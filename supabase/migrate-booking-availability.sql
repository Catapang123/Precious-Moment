-- Precious Moments — booking availability and product-management fields
-- Run once in the Supabase SQL editor before `npm run sync:prices -- --remote`.
-- Safe to run more than once.

alter table public.pm_services
  add column if not exists addon boolean not null default false;

alter table public.pm_services
  add column if not exists booking_availability text not null default 'unassigned';

alter table public.pm_services
  add column if not exists origin text not null default 'catalog';

alter table public.pm_services
  add column if not exists admin_edited boolean not null default false;

alter table public.pm_services
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pm_services_booking_availability_check'
      and conrelid = 'public.pm_services'::regclass
  ) then
    alter table public.pm_services
      add constraint pm_services_booking_availability_check
      check (booking_availability in ('pickup', 'event', 'both', 'unassigned'));
  end if;
end $$;

-- Keep the timestamp current for rows changed outside the app.
create or replace function public.pm_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pm_services_touch_updated_at on public.pm_services;
create trigger pm_services_touch_updated_at
  before update on public.pm_services
  for each row execute function public.pm_touch_updated_at();
