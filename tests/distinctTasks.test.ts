import { describe, expect, it } from "vitest";
import { DistinctTaskEvalPlanGenerator } from "../src/core/evalPlans";
import { createDistinctTaskSeedTraces } from "../src/core/distinctTaskSeed";
import { createDistinctTaskBuckets, HeuristicDistinctTaskClassifier } from "../src/core/distinctTasks";
import type { Trace } from "../src/types";

const traces=createDistinctTaskSeedTraces(); const classifier=new HeuristicDistinctTaskClassifier();
const by=(key:string)=>traces.find(trace=>trace.id.includes(key))!;
describe("distinct task classifier",()=>{
  it("infers core task categories and formats",()=>{
    expect(classifier.infer(by("extraction")).task).toMatchObject({task_type:"extraction",output_format:"json"});
    expect(classifier.infer(by("customer_support_responses")).task).toMatchObject({task_type:"customer_support_responses",grounding_requirement:"policy_grounded"});
    expect(classifier.infer(by("customer_support_responses")).customer_facing).toBe(true);
    expect(classifier.infer(by("rag_grounded_answers")).task).toMatchObject({task_type:"rag_grounded_answers",grounding_requirement:"source_citation_required"});
    expect(classifier.infer(by("rag_grounded_answers")).risk_level).toBe("high");
    expect(classifier.infer(by("code_generation")).task).toMatchObject({task_type:"code_generation",output_format:"code"});
    expect(classifier.infer(by("code_review_debugging")).task.task_type).toBe("code_review_debugging");
    expect(classifier.infer(by("sql_data_query_generation")).task).toMatchObject({task_type:"sql_data_query_generation",output_format:"sql"});
  });
  it("infers tools and complexity and marks uncertainty",()=>{
    expect(classifier.infer(by("tool_use_function_calling")).task.tool_use).toBe("success");
    expect(classifier.infer(by("rag_grounded_answers")).task.complexity).toBe("high");
    const uncertain={...by("extraction"),id:"uncertain",prompt_text:"Do something useful",response_text:"Okay",messages:[{role:"user" as const,content:"Do something useful"}],metadata:{},input_tokens:50,output_tokens:10,total_tokens:60};
    expect(classifier.infer(uncertain).task_status).toBe("low_confidence_needs_review");
  });
  it("treats semantic difficulty as more important than length",()=>{
    const denseLegal={...by("document_review_legal_analysis"),id:"dense-legal",prompt_text:"Interpret this short indemnity clause for compliance and liability risk.",messages:[{role:"user" as const,content:"Interpret this short indemnity clause for compliance and liability risk."}],input_tokens:500,output_tokens:100,total_tokens:600};
    const repetitiveText=Array.from({length:500},()=>"routine status update repeated for archival summary").join(" ");
    const repetitive={...by("summarization"),id:"long-repetitive",prompt_text:repetitiveText,messages:[{role:"user" as const,content:repetitiveText}],input_tokens:2000,output_tokens:100,total_tokens:2100};
    expect(classifier.infer(denseLegal).task.complexity).toBe("high");
    expect(classifier.infer(repetitive).task.complexity).toBe("low");
  });
  it("infers session position, tool outcomes, and expressed uncertainty",()=>{
    const lateRecovered={...by("tool_use_function_calling"),id:"late-recovered",messages:[
      {role:"user" as const,content:"Check inventory"},{role:"assistant" as const,content:"Checking"},{role:"user" as const,content:"Also calculate shipping"},
      {role:"assistant" as const,content:"The inventory API timed out"},{role:"user" as const,content:"Retry and finish"},
    ],response_text:"The retry succeeded. Inventory is available, but shipping may be delayed.",spans:[
      {id:"inventory",type:"tool" as const,name:"inventory API",output:{error:"timeout"},metadata:{status:"error"}},
      {id:"retry",type:"tool" as const,name:"inventory API retry",output:{available:true},metadata:{status:"success"}},
    ],metadata:{turn_number:5,total_turns:7,tool_recovered:true}};
    expect(classifier.infer(lateRecovered).task).toMatchObject({temporal_context:"late_multi_turn",tool_use:"recovered_failure",output_uncertainty:"medium"});
    const failed={...lateRecovered,id:"failed-tool",response_text:"I cannot complete the request.",metadata:{turn_number:2},spans:[{id:"inventory",type:"tool" as const,name:"inventory API",output:{error:"timeout"},metadata:{status:"error"}}]};
    expect(classifier.infer(failed).task.tool_use).toBe("failed");
  });
});
describe("distinct task buckets",()=>{
  const buckets=createDistinctTaskBuckets(traces,classifier);
  it("groups exact tasks with deterministic IDs and metrics",()=>{
    const again=createDistinctTaskBuckets(traces,classifier);
    expect(buckets).toHaveLength(20);
    expect(buckets.map(bucket=>bucket.bucket_id)).toEqual(again.map(bucket=>bucket.bucket_id));
    expect(buckets.every(bucket=>bucket.trace_count===3&&bucket.total_tokens>0&&bucket.avg_latency_ms&&bucket.examples.length===3)).toBe(true);
  });
});
describe("task eval plans",()=>{
  const buckets=createDistinctTaskBuckets(traces,classifier); const generator=new DistinctTaskEvalPlanGenerator();
  const planFor=(key:string)=>generator.generate(buckets.find(bucket=>bucket.traces.some(id=>id.includes(key)))!);
  const required=(key:string)=>planFor(key).required_evals.map(item=>item.eval_type);
  it("maps deterministic and grounded tasks to appropriate evals",()=>{
    expect(required("extraction")).toEqual(expect.arrayContaining(["json_schema_validation","field_level_exact_match"]));
    expect(required("customer_support_responses")).toEqual(expect.arrayContaining(["policy_compliance_judge","groundedness_judge"]));
    expect(required("rag_grounded_answers")).toEqual(expect.arrayContaining(["groundedness_judge","citation_accuracy","human_review_sample"]));
    expect(required("code_generation")).toEqual(expect.arrayContaining(["unit_tests","compile_check"]));
    expect(required("sql_data_query_generation")).toEqual(expect.arrayContaining(["sql_parse","sql_execution"]));
  });
  it("requires human review for high risk but not internal summarization",()=>{
    expect(planFor("rag_grounded_answers").human_review_required).toBe(true);
    expect(planFor("summarization").human_review_required).toBe(false);
  });
  it("adds specialized evals for multi-turn, tool recovery, and confident consequential answers",()=>{
    const base=by("customer_support_responses");
    const specialized={...base,id:"specialized",messages:[
      {role:"user" as const,content:"I need a refund"},{role:"assistant" as const,content:"Let me check"},{role:"user" as const,content:"Please retry"},
      {role:"assistant" as const,content:"The first lookup failed"},{role:"user" as const,content:"What is the final answer?"},
    ],response_text:"The answer is definitely that your refund is approved.",spans:[{id:"policy",type:"tool" as const,name:"refund lookup",output:{error:"timeout"},metadata:{status:"error"}}],metadata:{turn_number:5,total_turns:7}};
    const bucket=createDistinctTaskBuckets([specialized],classifier)[0];
    const plan=generator.generate(bucket); const evals=plan.required_evals.map(item=>item.eval_type);
    expect(evals).toEqual(expect.arrayContaining(["context_retention","instruction_adherence","tool_error_recovery","uncertainty_calibration"]));
    expect(plan.human_review_required).toBe(true);
  });
});
