-- Precious Moments — booking types, capacity, discounts, account security
-- Run once in the Supabase SQL editor on an existing project. Every statement
-- is additive; nothing is dropped and no rows are deleted.

alter table public.pm_users
  add column if not exists active boolean not null default true;
alter table public.pm_users
  add column if not exists mfa_enabled boolean not null default false;
alter table public.pm_users
  add column if not exists mfa_secret text;
alter table public.pm_users
  add column if not exists mfa_pending_secret text;
alter table public.pm_users
  add column if not exists must_change_password boolean not null default false;

alter table public.pm_bookings
  add column if not exists booking_type text not null default 'event';
alter table public.pm_bookings
  add column if not exists duration_hours numeric(4, 1) not null default 3;
alter table public.pm_bookings
  add column if not exists pickup_date date;
alter table public.pm_bookings
  add column if not exists pickup_time text not null default '';
alter table public.pm_bookings
  add column if not exists subtotal numeric(12, 2) not null default 0;
alter table public.pm_bookings
  add column if not exists discount_id text;
alter table public.pm_bookings
  add column if not exists discount_label text not null default '';
alter table public.pm_bookings
  add column if not exists discount_amount numeric(12, 2) not null default 0;

alter table public.pm_bookings drop constraint if exists pm_bookings_booking_type_check;
alter table public.pm_bookings
  add constraint pm_bookings_booking_type_check check (booking_type in ('event', 'pickup'));

create table if not exists public.pm_discounts (
  id text primary key,
  customer_id text not null references public.pm_users(id) on delete cascade,
  type text not null check (type in ('percent', 'fixed')),
  value numeric(12, 2) not null check (value > 0),
  note text not null default '',
  active boolean not null default true,
  created_by text references public.pm_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pm_bookings_type_idx on public.pm_bookings (booking_type);
create index if not exists pm_discounts_customer_idx on public.pm_discounts (customer_id) where active;

alter table public.pm_discounts enable row level security;

-- Old bookings are event bookings; their item total was the stored total.
update public.pm_bookings set subtotal = total where subtotal = 0 and total > 0;

-- Existing crew rows keep their name and branch as assignable records, but
-- crew do not sign in. Only the owner and the two branch heads have accounts.
update public.pm_users set password_hash = 'crew-record' where role = 'staff';
