import { mkdirSync, writeFileSync } from "node:fs";
import { buildBenchmarkPriorRecommendation } from "../src/core/benchmarkPriors";
import { DistinctTaskEvalPlanGenerator } from "../src/core/evalPlans";
import { createDistinctTaskSeedTraces } from "../src/core/distinctTaskSeed";
import { createDistinctTaskBuckets, HeuristicDistinctTaskClassifier } from "../src/core/distinctTasks";

const traces=createDistinctTaskSeedTraces(); const classifier=new HeuristicDistinctTaskClassifier();
const tasks=traces.map(trace=>classifier.infer(trace)); const buckets=createDistinctTaskBuckets(traces,classifier);
const generator=new DistinctTaskEvalPlanGenerator(); const plans=buckets.map(bucket=>generator.generate(bucket));
const enums={
  task_type:["summarization","extraction","classification_tagging","question_answering","rag_grounded_answers","customer_support_responses","policy_compliance_reasoning","code_generation","code_review_debugging","sql_data_query_generation","data_analysis_insight_generation","writing_editing","sales_marketing_content","translation_localization","document_review_legal_analysis","planning_strategy_recommendations","tool_use_function_calling","agentic_workflow_execution","moderation_safety_review","multimodal_document_image_understanding"],
  domain:["general","customer_support","billing","legal","compliance","finance","healthcare","sales","marketing","engineering","data","hr","education","operations","security","product","unknown"],
  complexity:["low","medium","high"],output_format:["natural_language","json","yaml","xml","markdown","table","code","sql","tool_call","classification_label","mixed","unknown"],
  temporal_context:["single_turn","early_multi_turn","late_multi_turn"],tool_use:["none","success","recovered_failure","failed"],output_uncertainty:["low","medium","high"],
  grounding_requirement:["none","provided_context","retrieval_augmented","source_citation_required","policy_grounded","tool_grounded","unknown"],
} as const;
if(tasks.length!==traces.length)throw new Error("A trace is missing a task");
for(const inferred of tasks)for(const [field,values] of Object.entries(enums))if(!values.includes(inferred.task[field as keyof typeof enums] as never))throw new Error(`Invalid ${field} enum value`);
if(buckets.length<10)throw new Error(`Expected at least 10 buckets, received ${buckets.length}`);
if(plans.length!==buckets.length)throw new Error("A bucket is missing an eval plan");
if(buckets.some(bucket=>bucket.risk_level==="high"&&!plans.find(plan=>plan.bucket_id===bucket.bucket_id)?.human_review_required))throw new Error("A high-risk bucket does not require human review");
mkdirSync("artifacts",{recursive:true});
const report={total_traces:traces.length,total_buckets:buckets.length,buckets:buckets.map(bucket=>({...bucket,eval_plan:plans.find(plan=>plan.bucket_id===bucket.bucket_id),benchmark_prior:buildBenchmarkPriorRecommendation(bucket.task)}))};
writeFileSync("artifacts/trace-task-report.json",JSON.stringify({total_traces:traces.length,total_buckets:buckets.length,tasks,buckets},null,2));
writeFileSync("artifacts/eval-plan-report.json",JSON.stringify(report,null,2));
console.log(`Distinct Task evaluation passed: ${traces.length} traces, ${buckets.length} buckets, ${plans.length} eval plans.`);
