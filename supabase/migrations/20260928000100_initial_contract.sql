-- A1: three private business tables. Apply to a Supabase project with Auth enabled.
-- An analysis row is inserted only after a complete report passes application validation.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile_data jsonb not null,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  constraint profile_data_shape check (
    jsonb_typeof(profile_data) = 'object'
    and coalesce(profile_data->>'structureVersion', '') = '1.0.0'
    and jsonb_typeof(profile_data->'facts') = 'array'
    and jsonb_typeof(profile_data->'targetDirections') = 'array'
  )
);

create function public.bump_profile_revision()
returns trigger language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_bump_revision
before update on public.profiles
for each row execute function public.bump_profile_revision();

create table public.job_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company text not null check (length(btrim(company)) > 0),
  job_title text not null check (length(btrim(job_title)) > 0),
  city text,
  direction text,
  jd_text text not null check (length(btrim(jd_text)) > 0),
  jd_source_url text,
  jd_items jsonb not null check (jsonb_typeof(jd_items) = 'array'),
  profile_version integer not null check (profile_version > 0),
  profile_snapshot jsonb not null check (
    jsonb_typeof(profile_snapshot) = 'object'
    and coalesce(profile_snapshot->>'structureVersion', '') = '1.0.0'
    and jsonb_typeof(profile_snapshot->'facts') = 'array'
  ),
  report jsonb not null check (
    jsonb_typeof(report) = 'object'
    and report ?& array[
      'materialFit', 'applicationAction', 'qualifications', 'coreDuties',
      'preferredItems', 'inferences', 'resumeSuggestions', 'verificationItems'
    ]
    and jsonb_typeof(report->'qualifications') = 'array'
    and jsonb_typeof(report->'coreDuties') = 'array'
    and jsonb_typeof(report->'preferredItems') = 'array'
  ),
  report_structure_version text not null
    check (report_structure_version = '1.0.0'),
  prompt_version text not null check (length(btrim(prompt_version)) > 0),
  model_provider text not null check (length(btrim(model_provider)) > 0),
  model_name text not null check (length(btrim(model_name)) > 0),
  test_data_version text check (
    test_data_version is null or length(btrim(test_data_version)) > 0
  ),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid,
  company text not null check (length(btrim(company)) > 0),
  job_title text not null check (length(btrim(job_title)) > 0),
  city text,
  direction text,
  applied_on date,
  status text not null default 'preparing' check (
    status in ('preparing', 'applied', 'assessment', 'interview', 'offer', 'closed')
  ),
  next_action text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_analysis_same_owner
    foreign key (analysis_id, user_id)
    references public.job_analyses(id, user_id)
    on delete restrict
);

create function public.touch_application()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger applications_touch
before update on public.applications
for each row execute function public.touch_application();

create index job_analyses_user_created_idx
  on public.job_analyses(user_id, created_at desc);
create index applications_user_status_idx
  on public.applications(user_id, status);
create index applications_user_created_idx
  on public.applications(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.job_analyses enable row level security;
alter table public.applications enable row level security;

revoke all on table public.profiles, public.job_analyses, public.applications
  from anon, authenticated;
grant select, insert, update, delete on table
  public.profiles, public.job_analyses, public.applications to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy profiles_delete_own on public.profiles
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy job_analyses_select_own on public.job_analyses
  for select to authenticated using ((select auth.uid()) = user_id);
create policy job_analyses_insert_own on public.job_analyses
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy job_analyses_update_own on public.job_analyses
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy job_analyses_delete_own on public.job_analyses
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy applications_select_own on public.applications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy applications_insert_own on public.applications
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy applications_update_own on public.applications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy applications_delete_own on public.applications
  for delete to authenticated using ((select auth.uid()) = user_id);
