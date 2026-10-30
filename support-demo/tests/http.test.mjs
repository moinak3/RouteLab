import { describe, expect, it } from "vitest";
import { apiErrorMessage, readApiPayload, scopedSupportApiUrl, supportWorkspaceContext } from "../public/http.js";

describe("Test Console API responses", () => {
  it("reads successful JSON responses", async () => {
    const payload = await readApiPayload(new Response(JSON.stringify({ connected: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    expect(payload).toEqual({ connected: true });
  });

  it("preserves structured API error messages", async () => {
    const payload = await readApiPayload(new Response(JSON.stringify({ error: { message: "Policy unavailable." } }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }));

    expect(apiErrorMessage(payload, "Fallback")).toBe("Policy unavailable.");
  });

  it("turns non-JSON service failures into a useful message", async () => {
    const payload = await readApiPayload(new Response("A server error has occurred", { status: 500 }));

    expect(apiErrorMessage(payload, "Fallback")).toBe("The RouteLab support service is temporarily unavailable. Please try again.");
  });

  it("keeps support requests scoped to the workspace that opened the console", () => {
    expect(supportWorkspaceContext("?workspace=personal_abc123&workspaceLabel=My%20workspace")).toEqual({
      workspaceId: "personal_abc123",
      workspaceLabel: "My workspace",
    });
    expect(scopedSupportApiUrl("/api/support", "chat", "personal_abc123")).toBe("/api/support/chat?workspace=personal_abc123");
    expect(supportWorkspaceContext("?workspace=../../demo").workspaceId).toBe("demo");
  });
});
