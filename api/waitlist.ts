import { neon } from "@neondatabase/serverless";
import { parseWaitlistSignup } from "../src/core/waitlist.js";
import { sendJson } from "./live/_shared.js";

let initializedForUrl = "";
let initialization: Promise<unknown> | null = null;

async function syncToGoogleSheet(signup: { email: string; name: string; company: string; useCase: string }) {
  const url = String(process.env.ROUTELAB_WAITLIST_SHEETS_WEBHOOK_URL ?? "").trim();
  const secret = String(process.env.ROUTELAB_WAITLIST_SHEETS_WEBHOOK_SECRET ?? "").trim();
  if (!url || !secret) return { configured: false, synced: false, error: "" } as const;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        submittedAt: new Date().toISOString(),
        ...signup,
        source: "marketing",
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Google Sheets webhook returned ${response.status}.`);
    return { configured: true, synced: true, error: "" } as const;
  } catch (error) {
    return {
      configured: true,
      synced: false,
      error: error instanceof Error ? error.message.slice(0, 240) : "Google Sheets sync failed.",
    } as const;
  } finally {
    clearTimeout(timeout);
  }
}

function waitlistStore(databaseUrl: string) {
  if (!databaseUrl) throw new Error("Waitlist storage is not configured.");
  const sql = neon(databaseUrl);
  if (initializedForUrl !== databaseUrl || !initialization) {
    initializedForUrl = databaseUrl;
    initialization = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS routelab_waitlist (
          email text PRIMARY KEY,
          name text NOT NULL DEFAULT '',
          company text NOT NULL DEFAULT '',
          use_case text NOT NULL DEFAULT '',
          source text NOT NULL DEFAULT 'marketing',
          sheet_synced_at timestamptz,
          sheet_sync_error text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`ALTER TABLE routelab_waitlist ADD COLUMN IF NOT EXISTS use_case text NOT NULL DEFAULT ''`;
      await sql`ALTER TABLE routelab_waitlist ADD COLUMN IF NOT EXISTS sheet_synced_at timestamptz`;
      await sql`ALTER TABLE routelab_waitlist ADD COLUMN IF NOT EXISTS sheet_sync_error text`;
    })();
  }
  return { sql, ready: initialization };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });

  const parsed = parseWaitlistSignup(req.body);
  if ("error" in parsed) return sendJson(res, 400, { error: parsed.error });
  if (parsed.honeypot || !parsed.signup) return sendJson(res, 200, { ok: true });

  try {
    const database = waitlistStore(String(process.env.DATABASE_URL ?? "").trim());
    await database.ready;
    const { email, name, company, useCase } = parsed.signup;
    await database.sql`
      INSERT INTO routelab_waitlist (email, name, company, use_case)
      VALUES (${email}, ${name}, ${company}, ${useCase})
      ON CONFLICT (email) DO UPDATE
      SET
        name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE routelab_waitlist.name END,
        company = CASE WHEN EXCLUDED.company <> '' THEN EXCLUDED.company ELSE routelab_waitlist.company END,
        use_case = CASE WHEN EXCLUDED.use_case <> '' THEN EXCLUDED.use_case ELSE routelab_waitlist.use_case END,
        updated_at = now()
    `;
    const sheetSync = await syncToGoogleSheet(parsed.signup);
    if (sheetSync.configured) {
      await database.sql`
        UPDATE routelab_waitlist
        SET
          sheet_synced_at = CASE WHEN ${sheetSync.synced} THEN now() ELSE sheet_synced_at END,
          sheet_sync_error = ${sheetSync.error || null}
        WHERE email = ${email}
      `;
      if (!sheetSync.synced) console.error("Waitlist Google Sheets sync failed", sheetSync.error);
    }
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("Waitlist signup failed", error instanceof Error ? error.message : "Unknown storage error");
    return sendJson(res, 503, { error: "The waitlist is temporarily unavailable. Please try again." });
  }
}
