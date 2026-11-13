-- Precious Moments — logistics, deployment, and schedule fields
-- Run once in the Supabase SQL editor. Safe to run more than once. Every change
-- is additive: existing bookings, payments, accounts, and inventory are kept.
--
-- Deployment statuses are intentionally separate from booking statuses:
-- booking status tracks the studio's work, deployment status tracks the physical
-- booth deployment (unassigned -> scheduled -> dispatched -> on_site -> collected).
-- assigned_units is a JSON array of unit labels such as ["PB-1", "MB-1"].

alter table public.pm_bookings
  add column if not exists deployment_status text not null default 'unassigned'
    check (deployment_status in ('unassigned', 'scheduled', 'dispatched', 'on_site', 'collected')),
  add column if not exists assigned_units jsonb not null default '[]'::jsonb,
  add column if not exists setup_date date,
  add column if not exists setup_time text not null default '',
  add column if not exists pickup_schedule_date date,
  add column if not exists pickup_schedule_time text not null default '',
  add column if not exists logistics_notes text not null default '',
  add column if not exists deployed_at timestamptz,
  add column if not exists collected_at timestamptz;

create index if not exists pm_bookings_deployment_idx
  on public.pm_bookings (deployment_status);
create index if not exists pm_bookings_setup_date_idx
  on public.pm_bookings (setup_date);
create index if not exists pm_bookings_pickup_schedule_idx
  on public.pm_bookings (pickup_schedule_date);

-- No browser policies are added: all access goes through the Node server with
-- the service-role key, exactly like the rest of this database.
