-- ColdFlow Supabase Schema
-- Run this in your Supabase SQL editor after creating a project

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ──────────────────────────────────────────────
-- Templates
-- ──────────────────────────────────────────────
create table templates (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null,
  subject     text not null default '',
  body        text not null default '',
  is_shared   boolean not null default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table templates enable row level security;

create policy "Users can manage own templates" on templates
  for all using (auth.uid() = user_id);

create policy "Users can read shared templates" on templates
  for select using (is_shared = true);

-- ──────────────────────────────────────────────
-- Sequences
-- ──────────────────────────────────────────────
create table sequences (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null,
  description text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table sequences enable row level security;
create policy "Users can manage own sequences" on sequences
  for all using (auth.uid() = user_id);

create table sequence_steps (
  id          uuid primary key default uuid_generate_v4(),
  sequence_id uuid references sequences(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  step_order  int not null default 0,
  name        text not null,
  template_id uuid references templates(id) on delete set null,
  wait_days   int not null default 0,
  variants    jsonb not null default '[]',
  created_at  timestamptz default now()
);

alter table sequence_steps enable row level security;
create policy "Users can manage own steps" on sequence_steps
  for all using (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- Contact lists & Contacts
-- ──────────────────────────────────────────────
create table contact_lists (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null,
  created_at  timestamptz default now()
);

alter table contact_lists enable row level security;
create policy "Users can manage own lists" on contact_lists
  for all using (auth.uid() = user_id);

create table contacts (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  list_id      uuid references contact_lists(id) on delete set null,
  first_name   text not null default '',
  last_name    text not null default '',
  email        text not null,
  company      text,
  status       text not null default 'active' check (status in ('active','bounced','unsubscribed')),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique(user_id, email)
);

alter table contacts enable row level security;
create policy "Users can manage own contacts" on contacts
  for all using (auth.uid() = user_id);

create table segments (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null,
  filters     jsonb not null default '[]',
  created_at  timestamptz default now()
);

alter table segments enable row level security;
create policy "Users can manage own segments" on segments
  for all using (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- Campaigns
-- ──────────────────────────────────────────────
create table campaigns (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  name            text not null,
  subject         text not null default '',
  status          text not null default 'draft' check (status in ('draft','active','paused','completed')),
  template_id     uuid references templates(id) on delete set null,
  sequence_id     uuid references sequences(id) on delete set null,
  contact_list_id uuid references contact_lists(id) on delete set null,
  scheduled_at    timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table campaigns enable row level security;
create policy "Users can manage own campaigns" on campaigns
  for all using (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- Analytics events
-- ──────────────────────────────────────────────
create table analytics_events (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  campaign_id  uuid references campaigns(id) on delete cascade,
  event_type   text not null, -- 'sent' | 'opened' | 'replied' | 'bounced' | 'converted'
  contact_id   uuid references contacts(id) on delete set null,
  metadata     jsonb default '{}',
  created_at   timestamptz default now()
);

alter table analytics_events enable row level security;
create policy "Users can manage own events" on analytics_events
  for all using (auth.uid() = user_id);

create index on analytics_events (user_id, created_at desc);
create index on analytics_events (campaign_id, event_type);

-- ──────────────────────────────────────────────
-- Settings (one row per user)
-- ──────────────────────────────────────────────
create table settings (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade not null unique,
  smtp_host       text,
  smtp_port       int,
  smtp_username   text,
  smtp_password   text, -- store encrypted in production!
  smtp_tls        boolean default true,
  daily_send_max  int default 200,
  send_delay_sec  int default 30,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table settings enable row level security;
create policy "Users can manage own settings" on settings
  for all using (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- API keys
-- ──────────────────────────────────────────────
create table api_keys (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null,
  key_hash    text not null unique, -- store bcrypt hash; show plaintext only once
  last_used   timestamptz,
  created_at  timestamptz default now()
);

alter table api_keys enable row level security;
create policy "Users can manage own api_keys" on api_keys
  for all using (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- Team invites
-- ──────────────────────────────────────────────
create table team_invites (
  id           uuid primary key default uuid_generate_v4(),
  owner_id     uuid references auth.users(id) on delete cascade not null,
  invitee_email text not null,
  role         text not null default 'editor' check (role in ('admin','editor','viewer')),
  status       text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at   timestamptz default now()
);

alter table team_invites enable row level security;
create policy "Owners can manage invites" on team_invites
  for all using (auth.uid() = owner_id);

-- ──────────────────────────────────────────────
-- User profiles (one row per user)
-- ──────────────────────────────────────────────
-- Holds onboarding state, encrypted secrets (Google refresh token,
-- Claude API key), the resume storage path, and the workspace config
-- JSON so onboarding hydrates across devices.
create table user_profiles (
  user_id                       uuid primary key references auth.users(id) on delete cascade,
  google_refresh_token_encrypted text,
  claude_api_key_encrypted       text,
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

-- Users may read their own profile via the anon/authenticated client.
-- Writes go through the service-role key in /api/profile so encrypted
-- fields never round-trip through the browser.
create policy "Users can read own profile" on user_profiles
  for select using (auth.uid() = user_id);

-- ──────────────────────────────────────────────
-- Resumes storage bucket
-- ──────────────────────────────────────────────
-- Run once per project. Files are written to `resumes/<user_id>/<filename>`.
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

create policy "Users can upload own resume"
  on storage.objects for insert
  with check (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can read own resume"
  on storage.objects for select
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can replace own resume"
  on storage.objects for update
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own resume"
  on storage.objects for delete
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ──────────────────────────────────────────────
-- Webhooks
-- ──────────────────────────────────────────────
create table webhooks (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  url         text not null,
  events      text[] not null default '{}',
  created_at  timestamptz default now()
);

alter table webhooks enable row level security;
create policy "Users can manage own webhooks" on webhooks
  for all using (auth.uid() = user_id);
