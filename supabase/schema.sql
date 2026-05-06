-- WebAR Layer Editor MVP schema
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.folders(id) on delete set null,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  thumbnail_path text,
  project_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.folders enable row level security;
alter table public.projects enable row level security;

-- Demo policies: public read/write with anon key.
-- This is intentionally permissive for fast demos. Replace with Supabase Auth policies before production.
drop policy if exists "Demo read folders" on public.folders;
drop policy if exists "Demo insert folders" on public.folders;
drop policy if exists "Demo update folders" on public.folders;
drop policy if exists "Demo read projects" on public.projects;
drop policy if exists "Demo insert projects" on public.projects;
drop policy if exists "Demo update projects" on public.projects;

create policy "Demo read folders"
on public.folders for select
to anon, authenticated
using (true);

create policy "Demo insert folders"
on public.folders for insert
to anon, authenticated
with check (true);

create policy "Demo update folders"
on public.folders for update
to anon, authenticated
using (true)
with check (true);

create policy "Demo read projects"
on public.projects for select
to anon, authenticated
using (true);

create policy "Demo insert projects"
on public.projects for insert
to anon, authenticated
with check (true);

create policy "Demo update projects"
on public.projects for update
to anon, authenticated
using (true)
with check (true);

insert into storage.buckets (id, name, public)
values ('ar-assets', 'ar-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "Demo public read ar assets" on storage.objects;
drop policy if exists "Demo public insert ar assets" on storage.objects;
drop policy if exists "Demo public update ar assets" on storage.objects;

create policy "Demo public read ar assets"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'ar-assets');

create policy "Demo public insert ar assets"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'ar-assets');

create policy "Demo public update ar assets"
on storage.objects for update
to anon, authenticated
using (bucket_id = 'ar-assets')
with check (bucket_id = 'ar-assets');
