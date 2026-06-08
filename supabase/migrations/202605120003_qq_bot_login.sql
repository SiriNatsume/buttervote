create extension if not exists "pgcrypto";

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

alter table public.profiles
  alter column id set default gen_random_uuid(),
  add column if not exists qq_user_id text,
  add column if not exists qq_nickname text,
  add column if not exists qq_avatar_url text,
  add column if not exists login_provider text not null default 'supabase';

create unique index if not exists profiles_qq_user_id_key
  on public.profiles(qq_user_id)
  where qq_user_id is not null;

create table if not exists public.qq_login_tickets (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  qq_user_id text not null,
  qq_nickname text,
  qq_avatar_url text,
  return_to text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists qq_login_tickets_qq_user_id_idx
  on public.qq_login_tickets(qq_user_id);

create index if not exists qq_login_tickets_expires_at_idx
  on public.qq_login_tickets(expires_at);

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  session_token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists app_sessions_profile_id_idx
  on public.app_sessions(profile_id);

create index if not exists app_sessions_expires_at_idx
  on public.app_sessions(expires_at);

alter table public.qq_login_tickets enable row level security;
alter table public.app_sessions enable row level security;

revoke all on public.qq_login_tickets from anon, authenticated;
revoke all on public.app_sessions from anon, authenticated;
