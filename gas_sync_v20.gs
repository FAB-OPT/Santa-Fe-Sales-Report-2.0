/**
 * Santa Fe — Supabase → Google Sheets (v20 · Delta Sync + Promo)
 * SHEET_ID:       1OwmLDyuPOKM2rNq4yaXHpVE6Mvfo6Jntk0kJukPHOU4  (main)
 * PROMO_SHEET_ID: 1PLTuAZI8E9w_-0SMigjZs_Ok1UE4w-kkL_dCJ7mfTHw  (เชียร์ขาย แยกไฟล์)
 *
 * ⚠️ SETUP: Services (+) → Google Sheets API → Add (identifier: Sheets)
 *
 * v20: + PROMO (รอบปิดการขาย - รายการเชียร์ขาย) → export ไฟล์แยก
 *      - action "promo_submission" → syncPromo() ดึงจากตาราง promo_submissions
 *      - Expand items JSONB → 1 row per item ใน sheet ปลายทาง
 *      - Append-only (INSERT-only ที่ Supabase)
 *
 * v19: submit_time_slot "16.00" → เป็นเลข 16 (ตัด .00 + ไม่มี apostrophe)
 * v18: submit_date เป็น date serial → format column E เป็น "d/M/yyyy"
 * v17: submit_time_slot "16.00" / "สิ้นวัน" (ไม่มี น.)
 * v16: syncSales 30min · Fast 5min · Slow 15min · Nightly 2 AM
 * v15: Sales branch_name (มี prefix)
 * v14: Delta sync — upsert + append + nightly full sync
 */

const SUPABASE_URL = "https://zroqklbobvixyohfaimc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpyb3FrbGJvYnZpeHlvaGZhaW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NTUzNjMsImV4cCI6MjA5NDIzMTM2M30.BSwbqeQ1jsyvATpOkJ-wV04TGZacagaNpj6S4fPC-J4";
const SHEET_ID = "1OwmLDyuPOKM2rNq4yaXHpVE6Mvfo6Jntk0kJukPHOU4";
const PROMO_SHEET_ID = "1PLTuAZI8E9w_-0SMigjZs_Ok1UE4w-kkL_dCJ7mfTHw";
const PROMO_SHEET_NAME = "Promo";

