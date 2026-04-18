-- Shared, cross-instance cache for domain availability lookups.
-- Lets refined searches and cold serverless invocations skip the upstream
-- registrar/WhoisXML API when a recent answer is on file.
--
-- Run in Supabase SQL Editor on your project (production + any preview/dev).
--
-- Access model: service-role only. RLS is enabled and no policy is granted to
-- anon/authenticated, so all reads and writes from the app go through the
-- service-role key in `domain-cache-store.ts` (server-side only).

create extension if not exists pgcrypto;

create table if not exists public.domain_cache (
  domain text primary key,
  available boolean not null,
  status text not null,
  premium boolean,
  price numeric,
  source text not null default 'api',
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_domain_cache_expires_at
  on public.domain_cache (expires_at);

alter table public.domain_cache enable row level security;

-- Belt-and-suspenders: drop any policy that may have been added previously so
-- we are sure no anon/authenticated path can read or write the cache.
drop policy if exists "domain_cache_select_all" on public.domain_cache;
drop policy if exists "domain_cache_insert_all" on public.domain_cache;
drop policy if exists "domain_cache_update_all" on public.domain_cache;
drop policy if exists "domain_cache_delete_all" on public.domain_cache;

-- Optional: a small helper to evict expired rows. Either call from a Supabase
-- cron job (`select cron.schedule(...)`) or run manually; the app does not
-- depend on it because lookups already filter out expired rows.
create or replace function public.purge_expired_domain_cache()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.domain_cache where expires_at < now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_domain_cache() from public;
revoke all on function public.purge_expired_domain_cache() from anon, authenticated;
