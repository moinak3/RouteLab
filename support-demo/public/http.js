export async function readApiPayload(response) {
  const body = await response.text();
  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    return {
      error: {
        message: response.ok
          ? "RouteLab returned an unreadable response. Please try again."
          : "The RouteLab support service is temporarily unavailable. Please try again.",
        type: "invalid_response",
      },
    };
  }
}

export function apiErrorMessage(payload, fallback) {
  if (typeof payload?.error === "string" && payload.error.trim()) return payload.error.trim();
  if (typeof payload?.error?.message === "string" && payload.error.message.trim()) return payload.error.message.trim();
  if (typeof payload?.message === "string" && payload.message.trim()) return payload.message.trim();
  return fallback;
}

const workspaceIdPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/i;

export function supportWorkspaceContext(search = "") {
  const params = new URLSearchParams(search);
  const requested = String(params.get("workspace") ?? "").trim();
  const workspaceId = workspaceIdPattern.test(requested) ? requested : "demo";
  const requestedLabel = String(params.get("workspaceLabel") ?? "").trim();
  const workspaceLabel = requestedLabel || (workspaceId === "demo" ? "RouteLab demo" : "My workspace");
  return { workspaceId, workspaceLabel };
}

export function scopedSupportApiUrl(apiBase, path, workspaceId) {
  return `${apiBase}/${path}?workspace=${encodeURIComponent(workspaceId)}`;
}