// ════════════════════════════════════════════
// TABLE CONFIGS
// ════════════════════════════════════════════
const TABLES = {
  Sales: {
    src: "sales_data",
    order: "submit_date.asc,submit_time_slot.asc",
    headers: [
      "timestamp", "submitter_name", "district_manager", "branch_name",
      "submit_date", "submit_time_slot",
      "plan_sale", "actual_sale",
      "sale_dine_in", "sale_take_away", "sale_grab", "sale_lineman", "sale_shopeefood",
      "total_trans",
      "trans_dine_in", "trans_take_away", "trans_grab", "trans_lineman", "trans_shopeefood",
      "customer", "labour_hour", "labour_baht",
      "__dup_key", "type"
    ],
    mapper: r => {
      const rawDate = r.submit_date || "";
      const dp = String(rawDate).split("-");
      let submit_date_value = "";
      if (dp.length >= 3) {
        const y = parseInt(dp[0], 10);
        const m = parseInt(dp[1], 10) - 1;
        const d = parseInt(dp[2], 10);
        const target = Date.UTC(y, m, d);
        const epoch = Date.UTC(1899, 11, 30);
        submit_date_value = Math.floor((target - epoch) / 86400000);
      }
      const slot = r.submit_time_slot || "";
      return {
        timestamp: r.submitted_at || "",
        submitter_name: r.submitter_name || "",
        district_manager: r.district_manager || "",
        branch_name: `${r.branch_code || ""} ${r.branch_name || ""}`.trim(),
        submit_date: submit_date_value,
        submit_time_slot: slot === "16.00" ? 16 : slot,
        plan_sale: r.plan_sale || 0,
        actual_sale: r.actual_sale || 0,
        sale_dine_in: r.sale_dine_in || 0,
        sale_take_away: r.sale_take_away || 0,
        sale_grab: r.sale_grab || 0,
        sale_lineman: r.sale_lineman || 0,
        sale_shopeefood: r.sale_shopeefood || 0,
        total_trans: r.total_trans || 0,
        trans_dine_in: r.trans_dine_in || 0,
        trans_take_away: r.trans_take_away || 0,
        trans_grab: r.trans_grab || 0,
        trans_lineman: r.trans_lineman || 0,
        trans_shopeefood: r.trans_shopeefood || 0,
        customer: r.customer || 0,
        labour_hour: r.labour_hour || 0,
        labour_baht: r.labour_baht || 0,
        __dup_key: `${r.branch_code || ""}|${rawDate}|${r.submit_time_slot || ""}`,
        type: "sale"
      };
    },
    deltaMode: "upsert",
    upsertKey: "__dup_key",
    deltaFilter: lastSync => `or=(submitted_at.gt.${encodeURIComponent(lastSync)},last_edited_at.gt.${encodeURIComponent(lastSync)})`,
    getTs: r => r.last_edited_at || r.submitted_at
  },

  Plan: {
    src: "plan_sale",
    order: "id.desc",
    headers: ["id", "branch_code", "plan_date", "plan_amount", "updated_at"],
    mapper: r => r,
    deltaMode: "upsert",
    upsertKey: "id",
    deltaFilter: lastSync => `updated_at.gt.${encodeURIComponent(lastSync)}`,
    getTs: r => r.updated_at
  },

  Branches: {
    src: "branches",
    order: "branch_code.asc",
    headers: ["branch_code", "branch_name", "district_manager"],
    mapper: r => ({
      branch_code: r.branch_code || "",
      branch_name: `${r.branch_code || ""} ${r.branch_name || ""}`.trim(),
      district_manager: r.district_manager || ""
    }),
    deltaMode: "replace"
  },

  Manpower: {
    src: "manpower",
    order: "year.desc,month.desc,branch_code.asc",
    headers: [
      "id", "branch_code", "year", "month",
      "plan_team", "plan_staff", "actual_team",
      "s_ft", "s_pt", "s_basic", "s_silver", "s_gold",
      "k_ft", "k_pt", "k_basic", "k_silver", "k_gold",
      "pt_8h", "pt_dual40", "pt_45h", "dual_ft", "dual_pt",
      "rgm", "sam", "am", "ss",
      "k_basic_pt", "k_basic_ft", "k_silver_pt", "k_silver_ft", "k_gold_pt", "k_gold_ft",
      "s_basic_pt", "s_basic_ft", "s_silver_pt", "s_silver_ft", "s_gold_pt", "s_gold_ft",
      "created_at", "updated_at"
    ],
    mapper: r => r,
    deltaMode: "upsert",
    upsertKey: "id",
    deltaFilter: lastSync => `updated_at.gt.${encodeURIComponent(lastSync)}`,
    getTs: r => r.updated_at
  },

  Users: {
    src: "users",
    order: "role.asc,code.asc",
    headers: ["code", "name", "nick", "role", "brand", "cross_brand",
              "dm", "branch_code", "branch_name", "active", "created_at", "updated_at"],
    mapper: r => r,
    deltaMode: "upsert",
    upsertKey: "code",
    deltaFilter: lastSync => `updated_at.gt.${encodeURIComponent(lastSync)}`,
    getTs: r => r.updated_at
  },

  LoginLogs: {
    src: "login_logs",
    order: "logged_at.desc",
    headers: ["id", "user_code", "user_name", "role",
              "branch_code", "branch_name", "dm",
              "ua", "platform", "event_type", "logged_at"],
    mapper: r => r,
    deltaMode: "append",
    upsertKey: "id",
    deltaFilter: lastSync => `logged_at.gt.${encodeURIComponent(lastSync)}`,
    getTs: r => r.logged_at
  },

  UserActions: {
    src: "user_actions",
    order: "created_at.desc",
    headers: ["id", "user_code", "action", "detail", "created_at"],
    mapper: r => r,
    deltaMode: "append",
    upsertKey: "id",
    deltaFilter: lastSync => `created_at.gt.${encodeURIComponent(lastSync)}`,
    getTs: r => r.created_at
  }
};

