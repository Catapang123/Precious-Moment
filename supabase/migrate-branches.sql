-- Precious Moments — two-branch update
-- Run once in the Supabase SQL editor on an existing project. Safe to re-run:
-- every statement is additive, nothing is dropped and no rows are deleted.
--
-- After this, create the two branch administrators with:
--   npm run setup:branches
-- (it generates passwords and writes them to data/branch-admins.txt)

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

alter table public.pm_users
  add column if not exists branch_id text references public.pm_branches(id);

alter table public.pm_users drop constraint if exists pm_users_role_check;
alter table public.pm_users
  add constraint pm_users_role_check check (role in ('customer', 'staff', 'branch_admin', 'admin'));

alter table public.pm_bookings add column if not exists address text not null default '';
alter table public.pm_bookings
  add column if not exists branch_id text references public.pm_branches(id);
alter table public.pm_bookings
  add column if not exists needs_review boolean not null default false;

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

-- Bookings created before this update have no branch; the owner resolves them in
-- the dashboard instead of them being guessed into a branch.
update public.pm_bookings set needs_review = true where branch_id is null;

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
alter table public.pm_notifications enable row level security;
