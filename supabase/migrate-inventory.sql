-- Precious Moments — physical booth inventory blocks
-- Run once in the Supabase SQL editor before using the Inventory dashboard.
-- Safe to run more than once. This migration only creates a new table and
-- indexes; existing bookings, accounts, payments, and catalog rows are untouched.

create table if not exists public.pm_inventory_blocks (
  id text primary key,
  booth_type text not null check (booth_type in ('photobooth', 'video', 'mirror', 'studio')),
  unit_label text not null,
  kind text not null default 'maintenance' check (kind in ('maintenance', 'damaged', 'blocked')),
  reason text not null default '',
  start_date date not null,
  start_time text not null default '00:00',
  end_date date not null,
  end_time text not null default '23:59',
  active boolean not null default true,
  created_by text references public.pm_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pm_inventory_blocks_window_idx
  on public.pm_inventory_blocks (booth_type, start_date, end_date);
create index if not exists pm_inventory_blocks_active_idx
  on public.pm_inventory_blocks (active, start_date);

alter table public.pm_inventory_blocks enable row level security;

-- The application uses the service-role key on the server, which bypasses RLS.
-- No browser policy is added: inventory and maintenance data stay server-only.