// Headers ของ Promo sheet (แยกไฟล์)
const PROMO_HEADERS = [
  "timestamp", "submit_date", "branch_code", "branch_name", "district_manager",
  "submitter_name", "item_id", "item_name", "unit_price", "quantity", "subtotal",
  "total_qty", "total_amount"
];

// ════════════════════════════════════════════
// PUSH
// ════════════════════════════════════════════
function doPost(e) {
  try {
    if (!e || !e.parameter) return _resp({ ok: false, error: "no event" });
    const action = e.parameter.action;

    // ── Promo: sheet แยก (ไม่ใช่ SHEET_ID หลัก) ──
    if (action === "promo_submission") {
      syncPromo();
      return _resp({ ok: true, promo: true });
    }

    const map = {
      submit_sales: "Sales", save_plan: "Plan",
      save_manpower: "Manpower", delete_manpower: "Manpower",
      save_user: "Users", delete_user: "Users"
    };
    const sheetName = map[action];
    if (!sheetName) return _resp({ ok: false, error: "Unknown action: " + action });
    syncSheet(sheetName);
    return _resp({ ok: true });
  } catch (err) {
    Logger.log("doPost error: " + err.message);
    return _resp({ ok: false, error: err.message });
  }
}

function doGet() {
  return _resp({ ok: true, msg: "Santa Fe Sheets sync v20 (delta + promo) — alive" });
}

function _resp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════
// PULL
// ════════════════════════════════════════════
function syncSales() { _syncBatch(["Sales"]); }
function syncFast()  { _syncBatch(["Plan", "Manpower"]); syncPromo(); }
function syncSlow()  { _syncBatch(["Branches", "Users", "LoginLogs", "UserActions"]); }
function syncAll()   {
  _syncBatch(["Sales", "Plan", "Branches", "Manpower", "Users", "LoginLogs", "UserActions"]);
  syncPromo();
}

function nightlyFullSync() {
  Logger.log("🌙 Nightly full sync");
  _resetLastSync();
  syncAll();
}

function _syncBatch(names) {
  const startAt = new Date().getTime();
  const MAX_MS = 5 * 60 * 1000;
  let ok = 0, fail = 0, skipped = 0;
  names.forEach(name => {
    if (new Date().getTime() - startAt > MAX_MS) { skipped++; return; }
    try { syncSheet(name); ok++; }
    catch (err) { Logger.log(`[${name}] FAILED: ${err.message}`); fail++; }
  });
  Logger.log(`✅ Done — ${ok} ok, ${fail} fail, ${skipped} skipped`);
}

function syncSheet(sheetName) {
  const cfg = TABLES[sheetName];
  if (!cfg) throw new Error("Unknown sheet: " + sheetName);

  const lastSync = _getLastSync(sheetName);
  const isFirstOrReplace = !lastSync || cfg.deltaMode === "replace";

  let rawRows;
  if (isFirstOrReplace) {
    rawRows = _fetchAllPages(cfg.src, cfg.order);
  } else {
    rawRows = _fetchWithFilter(cfg.src, cfg.order, cfg.deltaFilter(lastSync));
  }

  if (rawRows.length === 0) {
    Logger.log(`[${sheetName}] no changes`);
    return;
  }

  const rowObjs = rawRows.map(cfg.mapper);

  if (isFirstOrReplace) {
    _writeSheetFull(SHEET_ID, sheetName, cfg.headers, rowObjs);
    Logger.log(`[${sheetName}] full: ${rowObjs.length} rows`);
  } else if (cfg.deltaMode === "upsert") {
    _upsertRows(SHEET_ID, sheetName, cfg.headers, cfg.upsertKey, rowObjs);
  } else if (cfg.deltaMode === "append") {
    _appendRows(SHEET_ID, sheetName, cfg.headers, rowObjs);
  }

  if (cfg.getTs) {
    const timestamps = rawRows.map(cfg.getTs).filter(Boolean).sort();
    const latest = timestamps[timestamps.length - 1];
    if (latest) _setLastSync(sheetName, latest);
  } else {
    _setLastSync(sheetName, new Date().toISOString());
  }
}

