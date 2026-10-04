-- Tenth repair. Preserve all nine applied migrations.
-- Correct only the binding-extraction/subtraction grouping in check_material.
-- Signature, invoker security, search_path, owner, ACL and all business rules stay unchanged.
do $$
declare current_body text; current_hash text;
begin
  select prosrc into current_body from pg_proc where oid=to_regprocedure('job_copilot_ep_private.check_material(jsonb,jsonb,jsonb,integer)');
  if not found then raise sqlstate '23514' using message='FUNCTION_BASELINE_MISMATCH'; end if;
  current_hash:=encode(sha256(convert_to(replace(current_body,E'\r\n',E'\n'),'UTF8')),'hex');
  if current_hash not in ('cf3f6d90fd778912b9734749cdda8a8d0d4e615c66dbed83195dd9d8e24ed0a2','afe7aa60dc9f640eff2554112ab5c7f30396ba7444795d13676e109e56cd9ff6') then
    raise sqlstate '23514' using message='FUNCTION_BASELINE_MISMATCH';
  end if;
  if exists(select 1 from pg_proc where oid=to_regprocedure('job_copilot_ep_private.check_material(jsonb,jsonb,jsonb,integer)')
    and (prosecdef or not exists(select 1 from unnest(proconfig) c where replace(c,'"','')='search_path='))) then
    raise sqlstate '23514' using message='FUNCTION_PERMISSION_BASELINE_MISMATCH';
  end if;
end;
$$;

create or replace function job_copilot_ep_private.check_material(m jsonb, d jsonb, profile jsonb, profile_version integer) returns void
language plpgsql set search_path='' as $$
declare r jsonb; part jsonb; f jsonb; segment jsonb; seen text[]:='{}'; part_seen text[]:='{}'; start_pos integer; end_pos integer;
  parts jsonb; cursor_pos integer; jd_digest text; previous_end integer:=0; required_count integer;
