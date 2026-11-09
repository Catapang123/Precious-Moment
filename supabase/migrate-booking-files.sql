-- Precious Moments — customer design and reference uploads (additive migration)
--
-- Safe to run on an existing project: it only adds a nullable column, a new
-- table, indexes, and a private Storage bucket. No existing row is rewritten or
-- deleted. Run it in the Supabase SQL editor before deploying the updated app,
-- and take a database backup first.

create extension if not exists "pgcrypto";

alter table public.pm_bookings
  add column if not exists design_notes text not null default '';

alter table public.pm_bookings
  add column if not exists design_status text;

do $$
begin
  alter table public.pm_bookings
    add constraint pm_bookings_design_status_check
    check (design_status in ('for_review', 'in_progress', 'for_approval', 'approved'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.pm_booking_files (
  id text primary key,
  booking_id text not null references public.pm_bookings(id) on delete cascade,
  customer_id text not null references public.pm_users(id),
  uploaded_by text references public.pm_users(id),
  kind text not null default 'reference' check (kind in ('reference', 'final')),
  name text not null,
  mime text not null,
  extension text not null default '',
  bytes bigint not null default 0 check (bytes >= 0),
  storage text not null default 'supabase' check (storage in ('supabase', 'local')),
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists pm_booking_files_booking_idx
  on public.pm_booking_files (booking_id, created_at);
create index if not exists pm_booking_files_customer_idx
  on public.pm_booking_files (customer_id);

alter table public.pm_booking_files enable row level security;
-- No anon/authenticated policies: the Node server is the only client and uses
-- the service-role key. Browser access goes through the authorized API routes,
-- which mint short-lived signed URLs.

-- Private bucket. `public = false` is what makes a leaked object path useless
-- without a signature.
insert into storage.buckets (id, name, public)
values ('booking-files', 'booking-files', false)
on conflict (id) do nothing;
