-- UNTESTED in a real Supabase environment. Existing reports keep NULL provenance.
alter table public.job_analyses add column jd_confirmation_snapshot jsonb;
alter table public.job_analyses add constraint analysis_jd_confirmation_shape check (
  jd_confirmation_snapshot is null or (
    public.valid_jd_draft(jd_confirmation_snapshot)
    and coalesce(jsonb_typeof(jd_confirmation_snapshot->'confirmation') = 'object', false)
    and coalesce(jd_confirmation_snapshot->>'rawText' = jd_text, false)
  )
);
-- Close the older privileged path that did not require a confirmed JD.
drop function public.store_validated_analysis(uuid, integer, jsonb, jsonb, jsonb, jsonb);

create function public.store_confirmed_analysis(
  p_user_id uuid,
  p_expected_profile_version integer,
  p_draft_id uuid,
  p_expected_draft_revision integer,
  p_expected_jd_snapshot jsonb,
  p_job jsonb,
  p_jd_items jsonb,
  p_report jsonb,
  p_metadata jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  source_profile public.profiles%rowtype;
  source_jd public.jd_drafts%rowtype;
  saved_id uuid;
begin
  -- Always lock JD then profile. Ordinary mutations cannot change/delete either until commit.
  select * into source_jd from public.jd_drafts
    where id = p_draft_id and user_id = p_user_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_expected_draft_revision is null or source_jd.revision <> p_expected_draft_revision
    or p_expected_jd_snapshot is null or source_jd.draft <> p_expected_jd_snapshot then
    raise exception 'JD_DRAFT_CONFLICT' using errcode = '40001';
  end if;
  if jsonb_typeof(source_jd.draft->'confirmation') is distinct from 'object' then
    raise exception 'JD_REVIEW_REQUIRED' using errcode = '23514';
  end if;

  select * into source_profile from public.profiles where user_id = p_user_id for update;
  if not found then raise exception 'PROFILE_REQUIRED' using errcode = 'P0002'; end if;
  if p_expected_profile_version is null or source_profile.version <> p_expected_profile_version then
    raise exception 'PROFILE_VERSION_CONFLICT' using errcode = '40001';
  end if;
  -- IDs/categories must still match the stored confirmed manifest. Exact UTF-16 slices
  -- and natural-language evidence are checked by the server validator before this RPC.
  if jsonb_typeof(p_jd_items) is distinct from 'array' then
    raise exception 'JD_REVIEW_REQUIRED' using errcode = '23514';
  end if;
  if jsonb_array_length(p_jd_items) = 0 or
    (select jsonb_agg(jsonb_build_array(x->>'jdId', x->>'kind') order by n)
       from jsonb_array_elements(p_jd_items) with ordinality as items(x,n))
    is distinct from
    (select jsonb_agg(jsonb_build_array(x->>'id', x->>'category') order by n)
       from jsonb_array_elements(source_jd.draft->'segments') with ordinality as segments(x,n)
       where x->>'category' <> 'background') then
    raise exception 'JD_REVIEW_REQUIRED' using errcode = '23514';
  end if;
  insert into public.job_analyses (
    user_id, company, job_title, city, direction, jd_text, jd_source_url,
    jd_items, profile_version, profile_snapshot, report,
    report_structure_version, prompt_version, model_provider, model_name,
    test_data_version, jd_confirmation_snapshot
  ) values (
    p_user_id, p_job->>'company', p_job->>'jobTitle', p_job->>'city', p_job->>'direction',
    source_jd.draft->>'rawText', p_job->>'jdSourceUrl', p_jd_items,
    source_profile.version, source_profile.profile_data, p_report,
    p_metadata->>'reportStructureVersion', p_metadata->>'promptVersion',
    p_metadata->>'modelProvider', p_metadata->>'modelName', p_metadata->>'testDataVersion', source_jd.draft
  ) returning id into saved_id;
  return jsonb_build_object('id', saved_id);
end;
$$;
revoke all on function public.store_confirmed_analysis(uuid, integer, uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.store_confirmed_analysis(uuid, integer, uuid, integer, jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;
comment on column public.job_analyses.jd_confirmation_snapshot is
  'Immutable JD provenance. NULL only for reports predating confirmed-JD persistence. No FK: deleting draft preserves history.';
