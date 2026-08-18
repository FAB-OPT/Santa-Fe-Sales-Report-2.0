-- ═══════════════════════════════════════════════════════════════════════
-- promo_summary_views.sql
-- Server-side aggregate ของ promo_submissions (เชียร์ขายโปรอีสาน ซีรีย์)
--
-- ทำไมต้องมี:
--   PostgREST มีเพดาน db-max-rows = 1000 แถว/คำขอ (ใส่ &limit=50000 ไม่ช่วย)
--   การดึงตารางดิบมารวมฝั่ง client จึงขาดข้อมูลแบบเงียบๆ เมื่อเกิน 1000 submissions
--   ตอนนี้ทุก client วนดึงด้วย Range header แล้ว (แก้ correctness เรียบร้อย)
--   view ชุดนี้เป็นตัวช่วย "ตรวจสอบ + รายงาน" — คืนผลสรุปไม่กี่สิบแถว ยิงครั้งเดียวจบ
--
-- วิธีใช้: paste ทั้งไฟล์ลง Supabase → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════

-- ── พารามิเตอร์แคมเปญ (ต้องตรงกับ PROMO_CAMPAIGN ใน index.html / CONFIG ใน isaan.html) ──
--   startDate           = 2026-07-06   ยอดรวม/เป้า นับตั้งแต่วันนี้
--   incentiveStartDate  = 2026-07-10   incentive นับตั้งแต่วันนี้ (6-9 ก.ค. ไม่ได้เงิน)
--   incentivePerDish    = 5 บาท/จาน

-- ── 1) สรุปรายสาขา (แถวละสาขา ~36 แถว) ─────────────────────────────────
create or replace view promo_branch_summary as
select
  s.branch_code,
  max(s.branch_name)                                              as branch_name,
  max(s.district_manager)                                         as district_manager,
  count(*)                                                        as submissions,
  min(s.submit_date)                                              as first_date,
  max(s.submit_date)                                              as last_date,
  coalesce(sum(s.total_qty), 0)                                   as qty_total,
  coalesce(sum(s.total_qty) filter (where s.submit_date >= date '2026-07-10'), 0) as qty_incentive,
  coalesce(sum(s.total_qty) filter (where s.submit_date >= date '2026-07-10'), 0) * 5 as incentive_baht,
  coalesce(sum(s.total_amount), 0)                                as amount_total
from promo_submissions s
where s.submit_date >= date '2026-07-06'
  and s.submit_date <= date '2026-09-30'
group by s.branch_code;

-- ── 2) สรุปรายสาขา × รายเมนู (~36 × 3 แถว) ──────────────────────────────
create or replace view promo_branch_item_summary as
select
  s.branch_code,
  max(s.branch_name)                                              as branch_name,
  it->>'id'                                                       as item_id,
  max(it->>'name')                                                as item_name,
  coalesce(sum((it->>'qty')::int), 0)                             as qty_total,
  coalesce(sum((it->>'qty')::int) filter (where s.submit_date >= date '2026-07-10'), 0) as qty_incentive
from promo_submissions s
cross join lateral jsonb_array_elements(
  case jsonb_typeof(to_jsonb(s.items))
    when 'array'  then to_jsonb(s.items)
    when 'string' then (to_jsonb(s.items) #>> '{}')::jsonb
    else '[]'::jsonb
  end
) as it
where s.submit_date >= date '2026-07-06'
  and s.submit_date <= date '2026-09-30'
group by s.branch_code, it->>'id';

-- ── 3) สรุปรายวัน (ทุกสาขารวมกัน) ────────────────────────────────────────
create or replace view promo_daily_summary as
select
  s.submit_date,
  count(*)                                as submissions,
  count(distinct s.branch_code)           as branches,
  coalesce(sum(s.total_qty), 0)           as qty,
  coalesce(sum(s.total_amount), 0)        as amount
from promo_submissions s
where s.submit_date >= date '2026-07-06'
  and s.submit_date <= date '2026-09-30'
group by s.submit_date;

-- ── 4) ยอดรวมทั้งแคมเปญ (แถวเดียว — ใช้เป็น "ค่าจริง" ไว้เทียบกับทุกหน้า) ──
create or replace view promo_campaign_totals as
select
  count(*)                                                        as submissions,
  count(distinct s.branch_code)                                   as branches,
  coalesce(sum(s.total_qty), 0)                                   as qty_total,
  coalesce(sum(s.total_qty) filter (where s.submit_date >= date '2026-07-10'), 0) as qty_incentive,
  coalesce(sum(s.total_qty) filter (where s.submit_date >= date '2026-07-10'), 0) * 5 as incentive_baht,
  25806                                                           as goal,
  round(
    coalesce(sum(s.total_qty), 0)::numeric * 100 / nullif(25806, 0), 1
  )                                                               as pct_of_goal
from promo_submissions s
where s.submit_date >= date '2026-07-06'
  and s.submit_date <= date '2026-09-30';

-- ── สิทธิ์อ่าน (dashboard ใช้ anon key) ──────────────────────────────────
grant select on promo_branch_summary,
                promo_branch_item_summary,
                promo_daily_summary,
                promo_campaign_totals
  to anon, authenticated;

-- ── ตรวจสอบ ────────────────────────────────────────────────────────────
-- select * from promo_campaign_totals;
--   → ควรได้ qty_total / qty_incentive / incentive_baht ตรงกับตัวเลขบนแดชบอร์ดทั้ง 3 แหล่ง
--   → ยิงผ่าน REST:  /rest/v1/promo_campaign_totals?select=*
