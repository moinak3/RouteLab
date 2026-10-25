export type WaitlistSignup = {
  email: string;
  name: string;
  company: string;
  useCase: string;
};

export type WaitlistSignupResult =
  | { ok: true; signup: WaitlistSignup; honeypot: false }
  | { ok: true; signup: null; honeypot: true }
  | { ok: false; error: string };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (value: unknown) => String(value ?? "").trim();

export function parseWaitlistSignup(value: unknown): WaitlistSignupResult {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (text(input.website)) return { ok: true, signup: null, honeypot: true };

  const email = text(input.email).toLowerCase();
  const name = text(input.name);
  const company = text(input.company);
  const useCase = text(input.useCase);

  if (!email || email.length > 254 || !emailPattern.test(email)) {
    return { ok: false, error: "Enter a valid work email address." };
  }
  if (name.length > 120) return { ok: false, error: "Name must be 120 characters or fewer." };
  if (company.length > 160) return { ok: false, error: "Company must be 160 characters or fewer." };
  if (!useCase) return { ok: false, error: "Tell us how you would use RouteLab." };
  if (useCase.length > 1_200) return { ok: false, error: "Use case must be 1,200 characters or fewer." };

  return { ok: true, signup: { email, name, company, useCase }, honeypot: false };
}
