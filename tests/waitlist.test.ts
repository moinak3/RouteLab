import { describe, expect, it } from "vitest";
import { parseWaitlistSignup } from "../src/core/waitlist";

describe("waitlist signup", () => {
  it("normalizes a valid signup", () => {
    expect(parseWaitlistSignup({
      email: "  Founder@Example.com ",
      name: "  Ada Lovelace ",
      company: "  Analytical Engines  ",
      useCase: "  Compare models for support workflows.  ",
    })).toEqual({
      ok: true,
      honeypot: false,
      signup: {
        email: "founder@example.com",
        name: "Ada Lovelace",
        company: "Analytical Engines",
        useCase: "Compare models for support workflows.",
      },
    });
  });

  it("rejects invalid email addresses", () => {
    expect(parseWaitlistSignup({ email: "not-an-email" })).toEqual({
      ok: false,
      error: "Enter a valid work email address.",
    });
  });

  it("silently accepts honeypot submissions without returning signup data", () => {
    expect(parseWaitlistSignup({ email: "bot@example.com", website: "https://spam.example" })).toEqual({
      ok: true,
      honeypot: true,
      signup: null,
    });
  });

  it("requires a description of the intended use", () => {
    expect(parseWaitlistSignup({ email: "founder@example.com", useCase: "" })).toEqual({
      ok: false,
      error: "Tell us how you would use RouteLab.",
    });
  });
});
