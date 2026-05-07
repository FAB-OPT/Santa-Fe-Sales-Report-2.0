/**
 * Santa Fe — Supabase ↔ Google Sheets
 *
 * 2 ทิศทาง:
 *  - PULL  : ทุก 1 นาที sync ข้อมูลล่าสุดจาก Supabase ลง Sheet (safety net)
 *  - PUSH  : รับ POST จาก index.html ทุกครั้งที่ user submit/edit (real-time)
 *
 * วิธีใช้:
 *  1. Sheet ใหม่ → Extensions → Apps Script
 *  2. Paste โค้ดทั้งหมด → Save (ตั้งชื่อ "Santa Fe Sync")
 *  3. รัน setupTriggers() 1 ครั้ง (Authorize)
 *  4. Deploy → New deployment → Web app
 *     - Execute as: Me
 *     - Who has access: Anyone
 *     - Deploy → คัดลอก Web app URL
 *  5. ส่ง URL ให้ผม → ผมใส่ใน index.html ให้
 */

// ════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════
const SUPABASE_URL = "https://jvsjrqjrzdiujhxtahho.supabase.co";
const SUPABASE_KEY = "sb_publishable_c0-2mEMzgunEQQAsT6n4XQ_fVW38Cwx";

// Header ของแต่ละ sheet (ลำดับคอลัมน์)
const SALES_HEADERS = [
  "id", "branch_code", "branch_name", "district_manager", "submitter_name",
  "submit_date", "submit_time_slot", "submitted_at",
  "plan_sale", "actual_sale",
  "sale_dine_in", "sale_take_away", "sale_grab", "sale_lineman", "sale_shopeefood",
  "total_trans", "trans_dine_in", "trans_take_away", "trans_grab", "trans_lineman", "trans_shopeefood",
  "customer", "labour_hour", "labour_baht",
  "edit_count", "last_edited_at"
];

const PLAN_HEADERS = [
  "id", "branch_code", "plan_date", "plan_amount", "updated_at"
];

const BRANCHES_HEADERS = [
  "branch_code", "branch_name", "district_manager"
];

// ════════════════════════════════════════════
// PUSH — รับ POST จาก index.html (real-time)
// ════════════════════════════════════════════
function doPost(e) {
  try {
    const p = e.parameter || {};
    const action = p.action;

    if (action === "submit_sales") {
      appendOrUpdateRow("Sales", SALES_HEADERS, p, ["branch_code", "submit_date", "submit_time_slot"]);
    }
    else if (action === "save_plan") {
      // entries = JSON array [{date, plan_sale}, ...]
      const entries = JSON.parse(p.entries || "[]");
      entries.forEach(en => {
        const row = {
          branch_code: p.branch_code,
          plan_date: en.date,
          plan_amount: en.plan_sale,
          updated_at: new Date().toISOString()
        };
        appendOrUpdateRow("Plan", PLAN_HEADERS, row, ["branch_code", "plan_date"]);
      });
    }
    else {
      return _resp({ ok: false, error: "Unknown action: " + action });
    }

    return _resp({ ok: true });
  } catch (err) {
    Logger.log("doPost error: " + err.message);
    return _resp({ ok: false, error: err.message });
  }
}

// GET handler (สำหรับ ping ทดสอบ)
function doGet() {
  return _resp({ ok: true, msg: "Santa Fe Sheets sync — alive" });
}

function _resp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Append row หรือ update ถ้ามี (ตาม keyCols)
function appendOrUpdateRow(sheetName, headers, data, keyCols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground("#f26c1c").setFontColor("#fff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  // หา row ที่ match keyCols (ถ้ามี → update, ถ้าไม่ → append)
  const lastRow = sheet.getLastRow();
  let foundRow = -1;
  if (lastRow > 1 && keyCols && keyCols.length) {
    const data2d = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (let i = 0; i < data2d.length; i++) {
      const match = keyCols.every(kc => {
        const colIdx = headers.indexOf(kc);
        return String(data2d[i][colIdx]) === String(data[kc]);
      });
      if (match) { foundRow = i + 2; break; }
    }
  }

  const newRow = headers.map(h => {
    const v = data[h];
    return (v === undefined || v === null) ? "" : v;
  });

  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, headers.length).setValues([newRow]);
  } else {
    sheet.appendRow(newRow);
  }
}

// ════════════════════════════════════════════
// PULL — sync ทั้ง table ทุก 1 นาที (safety net)
// ════════════════════════════════════════════
function syncAll() {
  syncTable("sales_data", "Sales", SALES_HEADERS);
  syncTable("plan_sale",  "Plan",  PLAN_HEADERS);
  syncTable("branches",   "Branches", BRANCHES_HEADERS);
}

function syncTable(tableName, sheetName, headers) {
  const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=*&order=id.desc&limit=10000`;
  const response = UrlFetchApp.fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    Logger.log(`[${tableName}] ${response.getContentText()}`);
    return;
  }

  const data = JSON.parse(response.getContentText());
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground("#f26c1c").setFontColor("#fff").setFontWeight("bold");
  sheet.setFrozenRows(1);

  if (data.length) {
    const rows = data.map(r => headers.map(h => {
      const v = r[h];
      return (v === undefined || v === null) ? "" : v;
    }));
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  // timestamp
  const tz = "Asia/Bangkok";
  const stamp = Utilities.formatDate(new Date(), tz, "dd/MM/yyyy HH:mm:ss");
  sheet.getRange(1, headers.length + 2).setValue("Last sync:");
  sheet.getRange(1, headers.length + 3).setValue(stamp);

  Logger.log(`[${tableName}] ${data.length} rows`);
}

// ════════════════════════════════════════════
// Triggers (auto-sync ทุก 1 นาที)
// ════════════════════════════════════════════
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncAll").timeBased().everyMinutes(1).create();
  syncAll();
  Logger.log("✅ Auto-sync ทุก 1 นาที + Web App รับ POST จาก app");
}

function stopTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  SpreadsheetApp.getUi().alert("Stopped.");
}

// ════════════════════════════════════════════
// Menu
// ════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🔄 Supabase Sync")
    .addItem("Sync ตอนนี้", "syncAll")
    .addItem("Setup auto (ทุก 1 นาที)", "setupTriggers")
    .addItem("Stop auto-sync", "stopTriggers")
    .addToUi();
}