// ════════════════════════════════════════════
// PROMO SYNC — ไฟล์แยก (append-only)
// ════════════════════════════════════════════
function syncPromo() {
  try {
    const key = "Promo";
    const lastSync = _getLastSync(key);
    const filter = lastSync
      ? `created_at=gt.${encodeURIComponent(lastSync)}`
      : "";
    const url = `${SUPABASE_URL}/rest/v1/promo_submissions?select=*${filter ? "&" + filter : ""}&order=created_at.asc&limit=5000`;

    const response = UrlFetchApp.fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code !== 200 && code !== 206) throw new Error(`[Promo] HTTP ${code}`);
    const submissions = JSON.parse(response.getContentText());
    if (!submissions.length) {
      Logger.log(`[Promo] no changes`);
      return;
    }

    // Expand: 1 submission → หลายแถว (1 แถวต่อ item)
    const rows = [];
    submissions.forEach(s => {
      const items = (typeof s.items === "string") ? JSON.parse(s.items) : (s.items || []);
      items.forEach(it => {
        rows.push([
          s.created_at,                    // timestamp
          s.submit_date,                   // submit_date
          s.branch_code || "",
          s.branch_name || "",
          s.district_manager || "",
          s.submitter_name || "",
          it.id || "",
          it.name || "",
          parseFloat(it.price) || 0,
          parseInt(it.qty) || 0,
          parseFloat(it.subtotal) || 0,
          parseInt(s.total_qty) || 0,
          parseFloat(s.total_amount) || 0
        ]);
      });
    });

    if (!rows.length) { Logger.log(`[Promo] no items to write`); return; }

    // เขียนลง sheet แยก (append)
    _promoAppend(rows);

    // update lastSync = created_at ล่าสุด
    const latest = submissions
      .map(s => s.created_at)
      .filter(Boolean)
      .sort()
      .pop();
    if (latest) _setLastSync(key, latest);

    Logger.log(`[Promo] appended ${rows.length} item-rows from ${submissions.length} submissions`);
  } catch (err) {
    Logger.log(`[Promo] FAILED: ${err.message}`);
  }
}

function _promoAppend(rows) {
  const ss = SpreadsheetApp.openById(PROMO_SHEET_ID);
  let sheet = ss.getSheetByName(PROMO_SHEET_NAME);

  // สร้าง sheet + header ถ้ายังไม่มี
  if (!sheet) {
    sheet = ss.insertSheet(PROMO_SHEET_NAME);
    try {
      Sheets.Spreadsheets.batchUpdate({
        requests: [{
          repeatCell: {
            range: { sheetId: sheet.getSheetId(), startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.949, green: 0.424, blue: 0.11 },
                textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true }
              }
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)"
          }
        }, {
          updateSheetProperties: {
            properties: { sheetId: sheet.getSheetId(), gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount"
          }
        }]
      }, PROMO_SHEET_ID);
    } catch (e) {}
    // เขียน header
    Sheets.Spreadsheets.Values.update(
      { values: [PROMO_HEADERS] }, PROMO_SHEET_ID,
      `${PROMO_SHEET_NAME}!A1:${_colLetter(PROMO_HEADERS.length)}1`,
      { valueInputOption: "RAW" }
    );
  }

  const lastRow = sheet.getLastRow();
  const startRow = Math.max(2, lastRow + 1);
  Sheets.Spreadsheets.Values.update(
    { values: rows }, PROMO_SHEET_ID,
    `${PROMO_SHEET_NAME}!A${startRow}:${_colLetter(PROMO_HEADERS.length)}${startRow + rows.length - 1}`,
    { valueInputOption: "RAW" }
  );
}

