-- Precious Moments — product images, dynamic measurement pricing, and unified
-- password recovery. Run once in the Supabase SQL editor on an existing project.
-- Every statement is additive; no product or booking rows are deleted.

alter table public.pm_users
  add column if not exists session_version integer not null default 0;

alter table public.pm_services
  add column if not exists image_url text not null default '';
alter table public.pm_services
  add column if not exists image_alt text not null default '';
alter table public.pm_services
  add column if not exists image_updated_at timestamptz;
alter table public.pm_services
  add column if not exists image_updated_by text;
alter table public.pm_services
  add column if not exists image_width integer;
alter table public.pm_services
  add column if not exists image_height integer;
alter table public.pm_services
  add column if not exists catalog_visible boolean not null default true;
alter table public.pm_services
  add column if not exists round_dimensions_up boolean not null default false;
alter table public.pm_services
  add column if not exists min_dimension numeric(8, 2);
alter table public.pm_services
  add column if not exists max_dimension numeric(8, 2);

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

create index if not exists pm_password_resets_token_idx
  on public.pm_password_resets (token_hash);
create index if not exists pm_password_resets_user_idx
  on public.pm_password_resets (user_id, created_at desc);
create index if not exists pm_audit_logs_created_idx
  on public.pm_audit_logs (created_at desc);
create index if not exists pm_audit_logs_actor_idx
  on public.pm_audit_logs (actor_id, created_at desc);

alter table public.pm_password_resets enable row level security;
alter table public.pm_audit_logs enable row level security;

-- The new measured products are inserted by `npm run sync:prices`; no manual
-- product inserts are needed here. Existing products remain intact.
