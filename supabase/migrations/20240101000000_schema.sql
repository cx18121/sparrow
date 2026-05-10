-- Minimal migration for local e2e testing.
-- Only creates Supabase-managed tables. Prisma manages all other tables
-- (Company, Campaign, Template, UserLead, Email, DailyQuota, etc.) via db push.

create extension if not exists "uuid-ossp";

-- user_profiles: auth-adjacent table managed outside Prisma (@@ignore in schema.prisma).
-- No FK to auth.users — avoids Prisma P4002 cross-schema introspection error.
create table user_profiles (
  user_id                       uuid primary key,
  google_refresh_token_encrypted text,
  resume_path                    text,
  resume_text                    text,
  workspace_config               jsonb not null default '{}',
  default_filters                jsonb not null default '{}',
  full_name                      text,
  bio                            text,
  target_role                    text,
  onboarding_completed           boolean not null default false,
  onboarding_completed_at        timestamptz,
  created_at                     timestamptz default now(),
  updated_at                     timestamptz default now()
);

alter table user_profiles enable row level security;

create policy "Users can read own profile" on user_profiles
  for select using (auth.uid() = user_id);

-- Storage bucket for resume uploads.
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;
