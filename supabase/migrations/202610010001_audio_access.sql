-- Apply once with the Supabase SQL editor/migration runner, before enabling paid endpoints.
-- No scripts, prompts, files, email addresses, credentials or bearer tokens are stored here.
begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Criador' check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant all on public.profiles to service_role;
drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self on public.profiles for select to authenticated using ((select auth.uid()) = id);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create or replace function public.create_velora_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name', '')), 120), ''), 'Criador'))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.create_velora_profile() from public, anon, authenticated;
drop trigger if exists velora_create_profile on auth.users;
create trigger velora_create_profile after insert on auth.users for each row execute function public.create_velora_profile();
insert into public.profiles(id, display_name)
select id, coalesce(nullif(left(btrim(coalesce(raw_user_meta_data ->> 'display_name', raw_user_meta_data ->> 'name', '')), 120), ''), 'Criador') from auth.users
on conflict (id) do nothing;

create or replace function public.touch_velora_profile() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function public.touch_velora_profile() from public, anon, authenticated;
drop trigger if exists velora_profile_updated on public.profiles;
create trigger velora_profile_updated before update on public.profiles for each row execute function public.touch_velora_profile();

create table if not exists public.audio_usage_requests (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('speech', 'voice_change', 'ambience')),
  units integer not null check (units between 1 and 10000),
  state text not null check (state in ('reserved', 'succeeded', 'failed', 'timeout', 'expired')),
  usage_day date not null default ((now() at time zone 'UTC')::date),
  started_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  finished_at timestamptz
);
create index if not exists audio_usage_user_day on public.audio_usage_requests(user_id, usage_day);
create index if not exists audio_usage_day on public.audio_usage_requests(usage_day);
create index if not exists audio_usage_active on public.audio_usage_requests(lease_expires_at) where state = 'reserved';
alter table public.audio_usage_requests enable row level security;
revoke all on public.audio_usage_requests from anon, authenticated;
grant select on public.audio_usage_requests to authenticated;
grant all on public.audio_usage_requests to service_role;
drop policy if exists audio_usage_read_self on public.audio_usage_requests;
create policy audio_usage_read_self on public.audio_usage_requests for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.reserve_audio_usage(
  p_user_id uuid, p_request_id uuid, p_operation text, p_units integer,
  p_daily_limit integer default 10, p_daily_units integer default 15000,
  p_global_daily_limit integer default 50, p_global_daily_units integer default 75000,
  p_concurrency integer default 2, p_lease_seconds integer default 150
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  day_utc date := (now() at time zone 'UTC')::date;
  used_count bigint; used_units bigint; active_count bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' or (auth.uid() is not null and auth.uid() <> p_user_id) then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  if p_user_id is null or p_request_id is null or p_operation is null or p_operation not in ('speech', 'voice_change', 'ambience')
    or p_units is null or p_units not between 1 and 10000
    or p_daily_limit is null or p_daily_limit not between 1 and 1000
    or p_daily_units is null or p_daily_units not between 1 and 1000000
    or p_global_daily_limit is null or p_global_daily_limit not between 1 and 10000
    or p_global_daily_units is null or p_global_daily_units not between 1 and 10000000
    or p_concurrency is null or p_concurrency not between 1 and 2
    or p_lease_seconds is null or p_lease_seconds not between 30 and 180 then
    raise exception using errcode = '22023', message = 'Invalid reservation';
  end if;
  -- One database lock serializes checks across all serverless instances/users.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('velora_audio_paid_usage', 0));
  if exists (select 1 from public.audio_usage_requests where request_id = p_request_id) then
    return jsonb_build_object('allowed', false, 'code', 'duplicate_request');
  end if;
  update public.audio_usage_requests set state = 'expired', finished_at = now()
    where state = 'reserved' and lease_expires_at <= now();
  select count(*), coalesce(sum(units), 0) into used_count, used_units from public.audio_usage_requests where user_id = p_user_id and usage_day = day_utc;
  if used_count >= p_daily_limit then return jsonb_build_object('allowed', false, 'code', 'daily_limit'); end if;
  if used_units + p_units > p_daily_units then return jsonb_build_object('allowed', false, 'code', 'daily_budget_limit'); end if;
  select count(*), coalesce(sum(units), 0) into used_count, used_units from public.audio_usage_requests where usage_day = day_utc;
  if used_count >= p_global_daily_limit then return jsonb_build_object('allowed', false, 'code', 'global_daily_limit'); end if;
  if used_units + p_units > p_global_daily_units then return jsonb_build_object('allowed', false, 'code', 'global_budget_limit'); end if;
  select count(*) into active_count from public.audio_usage_requests where state = 'reserved' and lease_expires_at > now();
  if active_count >= p_concurrency then return jsonb_build_object('allowed', false, 'code', 'concurrency_limit'); end if;
  insert into public.audio_usage_requests(request_id, user_id, operation, units, state, usage_day, lease_expires_at)
    values (p_request_id, p_user_id, p_operation, p_units, 'reserved', day_utc, now() + pg_catalog.make_interval(secs => p_lease_seconds));
  return jsonb_build_object('allowed', true, 'requestId', p_request_id, 'remainingGenerations', p_daily_limit - (select count(*) from public.audio_usage_requests where user_id = p_user_id and usage_day = day_utc));
end;
$$;
revoke all on function public.reserve_audio_usage(uuid, uuid, text, integer, integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_audio_usage(uuid, uuid, text, integer, integer, integer, integer, integer, integer, integer) to service_role;

create or replace function public.finish_audio_usage(p_user_id uuid, p_request_id uuid, p_outcome text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' or (auth.uid() is not null and auth.uid() <> p_user_id) then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;
  if p_user_id is null or p_request_id is null or p_outcome is null or p_outcome not in ('succeeded', 'failed', 'timeout') then
    raise exception using errcode = '22023', message = 'Invalid outcome';
  end if;
  update public.audio_usage_requests set state = p_outcome, finished_at = now()
    where request_id = p_request_id and user_id = p_user_id and state = 'reserved';
  return found;
end;
$$;
revoke all on function public.finish_audio_usage(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.finish_audio_usage(uuid, uuid, text) to service_role;

commit;