// ════════════════════════════════════════════
// State
// ════════════════════════════════════════════
function _getLastSync(name) {
  return PropertiesService.getScriptProperties().getProperty(`last_sync_${name}`);
}
function _setLastSync(name, iso) {
  PropertiesService.getScriptProperties().setProperty(`last_sync_${name}`, iso);
}
function _resetLastSync() {
  const p = PropertiesService.getScriptProperties();
  p.getKeys().forEach(k => { if (k.startsWith("last_sync_")) p.deleteProperty(k); });
  Logger.log("  Reset all lastSync tracking");
}

// ════════════════════════════════════════════
// Fetch
// ════════════════════════════════════════════
function _fetchAllPages(tableName, orderBy) {
  const PAGE = 1000;
  let all = [], from = 0;
  while (true) {
    const to = from + PAGE - 1;
    const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=*&order=${orderBy}`;
    const response = UrlFetchApp.fetch(url, {
      headers: {
        apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY,
        Range: `${from}-${to}`, "Range-Unit": "items"
      },
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code !== 200 && code !== 206) throw new Error(`[${tableName}] HTTP ${code}`);
    const data = JSON.parse(response.getContentText());
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
    if (from > 500000) break;
  }
  Logger.log(`  [${tableName}] full fetch: ${all.length} rows`);
  return all;
}

function _fetchWithFilter(tableName, orderBy, filter) {
  const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=*&${filter}&order=${orderBy}&limit=10000`;
  const response = UrlFetchApp.fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code !== 200 && code !== 206) throw new Error(`[${tableName}] HTTP ${code}: ${response.getContentText()}`);
  const data = JSON.parse(response.getContentText());
  Logger.log(`  [${tableName}] delta fetch: ${data.length} rows`);
  return data;
}

// ════════════════════════════════════════════
// Write — full replace (main sheet only)
// ════════════════════════════════════════════
function _writeSheetFull(sheetId, sheetName, headers, rowObjs) {
  const ss = SpreadsheetApp.openById(sheetId);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    try {
      Sheets.Spreadsheets.batchUpdate({
        requests: [{
          repeatCell: {
            range: { sheetId: sheet.getSheetId(), startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.949, green: 0.424, blue: 0.11 },
                textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true }
              }
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)"
          }
        }, {
          updateSheetProperties: {
            properties: { sheetId: sheet.getSheetId(), gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount"
          }
        }]
      }, sheetId);
    } catch (e) {}
  }

  const totalRows = rowObjs.length + 1;
  const gridRows = sheet.getMaxRows();
  const gridCols = sheet.getMaxColumns();

  const values = [headers];
  for (let i = 0; i < rowObjs.length; i++) {
    values.push(headers.map(h => {
      const v = rowObjs[i][h];
      return (v === undefined || v === null) ? "" : v;
    }));
  }

  Sheets.Spreadsheets.Values.update(
    { values: values }, sheetId,
    `${sheetName}!A1:${_colLetter(headers.length)}${totalRows}`,
    { valueInputOption: "RAW" }
  );

  if (gridRows > totalRows) {
    try {
      Sheets.Spreadsheets.Values.clear({}, sheetId,
        `${sheetName}!A${totalRows + 1}:${_colLetter(gridCols)}${gridRows}`);
    } catch (e) {}
  }
  _writeTimestamp(sheetId, sheetName, headers.length);
}

