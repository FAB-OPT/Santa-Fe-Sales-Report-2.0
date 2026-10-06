/**
 * รายงานยอดขาย Santa Fe — สร้างทุกแท็บจากสคริปต์เดียว เขียนเป็น "ค่าดิบ" ไม่ใช่สูตร
 *
 * ทำไมต้องมี:
 *   ของเดิมใช้ IMPORTRANGE ซ้อนกันสองทอด + สูตรนับพันช่อง เปิดบนไอโฟนไม่ไหว
 *   ไฟล์นี้ย้ายการคำนวณทั้งหมดมาไว้ที่ Apps Script ชีทปลายทางเหลือแต่ตัวเลข
 *   เปิดเร็วเท่าตารางเปล่า และไม่ต้องพึ่งไฟล์กลางอีกต่อไป
 *
 * สร้างได้ 3 แบบ ในรอบเดียว:
 *   1. แท็บรวมทุกสาขา   — Total ทั้งปี / รายเดือน / รายวัน (30 คอลัมน์)
 *   2. แท็บรายสาขา      — แถวละวัน แบ่งหัวข้อตามเดือน + แถวรวมท้ายเดือน
 *   3. แท็บสรุปสั้น      — สาขา × เดือน เอาแค่ยอดขาย
 *
 * ⚠️ ไฟล์อิสระ ไม่เกี่ยวกับสคริปต์ซิงค์ gas_sync_v20.gs
 *
 * วิธีติดตั้ง:
 *   1. เปิดชีทปลายทาง → ส่วนขยาย → Apps Script
 *   2. วางโค้ดนี้ทั้งไฟล์
 *   3. แก้ 4 ค่าในหัวข้อ "ตั้งค่า" ด้านล่าง
 *   4. เลือกฟังก์ชัน buildAll แล้วกด Run (ครั้งแรกจะขออนุญาต)
 *   5. อยากให้อัปเดตเอง เลือก setupTrigger แล้วกด Run
 */

/* ══════════════════════════════════════════════════════════════
   ตั้งค่า — แก้แค่ส่วนนี้
   ══════════════════════════════════════════════════════════════ */

// รหัสไฟล์ปลายทาง (ส่วนใน URL ระหว่าง /d/ กับ /edit) — ใช้กับทุกแท็บ
const SHEET_ID = "ใส่รหัสไฟล์ตรงนี้";

const YEAR = 2026;

// แท็บรวมทุกสาขา · scope = "year" | "month" | "day"
const REPORT_TABS = [
  { tab: "Total 2026", scope: "year" },
  { tab: "มกราคม 69",  scope: "month", month: 1 },
  { tab: "Daily",      scope: "day",   date: "วันนี้" }   // หรือใส่ "2026-10-05"
];

// แท็บรายสาขา — ใส่รหัสสาขา ชื่อแท็บจะเท่ากับรหัส
const BRANCH_TABS = ["5001"];

// แท็บสรุปสั้น สาขา × เดือน — ใส่ "" ถ้าไม่ต้องการ
const SUMMARY_TAB = "สรุปรายเดือน";

// true  = สคริปต์ทาสีและจัดรูปแบบตัวเลขให้ทุกครั้งที่รัน
// false = ไม่แตะหน้าตาเลย — แต่งชีทเองได้ตามใจ สีอยู่ถาวร สคริปต์เติมแค่ตัวเลข
const FORMAT_TABS = true;

/* ── ไม่ต้องแก้ตั้งแต่บรรทัดนี้ลงไป ───────────────────────────── */

const SUPA_URL = "https://zroqklbobvixyohfaimc.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpyb3FrbGJvYnZpeHlvaGZhaW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NTUzNjMsImV4cCI6MjA5NDIzMTM2M30.BSwbqeQ1jsyvATpOkJ-wV04TGZacagaNpj6S4fPC-J4";

// สาขา Santa fe Easy — แยกบล็อกท้ายตารางเหมือนไฟล์เดิม
const EASY_CODES = ["5504", "5505", "5508", "5509"];

const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
                   "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

const METRIC_COLS = [
  "Plan Sale", "Actual Sale 16.00", "Actual Sale สิ้นวัน", "%",
  "Dine In", "Take away", "Grab", "Line Man", "Shopee Food", "Total Delivery",
  "Trans Total", "Trans Dine In", "Trans Take away", "Trans Grab",
  "Trans Line Man", "Trans Shopee Food", "Trans Delivery",
  "Ticket Avg.", "Ticket Dine In", "Ticket Take away", "Ticket Delivery",
  "Customer", "Customer Avg.", "Labour(hour)", "Labour(Baht)",
  "%Col", "Productivity Trans", "Productivity Sale"
];
const REPORT_HEADER = ["BZM", "รหัส", "สาขา"].concat(METRIC_COLS);
const BRANCH_HEADER = ["วันที่"].concat(METRIC_COLS).concat(["คนลงข้อมูล"]);

