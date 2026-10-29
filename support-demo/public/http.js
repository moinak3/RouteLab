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
