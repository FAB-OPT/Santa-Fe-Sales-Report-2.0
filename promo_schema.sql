-- ═════════════════════════════════════════════════════
-- FEATURE: รอบปิดการขาย — รายการเชียร์ขาย
-- ═════════════════════════════════════════════════════

-- ตารางส่งข้อมูลเชียร์ขาย (สาขาส่งได้ครั้งเดียวต่อวัน — ไม่มี edit)
CREATE TABLE IF NOT EXISTS promo_submissions (
  id           SERIAL PRIMARY KEY,
  branch_code  TEXT NOT NULL,
  branch_name  TEXT,
  district_manager TEXT,
  submit_date  DATE NOT NULL,
  submitter_name TEXT,
  -- items = [{id, name, price, qty, subtotal}]
  items        JSONB NOT NULL,
  total_qty    INT NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(branch_code, submit_date)  -- 1 สาขา ต่อ 1 วัน ส่งได้ครั้งเดียว
);

CREATE INDEX IF NOT EXISTS idx_promo_date ON promo_submissions(submit_date DESC);
CREATE INDEX IF NOT EXISTS idx_promo_branch ON promo_submissions(branch_code, submit_date DESC);

-- ═════════════════════════════════════════════════════
-- RLS: ล็อค — ห้าม UPDATE ห้าม DELETE
-- ═════════════════════════════════════════════════════
ALTER TABLE promo_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promo_read_all   ON promo_submissions;
DROP POLICY IF EXISTS promo_insert_all ON promo_submissions;
DROP POLICY IF EXISTS promo_no_update  ON promo_submissions;
DROP POLICY IF EXISTS promo_no_delete  ON promo_submissions;

CREATE POLICY promo_read_all   ON promo_submissions FOR SELECT USING (true);
CREATE POLICY promo_insert_all ON promo_submissions FOR INSERT WITH CHECK (true);
-- ไม่ define UPDATE / DELETE policy → default deny (แก้/ลบไม่ได้)

-- ตรวจสอบว่าตารางถูกสร้าง
SELECT 'Done ✓ table = promo_submissions' as status;
