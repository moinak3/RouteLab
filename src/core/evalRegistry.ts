import type { EvalDefinition } from "./evalDefinitions";

export type StoredEvalVersion = {
  version: number;
  createdAt: string;
  definition: EvalDefinition;
};

export type ActiveEvalConfig = {
  version: number;
  definition: EvalDefinition;
};

export const EVAL_DEFINITIONS_STORAGE_PREFIX = "routelab-eval-definitions-v2:";
export const EVAL_VERSIONS_STORAGE_PREFIX = "routelab-eval-versions-v2:";
export const ACTIVE_EVAL_VERSION_STORAGE_PREFIX = "routelab-active-eval-version-v2:";

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function loadStoredEvalDefinitions(workspaceId: string): EvalDefinition[] | null {
  try {
    const parsed = JSON.parse(browserStorage()?.getItem(`${EVAL_DEFINITIONS_STORAGE_PREFIX}${workspaceId}`) ?? "null") as EvalDefinition[] | null;
    return Array.isArray(parsed) && parsed.every((item) => typeof item?.id === "string" && typeof item?.name === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function loadStoredEvalVersions(workspaceId: string): StoredEvalVersion[] | null {
  try {
    const parsed = JSON.parse(browserStorage()?.getItem(`${EVAL_VERSIONS_STORAGE_PREFIX}${workspaceId}`) ?? "null") as StoredEvalVersion[] | null;
    return Array.isArray(parsed)
      && parsed.every((item) => Number.isInteger(item?.version) && typeof item?.createdAt === "string" && typeof item?.definition?.id === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function loadStoredActiveEvalVersion(workspaceId: string) {
  const parsed = Number(browserStorage()?.getItem(`${ACTIVE_EVAL_VERSION_STORAGE_PREFIX}${workspaceId}`));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function loadActiveEvalConfig(workspaceId: string): ActiveEvalConfig | undefined {
  const versions = loadStoredEvalVersions(workspaceId);
  if (!versions?.length) return undefined;
  const requestedVersion = loadStoredActiveEvalVersion(workspaceId);
  const active = versions.find((item) => item.version === requestedVersion) ?? versions.at(-1);
  return active ? { version: active.version, definition: active.definition } : undefined;
}
