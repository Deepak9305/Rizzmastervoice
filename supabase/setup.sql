-- Initial Rizzmaster Voice schema. Run once in the Supabase SQL Editor.
-- Fresh project setup, not an invented migration-history entry.
begin;

create table if not exists public.voice_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 60),
  coach text not null default 'wingman' check (coach in ('wingman','bestie','straight')),
  save_transcripts boolean not null default false,
  spoken_replies boolean not null default true,
  voice_consent boolean not null default false,
  age_confirmed boolean not null default false,
  terms_version text,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.voice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) <= 80),
  mode text not null check (mode in ('advice','practice')),
  coach text not null check (coach in ('wingman','bestie','straight')),
  scenario text not null default 'intro' check (scenario in ('intro','second','boundary','rejection')),
  messages jsonb not null check (jsonb_typeof(messages) = 'array'),
  created_at timestamptz not null default now()
);
create index if not exists voice_sessions_user_created on public.voice_sessions(user_id, created_at desc);
create table if not exists public.voice_purchases (
  purchase_token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default false,
  plan text check (plan in ('weekly','monthly')),
  expires_at timestamptz,
  state text not null,
  updated_at timestamptz not null default now()
);
create index if not exists voice_purchases_user on public.voice_purchases(user_id);
create table if not exists public.voice_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  turns integer not null default 0 check (turns >= 0),
  reports integer not null default 0 check (reports >= 0),
  primary key(user_id, day)
);
create table if not exists public.voice_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null default '',
  reason text not null check (reason in ('Harmful advice','Sexual content','Inaccurate advice','Something else')),
  content text not null check (length(content) <= 4000),
  note text not null default '' check (length(note) <= 500),
  status text not null default 'new' check (status in ('new','reviewed','actioned')),
  created_at timestamptz not null default now()
);
create index if not exists voice_reports_review_queue on public.voice_reports(status, created_at);

alter table public.voice_profiles enable row level security;
alter table public.voice_sessions enable row level security;
alter table public.voice_purchases enable row level security;
alter table public.voice_usage enable row level security;
alter table public.voice_reports enable row level security;

-- All writes go through authenticated Vercel handlers. Users cannot edit entitlements,
-- terms acceptance, quota, or moderation status with a public key.
revoke all on public.voice_profiles, public.voice_sessions, public.voice_purchases, public.voice_usage, public.voice_reports from anon, authenticated;
grant select on public.voice_profiles, public.voice_sessions to authenticated;
grant all on public.voice_profiles, public.voice_sessions, public.voice_purchases, public.voice_usage, public.voice_reports to service_role;
drop policy if exists "Read own profile" on public.voice_profiles;
create policy "Read own profile" on public.voice_profiles for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Read own sessions" on public.voice_sessions;
create policy "Read own sessions" on public.voice_sessions for select to authenticated using ((select auth.uid()) = user_id);
-- No public policies on purchase tokens, usage, or reports: server-only access.

-- Service-only RPC uses SECURITY INVOKER. No public privilege escalation.
create or replace function public.voice_reserve_turn(p_user uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_limit integer; v_used integer;
begin
  if p_user is null then raise exception 'Missing user'; end if;
  select case when exists(
    select 1 from public.voice_purchases where user_id = p_user and active and expires_at > now()
  ) then 60 else 5 end into v_limit;
  insert into public.voice_usage as u(user_id, day, turns)
  values(p_user, (now() at time zone 'UTC')::date, 1)
  on conflict(user_id, day) do update set turns = u.turns + 1 where u.turns < v_limit
  returning turns into v_used;
  return jsonb_build_object('allowed', v_used is not null, 'used', coalesce(v_used, v_limit), 'limit', v_limit);
end;
$$;
create or replace function public.voice_reserve_report(p_user uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  insert into public.voice_usage as u(user_id, day, reports)
  values(p_user, (now() at time zone 'UTC')::date, 1)
  on conflict(user_id, day) do update set reports = u.reports + 1 where u.reports < 20
  returning reports into v_count;
  return v_count is not null;
end;
$$;
grant usage on schema auth to service_role;
grant select on auth.sessions to service_role;
create or replace function public.voice_session_active(p_user uuid, p_session uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from auth.sessions where id = p_session and user_id = p_user);
$$;
revoke all on function public.voice_reserve_turn(uuid), public.voice_reserve_report(uuid), public.voice_session_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.voice_reserve_turn(uuid), public.voice_reserve_report(uuid), public.voice_session_active(uuid, uuid) to service_role;

commit;