begin
  if jsonb_typeof(m) is distinct from 'object' or octet_length(job_copilot_ep_private.canonical(m))>262144
    or m - array['binding','jdText','requirements','profile'] <> '{}'::jsonb
    or m->'profile' is distinct from profile or m->>'jdText' is distinct from d->>'rawText'
    or jsonb_typeof(m->'binding') is distinct from 'object'
    or (m->'binding') - array['draftId','draftRevision','confirmationDigest','profileVersion'] <> '{}'::jsonb
    or m->'binding'->>'draftId' is distinct from d->>'id'
    or m->'binding'->>'draftRevision' is distinct from d->>'revision'
    or m->'binding'->>'profileVersion' is distinct from profile_version::text
    or m->'binding'->>'confirmationDigest' is distinct from d->'confirmation'->>'digest'
    or jsonb_typeof(m->'requirements') is distinct from 'array' then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
  if jsonb_array_length(m->'requirements') not between 1 and 500 then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
  if d->'confirmation' is null or d->'confirmation'='null'::jsonb
    or d->'confirmation'->>'revision' is distinct from d->>'revision'
    or exists(select 1 from jsonb_array_elements(d->'segments') x where x->'category'='null'::jsonb) then
    raise sqlstate 'P2001' using message='JD_DRAFT_CONFLICT'; end if;
  jd_digest:=job_copilot_ep_private.hash(jsonb_build_array('jd-digest-v1',d->'id',d->'revision',d->'ruleVersion',d->'rawText',
    (select jsonb_agg(jsonb_build_array(s->'id',s->'start',s->'end',s->'sourceStart',s->'sourceEnd',s->'suggestedCategory',s->'category') order by n)
      from jsonb_array_elements(d->'segments') with ordinality x(s,n))));
  if d->'confirmation'->>'digest' is distinct from jd_digest then raise sqlstate 'P2001' using message='JD_DRAFT_CONFLICT'; end if;
  select count(*) into required_count from jsonb_array_elements(d->'segments') x where x->>'category'<>'background';
  if required_count<>jsonb_array_length(m->'requirements') then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
  for r in select value from jsonb_array_elements(m->'requirements') loop
    if jsonb_typeof(r) is distinct from 'object' or r - array['jdId','kind','exactText','start','end','conditions','sections']<>'{}'::jsonb
      or coalesce(r->>'kind','') not in ('qualification','core_duty','preferred') or coalesce(r->>'jdId','')=''
      or r->>'jdId'=any(seen) or jsonb_typeof(r->'conditions') is distinct from 'array' or jsonb_typeof(r->'sections') is distinct from 'array' then
      raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
    seen:=array_append(seen,r->>'jdId');
    start_pos:=job_copilot_ep_private.integer_field(r->'start'); end_pos:=job_copilot_ep_private.integer_field(r->'end');
    if start_pos<previous_end or job_copilot_ep_private.fragment(m->>'jdText',start_pos,end_pos) is distinct from r->>'exactText' then
      raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
    previous_end:=end_pos;
    select value into segment from jsonb_array_elements(d->'segments') where value->>'id'=r->>'jdId';
    if segment is null or segment->'start'<>r->'start' or segment->'end'<>r->'end' or segment->'category'<>r->'kind' then
      raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
    if r->>'kind'='qualification' then
      if jsonb_array_length(r->'conditions')=0 or jsonb_array_length(r->'sections')<>0 then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
      parts:=r->'conditions';
    elsif r->>'kind'='preferred' then
      if jsonb_array_length(r->'sections')=0 or jsonb_array_length(r->'conditions')<>0 then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
      parts:=r->'sections';
    else
      if jsonb_array_length(r->'sections')<>0 or jsonb_array_length(r->'conditions')<>0 then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
      parts:='[]';
    end if;
    cursor_pos:=start_pos;
    for part in select value from jsonb_array_elements(parts) order by job_copilot_ep_private.integer_field(value->'start') loop
      if jsonb_typeof(part) is distinct from 'object' or coalesce(part->>'key','')='' or part->>'key'=any(part_seen)
        or (r->>'kind'='qualification' and (part - array['key','start','end','basisKind']<>'{}'::jsonb or coalesce(part->>'basisKind','') not in ('verified_date_rule','unresolved')))
        or (r->>'kind'='preferred' and (part - array['key','start','end','kind']<>'{}'::jsonb or coalesce(part->>'kind','') not in ('task','background'))) then
        raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
      part_seen:=array_append(part_seen,part->>'key');
      if job_copilot_ep_private.integer_field(part->'start')<cursor_pos or job_copilot_ep_private.integer_field(part->'end')>end_pos then
        raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
      if job_copilot_ep_private.integer_field(part->'start')>cursor_pos and not job_copilot_ep_private.is_blank(job_copilot_ep_private.fragment(m->>'jdText',cursor_pos,
        job_copilot_ep_private.integer_field(part->'start'),true)) then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
      perform job_copilot_ep_private.fragment(m->>'jdText',job_copilot_ep_private.integer_field(part->'start'),job_copilot_ep_private.integer_field(part->'end'));
      cursor_pos:=job_copilot_ep_private.integer_field(part->'end');
    end loop;
    if jsonb_array_length(parts)>0 and cursor_pos<end_pos and not job_copilot_ep_private.is_blank(job_copilot_ep_private.fragment(m->>'jdText',cursor_pos,end_pos,true)) then
      raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
  end loop;
  seen:='{}';
  if jsonb_typeof(profile->'facts') is distinct from 'array' or jsonb_array_length(profile->'facts')>500 then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
  for f in select value from jsonb_array_elements(profile->'facts') loop
    if coalesce(f->>'factId','')='' or jsonb_typeof(f->'factId') is distinct from 'string' or f->>'factId'=any(seen) or jsonb_typeof(f->'statement') is distinct from 'string'
      or coalesce(f->>'category','') not in ('education','work','project','skill','award','preference','constraint')
      or coalesce(f->>'context','') not in ('education','formal_work','entrepreneurship','campus','competition','personal_project','self_report')
      or ((f->>'category'='education') is distinct from (f->>'context'='education')) then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
    seen:=array_append(seen,f->>'factId');
  end loop;
end;
$$;
