/**
 * สรุปยอดขายรายเดือนแยกสาขา — เขียนเป็น "ค่าดิบ" ไม่ใช่สูตร
 *
 * ทำไมต้องมีไฟล์นี้:
 *   IMPORTRANGE / QUERY ในชีทสรุปทำให้เปิดบนไอโฟนไม่ไหว เพราะมือถือต้อง
 *   คำนวณสูตรใหม่ทุกครั้งที่เปิด ไฟล์นี้ย้ายการคำนวณไปไว้ที่ Apps Script
 *   แล้ววางผลลัพธ์เป็นตัวเลขนิ่ง ๆ ลงชีท เปิดบนมือถือเร็วเท่าเปิดตารางเปล่า
 *
 * วิธีติดตั้ง:
 *   1. เปิด Apps Script ของชีทหลัก (ไฟล์เดียวกับ gas_sync_v20.gs)
 *   2. กด + เพิ่มไฟล์สคริปต์ใหม่ แล้ววางโค้ดนี้ทั้งหมด
 *   3. เลือกฟังก์ชัน syncSummaryValues แล้วกด Run หนึ่งครั้ง (ครั้งแรกจะขออนุญาต)
 *   4. ถ้าจะให้อัปเดตเอง เลือกฟังก์ชัน setupSummaryTrigger แล้วกด Run
 *
 * ใช้ค่าคงที่ SUPABASE_URL / SUPABASE_KEY จาก gas_sync_v20.gs ในโปรเจกต์เดียวกัน
 */

const SUMMARY_YEAR = 2026;

/* ── ไฟล์ปลายทาง — เพิ่มได้ไม่จำกัด ──────────────────────────────
   id     = รหัสไฟล์ชีท (ส่วนกลาง URL ระหว่าง /d/ กับ /edit)
   tab    = ชื่อแท็บที่จะเขียน (ไม่มีจะสร้างให้)
   bzm    = ใส่ชื่อ BZM เพื่อกรองเฉพาะโซนนั้น · "" = ทุกสาขา
   codes  = ใส่รหัสสาขาเพื่อกรองเฉพาะสาขานั้น ๆ · [] = ไม่กรอง

   ตัวอย่างแยกไฟล์ให้แต่ละ BZM เปิดบนมือถือ:
     { id: "xxxx", tab: "สรุปรายเดือน", bzm: "นพชัย จันทร์รุ่ง (พี่นพ)", codes: [] },
     { id: "yyyy", tab: "สรุปรายเดือน", bzm: "", codes: ["5001", "5002"] },
─────────────────────────────────────────────────────────────── */
const SUMMARY_TARGETS = [
  { id: "1nicpQ1lgPA6ZowwWes44JXWMtBQmTAZrAB7mKjsedF0", tab: "สรุปรายเดือน", bzm: "", codes: [] }
];

const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
                   "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

// ════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════
function syncSummaryValues() {
  const t0 = new Date().getTime();
  // ดึงข้อมูลครั้งเดียว แล้วแจกให้ทุกไฟล์ปลายทาง — ไม่ยิง Supabase ซ้ำ
  const rows = _summaryFetchYear(SUMMARY_YEAR);
  Logger.log("ดึงมา " + rows.length + " แถว (รอบสิ้นวัน ปี " + SUMMARY_YEAR + ")");

  SUMMARY_TARGETS.forEach(target => {
    try {
      const n = _summaryWriteTarget(target, rows);
      Logger.log("  ✓ " + target.tab + " (" + target.id.slice(0, 8) + "…) " + n + " สาขา");
    } catch (e) {
      Logger.log("  ✗ " + target.id.slice(0, 8) + "… : " + e.message);
    }
  });
  Logger.log("✅ เสร็จ " + SUMMARY_TARGETS.length + " ไฟล์ ใช้เวลา " +
             ((new Date().getTime() - t0) / 1000).toFixed(1) + " วินาที");
}

