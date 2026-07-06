import type { GoldenDataset } from "../types.js";

export const BASETEN_FINE_TUNE_DATASET_LIMIT = 48_000;

export const basetenOpenWeightModels = [
  "Mistral 7B Instruct",
  "LLaMA 3.1 8B",
  "LLaMA 3.3 70B",
  "Qwen 2.5 7B",
  "Qwen 2.5 32B",
];

const modelRepos: Record<string, string> = {
  "Mistral 7B Instruct": "mistralai/Mistral-7B-Instruct-v0.3",
  "LLaMA 3.1 8B": "meta-llama/Meta-Llama-3.1-8B-Instruct",
  "LLaMA 3.3 70B": "meta-llama/Llama-3.3-70B-Instruct",
  "Qwen 2.5 7B": "Qwen/Qwen2.5-7B-Instruct",
  "Qwen 2.5 32B": "Qwen/Qwen2.5-32B-Instruct",
};

const rowString = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
};

export function basetenModelRepo(baseModel: string) {
  return modelRepos[baseModel] ?? modelRepos["Qwen 2.5 7B"];
}

export function toSupervisedFineTuneJsonl(dataset: GoldenDataset) {
  return dataset.rows
    .map((row) => {
      const prompt = rowString(row, ["prompt", "prompt_text", "input", "question"]);
      const answer = rowString(row, ["human_answer", "reference_answer", "gold_answer", "answer", "agent_answer"]);
      if (!prompt || !answer) return null;
      return JSON.stringify({
        messages: [
          { role: "user", content: prompt },
          { role: "assistant", content: answer },
        ],
      });
    })
    .filter((row): row is string => row !== null)
    .join("\n");
}

export function slugForFineTuneJob(datasetName: string, baseModel: string) {
  const raw = `routelab-${datasetName}-${baseModel}`.toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "routelab-fine-tune";
}

export function buildBasetenStartCommands() {
  const writeDataset = [
    "python - <<'PY'",
    "import base64, os",
    "from pathlib import Path",
    "Path('/workspace/data').mkdir(parents=True, exist_ok=True)",
    "payload = os.environ['ROUTELAB_DATASET_JSONL_B64']",
    "Path('/workspace/data/train.jsonl').write_text(base64.b64decode(payload).decode('utf-8'))",
    "PY",
  ].join("\n");
  const writeTrainer = [
    "cat > /workspace/train_routelab_lora.py <<'PY'",
    "import os",
    "from pathlib import Path",
    "from datasets import load_dataset",
    "from peft import LoraConfig",
    "from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments",
    "from trl import SFTTrainer",
    "",
    "model_path = os.environ.get('ROUTELAB_BASE_MODEL_PATH', '/app/models/base')",
    "checkpoint_dir = Path(os.environ.get('BT_CHECKPOINT_DIR', '/tmp/training_checkpoints')) / 'routelab-lora'",
    "dataset = load_dataset('json', data_files='/workspace/data/train.jsonl', split='train')",
    "tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)",
    "if tokenizer.pad_token is None:",
    "    tokenizer.pad_token = tokenizer.eos_token",
    "model = AutoModelForCausalLM.from_pretrained(model_path, device_map='auto', trust_remote_code=True)",
    "peft_config = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, bias='none', task_type='CAUSAL_LM')",
    "args = TrainingArguments(",
    "    output_dir=str(checkpoint_dir),",
    "    per_device_train_batch_size=1,",
    "    gradient_accumulation_steps=4,",
    "    num_train_epochs=float(os.environ.get('ROUTELAB_EPOCHS', '1')),",
    "    learning_rate=float(os.environ.get('ROUTELAB_LEARNING_RATE', '0.0002')),",
    "    logging_steps=1,",
    "    save_strategy='epoch',",
    "    report_to=[],",
    ")",
    "trainer = SFTTrainer(",
    "    model=model,",
    "    tokenizer=tokenizer,",
    "    train_dataset=dataset,",
    "    peft_config=peft_config,",
    "    args=args,",
    "    max_seq_length=int(os.environ.get('ROUTELAB_MAX_SEQ_LENGTH', '2048')),",
    ")",
    "trainer.train()",
    "trainer.model.save_pretrained(checkpoint_dir)",
    "tokenizer.save_pretrained(checkpoint_dir)",
    "print(f'RouteLab LoRA checkpoint written to {checkpoint_dir}')",
    "PY",
  ].join("\n");
  return [
    "pip install -q 'transformers>=4.44.0' 'datasets>=2.20.0' 'peft>=0.12.0' 'accelerate>=0.33.0' 'trl>=0.9.6'",
    writeDataset,
    writeTrainer,
    "python /workspace/train_routelab_lora.py",
  ];
}

export function buildBasetenTrainingJobPayload(params: {
  dataset: GoldenDataset;
  baseModel: string;
  datasetJsonlB64: string;
  hfSecretName?: string;
}) {
  const modelRepo = basetenModelRepo(params.baseModel);
  const authSecretName = params.hfSecretName?.trim() || null;
  return {
    training_job: {
      name: slugForFineTuneJob(params.dataset.name, params.baseModel),
      image: {
        base_image: "pytorch/pytorch:2.4.1-cuda12.4-cudnn9-runtime",
        docker_auth: null,
      },
      compute: {
        node_count: 1,
        cpu_count: 8,
        memory: "48Gi",
        accelerator: {
          accelerator: "H100",
          count: 1,
        },
      },
      runtime: {
        start_commands: buildBasetenStartCommands(),
        environment_variables: {
          ROUTELAB_BASE_MODEL_REPO: modelRepo,
          ROUTELAB_BASE_MODEL_PATH: "/app/models/base",
          ROUTELAB_DATASET_JSONL_B64: params.datasetJsonlB64,
          ROUTELAB_DATASET_NAME: params.dataset.name,
        },
        enable_cache: true,
        cache_config: {
          enabled: true,
          mount_base_path: "/root/.cache",
          enable_legacy_hf_mount: true,
          require_cache_affinity: false,
        },
        checkpointing_config: {
          enabled: true,
          checkpoint_path: "/tmp/training_checkpoints",
          volume_size_gib: 20,
        },
        load_checkpoint_config: null,
      },
      truss_user_env: null,
      interactive_session: null,
      weights: [
        {
          allow_patterns: null,
          auth: null,
          auth_secret_name: authSecretName,
          ignore_patterns: null,
          mount_location: "/app/models/base",
          source: `hf://${modelRepo}@main`,
        },
      ],
      enable_baseten_workdir: false,
      priority: 0,
    },
  };
}
