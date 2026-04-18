-- Feedback loop tables for suggestion tracking + shipped-fix acknowledgements.
-- Run in Supabase SQL Editor after base schema.

create extension if not exists pgcrypto;

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

alter table public.feedback_submissions enable row level security;

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
