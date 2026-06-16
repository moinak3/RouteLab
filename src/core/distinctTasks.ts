import type { Complexity, Domain, GroundingRequirement, InferredDistinctTask, NormalizedTrace, OutputFormat, OutputUncertainty, Risk, DistinctTaskField, TaskType, TemporalContext, ToolUse, DistinctTask, DistinctTaskBucket } from "../types";

type Inference<T> = { value: T; confidence: number; evidence: string[] };
const has = (text: string, words: string[]) => words.filter((word) => text.includes(word));
const inferByKeywords = <T extends string>(text: string, choices: Array<[T, string[]]>, fallback: T): Inference<T> => {
  for (const [value, words] of choices) {
    const matches = has(text, words);
    if (matches.length) return { value, confidence: Math.min(.98, .72 + matches.length * .06), evidence: [`Matched: ${matches.slice(0, 4).join(", ")}`] };
  }
  return { value: fallback, confidence: .42, evidence: ["No strong keyword signal"] };
};
const evidenceValues=(value:unknown):string=>{
  if(value===null||value===undefined)return "";
  if(typeof value==="string"||typeof value==="number"||typeof value==="boolean")return String(value);
  if(Array.isArray(value))return value.map(evidenceValues).join(" ");
  if(typeof value==="object")return Object.values(value as Record<string,unknown>).map(evidenceValues).join(" ");
  return "";
};
const combinedText = (trace: NormalizedTrace) => `${trace.messages?.map(message=>message.content).join(" ") ?? ""} ${trace.prompt_text ?? ""} ${trace.response_text ?? ""} ${evidenceValues(trace.metadata)} ${(trace.spans??[]).map(span=>`${span.type} ${span.name??""} ${evidenceValues(span.metadata)}`).join(" ")}`.toLowerCase();
const validJson = (text: string) => { try { JSON.parse(text); return true; } catch { return false; } };
const average = (values: number[]) => values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : 0;
const distinctTaskFields: DistinctTaskField[] = ["task_type","domain","complexity","temporal_context","tool_use","output_uncertainty","output_format","grounding_requirement"];
const taskTypes:TaskType[]=["summarization","extraction","classification_tagging","question_answering","rag_grounded_answers","customer_support_responses","policy_compliance_reasoning","code_generation","code_review_debugging","sql_data_query_generation","data_analysis_insight_generation","writing_editing","sales_marketing_content","translation_localization","document_review_legal_analysis","planning_strategy_recommendations","tool_use_function_calling","agentic_workflow_execution","moderation_safety_review","multimodal_document_image_understanding"];
const domains:Domain[]=["general","customer_support","billing","legal","compliance","finance","healthcare","sales","marketing","engineering","data","hr","education","operations","security","product","unknown"];
const numericMetadata = (trace:NormalizedTrace,keys:string[]) => {
  for(const key of keys){const value=Number(trace.metadata?.[key]);if(Number.isFinite(value))return value>1?Math.min(1,value/100):Math.max(0,value)}
  return undefined;
};
const repetitionRatio=(text:string)=>{
  const words=text.toLowerCase().match(/[a-z0-9]+/g)??[];
  return words.length<40?1:new Set(words).size/words.length;
};

