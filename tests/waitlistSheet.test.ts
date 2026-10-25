import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("Google Sheets waitlist webhook", () => {
  it("appends repeat submissions instead of replacing the existing email row", () => {
    const appendedRows: unknown[][] = [];
    const setNumberFormat = vi.fn();
    const setWrap = vi.fn();
    const sheet = {
      appendRow: vi.fn((row: unknown[]) => appendedRows.push(row)),
      getLastRow: vi.fn(() => appendedRows.length + 1),
      getRange: vi.fn(() => ({ setNumberFormat, setWrap })),
    };
    const context = {
      ContentService: {
        MimeType: { JSON: "application/json" },
        createTextOutput: (body: string) => ({ body, setMimeType() { return this; } }),
      },
      PropertiesService: {
        getScriptProperties: () => ({ getProperty: () => "test-secret" }),
      },
      LockService: {
        getScriptLock: () => ({ waitLock: vi.fn(), releaseLock: vi.fn() }),
      },
      SpreadsheetApp: {
        openById: () => ({ getSheetByName: () => sheet }),
      },
    };
    const source = readFileSync(new URL("../integrations/google-apps-script/RouteLabWaitlist.gs", import.meta.url), "utf8");
    runInNewContext(source, context);
    const doPost = (context as typeof context & { doPost: (event: unknown) => unknown }).doPost;

    doPost({ postData: { contents: JSON.stringify({ secret: "test-secret", email: "same@example.com", name: "First", useCase: "First use case" }) } });
    doPost({ postData: { contents: JSON.stringify({ secret: "test-secret", email: "same@example.com", name: "Second", useCase: "Second use case" }) } });

    expect(sheet.appendRow).toHaveBeenCalledTimes(2);
    expect(appendedRows.map((row) => row.slice(1, 5))).toEqual([
      ["same@example.com", "First", "", "First use case"],
      ["same@example.com", "Second", "", "Second use case"],
    ]);
  });
});