// ════════════════════════════════════════════
// Upsert (main sheet)
// ════════════════════════════════════════════
function _upsertRows(sheetId, sheetName, headers, keyField, newRows) {
  const ss = SpreadsheetApp.openById(sheetId);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    _writeSheetFull(sheetId, sheetName, headers, newRows);
    return;
  }

  const keyColIdx = headers.indexOf(keyField);
  if (keyColIdx < 0) throw new Error(`upsertKey ${keyField} not in headers`);

  const keyColLetter = _colLetter(keyColIdx + 1);
  const keyRange = `${sheetName}!${keyColLetter}2:${keyColLetter}`;
  let existingKeys = [];
  try {
    const res = Sheets.Spreadsheets.Values.get(sheetId, keyRange);
    existingKeys = res.values ? res.values.map(r => r[0]) : [];
  } catch (e) {}

  const keyMap = {};
  existingKeys.forEach((k, i) => {
    if (k !== undefined && k !== null && k !== "") keyMap[String(k)] = i + 2;
  });

  const updates = [];
  const appends = [];
  newRows.forEach(r => {
    const key = String(r[keyField]);
    const rowValues = headers.map(h => {
      const v = r[h];
      return (v === undefined || v === null) ? "" : v;
    });
    if (keyMap[key]) {
      updates.push({ row: keyMap[key], values: rowValues });
    } else {
      appends.push(rowValues);
    }
  });

  if (updates.length > 0) {
    const data = updates.map(u => ({
      range: `${sheetName}!A${u.row}:${_colLetter(headers.length)}${u.row}`,
      values: [u.values]
    }));
    Sheets.Spreadsheets.Values.batchUpdate({
      valueInputOption: "RAW", data: data
    }, sheetId);
  }

  if (appends.length > 0) {
    const startRow = Math.max(2, existingKeys.length + 2);
    Sheets.Spreadsheets.Values.update(
      { values: appends }, sheetId,
      `${sheetName}!A${startRow}:${_colLetter(headers.length)}${startRow + appends.length - 1}`,
      { valueInputOption: "RAW" }
    );
  }

  Logger.log(`[${sheetName}] upsert: ${updates.length} updated, ${appends.length} appended`);
  _writeTimestamp(sheetId, sheetName, headers.length);
}

// ════════════════════════════════════════════
// Append (main sheet)
// ════════════════════════════════════════════
function _appendRows(sheetId, sheetName, headers, newRows) {
  const ss = SpreadsheetApp.openById(sheetId);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    _writeSheetFull(sheetId, sheetName, headers, newRows);
    return;
  }

  const lastRow = sheet.getLastRow();
  const values = newRows.map(r => headers.map(h => {
    const v = r[h];
    return (v === undefined || v === null) ? "" : v;
  }));
  const startRow = Math.max(2, lastRow + 1);

  Sheets.Spreadsheets.Values.update(
    { values: values }, sheetId,
    `${sheetName}!A${startRow}:${_colLetter(headers.length)}${startRow + values.length - 1}`,
    { valueInputOption: "RAW" }
  );

  Logger.log(`[${sheetName}] append: ${values.length}`);
  _writeTimestamp(sheetId, sheetName, headers.length);
}

function _writeTimestamp(sheetId, sheetName, cols) {
  const stamp = Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");
  try {
    Sheets.Spreadsheets.Values.update(
      { values: [["Last sync:", stamp]] }, sheetId,
      `${sheetName}!${_colLetter(cols + 2)}1:${_colLetter(cols + 3)}1`,
      { valueInputOption: "RAW" }
    );
  } catch (e) {}
}

function _colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ════════════════════════════════════════════
// Triggers
// ════════════════════════════════════════════
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncSales").timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger("syncFast").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("syncSlow").timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger("nightlyFullSync").timeBased().atHour(2).everyDays(1).create();
  Logger.log("✅ Sales 30 min · Fast 5 min (+Promo) · Slow 15 min · Nightly 2 AM");
}

function stopTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  try { SpreadsheetApp.getUi().alert("Stopped."); } catch (_) { Logger.log("Stopped."); }
}

// ════════════════════════════════════════════
// Menu
// ════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🔄 Supabase Sync")
    .addItem("Sync ทั้งหมด (delta)", "syncAll")
    .addItem("Sync Sales", "syncSales")
    .addItem("Sync Fast (Plan/Manpower/Promo)", "syncFast")
    .addItem("Sync Slow (Users/Logs)", "syncSlow")
    .addSeparator()
    .addItem("🎯 Sync Promo (เชียร์ขาย)", "syncPromo")
    .addSeparator()
    .addItem("🌙 Full sync (reset delta)", "nightlyFullSync")
    .addSeparator()
    .addItem("Setup auto (Sales 30m / Fast 5m / Slow 15m)", "setupTriggers")
    .addItem("Stop auto-sync", "stopTriggers")
    .addToUi();
}
