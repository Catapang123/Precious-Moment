-- Precious Moments — private assistant conversation history
-- Run once in the Supabase SQL editor. Safe to run more than once. This only
-- creates two new tables and their indexes; accounts, bookings, inventory,
-- payments, and catalog rows are untouched.
--
-- Ownership is enforced twice:
--   1. every server query is scoped to the signed-in session's user id;
--   2. the composite foreign key makes a message's user_id match the owning
--      conversation's user_id at the database level.

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

create index if not exists pm_assistant_conversations_user_idx
  on public.pm_assistant_conversations (user_id, updated_at desc);
create index if not exists pm_assistant_messages_conversation_idx
  on public.pm_assistant_messages (conversation_id, created_at);
create index if not exists pm_assistant_messages_user_idx
  on public.pm_assistant_messages (user_id, created_at desc);

alter table public.pm_assistant_conversations enable row level security;
alter table public.pm_assistant_messages enable row level security;

-- The Node server uses the service-role key and checks ownership on every
-- request. No anon/authenticated policies are added: the browser never reads
-- these tables directly.
