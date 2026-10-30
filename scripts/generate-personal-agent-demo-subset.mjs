import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePath = resolve("datasets/personal-agent/personal-agent-traces-300.jsonl");
const datasetDirectory = resolve("datasets/personal-agent");
const publicDirectory = resolve("public/examples");
const source = (await readFile(sourcePath, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const taskGroupIds = [...new Set(source.map((trace) => trace.metadata?.task_group).filter(Boolean))];
const selected = taskGroupIds.flatMap((taskGroupId, groupIndex) => {
  const group = source.filter((trace) => trace.metadata?.task_group === taskGroupId);
  const happy = group.filter((trace) => trace.metadata?.case_type === "happy");
  const unhappy = group.filter((trace) => trace.metadata?.case_type === "unhappy");
  const edge = group.filter((trace) => trace.metadata?.case_type === "edge");
  const happyCount = groupIndex < 10 ? 4 : 3;
  return [
    ...happy.slice(0, happyCount),
    ...unhappy.slice(0, 2),
    edge[groupIndex % 2],
  ];
});

if (selected.length !== 100) {
  throw new Error(`Expected a 100-trace demo subset, received ${selected.length}.`);
}

const json = `${JSON.stringify(selected)}\n`;
const jsonl = `${selected.map((trace) => JSON.stringify(trace)).join("\n")}\n`;

await Promise.all([
  mkdir(datasetDirectory, { recursive: true }),
  mkdir(publicDirectory, { recursive: true }),
]);
await Promise.all([
  writeFile(resolve(datasetDirectory, "personal-agent-traces-100.json"), json),
  writeFile(resolve(datasetDirectory, "personal-agent-traces-100.jsonl"), jsonl),
  writeFile(resolve(publicDirectory, "personal-agent-traces-100.json"), json),
]);

console.log(JSON.stringify({
  trace_count: selected.length,
  task_groups: taskGroupIds.length,
  case_distribution: Object.fromEntries(["happy", "unhappy", "edge"].map((caseType) => [
    caseType,
    selected.filter((trace) => trace.metadata?.case_type === caseType).length,
  ])),
  pass_distribution: {
    passed: selected.filter((trace) => trace.metadata?.eval_passed).length,
    failed: selected.filter((trace) => !trace.metadata?.eval_passed).length,
  },
}, null, 2));
