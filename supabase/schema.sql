-- Precious Moments — Supabase schema
-- Run once in the Supabase SQL editor, then set SUPABASE_URL and
-- SUPABASE_SERVICE_ROLE_KEY on the Node server.
--
-- Tables are prefixed with pm_ so this app can share a Supabase project with
-- other work. The server uses its own session auth; all table access stays
-- server-side through the service-role key.

create extension if not exists "pgcrypto";

create table if not exists public.pm_users (
  id text primary key,
  name text not null check (char_length(name) between 2 and 80),
  email text not null unique,
  password_hash text not null,
  role text not null default 'customer' check (role in ('customer', 'staff', 'admin')),
  phone text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.pm_services (
  id text primary key,
  name text not null,
  category text not null,
  description text not null default '',
  price numeric(12, 2) not null check (price >= 0),
  unit text not null,
  pricing_mode text not null check (pricing_mode in ('fixed', 'area')),
  min_area numeric(8, 2),
  min_qty integer,
  popular boolean not null default false,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.pm_bookings (
  id text primary key,
  ref text not null unique,
  customer_id text not null references public.pm_users(id),
  staff_id text references public.pm_users(id),
  event_date date not null,
  event_time text not null default '',
  venue text not null,
  notes text not null default '',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'in_progress', 'ready', 'completed', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'deposit_paid', 'paid', 'refunded')),
  payment_method text not null default '',
  payment_ref text not null default '',
  amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),
  total numeric(12, 2) not null check (total >= 0),
  paid_at timestamptz,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pm_booking_updates (
  id text primary key,
  booking_id text not null references public.pm_bookings(id) on delete cascade,
  author_id text references public.pm_users(id),
  status text not null,
  message text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists pm_bookings_customer_idx on public.pm_bookings (customer_id);
create index if not exists pm_bookings_staff_idx on public.pm_bookings (staff_id);
create index if not exists pm_bookings_event_date_idx on public.pm_bookings (event_date);
create index if not exists pm_bookings_status_idx on public.pm_bookings (status);
create index if not exists pm_booking_updates_booking_idx on public.pm_booking_updates (booking_id, created_at);

alter table public.pm_users enable row level security;
alter table public.pm_services enable row level security;
alter table public.pm_bookings enable row level security;
alter table public.pm_booking_updates enable row level security;

-- Deliberately no anon/authenticated policies: the public API is the only
-- client. The Node server connects with the service-role key, which bypasses
-- RLS. Never expose the service-role key to the browser.