// เขียนไฟล์ปลายทางหนึ่งไฟล์ — กรองตามเงื่อนไขของไฟล์นั้น
function _summaryWriteTarget(target, allRows) {
  const codeSet = (target.codes && target.codes.length)
    ? new Set(target.codes.map(String)) : null;
  const rows = allRows.filter(r => {
    if (target.bzm && String(r.district_manager || "") !== target.bzm) return false;
    if (codeSet && !codeSet.has(String(r.branch_code || ""))) return false;
    return true;
  });

  // branch_code → { name, bzm, actual[12], plan[12] }
  const byBranch = {};
  rows.forEach(r => {
    const code = String(r.branch_code || "").trim();
    if (!code) return;
    const d = String(r.submit_date || "");       // yyyy-mm-dd
    const m = parseInt(d.slice(5, 7), 10) - 1;
    if (isNaN(m) || m < 0 || m > 11) return;

    let b = byBranch[code];
    if (!b) {
      b = byBranch[code] = {
        name: _summaryCleanName(r.branch_name) || "",
        bzm:  r.district_manager || "",
        actual: new Array(12).fill(0),
        plan:   new Array(12).fill(0)
      };
    }
    // ชื่อ/BZM ใช้ของแถวล่าสุดเสมอ (เผื่อเปลี่ยนผู้จัดการเขตระหว่างปี)
    if (r.branch_name)      b.name = _summaryCleanName(r.branch_name);
    if (r.district_manager) b.bzm  = r.district_manager;

    b.actual[m] += Number(r.actual_sale) || 0;
    b.plan[m]   += Number(r.plan_sale)   || 0;
  });

  const codes = Object.keys(byBranch).sort();
  const header = ["BZM", "รหัส", "สาขา"]
    .concat(TH_MONTHS.map(m => m + " " + SUMMARY_YEAR))
    .concat(["รวมทั้งปี"]);

  const body = codes.map(code => {
    const b = byBranch[code];
    const total = b.actual.reduce((s, v) => s + v, 0);
    return [b.bzm, code, b.name].concat(b.actual).concat([total]);
  });

  // แถวรวมท้ายตาราง
  if (body.length) {
    const sumRow = ["", "", "รวมทุกสาขา"];
    for (let m = 0; m < 12; m++) {
      sumRow.push(codes.reduce((s, c) => s + byBranch[c].actual[m], 0));
    }
    sumRow.push(sumRow.slice(3).reduce((s, v) => s + v, 0));
    body.push(sumRow);
  }

  _summaryWrite(target, header, body);
  return codes.length;
}

// ════════════════════════════════════════════
// FETCH — เฉพาะรอบสิ้นวันของปีที่กำหนด (แบ่งหน้าละ 1000)
// ════════════════════════════════════════════
function _summaryFetchYear(year) {
  const PAGE = 1000;
  const from = year + "-01-01", to = year + "-12-31";
  const base = SUPABASE_URL + "/rest/v1/sales_data" +
    "?select=branch_code,branch_name,district_manager,submit_date,plan_sale,actual_sale" +
    "&submit_time_slot=eq." + encodeURIComponent("สิ้นวัน") +
    "&submit_date=gte." + from + "&submit_date=lte." + to +
    "&order=submit_date.asc";

  let all = [], offset = 0;
  while (true) {
    const res = UrlFetchApp.fetch(base, {
      headers: {
        apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY,
        Range: offset + "-" + (offset + PAGE - 1), "Range-Unit": "items"
      },
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code !== 200 && code !== 206) throw new Error("HTTP " + code + ": " + res.getContentText());
    const data = JSON.parse(res.getContentText());
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
    if (offset > 500000) break;   // กันลูปไม่รู้จบ
  }
  return all;
}

// ชื่อสาขาในฐานข้อมูลบางแถวมีรหัสนำหน้า เช่น "5001 แฟชั่น ไอส์แลนด์" — ตัดรหัสออก
function _summaryCleanName(name) {
  return String(name || "").replace(/^\s*\d{4,5}\s+/, "").trim();
}

// ════════════════════════════════════════════
// WRITE — ล้างเฉพาะข้อมูล ไม่ยุ่งกับการจัดรูปแบบของชีท
// ════════════════════════════════════════════
function _summaryWrite(target, header, body) {
  const ss = SpreadsheetApp.openById(target.id);
  let sh = ss.getSheetByName(target.tab);
  if (!sh) {
    sh = ss.insertSheet(target.tab);
    sh.setFrozenRows(1);
    sh.setFrozenColumns(3);
  }

  const cols = header.length;
  const needRows = body.length + 2;                       // + หัวตาราง + บรรทัดเวลาอัปเดต
  if (sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  if (sh.getMaxColumns() < cols)  sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());

  sh.getRange(1, 1, sh.getMaxRows(), cols).clearContent();
  sh.getRange(1, 1, 1, cols).setValues([header]).setFontWeight("bold");
  if (body.length) {
    sh.getRange(2, 1, body.length, cols).setValues(body);
    sh.getRange(2, 4, body.length, cols - 3).setNumberFormat("#,##0");
    // แถวรวมท้ายตาราง — ตัวหนา
    sh.getRange(body.length + 1, 1, 1, cols).setFontWeight("bold");
  }
  sh.getRange(body.length + 2, 1).setValue(
    "อัปเดตล่าสุด " + Utilities.formatDate(new Date(), "Asia/Bangkok", "d/M/yyyy HH:mm")
  );
  SpreadsheetApp.flush();
}

// ════════════════════════════════════════════
// TRIGGER — อัปเดตเองทุกชั่วโมง
// ════════════════════════════════════════════
function setupSummaryTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "syncSummaryValues")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncSummaryValues").timeBased().everyHours(1).create();
  Logger.log("✅ ตั้งให้สรุปรายเดือนอัปเดตทุก 1 ชั่วโมง");
}