/* ══════════════════════════════════════════════════════════════
   MAIN — สร้างทุกแท็บในรอบเดียว ดึงข้อมูลจาก Supabase ครั้งเดียว
   ══════════════════════════════════════════════════════════════ */
function buildAll() {
  const t0 = new Date().getTime();
  if (SHEET_ID.indexOf("ใส่รหัส") === 0) {
    throw new Error("ยังไม่ได้ใส่ SHEET_ID — ดูหัวข้อ ตั้งค่า ด้านบนไฟล์");
  }

  const rows = fetchYear(YEAR);
  Logger.log("ดึงข้อมูลปี " + YEAR + " ได้ " + rows.length + " แถว");

  REPORT_TABS.forEach(t => {
    try {
      const range = scopeRange(t);
      const sub = rows.filter(r => r.submit_date >= range.from && r.submit_date <= range.to);
      const n = writeReportTab(t, sub, range);
      Logger.log("  ✓ " + t.tab + "  (" + range.label + ")  " + n + " สาขา");
    } catch (e) { Logger.log("  ✗ " + t.tab + " : " + e.message); }
  });

  BRANCH_TABS.forEach(code => {
    try {
      const sub = rows.filter(r => String(r.branch_code || "") === String(code));
      const n = writeBranchTab(String(code), sub);
      Logger.log("  ✓ สาขา " + code + "  " + n + " วัน");
    } catch (e) { Logger.log("  ✗ สาขา " + code + " : " + e.message); }
  });

  if (SUMMARY_TAB) {
    try {
      const n = writeSummaryTab(rows);
      Logger.log("  ✓ " + SUMMARY_TAB + "  " + n + " สาขา");
    } catch (e) { Logger.log("  ✗ " + SUMMARY_TAB + " : " + e.message); }
  }

  Logger.log("✅ เสร็จทั้งหมด ใช้เวลา " +
             ((new Date().getTime() - t0) / 1000).toFixed(1) + " วินาที");
}

/* ══════════════════════════════════════════════════════════════
   FETCH — ทั้งปี ทั้งรอบ 16.00 และสิ้นวัน (แบ่งหน้าละ 1000)
   ══════════════════════════════════════════════════════════════ */
