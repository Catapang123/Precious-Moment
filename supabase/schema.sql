-- Precious Moments — Supabase schema
-- Run once in the Supabase SQL editor, then set SUPABASE_URL and
-- SUPABASE_SERVICE_ROLE_KEY on the Node server.
--
-- Tables are prefixed with pm_ so this app can share a Supabase project with
-- other work. The server uses its own session auth; all table access stays
-- server-side through the service-role key.

create extension if not exists "pgcrypto";

create table if not exists public.pm_branches (
  id text primary key,
  name text not null,
  address text not null default '',
  lat double precision not null,
  lng double precision not null,
  map_url text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.pm_users (
  id text primary key,
  name text not null check (char_length(name) between 2 and 80),
  email text not null unique,
  password_hash text not null,
  role text not null default 'customer' check (role in ('customer', 'staff', 'branch_admin', 'admin')),
  branch_id text references public.pm_branches(id),
  phone text not null default '',
  active boolean not null default true,
  mfa_enabled boolean not null default false,
  mfa_secret text,
  mfa_pending_secret text,
  session_version integer not null default 0,
  must_change_password boolean not null default false,
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
  tiers jsonb not null default '[]'::jsonb,
  base_fee numeric(12, 2) not null default 0,
  dimension_unit text not null default 'ft',
  image_url text not null default '',
  image_alt text not null default '',
  image_updated_at timestamptz,
  image_updated_by text,
  image_width integer,
  image_height integer,
  video_url text not null default '',
  video_mime text not null default '',
  video_bytes bigint,
  video_updated_at timestamptz,
  video_updated_by text,
  catalog_visible boolean not null default true,
  round_dimensions_up boolean not null default false,
  min_dimension numeric(8, 2),
  max_dimension numeric(8, 2),
  capacity boolean not null default false,
  needs_review boolean not null default false,
  review_note text not null default '',
  popular boolean not null default false,
  addon boolean not null default false,
  booking_availability text not null default 'unassigned'
    check (booking_availability in ('pickup', 'event', 'both', 'unassigned')),
  active boolean not null default true,
  sort integer not null default 0,
  origin text not null default 'catalog',
  admin_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pm_bookings (
  id text primary key,
  ref text not null unique,
  customer_id text not null references public.pm_users(id),
  staff_id text references public.pm_users(id),
  branch_id text references public.pm_branches(id),
  needs_review boolean not null default false,
  booking_type text not null default 'event' check (booking_type in ('event', 'pickup')),
  duration_hours numeric(4, 1) not null default 3 check (duration_hours >= 0 and duration_hours <= 24),
  pickup_date date,
  pickup_time text not null default '',
  event_date date not null,
  event_time text not null default '',
  venue text not null,
  address text not null default '',
  notes text not null default '',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'in_progress', 'ready', 'completed', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'deposit_paid', 'paid', 'refunded')),
  payment_method text not null default '',
  payment_ref text not null default '',
  amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  discount_id text,
  discount_label text not null default '',
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  total numeric(12, 2) not null check (total >= 0),
  paid_at timestamptz,
  items jsonb not null default '[]'::jsonb,
  deployment_status text not null default 'unassigned'
    check (deployment_status in ('unassigned', 'scheduled', 'dispatched', 'on_site', 'collected')),
  assigned_units jsonb not null default '[]'::jsonb,
  setup_date date,
  setup_time text not null default '',
  pickup_schedule_date date,
  pickup_schedule_time text not null default '',
  logistics_notes text not null default '',
  deployed_at timestamptz,
  collected_at timestamptz,
  design_notes text not null default '',
  design_status text check (design_status in ('for_review', 'in_progress', 'for_approval', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

-- Private assistant conversations. The composite key and the matching
-- (conversation_id, user_id) foreign key below make it impossible for a message
-- to be attached to another customer's conversation, even through a server bug.
create table if not exists public.pm_assistant_conversations (
  id text primary key,
  user_id text not null references public.pm_users(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.pm_assistant_messages (
  id text primary key,
  conversation_id text not null,
  user_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, user_id)
    references public.pm_assistant_conversations (id, user_id) on delete cascade
);

create table if not exists public.pm_password_resets (
  id text primary key,
  user_id text not null references public.pm_users(id) on delete cascade,
  token_hash text not null unique,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  requested_by_ip text not null default '',
  used_by_ip text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.pm_audit_logs (
  id text primary key,
  actor_id text,
  actor_role text not null default 'guest',
  action text not null,
  target_type text not null default '',
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.pm_booking_updates (
  id text primary key,
  booking_id text not null references public.pm_bookings(id) on delete cascade,
  author_id text references public.pm_users(id),
  status text not null,
  message text not null default '',
  created_at timestamptz not null default now()
);

-- Customer design and reference files. Only metadata lives here; the bytes are
-- in the private `booking-files` Storage bucket. Deleting a booking removes its
-- rows, but nothing in the app deletes files when a status changes.
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

-- Structured cancellation history. The booking row holds the current status;
-- this table preserves every cancellation event with its reason and actor.
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

create table if not exists public.pm_notifications (
  id text primary key,
  user_id text not null references public.pm_users(id) on delete cascade,
  branch_id text references public.pm_branches(id),
  booking_id text references public.pm_bookings(id) on delete cascade,
  title text not null,
  message text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pm_users_branch_idx on public.pm_users (branch_id);
create index if not exists pm_bookings_branch_idx on public.pm_bookings (branch_id);
create index if not exists pm_notifications_user_idx on public.pm_notifications (user_id, created_at desc);
create index if not exists pm_bookings_customer_idx on public.pm_bookings (customer_id);
create index if not exists pm_bookings_staff_idx on public.pm_bookings (staff_id);
create index if not exists pm_bookings_event_date_idx on public.pm_bookings (event_date);
create index if not exists pm_bookings_status_idx on public.pm_bookings (status);
create index if not exists pm_bookings_type_idx on public.pm_bookings (booking_type);
create index if not exists pm_bookings_deployment_idx on public.pm_bookings (deployment_status);
create index if not exists pm_bookings_setup_date_idx on public.pm_bookings (setup_date);
create index if not exists pm_bookings_pickup_schedule_idx on public.pm_bookings (pickup_schedule_date);
create index if not exists pm_inventory_blocks_window_idx
  on public.pm_inventory_blocks (booth_type, start_date, end_date);
create index if not exists pm_inventory_blocks_active_idx
  on public.pm_inventory_blocks (active, start_date);
create index if not exists pm_discounts_customer_idx on public.pm_discounts (customer_id) where active;
create index if not exists pm_assistant_conversations_user_idx
  on public.pm_assistant_conversations (user_id, updated_at desc);
create index if not exists pm_assistant_messages_conversation_idx
  on public.pm_assistant_messages (conversation_id, created_at);
create index if not exists pm_assistant_messages_user_idx
  on public.pm_assistant_messages (user_id, created_at desc);
create index if not exists pm_password_resets_token_idx on public.pm_password_resets (token_hash);
create index if not exists pm_password_resets_user_idx on public.pm_password_resets (user_id, created_at desc);
create index if not exists pm_audit_logs_created_idx on public.pm_audit_logs (created_at desc);
create index if not exists pm_audit_logs_actor_idx on public.pm_audit_logs (actor_id, created_at desc);
create index if not exists pm_booking_updates_booking_idx on public.pm_booking_updates (booking_id, created_at);
create index if not exists pm_booking_files_booking_idx on public.pm_booking_files (booking_id, created_at);
create index if not exists pm_booking_files_customer_idx on public.pm_booking_files (customer_id);
create index if not exists pm_booking_cancellations_booking_idx on public.pm_booking_cancellations (booking_id, created_at desc);
create index if not exists pm_booking_cancellations_branch_idx on public.pm_booking_cancellations (branch_id, created_at desc);
create index if not exists pm_booking_cancellations_reason_idx on public.pm_booking_cancellations (reason_code);

-- The two studio branches. Bookings are routed to the nearest one.
insert into public.pm_branches (id, name, address, lat, lng, map_url) values
  (
    'branch-batangas',
    'Batangas City branch',
    'P. Burgos Street, Barangay 12, Pallocan Kanluran, Batangas City, Batangas 4200',
    13.7606916,
    121.0573095,
    'https://maps.app.goo.gl/Qiz5kipeCsmVfEbs6'
  ),
  (
    'branch-bauan',
    'Bauan branch',
    'Poblacion 4, New Danglayan, Bauan, Batangas 4201',
    13.7923305,
    121.0103575,
    'https://maps.app.goo.gl/85qpuunn9K74po7w5'
  )
  on conflict (id) do nothing;

alter table public.pm_branches enable row level security;
alter table public.pm_users enable row level security;
alter table public.pm_services enable row level security;
alter table public.pm_bookings enable row level security;
alter table public.pm_inventory_blocks enable row level security;
alter table public.pm_booking_updates enable row level security;
alter table public.pm_notifications enable row level security;
alter table public.pm_discounts enable row level security;
alter table public.pm_assistant_conversations enable row level security;
alter table public.pm_assistant_messages enable row level security;
alter table public.pm_password_resets enable row level security;
alter table public.pm_audit_logs enable row level security;
alter table public.pm_booking_files enable row level security;
alter table public.pm_booking_cancellations enable row level security;

-- Deliberately no anon/authenticated policies: the public API is the only
-- client. The Node server connects with the service-role key, which bypasses
-- RLS. Never expose the service-role key to the browser.

-- Private bucket for customer design uploads. The server mints 5-minute signed
-- URLs after checking booking access, so the bucket itself stays closed.
insert into storage.buckets (id, name, public)
values ('booking-files', 'booking-files', false)
on conflict (id) do nothing;
