const ROUTELAB_WAITLIST_SHEET_ID = "1ivo0aGC-GliOWl03hr59X-mJU0O6EbiZY1GYyXJBVsM";
const ROUTELAB_WAITLIST_SHEET_NAME = "Waitlist";

function jsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(event) {
  const expectedSecret = PropertiesService.getScriptProperties().getProperty("ROUTELAB_WAITLIST_WEBHOOK_SECRET");
  const payload = JSON.parse((event && event.postData && event.postData.contents) || "{}");
  if (!expectedSecret || payload.secret !== expectedSecret) return jsonResponse({ ok: false, error: "Unauthorized" });

  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) return jsonResponse({ ok: false, error: "Email is required" });

  const lock = LockService.getScriptLock();
  lock.waitLock(10_000);
  try {
    const sheet = SpreadsheetApp.openById(ROUTELAB_WAITLIST_SHEET_ID).getSheetByName(ROUTELAB_WAITLIST_SHEET_NAME);
    if (!sheet) throw new Error("Waitlist sheet not found.");

    const values = [[
      payload.submittedAt ? new Date(payload.submittedAt) : new Date(),
      email,
      String(payload.name || ""),
      String(payload.company || ""),
      String(payload.useCase || ""),
      String(payload.source || "marketing"),
      new Date(),
    ]];
    const existing = sheet.getLastRow() > 1
      ? sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).createTextFinder(email).matchEntireCell(true).findNext()
      : null;
    const row = existing ? existing.getRow() : sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, values[0].length).setValues(values);
    sheet.getRange(row, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
    sheet.getRange(row, 7).setNumberFormat("yyyy-mm-dd hh:mm:ss");
    sheet.getRange(row, 5).setWrap(true);
    return jsonResponse({ ok: true });
  } finally {
    lock.releaseLock();
  }
}
