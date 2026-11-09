-- Precious Moments — booking cancellation reasons (additive migration)
--
-- One row per cancellation event. Rows are never updated or deleted by the app:
-- the booking timeline and this table together are the audit trail. Safe to run
-- on an existing project; it adds a new table and indexes only.

create table if not exists public.pm_booking_cancellations (
  id text primary key,
  booking_id text not null references public.pm_bookings(id) on delete cascade,
  branch_id text references public.pm_branches(id),
  cancelled_by text references public.pm_users(id),
  cancelled_by_role text not null check (cancelled_by_role in ('customer', 'branch')),
  reason_code text not null,
  reason_label text not null,
  details text not null default '',
  previous_status text not null,
  new_status text not null default 'cancelled',
  created_at timestamptz not null default now()
);

create index if not exists pm_booking_cancellations_booking_idx
  on public.pm_booking_cancellations (booking_id, created_at desc);
create index if not exists pm_booking_cancellations_branch_idx
  on public.pm_booking_cancellations (branch_id, created_at desc);
create index if not exists pm_booking_cancellations_reason_idx
  on public.pm_booking_cancellations (reason_code);

alter table public.pm_booking_cancellations enable row level security;
-- No anon/authenticated policies: the Node server is the only client and reads
-- through the service-role key after checking role and branch access.
