-- Correct A1. Not yet executed against a Supabase test environment.
revoke insert, update on public.job_analyses from authenticated;
drop policy job_analyses_insert_own on public.job_analyses;
drop policy job_analyses_update_own on public.job_analyses;
-- Only the SECURITY DEFINER RPC below may insert, even for the server client.
revoke insert, update on public.job_analyses from service_role;

create function public.reject_report_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Historical reports are immutable; regenerate as a new record'
    using errcode = '23514';
end;
$$;
create trigger reports_immutable before update on public.job_analyses
for each row execute function public.reject_report_update();

-- Prevent clients from selecting their own initial revision or resetting it.
revoke insert, update, delete on public.profiles from authenticated;
grant insert (user_id, profile_data), update (profile_data) on public.profiles to authenticated;
drop policy profiles_delete_own on public.profiles;

-- SQL CHECK treats NULL as success; explicitly reject missing JSON keys.
alter table public.profiles add constraint profile_required_arrays check (
  coalesce(jsonb_typeof(profile_data->'facts') = 'array', false)
  and coalesce(jsonb_typeof(profile_data->'targetDirections') = 'array', false)
);

create function public.store_validated_analysis(
  p_user_id uuid,
  p_expected_profile_version integer,
  p_job jsonb,
  p_jd_items jsonb,
  p_report jsonb,
  p_metadata jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  source_profile public.profiles%rowtype;
  saved public.job_analyses%rowtype;
begin
  -- The owner ID is supplied by the authenticated server, never a browser body.
  -- Hold the profile row until INSERT commits so a concurrent save cannot race.
  select * into source_profile from public.profiles
    where user_id = p_user_id for update;
  if not found then
    raise exception 'PROFILE_REQUIRED' using errcode = 'P0002';
  end if;
  if source_profile.version <> p_expected_profile_version then
    raise exception 'PROFILE_VERSION_CONFLICT' using errcode = '40001';
  end if;

  insert into public.job_analyses (
    user_id, company, job_title, city, direction, jd_text, jd_source_url,
    jd_items, profile_version, profile_snapshot, report,
    report_structure_version, prompt_version, model_provider, model_name,
    test_data_version
  ) values (
    p_user_id, p_job->>'company', p_job->>'jobTitle', p_job->>'city',
    p_job->>'direction', p_job->>'jdText', p_job->>'jdSourceUrl',
    p_jd_items, source_profile.version, source_profile.profile_data, p_report,
    p_metadata->>'reportStructureVersion', p_metadata->>'promptVersion',
    p_metadata->>'modelProvider', p_metadata->>'modelName',
    p_metadata->>'testDataVersion'
  ) returning * into saved;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.store_validated_analysis(uuid, integer, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.store_validated_analysis(uuid, integer, jsonb, jsonb, jsonb, jsonb)
  to service_role;

comment on function public.store_validated_analysis(uuid, integer, jsonb, jsonb, jsonb, jsonb)
  is 'Server only, AFTER report validation. Captures profile snapshot atomically. Does not verify natural-language truth.';
