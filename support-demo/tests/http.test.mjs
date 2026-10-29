import { describe, expect, it } from "vitest";
import { apiErrorMessage, readApiPayload } from "../public/http.js";

describe("Support Console API responses", () => {
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
});
