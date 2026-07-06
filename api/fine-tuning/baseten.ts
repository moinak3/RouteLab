import { buildBasetenTrainingJobPayload, BASETEN_FINE_TUNE_DATASET_LIMIT, toSupervisedFineTuneJsonl } from "../../src/core/basetenFineTuning.js";
import type { GoldenDataset } from "../../src/types.js";
import { sendJson } from "../live/_shared.js";

const BASETEN_API_BASE = "https://api.baseten.co/v1";

const serverBasetenKey = () =>
  String(process.env.ROUTELAB_BASETEN_API_KEY ?? process.env.BASETEN_API_KEY ?? "").trim();

const serverBasetenProjectId = () =>
  String(process.env.ROUTELAB_BASETEN_TRAINING_PROJECT_ID ?? process.env.BASETEN_TRAINING_PROJECT_ID ?? "").trim();

const serverBasetenProjectName = () =>
  String(process.env.ROUTELAB_BASETEN_TRAINING_PROJECT_NAME ?? process.env.BASETEN_TRAINING_PROJECT_NAME ?? "RouteLab fine-tuning").trim();

const serverHfSecretName = () =>
  String(process.env.ROUTELAB_BASETEN_HF_SECRET_NAME ?? process.env.BASETEN_HF_SECRET_NAME ?? "HF_TOKEN").trim();

const basetenFetch = async (path: string, apiKey: string, body: unknown) => {
  const response = await fetch(`${BASETEN_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const message = payload?.message ?? payload?.error ?? payload?.raw ?? `BaseTen request failed with ${response.status}`;
    throw new Error(String(message));
  }
  return payload;
};

const assertGoldenDataset = (value: unknown): GoldenDataset => {
  const dataset = value as GoldenDataset | undefined;
  if (!dataset?.id || !dataset.name || !Array.isArray(dataset.rows) || !dataset.rows.length) {
    throw new Error("A non-empty golden dataset is required to start BaseTen fine-tuning.");
  }
  return dataset;
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const apiKey = serverBasetenKey();
    if (!apiKey) {
      return sendJson(res, 400, {
        error: "BaseTen fine-tuning is not configured. Set BASETEN_API_KEY or ROUTELAB_BASETEN_API_KEY on the server.",
      });
    }

    const dataset = assertGoldenDataset(body?.dataset);
    const baseModel = String(body?.baseModel ?? "Qwen 2.5 7B");
    const datasetJsonl = toSupervisedFineTuneJsonl(dataset);
    if (!datasetJsonl.trim()) {
      return sendJson(res, 400, { error: "The selected dataset does not contain usable prompt/answer rows." });
    }
    if (datasetJsonl.length > BASETEN_FINE_TUNE_DATASET_LIMIT) {
      return sendJson(res, 413, {
        error: `Dataset is too large for the inline BaseTen starter job (${datasetJsonl.length.toLocaleString()} characters). Upload a smaller calibration set or wire object storage for full-scale training.`,
      });
    }

    let projectId = serverBasetenProjectId();
    let trainingProject: any = undefined;
    if (!projectId) {
      const projectPayload = await basetenFetch("/training_projects", apiKey, {
        training_project: { name: serverBasetenProjectName() },
      });
      trainingProject = projectPayload.training_project;
      projectId = String(trainingProject?.id ?? "");
    }
    if (!projectId) throw new Error("BaseTen did not return a training project id.");

    const datasetJsonlB64 = Buffer.from(datasetJsonl, "utf8").toString("base64");
    const jobPayload = buildBasetenTrainingJobPayload({
      dataset,
      baseModel,
      datasetJsonlB64,
      hfSecretName: serverHfSecretName(),
    });
    const jobResponse = await basetenFetch(`/training_projects/${projectId}/jobs`, apiKey, jobPayload);
    const trainingJob = jobResponse.training_job;

    return sendJson(res, 200, {
      provider: "BaseTen",
      training_project: trainingProject ?? trainingJob?.training_project ?? { id: projectId },
      training_job: trainingJob,
      model_repo: jobPayload.training_job.runtime.environment_variables.ROUTELAB_BASE_MODEL_REPO,
      dataset_rows: dataset.row_count,
    });
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "BaseTen fine-tuning failed." });
  }
}
