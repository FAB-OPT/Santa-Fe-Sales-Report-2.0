-- ═════════════════════════════════════════════════════
-- FEATURE: วันที่สาขาปิดร้าน (ไม่มียอดขายให้ส่ง)
--
-- ใช้คู่กับ "แถบเตือนยอดค้างส่ง" บนหัวหน้าส่งยอด
-- สาขาที่ปิดจริง เช่น น้ำท่วม ไฟดับ ห้างปิด กดปิดวันนั้นได้
-- แถบจะไม่เตือนวันนั้นอีก และแยกออกจาก "สาขาไม่ส่ง" ได้ชัดเจน
--
-- รันไฟล์นี้ที่ Supabase → SQL Editor → New query → วาง → Run
-- ═════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS branch_closures (
  id               SERIAL PRIMARY KEY,
  branch_code      TEXT NOT NULL,
  branch_name      TEXT,
  district_manager TEXT,
  closed_date      DATE NOT NULL,
  reason           TEXT NOT NULL,
  closed_by        TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(branch_code, closed_date)   -- 1 สาขา ต่อ 1 วัน กดได้ครั้งเดียว
);

CREATE INDEX IF NOT EXISTS idx_closure_date
  ON branch_closures(closed_date DESC);
CREATE INDEX IF NOT EXISTS idx_closure_branch
  ON branch_closures(branch_code, closed_date DESC);

-- ═════════════════════════════════════════════════════
-- RLS: อ่านได้ทุกคน · เพิ่มได้ · ลบได้ (เผื่อสาขากดผิดแล้วกดแก้ไข)
--      แต่แก้ไขแถวเดิมไม่ได้ ถ้าจะเปลี่ยนเหตุผลให้ลบแล้วกดใหม่
-- ═════════════════════════════════════════════════════
ALTER TABLE branch_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS closure_read_all   ON branch_closures;
DROP POLICY IF EXISTS closure_insert_all ON branch_closures;
DROP POLICY IF EXISTS closure_delete_all ON branch_closures;

CREATE POLICY closure_read_all   ON branch_closures FOR SELECT USING (true);
CREATE POLICY closure_insert_all ON branch_closures FOR INSERT WITH CHECK (true);
CREATE POLICY closure_delete_all ON branch_closures FOR DELETE USING (true);
-- ไม่ define UPDATE policy → default deny (แก้แถวเดิมไม่ได้)

-- ตรวจสอบว่าตารางถูกสร้าง
SELECT 'Done ✓ table = branch_closures' as status;
