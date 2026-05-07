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

-- Backstage policies:
-- anon can read published/demo content for Viewer.
-- authenticated users can manage the shared backstage projects.
drop policy if exists "Demo read folders" on public.folders;
drop policy if exists "Demo insert folders" on public.folders;
drop policy if exists "Demo update folders" on public.folders;
drop policy if exists "Demo delete folders" on public.folders;
drop policy if exists "Demo read projects" on public.projects;
drop policy if exists "Demo insert projects" on public.projects;
drop policy if exists "Demo update projects" on public.projects;
drop policy if exists "Demo delete projects" on public.projects;
drop policy if exists "Backstage read folders" on public.folders;
drop policy if exists "Backstage insert folders" on public.folders;
drop policy if exists "Backstage update folders" on public.folders;
drop policy if exists "Backstage delete folders" on public.folders;
drop policy if exists "Backstage read projects" on public.projects;
drop policy if exists "Backstage insert projects" on public.projects;
drop policy if exists "Backstage update projects" on public.projects;
drop policy if exists "Backstage delete projects" on public.projects;

create policy "Backstage read folders"
on public.folders for select
to anon, authenticated
using (true);

create policy "Backstage insert folders"
on public.folders for insert
to authenticated
with check (true);

create policy "Backstage update folders"
on public.folders for update
to authenticated
using (true)
with check (true);

create policy "Backstage delete folders"
on public.folders for delete
to authenticated
using (true);

create policy "Backstage read projects"
on public.projects for select
to anon, authenticated
using (true);

create policy "Backstage insert projects"
on public.projects for insert
to authenticated
with check (true);

create policy "Backstage update projects"
on public.projects for update
to authenticated
using (true)
with check (true);

create policy "Backstage delete projects"
on public.projects for delete
to authenticated
using (true);

insert into storage.buckets (id, name, public)
values ('ar-assets', 'ar-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "Demo public read ar assets" on storage.objects;
drop policy if exists "Demo public insert ar assets" on storage.objects;
drop policy if exists "Demo public update ar assets" on storage.objects;
drop policy if exists "Demo public delete ar assets" on storage.objects;
drop policy if exists "Backstage read ar assets" on storage.objects;
drop policy if exists "Backstage insert ar assets" on storage.objects;
drop policy if exists "Backstage update ar assets" on storage.objects;
drop policy if exists "Backstage delete ar assets" on storage.objects;

create policy "Backstage read ar assets"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'ar-assets');

create policy "Backstage insert ar assets"
on storage.objects for insert
to authenticated
with check (bucket_id = 'ar-assets');

create policy "Backstage update ar assets"
on storage.objects for update
to authenticated
using (bucket_id = 'ar-assets')
with check (bucket_id = 'ar-assets');

create policy "Backstage delete ar assets"
on storage.objects for delete
to authenticated
using (bucket_id = 'ar-assets');
