-- Precious Moments — pricing columns for the 2026 price sheet
--
-- Run once on an existing project before deploying the catalog update:
--   psql "$DATABASE_URL" -f supabase/migrate-pricing.sql
-- or paste this into the Supabase SQL editor.
--
-- The columns are additive and nullable/defaulted, so existing rows and
-- bookings keep working. `price` remains the first/standard unit price; the
-- `tiers` array holds quantity breaks such as 1–29 at ₱35 and 30+ at ₱30.

alter table public.pm_services
  add column if not exists tiers jsonb not null default '[]'::jsonb;

alter table public.pm_services
  add column if not exists base_fee numeric(12, 2) not null default 0;

alter table public.pm_services
  add column if not exists dimension_unit text not null default 'ft';

alter table public.pm_services
  add column if not exists capacity boolean not null default false;

alter table public.pm_services
  add column if not exists needs_review boolean not null default false;

alter table public.pm_services
  add column if not exists review_note text not null default '';

-- A tiered service may have no hard minimum (for example a ref magnet can be
-- bought singly at the below-minimum rate), so min_qty stays nullable.
alter table public.pm_services
  alter column min_qty drop not null;
