-- Supabase schema for account-scoped saved ideas/history
-- Run in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.saved_names (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  base text not null,
  domains jsonb not null default '[]'::jsonb,
  rationale text,
  score integer not null,
  score_breakdown jsonb,
  summary_conclusion text,
  recommendation_reason text,
  saved_at timestamptz not null default now()
);

create index if not exists idx_saved_names_user_saved_at
  on public.saved_names (user_id, saved_at desc);

create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null default '',
  tone text not null default '',
  name_style text not null default '',
  tlds text[] not null default '{}',
  refined boolean not null default false,
  result_count integer not null default 0,
  available_count integer not null default 0,
  names jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_search_history_user_created_at
  on public.search_history (user_id, created_at desc);

create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_title text not null,
  title text not null,
  description text not null,
  submitted_at timestamptz not null default now(),
  linear_issue_id text,
  linear_issue_identifier text,
  linear_issue_url text,
  linear_issue_state_name text,
  linear_issue_state_type text,
  issue_status text not null default 'submitted'
    check (issue_status in ('submitted', 'linked', 'fixed', 'closed_no_fix', 'unlinked')),
  fixed_at timestamptz,
  acknowledged_at timestamptz
);

create index if not exists idx_feedback_submissions_user_submitted_at
  on public.feedback_submissions (user_id, submitted_at desc);

create index if not exists idx_feedback_submissions_issue_id
  on public.feedback_submissions (linear_issue_id);

create index if not exists idx_feedback_submissions_normalized_title
  on public.feedback_submissions (normalized_title);

alter table public.saved_names enable row level security;
alter table public.search_history enable row level security;
alter table public.feedback_submissions enable row level security;

drop policy if exists "saved_names_select_own" on public.saved_names;
drop policy if exists "saved_names_insert_own" on public.saved_names;
drop policy if exists "saved_names_update_own" on public.saved_names;
drop policy if exists "saved_names_delete_own" on public.saved_names;

create policy "saved_names_select_own"
  on public.saved_names for select
  using (auth.uid() = user_id);

create policy "saved_names_insert_own"
  on public.saved_names for insert
  with check (auth.uid() = user_id);

create policy "saved_names_update_own"
  on public.saved_names for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "saved_names_delete_own"
  on public.saved_names for delete
  using (auth.uid() = user_id);

drop policy if exists "search_history_select_own" on public.search_history;
drop policy if exists "search_history_insert_own" on public.search_history;
drop policy if exists "search_history_update_own" on public.search_history;
drop policy if exists "search_history_delete_own" on public.search_history;

create policy "search_history_select_own"
  on public.search_history for select
  using (auth.uid() = user_id);

create policy "search_history_insert_own"
  on public.search_history for insert
  with check (auth.uid() = user_id);

create policy "search_history_update_own"
  on public.search_history for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "search_history_delete_own"
  on public.search_history for delete
  using (auth.uid() = user_id);

drop policy if exists "feedback_submissions_select_own" on public.feedback_submissions;
drop policy if exists "feedback_submissions_insert_own" on public.feedback_submissions;
drop policy if exists "feedback_submissions_update_own" on public.feedback_submissions;

create policy "feedback_submissions_select_own"
  on public.feedback_submissions for select
  using (auth.uid() = user_id);

create policy "feedback_submissions_insert_own"
  on public.feedback_submissions for insert
  with check (auth.uid() = user_id);

create policy "feedback_submissions_update_own"
  on public.feedback_submissions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
