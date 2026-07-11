-- ═════════════════════════════════════════════════════
-- FEATURE V3: Promo — ระบุสาขาที่จะเห็นการ์ดเชียร์ขาย
-- ═════════════════════════════════════════════════════

-- เพิ่ม key promo_branches ใน app_settings
-- ค่า:
--   "ALL"                       → ทุกสาขา
--   '["5001","5023",...]'       → เฉพาะสาขาในรายการ (JSON string ของ array)
INSERT INTO app_settings (key, value) VALUES ('promo_branches', 'ALL')
  ON CONFLICT (key) DO NOTHING;

SELECT 'Done ✓ promo_branches key added (default = ALL)' AS status;