function fetchYear(year) {
  const PAGE = 1000;
  const url = SUPA_URL + "/rest/v1/sales_data" +
    "?select=branch_code,branch_name,district_manager,submitter_name,submit_date,submit_time_slot," +
    "plan_sale,actual_sale,sale_dine_in,sale_take_away,sale_grab,sale_lineman,sale_shopeefood," +
    "total_trans,trans_dine_in,trans_take_away,trans_grab,trans_lineman,trans_shopeefood," +
    "customer,labour_hour,labour_baht" +
    "&submit_date=gte." + year + "-01-01&submit_date=lte." + year + "-12-31" +
    "&order=submit_date.asc";

  let all = [], offset = 0;
  while (true) {
    const res = UrlFetchApp.fetch(url, {
      headers: {
        apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY,
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
    if (offset > 500000) break;
  }
  return all;
}

function scopeRange(t) {
  const pad = n => (n < 10 ? "0" + n : "" + n);
  if (t.scope === "year")  return { from: YEAR + "-01-01", to: YEAR + "-12-31", label: "ปี " + YEAR };
  if (t.scope === "month") {
    const last = new Date(YEAR, t.month, 0).getDate();
    return { from: YEAR + "-" + pad(t.month) + "-01",
             to:   YEAR + "-" + pad(t.month) + "-" + pad(last),
             label: TH_MONTHS[t.month - 1] + " " + YEAR };
  }
  if (t.scope === "day") {
    const d = (!t.date || t.date === "วันนี้")
      ? Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd") : t.date;
    return { from: d, to: d, label: d };
  }
  throw new Error("scope ไม่ถูกต้อง: " + t.scope);
}

/* ══════════════════════════════════════════════════════════════
   คำนวณ
   ══════════════════════════════════════════════════════════════ */
function emptyBucket() {
  return {
    plan: 0, a16: 0, aEod: 0, dine: 0, take: 0, grab: 0, line: 0, shopee: 0,
    tTotal: 0, tDine: 0, tTake: 0, tGrab: 0, tLine: 0, tShopee: 0,
    customer: 0, lhour: 0, lbaht: 0
  };
}
function addRow(b, r) {
  const n = v => Number(v) || 0;
  // รอบ 16.00 เป็นยอดระหว่างวัน เก็บแค่ยอดขาย ไม่เอาช่องทาง/trans มารวมซ้ำ
  if (r.submit_time_slot === "16.00") { b.a16 += n(r.actual_sale); return; }
  b.plan += n(r.plan_sale);       b.aEod   += n(r.actual_sale);
  b.dine += n(r.sale_dine_in);    b.take   += n(r.sale_take_away);
  b.grab += n(r.sale_grab);       b.line   += n(r.sale_lineman);
  b.shopee += n(r.sale_shopeefood);
  b.tTotal += n(r.total_trans);   b.tDine  += n(r.trans_dine_in);
  b.tTake  += n(r.trans_take_away); b.tGrab += n(r.trans_grab);
  b.tLine  += n(r.trans_lineman); b.tShopee += n(r.trans_shopeefood);
  b.customer += n(r.customer);    b.lhour  += n(r.labour_hour);
  b.lbaht += n(r.labour_baht);
}
function addBucket(dst, src) { Object.keys(dst).forEach(k => { dst[k] += src[k]; }); }

// ตัวหารเป็น 0 → คืนค่าว่าง ไม่ขึ้น #DIV/0!
function div(a, b) { return b ? a / b : ""; }

// 28 ตัวเลขตามลำดับ METRIC_COLS
function metrics(b) {
  const delivery  = b.grab + b.line + b.shopee;
  const tDelivery = b.tGrab + b.tLine + b.tShopee;
  return [
    b.plan, b.a16, b.aEod, div(b.aEod, b.plan),
    b.dine, b.take, b.grab, b.line, b.shopee, delivery,
    b.tTotal, b.tDine, b.tTake, b.tGrab, b.tLine, b.tShopee, tDelivery,
    div(b.aEod, b.tTotal), div(b.dine, b.tDine), div(b.take, b.tTake), div(delivery, tDelivery),
    b.customer, div(b.aEod, b.customer),
    b.lhour, b.lbaht,
    div(b.lbaht, b.aEod), div(b.tTotal, b.lhour), div(b.aEod, b.lhour)
  ];
}

function cleanName(name) { return String(name || "").replace(/^\s*\d{4,5}\s+/, "").trim(); }
function toSet(list) { const o = {}; list.forEach(v => { o[String(v)] = true; }); return o; }
function thaiDate(ds) {
  const p = String(ds).split("-");
  return parseInt(p[2], 10) + "/" + parseInt(p[1], 10) + "/" + p[0];
}

/* ══════════════════════════════════════════════════════════════
   แท็บรวมทุกสาขา
   ══════════════════════════════════════════════════════════════ */
function writeReportTab(target, rows, range) {
  const by = {};
  rows.forEach(r => {
    const code = String(r.branch_code || "").trim();
    if (!code) return;
    let b = by[code];
    if (!b) { b = by[code] = emptyBucket(); b.code = code; b.name = ""; b.bzm = ""; }
    if (r.branch_name)      b.name = cleanName(r.branch_name);
    if (r.district_manager) b.bzm  = r.district_manager;
    addRow(b, r);
  });

  const codes = Object.keys(by).sort();
  const easy  = toSet(EASY_CODES);
  const main  = codes.filter(c => !easy[c]).map(c => by[c]);
  const sfe   = codes.filter(c =>  easy[c]).map(c => by[c]);

  const line = b => [b.bzm, b.code, b.name].concat(metrics(b));
  const totalOf = (label, list) => {
    const s = emptyBucket();
    list.forEach(b => addBucket(s, b));
    return ["Total", "", label].concat(metrics(s));
  };

  const body = [];
  main.forEach(b => body.push(line(b)));
  if (main.length) body.push(totalOf("Santa fe", main));
  if (sfe.length) {
    body.push(new Array(REPORT_HEADER.length).fill(""));
    sfe.forEach(b => body.push(line(b)));
    body.push(totalOf("Santa fe Easy", sfe));
  }

  const zones = {};
  codes.forEach(c => {
    const z = by[c].bzm || "(ไม่ระบุ BZM)";
    (zones[z] = zones[z] || []).push(by[c]);
  });
  const zoneNames = Object.keys(zones).sort();
  if (zoneNames.length > 1) {
    body.push(new Array(REPORT_HEADER.length).fill(""));
    zoneNames.forEach(z => body.push(totalOf(z, zones[z])));
  }

  writeSheet(target.tab, range.label, REPORT_HEADER, body, {
    pct: [7, 29],            // % และ %Col (คอลัมน์ที่เท่าไหร่ นับจาก 1)
    numFrom: 4, frozenCols: 3
  });
  return codes.length;
}

/* ══════════════════════════════════════════════════════════════
   แท็บรายสาขา — แถวละวัน แบ่งหัวข้อตามเดือน
   ══════════════════════════════════════════════════════════════ */
function writeBranchTab(code, rows) {
  const byDate = {}, whoByDate = {};
  rows.forEach(r => {
    const d = String(r.submit_date || "");
    if (!d) return;
    if (!byDate[d]) byDate[d] = emptyBucket();
    addRow(byDate[d], r);
    if (r.submit_time_slot !== "16.00" && r.submitter_name) whoByDate[d] = r.submitter_name;
  });

  const dates = Object.keys(byDate).sort();
  const body = [];
  let days = 0;

  for (let m = 1; m <= 12; m++) {
    const mm = (m < 10 ? "0" + m : "" + m);
    const inMonth = dates.filter(d => d.slice(5, 7) === mm);
    if (!inMonth.length) continue;

    const head = new Array(BRANCH_HEADER.length).fill("");
    head[0] = TH_MONTHS[m - 1] + " " + YEAR;
    body.push(head);

    const monthSum = emptyBucket();
    inMonth.forEach(d => {
      addBucket(monthSum, byDate[d]);
      body.push([thaiDate(d)].concat(metrics(byDate[d])).concat([whoByDate[d] || ""]));
      days++;
    });

    body.push(["รวม " + TH_MONTHS[m - 1]].concat(metrics(monthSum)).concat([""]));

    // บรรทัดสัดส่วนช่องทาง (เทียบยอดสิ้นวันของทั้งเดือน)
    const mix = new Array(BRANCH_HEADER.length).fill("");
    const delivery = monthSum.grab + monthSum.line + monthSum.shopee;
    mix[0] = "สัดส่วน";
    mix[5] = div(monthSum.dine, monthSum.aEod);
    mix[6] = div(monthSum.take, monthSum.aEod);
    mix[7] = div(monthSum.grab, monthSum.aEod);
    mix[8] = div(monthSum.line, monthSum.aEod);
    mix[9] = div(monthSum.shopee, monthSum.aEod);
    mix[10] = div(delivery, monthSum.aEod);
    body.push(mix);
    body.push(new Array(BRANCH_HEADER.length).fill(""));
  }

  writeSheet(code, "สาขา " + code + " — ปี " + YEAR, BRANCH_HEADER, body, {
    pct: [5, 27], numFrom: 2, frozenCols: 1
  });
  return days;
}

/* ══════════════════════════════════════════════════════════════
   แท็บสรุปสั้น — สาขา × เดือน (ยอดสิ้นวัน)
   ══════════════════════════════════════════════════════════════ */
function writeSummaryTab(rows) {
  const by = {};
  rows.forEach(r => {
    if (r.submit_time_slot === "16.00") return;
    const code = String(r.branch_code || "").trim();
    const m = parseInt(String(r.submit_date || "").slice(5, 7), 10) - 1;
    if (!code || isNaN(m) || m < 0 || m > 11) return;
    let b = by[code];
    if (!b) b = by[code] = { name: "", bzm: "", months: new Array(12).fill(0) };
    if (r.branch_name)      b.name = cleanName(r.branch_name);
    if (r.district_manager) b.bzm  = r.district_manager;
    b.months[m] += Number(r.actual_sale) || 0;
  });

  const codes = Object.keys(by).sort();
  const header = ["BZM", "รหัส", "สาขา"]
    .concat(TH_MONTHS.map(m => m + " " + YEAR)).concat(["รวมทั้งปี"]);
  const body = codes.map(c => {
    const b = by[c];
    return [b.bzm, c, b.name].concat(b.months)
      .concat([b.months.reduce((s, v) => s + v, 0)]);
  });
  if (body.length) {
    const sum = ["", "", "รวมทุกสาขา"];
    for (let m = 0; m < 12; m++) sum.push(codes.reduce((s, c) => s + by[c].months[m], 0));
    sum.push(sum.slice(3).reduce((s, v) => s + v, 0));
    body.push(sum);
  }
  writeSheet(SUMMARY_TAB, "ยอดขายรายเดือน ปี " + YEAR, header, body,
             { pct: [], numFrom: 4, frozenCols: 3 });
  return codes.length;
}

/* ══════════════════════════════════════════════════════════════
   เขียนลงชีท — ล้างเฉพาะข้อมูล ไม่ยุ่งกับการจัดรูปแบบ
   ══════════════════════════════════════════════════════════════ */
function writeSheet(tabName, title, header, body, opt) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(tabName);
  if (!sh) {
    sh = ss.insertSheet(tabName);
    sh.setFrozenRows(2);
    sh.setFrozenColumns(opt.frozenCols || 1);
  }
  const cols = header.length;
  const need = body.length + 4;
  if (sh.getMaxRows() < need)    sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());

  // ล้างเฉพาะตัวเลข — สีพื้นและกฎสีที่ตั้งไว้ยังอยู่ครบ
  sh.getRange(1, 1, sh.getMaxRows(), cols).clearContent();
  sh.getRange(1, 1).setValue(title).setFontWeight("bold");
  const head = sh.getRange(2, 1, 1, cols).setValues([header]).setFontWeight("bold");
  if (FORMAT_TABS) head.setBackground(C_HEAD).setFontColor("#ffffff");

  if (body.length) {
    sh.getRange(3, 1, body.length, cols).setValues(body);
    if (FORMAT_TABS) {
      sh.getRange(3, opt.numFrom, body.length, cols - opt.numFrom + 1).setNumberFormat("#,##0.00");
      (opt.pct || []).forEach(c => sh.getRange(3, c, body.length, 1).setNumberFormat("0.00%"));
      paintRows(sh, body, cols);
      setPctRules(sh, body.length, cols, opt.pct || []);
    }
  }
  sh.getRange(body.length + 4, 1).setValue(
    "อัปเดตล่าสุด " + Utilities.formatDate(new Date(), "Asia/Bangkok", "d/M/yyyy HH:mm")
  );
  SpreadsheetApp.flush();
}

/* ══════════════════════════════════════════════════════════════
   TRIGGER
   ══════════════════════════════════════════════════════════════ */
function setupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "buildAll")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("buildAll").timeBased().everyHours(1).create();
  Logger.log("✅ ตั้งให้สร้างรายงานใหม่ทุก 1 ชั่วโมง");
}

