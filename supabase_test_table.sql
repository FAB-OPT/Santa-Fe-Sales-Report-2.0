-- ════════════════════════════════════════════════════════
-- Santa Fe — Test Sandbox Table
-- รัน 1 ครั้งที่ Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════
-- สำหรับ import ข้อมูลทดสอบจากไฟล์ Excel โดยไม่ปะปนกับ sales_data จริง

create table if not exists public.sales_data_test (
  id              bigserial primary key,
  branch_code     text not null,
  branch_name     text,
  district_manager text,
  submitter_name  text,
  submit_date     date not null,
  submit_time_slot text not null check (submit_time_slot in ('16.00', 'สิ้นวัน')),
  submitted_at    timestamptz not null default now(),
  plan_sale       numeric default 0,
  actual_sale     numeric default 0,
  sale_dine_in    numeric default 0,
  sale_take_away  numeric default 0,
  sale_grab       numeric default 0,
  sale_lineman    numeric default 0,
  sale_shopeefood numeric default 0,
  total_trans     integer default 0,
  trans_dine_in   integer default 0,
  trans_take_away integer default 0,
  trans_grab      integer default 0,
  trans_lineman   integer default 0,
  trans_shopeefood integer default 0,
  customer        integer default 0,
  labour_hour     numeric default 0,
  labour_baht     numeric default 0,
  edit_count      integer default 0,
  last_edited_at  timestamptz,
  constraint uq_sales_test_branch_date_slot unique (branch_code, submit_date, submit_time_slot)
);

create index if not exists idx_sales_test_branch_date on public.sales_data_test(branch_code, submit_date desc);

alter table public.sales_data_test disable row level security;

-- ──────────────────────────────────────────────
-- Plan Sale sandbox (mirror schema ของ plan_sale)
-- ──────────────────────────────────────────────
create table if not exists public.plan_sale_test (
  id           bigserial primary key,
  branch_code  text not null,
  plan_date    date not null,
  plan_amount  numeric not null default 0,
  updated_at   timestamptz not null default now(),
  constraint uq_plan_test_branch_date unique (branch_code, plan_date)
);

create index if not exists idx_plan_test_branch_date on public.plan_sale_test(branch_code, plan_date);

alter table public.plan_sale_test disable row level security;

-- Populate plan_sale_test จาก sales_data_test (รอบ 16.00 ที่มี plan_sale > 0)
insert into public.plan_sale_test (branch_code, plan_date, plan_amount, updated_at)
select branch_code, submit_date, plan_sale, now()
from public.sales_data_test
where submit_time_slot = '16.00' and plan_sale > 0
on conflict (branch_code, plan_date) do update
  set plan_amount = excluded.plan_amount,
      updated_at  = now();

-- ลบทั้งตาราง (รีเซ็ตสำหรับ re-import): uncomment ถ้าต้องการ
-- truncate table public.sales_data_test restart identity;
-- truncate table public.plan_sale_test restart identity;