export interface DistinctTaskClassifier { infer(trace: NormalizedTrace): InferredDistinctTask }
export class HeuristicDistinctTaskClassifier implements DistinctTaskClassifier {
  infer(trace: NormalizedTrace): InferredDistinctTask {
    const text=combinedText(trace); const response=(trace.response_text??"").trim(); const prompt=(trace.prompt_text??"").toLowerCase();
    const spanTypes=new Set((trace.spans??[]).map(span=>span.type)); const multipleTools=(trace.spans??[]).filter(span=>["tool","function","retriever","agent"].includes(span.type)).length;
    const tool:Inference<boolean>=multipleTools>0||["tool_caller","retriever"].includes(trace.workflow_role??"")||has(text,["use the database","use the api","calculator","browser tool","tool_call"]).length>0
      ? {value:true,confidence:.95,evidence:[multipleTools?`${multipleTools} tool/retriever/agent spans detected`:"Tool requirement detected in trace"]}
      : {value:false,confidence:.78,evidence:["No tool, function, retriever, or agent signal"]};
    const userTurns=trace.messages.filter(message=>message.role==="user").length;
    const explicitTurn=Number(trace.metadata?.turn_number??trace.metadata?.turn_index??0);
    const totalTurns=Number(trace.metadata?.total_turns??trace.metadata?.conversation_turns??0);
    const observedTurn=Math.max(userTurns,explicitTurn);
    const temporal:Inference<TemporalContext>=observedTurn<=1&&!trace.metadata?.session_id
      ? {value:"single_turn",confidence:.9,evidence:["One user turn and no session-continuation signal"]}
      : observedTurn>=4||totalTurns>=6
        ? {value:"late_multi_turn",confidence:.94,evidence:[`Turn ${observedTurn||"unknown"} of ${totalTurns||"an extended conversation"}`]}
        : {value:"early_multi_turn",confidence:.88,evidence:[`${Math.max(observedTurn,2)} observed conversation turns`]};
    const toolSpans=(trace.spans??[]).filter(span=>["tool","function","retriever"].includes(span.type));
    const toolEvidence=toolSpans.map(span=>`${span.name??span.type}: ${evidenceValues(span.metadata)} ${evidenceValues(span.output)}`.toLowerCase());
    const failedTools=toolEvidence.filter(value=>/error|failed|failure|timeout|exception|unavailable|status.?[:= ]?(4|5)\d\d/.test(value)).length;
    const recovered=has(text,["recovered","retry succeeded","fallback succeeded","handled the error","used fallback"]).length>0||Boolean(trace.metadata?.tool_recovered);
    const toolUse:Inference<ToolUse>=!tool.value
      ? {value:"none",confidence:.96,evidence:["No tool call was required"]}
      : failedTools===0
        ? {value:"success",confidence:toolSpans.length?.88:.62,evidence:[toolSpans.length?`${toolSpans.length} tool/retriever calls with no error signal`:"Tool required; no failure signal observed"]}
        : recovered
          ? {value:"recovered_failure",confidence:.94,evidence:[`${failedTools} tool call failure signal(s); recovery detected`]}
          : {value:"failed",confidence:.94,evidence:[`${failedTools} tool call failure signal(s); no recovery detected`]};
    const uncertaintyMatches=has(response.toLowerCase(),["i'm not sure","i am not sure","uncertain","may be","might be","could be","likely","possibly","cannot confirm","insufficient information","it depends"]);
    const certaintyMatches=has(response.toLowerCase(),["definitely","certainly","clearly","without doubt","is guaranteed","the answer is"]);
    const explicitUncertainty=numericMetadata(trace,["uncertainty_score","output_uncertainty_score"]);
    const uncertainty:Inference<OutputUncertainty>=explicitUncertainty!==undefined
      ? {value:explicitUncertainty>=.65?"high":explicitUncertainty>=.3?"medium":"low",confidence:.98,evidence:[`Explicit output uncertainty score: ${(explicitUncertainty*100).toFixed(0)}%`]}
      : uncertaintyMatches.length>=2
        ? {value:"high",confidence:.9,evidence:[`Hedging signals: ${uncertaintyMatches.slice(0,4).join(", ")}`]}
        : uncertaintyMatches.length===1
          ? {value:"medium",confidence:.82,evidence:[`Hedging signal: ${uncertaintyMatches[0]}`]}
          : {value:"low",confidence:certaintyMatches.length?.9:.72,evidence:[certaintyMatches.length?`Strong certainty signal: ${certaintyMatches.slice(0,3).join(", ")}`:"No uncertainty language detected"]};
    let format:Inference<OutputFormat>;
    const isSql=/^\s*(select|insert|update|delete|with)\b/i.test(response)||has(prompt,["write sql","sql query"]).length>0;
    const isCode=/```(?:ts|js|python|java|go|rust)|\b(function|const|def|class)\s+\w+/i.test(response)||has(prompt,["write code","implement a","generate code"]).length>0;
    if(validJson(response)) format={value:"json",confidence:.99,evidence:["Assistant output parses as JSON"]};
    else if(isSql) format={value:"sql",confidence:.97,evidence:["SQL syntax detected"]};
    else if(tool.value&&/tool.?call|function.?call/.test(text)) format={value:"tool_call",confidence:.93,evidence:["Tool call structure detected"]};
    else if(isCode) format={value:"code",confidence:.94,evidence:["Code syntax or code-generation request detected"]};
    else if(/^\s*<[\w-]+[\s>]/.test(response)) format={value:"xml",confidence:.92,evidence:["XML tags detected"]};
    else if(/(^|\n)#{1,4}\s|```|(^|\n)[*-]\s/.test(response)) format={value:"markdown",confidence:.86,evidence:["Markdown structure detected"]};
    else if(/\|.+\|.+\|/.test(response)||response.split("\n").filter(line=>line.split(",").length>2).length>1) format={value:"table",confidence:.82,evidence:["Tabular structure detected"]};
    else if(response.length<60&&has(prompt,["classify","categorize","tag","label"]).length) format={value:"classification_label",confidence:.9,evidence:["Short label output for classification prompt"]};
    else format={value:"natural_language",confidence:response.length > 0 ? .82 : .55,evidence:["No structured output syntax detected"]};
    let taskType:Inference<TaskType>=taskTypes.includes(trace.metadata?.task_type as TaskType)
      ? {value:trace.metadata?.task_type as TaskType,confidence:.99,evidence:[`Explicit task category: ${trace.metadata?.task_type}`]}
      : inferByKeywords<TaskType>(text,[
      ["agentic_workflow_execution",["research competitors","research → plan","plan → act","verify → report","multi-step tasks","create follow-up tasks","agent workflow"]],
      ["tool_use_function_calling",["use the tools","use the inventory api","shipping calculator","crm lookup","call the","use the api","calculator","tool_call"]],
      ["code_review_debugging",["code review","review this pr","review the diff","find bugs","debug","explain errors","severe bugs","pull request"]],
      ["sql_data_query_generation",["write sql","sql query","generate sql","weekly active users","data warehouse"]],
      ["code_generation",["write code","generate code","implement a function","create a function"]],
      ["summarization",["summarize","summary","tl;dr"]],
      ["extraction",["extract","parse fields","invoice","receipt","fields into json"]],
      ["classification_tagging",["classify","categorize","tag this","label this","intent","sentiment","priority"]],
      ["translation_localization",["translate","localize","localise","spanish","locale"]],
      ["moderation_safety_review",["unsafe content","toxicity","policy violation","moderate","harassment","self-harm","safety review"]],
      ["multimodal_document_image_understanding",["screenshot","image","pdf","diagram","chart image","form image","multimodal"]],
      ["document_review_legal_analysis",["contract clause","legal analysis","termination obligations","indemnity","liability cap"]],
      ["policy_compliance_reasoning",["complies with","compliance","policy requiring","data handling policy","regulatory"]],
      ["data_analysis_insight_generation",["analyze dashboard","analyze data","spreadsheet","metrics","dashboard","dataframe","experiment","trend"]],
      ["sales_marketing_content",["outbound email","ads","landing copy","positioning","campaign","marketing content","subject lines"]],
      ["writing_editing",["rewrite","edit this","improve clarity","change tone","draft a paragraph"]],
      ["planning_strategy_recommendations",["create a plan","rollout plan","plan the","steps and strategy","roadmap","recommend next steps","decision memo"]],
      ["customer_support_responses",["reply to the customer","support ticket","support faq","password reset","refund request","customer-facing reply"]],
      ["question_answering",["answer the question","question answering"]],
    ],"question_answering");
    if(spanTypes.has("retriever")&&format.value==="natural_language") taskType={value:"rag_grounded_answers",confidence:.97,evidence:["Retriever span with natural-language answer"]};
    else if(spanTypes.has("agent")) taskType={value:"agentic_workflow_execution",confidence:.97,evidence:["Agent span detected"]};
    else if(multipleTools>1) taskType={value:"tool_use_function_calling",confidence:.97,evidence:["Multiple tool or function spans detected"]};
    else if(format.value==="json"&&taskType.confidence<.6) taskType={value:"extraction",confidence:.8,evidence:["Structured JSON output suggests extraction"]};
    else if(format.value==="sql") taskType={value:"sql_data_query_generation",confidence:.97,evidence:["SQL output detected"]};
    else if(format.value==="code"&&taskType.confidence<.6) taskType={value:"code_generation",confidence:.85,evidence:["Code output detected"]};
    const domain:Inference<Domain>=domains.includes(trace.metadata?.domain as Domain)
      ? {value:trace.metadata?.domain as Domain,confidence:.99,evidence:[`Explicit domain: ${trace.metadata?.domain}`]}
      : inferByKeywords<Domain>(text,[
      ["healthcare",["diagnosis","symptoms","medication","patient","clinical","hipaa"]],
      ["security",["vulnerability","incident","authentication","permission","secret"]],
      ["legal",["contract","clause","legal","liability","terms of service"]],
      ["compliance",["compliance","audit","regulatory","soc2","gdpr"]],
      ["billing",["refund","invoice","payment","subscription","charge","dispute"]],
      ["finance",["financial","investment","tax","portfolio"]],
      ["sales",["lead","prospect","crm","sales outreach"]],
      ["marketing",["campaign","seo","marketing","positioning","ad copy"]],
      ["engineering",["code","pull request","repo","stack trace","bug"]],
      ["data",["sql","dataframe","warehouse","dashboard","metric"]],
      ["hr",["candidate","employee","performance review","termination","hr policy"]],
      ["product",["prd","feature","user story","product roadmap"]],
      ["customer_support",["customer support","support ticket","password reset"]],
      ["operations",["operations","runbook","fulfillment","inventory"]],
      ["education",["student","lesson","curriculum"]],
    ],"general");
    const total=trace.total_tokens||((trace.input_tokens??0)+(trace.output_tokens??0))||Math.ceil(((trace.prompt_text?.length??0)+(trace.response_text?.length??0))/4);
    let grounding:Inference<GroundingRequirement>;
    if(has(prompt,["cite sources","include citations","with citations"]).length||/\[[0-9]+\]/.test(response)) grounding={value:"source_citation_required",confidence:.94,evidence:["Citation requirement or citations detected"]};
    else if(spanTypes.has("retriever")||has(text,["retrieved_context","context chunks"]).length) grounding={value:"retrieval_augmented",confidence:.97,evidence:["Retriever or retrieved context detected"]};
    else if(has(text,["according to policy","refund policy","company policy","compliance policy","support policy","account access policy","safety moderation policy","terms and guidelines"]).length) grounding={value:"policy_grounded",confidence:.92,evidence:["Policy-grounding language detected"]};
    else if(tool.value) grounding={value:"tool_grounded",confidence:.86,evidence:["Answer depends on a tool, API, database, or retriever"]};
    else if(has(prompt,["provided context","use the following context","based on this document"]).length) grounding={value:"provided_context",confidence:.9,evidence:["Provided context instruction detected"]};
    else grounding={value:"none",confidence:.7,evidence:["No grounding requirement detected"]};
    const visibleMatches=has(text,["reply to the customer","send to user","draft response","customer-facing","support chat"]);
    const internalMatches=has(text,["internal summary","internal classification","backoffice","developer tooling","internal analytics"]);
    const visibility:Inference<boolean>=visibleMatches.length?{value:true,confidence:.93,evidence:[`Customer-facing signal: ${visibleMatches.join(", ")}`]}:trace.metadata?.internal?{value:false,confidence:.94,evidence:["Metadata marks trace as internal"]}:internalMatches.length?{value:false,confidence:.93,evidence:[`Internal signal: ${internalMatches.join(", ")}`]}:{value:false,confidence:.48,evidence:["No explicit user-visibility signal; defaulted to internal"]};
    let risk:Inference<Risk>;
    if(["legal","compliance","healthcare","security"].includes(domain.value)||domain.value==="hr"&&has(text,["decision","termination","candidate"]).length||["policy_compliance_reasoning","document_review_legal_analysis","moderation_safety_review"].includes(taskType.value)||taskType.value==="rag_grounded_answers"&&grounding.value==="source_citation_required") risk={value:"high",confidence:.94,evidence:[["policy_compliance_reasoning","document_review_legal_analysis","moderation_safety_review"].includes(taskType.value)?"High-stakes support task category":domain.value==="general"?"Source-cited grounded answer is treated as high risk":`${domain.value} is treated as high risk`]};
    else if(visibility.value||["billing","customer_support"].includes(domain.value)||["code_review_debugging","code_generation","data_analysis_insight_generation"].includes(taskType.value)||grounding.value==="policy_grounded") risk={value:"medium",confidence:.82,evidence:["Customer-facing, policy-grounded, production, or decision-impacting workload"]};
    else if(["summarization","extraction","classification_tagging","writing_editing","sales_marketing_content","translation_localization"].includes(taskType.value)) risk={value:"low",confidence:.82,evidence:["Low-stakes internal or deterministic workload"]};
    else risk={value:"medium",confidence:.52,evidence:["Conservative medium-risk fallback"]};
    const externalDifficulty=numericMetadata(trace,["complexity_score","difficulty_score","llm_difficulty_score","embedding_complexity_score"]);
    const complexityEvidence:string[]=[]; let complexityScore=0;
    if(total>=12000){complexityScore+=2;complexityEvidence.push(`${total.toLocaleString()} tokens add substantial context load`)}
    else if(total>=1500){complexityScore+=1;complexityEvidence.push(`${total.toLocaleString()} tokens add moderate context load`)}
    else complexityEvidence.push(`${total.toLocaleString()} tokens add little context load`);
    if(["legal","compliance","healthcare","security","finance"].includes(domain.value)){complexityScore+=2;complexityEvidence.push(`${domain.value} language is dense and precision-sensitive`)}
    if(["document_review_legal_analysis","policy_compliance_reasoning"].includes(taskType.value)){complexityScore+=3;complexityEvidence.push(`${taskType.value.replaceAll("_"," ")} requires high-precision support reasoning`)}
    else if(["rag_grounded_answers","code_generation","code_review_debugging","sql_data_query_generation","data_analysis_insight_generation","planning_strategy_recommendations","tool_use_function_calling","agentic_workflow_execution","multimodal_document_image_understanding"].includes(taskType.value)){complexityScore+=1;complexityEvidence.push(`${taskType.value.replaceAll("_"," ")} requires multi-step reasoning or verification`)}
    if(tool.value||grounding.value!=="none"){complexityScore+=1;complexityEvidence.push(`${tool.value?"Tool use":grounding.value.replaceAll("_"," ")} increases dependency complexity`)}
    const constraintMatches=has(text,["cite","cite sources","exactly","strict","schema","severe bugs","compliance","liability","calculate","multi-step"]);
    if(constraintMatches.length){complexityScore+=1;complexityEvidence.push(`Constraint signals: ${constraintMatches.slice(0,3).join(", ")}`)}
    const repetition=repetitionRatio(trace.prompt_text??"");
    if(repetition<.38){complexityScore-=2;complexityEvidence.push("Highly repetitive input reduces semantic complexity")}
    if(trace.metadata?.mock_difficulty==="hard"){complexityScore+=1;complexityEvidence.push("Historical difficulty signal marks this workload hard")}
    if(trace.metadata?.mock_difficulty==="easy"){complexityScore-=1;complexityEvidence.push("Historical difficulty signal marks this workload easy")}
    if(externalDifficulty!==undefined){complexityScore+=externalDifficulty>=.7?3:externalDifficulty>=.4?1:-1;complexityEvidence.push(`External embedding/LLM difficulty score: ${(externalDifficulty*100).toFixed(0)}%`)}
    const complexity:Inference<Complexity>={value:complexityScore>=4?"high":complexityScore>=2?"medium":"low",confidence:externalDifficulty===undefined?.84:.97,evidence:complexityEvidence.slice(0,4)};
    const fields={task_type:taskType,domain,complexity,temporal_context:temporal,tool_use:toolUse,output_uncertainty:uncertainty,output_format:format,grounding_requirement:grounding};
    const distinctTask=Object.fromEntries(distinctTaskFields.map(field=>[field,fields[field].value])) as DistinctTask;
    const confidence=Object.fromEntries(distinctTaskFields.map(field=>[field,fields[field].confidence])) as Record<DistinctTaskField,number>;
    const evidence=Object.fromEntries(distinctTaskFields.map(field=>[field,fields[field].evidence])) as Record<DistinctTaskField,string[]>;
    const overall=average(Object.values(confidence));
    return {trace_id:trace.id,task:distinctTask,confidence,evidence,overall_confidence:overall,risk_level:risk.value,customer_facing:visibility.value,task_status:risk.confidence<.6||visibility.confidence<.6||overall<.65?"low_confidence_needs_review":"inferred"};
  }
}
export const distinctTaskKey=(task:DistinctTask)=>[task.task_type,task.domain,task.complexity,task.temporal_context,task.tool_use,task.output_uncertainty,task.output_format,task.grounding_requirement].join("|");
const hash=(value:string)=>{let result=2166136261;for(const char of value){result^=char.charCodeAt(0);result=Math.imul(result,16777619)}return (result>>>0).toString(36)};
const title=(value:string)=>value.replaceAll("_"," ");
export const bucketName=(task:DistinctTask)=>`${title(task.domain)} ${title(task.task_type)}, ${task.complexity} complexity, ${title(task.temporal_context)}, ${title(task.tool_use)} tools`;
export function createDistinctTaskBuckets(traces:NormalizedTrace[], classifier:DistinctTaskClassifier=new HeuristicDistinctTaskClassifier()):DistinctTaskBucket[]{
  const inferred=traces.map(trace=>({trace,result:classifier.infer(trace)})); const groups=new Map<string,typeof inferred>();
  inferred.forEach(item=>{const key=distinctTaskKey(item.result.task);const group=groups.get(key);if(group)group.push(item);else groups.set(key,[item])});
  return [...groups.entries()].map(([key,items])=>{
    const task=items[0].result.task;
    const riskOrder:Risk[]=["low","medium","high"];
    const riskLevel=items.map(item=>item.result.risk_level).sort((a,b)=>riskOrder.indexOf(b)-riskOrder.indexOf(a))[0]??"medium";
    const evidence=Object.fromEntries(distinctTaskFields.map(field=>[field,[...new Set(items.flatMap(item=>item.result.evidence[field]))].slice(0,3)])) as Record<DistinctTaskField,string[]>;
    return {
      bucket_id:`task_${hash(key)}`,bucket_name:bucketName(task),task,traces:items.map(item=>item.trace.id),trace_count:items.length,
      total_cost_usd:items.reduce((s,i)=>s+(i.trace.cost_usd??0),0),avg_cost_usd:average(items.map(i=>i.trace.cost_usd??0)),
      total_tokens:items.reduce((s,i)=>s+i.trace.total_tokens,0),avg_input_tokens:average(items.map(i=>i.trace.input_tokens)),
      avg_output_tokens:average(items.map(i=>i.trace.output_tokens)),avg_latency_ms:average(items.map(i=>i.trace.latency_ms??0)),
      avg_confidence:average(items.map(i=>i.result.overall_confidence)),low_confidence_count:items.filter(i=>i.result.task_status==="low_confidence_needs_review").length,
      risk_level:riskLevel,customer_facing:items.some(item=>item.result.customer_facing),
      evidence,examples:items.slice(0,3).map(i=>({trace_id:i.trace.id,prompt_preview:i.trace.prompt_text.slice(0,140),response_preview:(i.trace.response_text??"").slice(0,140)})),
    };
  }).sort((a,b)=>b.trace_count-a.trace_count);
}