/* ══════════════════════════════════════════════════════════════
   สี
   ══════════════════════════════════════════════════════════════ */
const C_HEAD  = "#f26c1c";   // แถบหัวตาราง — ส้ม ตัวหนังสือขาว
const C_TOTAL = "#fff2a8";   // แถวรวม — เหลือง
const C_MONTH = "#ffe0b2";   // หัวข้อเดือนในแท็บรายสาขา — ส้มอ่อน
const C_PLAIN = "#ffffff";

// ทาสีพื้นทั้งตารางในคำสั่งเดียว — เร็วกว่าทาทีละแถว
function paintRows(sh, body, cols) {
  const colors = body.map(r => {
    const first = String(r[0] || "");
    const third = String(r[2] || "");
    let c = C_PLAIN;
    if (first === "Total" || first.indexOf("รวม") === 0 || third.indexOf("รวม") === 0) c = C_TOTAL;
    else if (first.indexOf(" " + YEAR) > 0) c = C_MONTH;      // "มกราคม 2026"
    else if (first === "สัดส่วน") c = C_MONTH;
    const row = [];
    for (let i = 0; i < cols; i++) row.push(c);
    return row;
  });
  sh.getRange(3, 1, body.length, cols).setBackgrounds(colors);
}

// กฎสีตามค่า: ตั้งครั้งเดียว อยู่ถาวร ไม่ถูกล้างตอนเขียนรอบถัดไป
//   ≥ 100% เขียว · 80–99.99% ส้ม · < 80% แดง
function setPctRules(sh, rowCount, cols, pctCols) {
  if (!pctCols.length) return;
  const ranges = pctCols.map(c => sh.getRange(3, c, rowCount, 1));
  const mk = (type, val, bg, fg) => {
    let b = SpreadsheetApp.newConditionalFormatRule();
    b = (type === "ge") ? b.whenNumberGreaterThanOrEqualTo(val)
      : (type === "lt") ? b.whenNumberLessThan(val)
      : b.whenNumberBetween(val[0], val[1]);
    return b.setBackground(bg).setFontColor(fg).setRanges(ranges).build();
  };
  const rules = [
    mk("ge", 1,            "#b7e1cd", "#0b5d3b"),
    mk("bt", [0.8, 0.9999],"#fce8b2", "#7a4b1d"),
    mk("lt", 0.8,          "#f4c7c3", "#8c1d18")
  ];
  sh.setConditionalFormatRules(rules);
}
