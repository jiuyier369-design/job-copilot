-- REVIEW ONLY; remote application requires a separate approval.
-- CLI owns the migration + history transaction; no nested BEGIN/COMMIT.
-- Dedicated test project only. Pending ninth migration; not in the generic apply allowlist.
-- No changes to the eight applied migrations, existing tables/ACL/RLS, queue or budget.
-- Service ports receive owner from the verified session; no browser-controlled owner/material.

-- Repeat/partial state is a stop condition, never a reset or silent replacement.
do $$ begin
  if exists(select 1 from pg_namespace where nspname='job_copilot_ep_private')
    or to_regclass('public.evidence_plans') is not null
    or to_regclass('public.evidence_plan_operations') is not null
    or to_regclass('public.job_analyses_v2') is not null
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('execute_evidence_plan_operation','read_evidence_plan','read_evidence_plan_operation','read_evidence_report_v2')) then
    raise sqlstate '23514' using message='EVIDENCE_V2_ALREADY_PRESENT';
  end if;
end; $$;

create schema job_copilot_ep_private;
revoke all on schema job_copilot_ep_private from public, anon, authenticated, service_role;

-- Canonical compact JSON for this bounded integer-only plan/operation protocol.
-- Bytewise key order is shared with the local TypeScript port. Never hash jsonb::text directly.
create function job_copilot_ep_private.canonical(value jsonb) returns text
language plpgsql immutable strict set search_path = '' as $$
declare result text;
begin
  case jsonb_typeof(value)
    when 'object' then
      select '{' || coalesce(string_agg(to_jsonb(k)::text || ':' || job_copilot_ep_private.canonical(v), ',' order by k collate "C"), '') || '}'
        into result from jsonb_each(value) as x(k,v);
    when 'array' then
      select '[' || coalesce(string_agg(job_copilot_ep_private.canonical(v), ',' order by n), '') || ']'
        into result from jsonb_array_elements(value) with ordinality as x(v,n);
    when 'number' then
      if (value::text)::numeric <> trunc((value::text)::numeric) or abs((value::text)::numeric) > 9007199254740991 then
        raise sqlstate 'P2001' using message = 'INVALID_INPUT';
      end if;
      result := ((value::text)::numeric)::bigint::text;
    else result := value::text;
  end case;
  return result;
end;
$$;

create function job_copilot_ep_private.hash(value jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select encode(sha256(convert_to(job_copilot_ep_private.canonical(value), 'UTF8')), 'hex');
$$;

create function job_copilot_ep_private.integer_field(value jsonb, minimum integer default 0) returns integer
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(value) is distinct from 'number' then raise sqlstate 'P2001' using message = 'INVALID_INPUT'; end if;
  if (value::text)::numeric <> trunc((value::text)::numeric) or (value::text)::numeric < minimum
    or (value::text)::numeric >= 2147483647 then raise sqlstate 'P2001' using message = 'INVALID_INPUT'; end if;
  return ((value::text)::numeric)::integer;
end;
$$;

-- Match ECMAScript trim/\s explicitly, independent of PostgreSQL locale.
create function job_copilot_ep_private.is_blank(value text) returns boolean
language sql immutable strict set search_path='' as $$
  select translate(value,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)
    ||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)
    ||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279),'')='';
$$;
create function job_copilot_ep_private.utf16_length(value text) returns integer
language sql immutable strict set search_path='' as $$
  select coalesce(sum(case when ascii(substr(value,n,1))>65535 then 2 else 1 end),0)::integer from generate_series(1,length(value)) n;
$$;

-- PostgreSQL offsets are codepoints; client offsets are UTF-16. Reject half of a surrogate pair.
create function job_copilot_ep_private.fragment(value text, first_pos integer, last_pos integer, allow_blank boolean default false) returns text
language plpgsql immutable set search_path = '' as $$
declare pos integer := 0; width integer; item text; result text := ''; start_ok boolean := false; end_ok boolean := false;
begin
  if value is null or first_pos is null or last_pos is null or first_pos < 0 or last_pos <= first_pos then
    raise sqlstate 'P2001' using message = 'INVALID_INPUT';
  end if;
  for i in 1..length(value) loop
    item := substr(value,i,1); width := case when ascii(item)>65535 then 2 else 1 end;
    if pos=first_pos then start_ok:=true; end if;
    if pos=last_pos then end_ok:=true; exit; end if;
    if pos>=first_pos and pos+width<=last_pos then result:=result||item; end if;
    pos:=pos+width;
  end loop;
  if pos=last_pos then end_ok:=true; end if;
  if not start_ok or not end_ok or (not allow_blank and job_copilot_ep_private.is_blank(result)) then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
  return result;
end;
$$;

create function job_copilot_ep_private.material_digest(m jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select job_copilot_ep_private.hash(jsonb_build_array('source-review/2', m->'binding'->'draftId', m->'binding'->'draftRevision',
    m->'binding'->'confirmationDigest',m->'binding'->'profileVersion',m->'jdText',
    (select jsonb_agg(jsonb_build_array(r->'jdId',r->'kind',r->'exactText',r->'start',r->'end',
      (select coalesce(jsonb_agg(jsonb_build_array(p->'key',p->'start',p->'end',p->'basisKind') order by n),'[]') from jsonb_array_elements(r->'conditions') with ordinality x(p,n)),
      (select coalesce(jsonb_agg(jsonb_build_array(p->'key',p->'start',p->'end',p->'kind') order by n),'[]') from jsonb_array_elements(r->'sections') with ordinality x(p,n))) order by n)
      from jsonb_array_elements(m->'requirements') with ordinality x(r,n)),
    m->'profile'->'structureVersion',m->'profile'->'targetDirections',
    (select coalesce(jsonb_agg(jsonb_build_array(f->'factId',f->'category',f->'context',f->'statement',coalesce(f->'period','null'),coalesce(f->'organization','null')) order by n),'[]')
      from jsonb_array_elements(m->'profile'->'facts') with ordinality x(f,n))));
$$;

create function job_copilot_ep_private.row_digest(r jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select job_copilot_ep_private.hash(jsonb_build_array(r->'jdId',r->'choice',r->'sources',r->'existingAction',r->'missingScope',r->'pendingReason'));
$$;
create function job_copilot_ep_private.source_digest(p jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select job_copilot_ep_private.hash(jsonb_build_array(p->'materialDigest',
    (select coalesce(jsonb_agg(jsonb_build_array(r->'jdId',r->'sources') order by n),'[]') from jsonb_array_elements(p->'rows') with ordinality x(r,n))));
$$;
create function job_copilot_ep_private.plan_digest(p jsonb) returns text
language sql immutable strict set search_path = '' as $$
  select job_copilot_ep_private.hash(jsonb_build_array('source-review/2',p->'ownerId',p->'id',p->'revision',p->'materialDigest',
    job_copilot_ep_private.source_digest(p),
    (select jsonb_agg(jsonb_build_array(job_copilot_ep_private.row_digest(r),r->'confirmation') order by n)
      from jsonb_array_elements(p->'rows') with ordinality x(r,n))));
$$;

create table public.evidence_plans (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null check(revision>0),
  plan jsonb not null check((jsonb_typeof(plan)='object' and plan->>'policyVersion'='source-review/2'
    and plan->>'id'=id::text and plan->>'ownerId'=user_id::text and plan->>'revision'=revision::text) is true),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(id,user_id)
);
create index evidence_plans_owner_created on public.evidence_plans(user_id,created_at desc);
create table public.evidence_plan_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
  operation text not null check(operation in ('create_plan','review_row','confirm_plan','delete')),
  target_plan_id uuid, -- Intentionally no plan FK: keep receipts after physical plan deletion.
  receipt jsonb not null check((jsonb_typeof(receipt)='object' and receipt->>'contractVersion'='evidence-plan-receipt/2'
    and receipt->>'operationId'=operation_id::text and receipt->>'operation'=operation and (
      (receipt->>'outcome'='applied' and jsonb_typeof(receipt->'planId')='string'
        and jsonb_typeof(receipt->'resultingRevision')='number' and receipt->'failureCode'='null'::jsonb)
      or (receipt->>'outcome'='rejected' and receipt->'planId'='null'::jsonb and receipt->'resultingRevision'='null'::jsonb
        and receipt->>'failureCode' in ('INVALID_INPUT','PLAN_CONFLICT','PLAN_SOURCE_CHANGED','JD_DRAFT_CONFLICT',
          'PROFILE_VERSION_CONFLICT','EVIDENCE_NOT_ALLOWED','PLAN_REVIEW_REQUIRED','NOT_FOUND')))) is true),
  resolved_at timestamptz not null default clock_timestamp(),
  unique(user_id,operation_id)
);
create index evidence_operations_owner_resolved on public.evidence_plan_operations(user_id,resolved_at desc);

-- Separate physical storage: existing job_analyses check remains 1.0.0 and all v1 paths unchanged.
-- No public/service EXECUTE save grant at P2: future v2 completion must bind a run atomically.
create table public.job_analyses_v2 (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_structure_version text not null default '2.0.0' check(report_structure_version='2.0.0'),
  record jsonb not null check((jsonb_typeof(record)='object' and record->>'id'=id::text and record->>'userId'=user_id::text
    and record->'versions'->>'reportStructureVersion'='2.0.0' and record->'report'->>'reportStructureVersion'='2.0.0') is true),
  created_at timestamptz not null default clock_timestamp(), unique(id,user_id)
);
create index analyses_v2_owner_created on public.job_analyses_v2(user_id,created_at desc);

alter table public.evidence_plans enable row level security;
alter table public.evidence_plan_operations enable row level security;
alter table public.job_analyses_v2 enable row level security;
revoke all on public.evidence_plans,public.evidence_plan_operations,public.job_analyses_v2 from public,anon,authenticated,service_role;
grant select on public.evidence_plans,public.job_analyses_v2 to authenticated;
grant select(user_id,operation_id,operation,receipt,resolved_at) on public.evidence_plan_operations to authenticated;
create policy evidence_plans_read_own on public.evidence_plans for select to authenticated using((select auth.uid())=user_id);
create policy evidence_operations_read_own on public.evidence_plan_operations for select to authenticated using((select auth.uid())=user_id);
create policy analyses_v2_read_own on public.job_analyses_v2 for select to authenticated using((select auth.uid())=user_id);

create function job_copilot_ep_private.immutable_row() returns trigger
language plpgsql set search_path='' as $$ begin raise sqlstate 'PT409' using message='IMMUTABLE_RECORD'; end; $$;
create trigger evidence_operations_immutable before update on public.evidence_plan_operations
  for each row execute function job_copilot_ep_private.immutable_row();
create trigger analyses_v2_immutable before update on public.job_analyses_v2
  for each row execute function job_copilot_ep_private.immutable_row();
-- No direct DELETE grants; Auth deletion can cascade. Receipt retention has no TTL.

create function job_copilot_ep_private.guard_plan() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='INSERT' then
    if new.revision<>1 or new.plan->'confirmation' is distinct from 'null'::jsonb then raise sqlstate '23514' using message='PLAN_INSERT_INVALID'; end if;
  elsif new.id<>old.id or new.user_id<>old.user_id or new.revision<>old.revision+1
    or (new.plan - array['revision','rows','confirmation']) is distinct from (old.plan - array['revision','rows','confirmation']) then
    raise sqlstate '23514' using message='PLAN_TRANSITION_INVALID';
  end if;
  new.updated_at:=clock_timestamp(); return new;
end;
$$;
create trigger evidence_plan_guard before insert or update on public.evidence_plans
  for each row execute function job_copilot_ep_private.guard_plan();

-- Helpers/RPCs below remain private until all grants are explicitly assigned at end.
create function job_copilot_ep_private.check_material(m jsonb, d jsonb, profile jsonb, profile_version integer) returns void
language plpgsql set search_path='' as $$
declare r jsonb; part jsonb; f jsonb; segment jsonb; seen text[]:='{}'; part_seen text[]:='{}'; start_pos integer; end_pos integer;
  parts jsonb; cursor_pos integer; jd_digest text; previous_end integer:=0; required_count integer;
begin
  if jsonb_typeof(m) is distinct from 'object' or octet_length(job_copilot_ep_private.canonical(m))>262144
    or m - array['binding','jdText','requirements','profile'] <> '{}'::jsonb
    or m->'profile' is distinct from profile or m->>'jdText' is distinct from d->>'rawText'
    or jsonb_typeof(m->'binding') is distinct from 'object'
    or m->'binding' - array['draftId','draftRevision','confirmationDigest','profileVersion'] <> '{}'::jsonb
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

create function job_copilot_ep_private.review_row(m jsonb, c jsonb, material_digest text, now_text text) returns jsonb
language plpgsql set search_path='' as $$
declare r jsonb; s jsonb; fact jsonb; part jsonb; sources jsonb:='[]'; normalized jsonb; source_text text;
  first_pos integer; last_pos integer; candidate jsonb; selected jsonb; row_value jsonb; existing_action text;
begin
  if jsonb_typeof(c->'selectedSources') is distinct from 'array' or jsonb_array_length(c->'selectedSources')>500
    or coalesce(c->>'choice','') not in ('limited_support','no_clue','pending')
    or coalesce(c->>'intent','') not in ('save_progress','confirm_and_continue')
    or jsonb_typeof(c->'missingScope') is distinct from 'string' or job_copilot_ep_private.utf16_length(c->>'missingScope')>800
    or jsonb_typeof(c->'pendingReason') is distinct from 'string' or job_copilot_ep_private.utf16_length(c->>'pendingReason')>300
    or (c->>'intent'='save_progress' and c->'acknowledged' is distinct from 'false'::jsonb)
    or (c->>'intent'='confirm_and_continue' and c->'acknowledged' is distinct from 'true'::jsonb) then
    raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
  select value into r from jsonb_array_elements(m->'requirements') where value->>'jdId'=c->>'jdId';
  if r is null then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
  selected:=c->'selectedSources';
  for s in select value from jsonb_array_elements(selected) loop
    if jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(s->'factId') is distinct from 'string'
      or s - array['factId','start','end','evidenceType','sectionKey']<>'{}'::jsonb
      or not(s ? 'sectionKey') or jsonb_typeof(s->'sectionKey') not in ('string','null') or coalesce(s->>'evidenceType','') not in ('qualification','background','same_task','transferable','personal_practice') then
      raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
    first_pos:=job_copilot_ep_private.integer_field(s->'start'); last_pos:=job_copilot_ep_private.integer_field(s->'end');
    select value into fact from jsonb_array_elements(m->'profile'->'facts') where value->>'factId'=s->>'factId';
    if fact is null then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
    source_text:=job_copilot_ep_private.fragment(fact->>'statement',first_pos,last_pos);
    select value into part from jsonb_array_elements(r->'sections') where value->>'key'=s->>'sectionKey';
    if (r->>'kind'='preferred' and part is null) or (r->>'kind'<>'preferred' and s->'sectionKey'<>'null'::jsonb) then
      raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
    if fact->>'category' in ('preference','constraint') then raise sqlstate 'P2001' using message='EVIDENCE_NOT_ALLOWED'; end if;
    if r->>'kind'='qualification' then
      if s->>'evidenceType'<>'qualification' or (fact->>'category'<>'education' and fact->>'context'<>'formal_work') then
        raise sqlstate 'P2001' using message='EVIDENCE_NOT_ALLOWED'; end if;
    elsif part->>'kind'='background' then
      if s->>'evidenceType'<>'background' or fact->>'category'<>'education' or fact->>'context'<>'education' then
        raise sqlstate 'P2001' using message='EVIDENCE_NOT_ALLOWED'; end if;
    elsif fact->>'category'='education' or fact->>'context'='self_report' or s->>'evidenceType' in ('qualification','background')
      or ((fact->>'context'='personal_project') is distinct from (s->>'evidenceType'='personal_practice')) then
      raise sqlstate 'P2001' using message='EVIDENCE_NOT_ALLOWED';
    end if;
    if exists(select 1 from jsonb_array_elements(sources) x where x->'sectionKey'=s->'sectionKey' and x->>'factId'=s->>'factId'
      and (x->>'start')::integer<last_pos and (x->>'end')::integer>first_pos) then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
    candidate:=jsonb_build_object('factId',s->'factId','start',first_pos,'end',last_pos,'evidenceType',s->'evidenceType','sectionKey',s->'sectionKey',
      'sourceKey','source/'||job_copilot_ep_private.hash(jsonb_build_array(c->'jdId',s->'sectionKey',s->'factId',first_pos,last_pos,s->'evidenceType')),
      'quote',source_text,'scene',fact->'context');
    sources:=sources||jsonb_build_array(candidate);
  end loop;
  select coalesce(jsonb_agg(value order by job_copilot_ep_private.canonical(jsonb_build_array(value->'sectionKey',value->'factId',value->'start',value->'end',value->'evidenceType')) collate "C"),'[]')
    into normalized from jsonb_array_elements(sources);
  sources:=normalized;
  if c->>'choice'<>'limited_support' and jsonb_array_length(sources)>0 then raise sqlstate 'P2001' using message='EVIDENCE_NOT_ALLOWED'; end if;
  if c->>'choice'='pending' and job_copilot_ep_private.is_blank(c->>'pendingReason') then raise sqlstate 'P2001' using message='PLAN_REVIEW_REQUIRED'; end if;
  if c->>'choice'<>'pending' and c->>'pendingReason'<>'' then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
  if c->>'intent'='confirm_and_continue' and (c->>'choice'='pending' or job_copilot_ep_private.is_blank(c->>'missingScope')
    or (c->>'choice'='limited_support' and jsonb_array_length(sources)=0)) then raise sqlstate 'P2001' using message='PLAN_REVIEW_REQUIRED'; end if;
  select coalesce(string_agg(value->>'quote','；' order by n),'') into existing_action from jsonb_array_elements(sources) with ordinality x(value,n);
  row_value:=jsonb_build_object('jdId',c->'jdId','choice',c->'choice','sources',sources,'existingAction',existing_action,
    'missingScope',c->'missingScope','pendingReason',c->'pendingReason','confirmation',null);
  if c->>'intent'='confirm_and_continue' then
    row_value:=jsonb_set(row_value,'{confirmation}',jsonb_build_object('rowDigest',job_copilot_ep_private.row_digest(row_value),
      'rowSourceDigest',job_copilot_ep_private.hash(sources),'materialDigest',material_digest,'confirmedAt',now_text));
  end if;
  return row_value;
end;
$$;

create function job_copilot_ep_private.canonical_command(c jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb;
begin
  if c->>'action'='review_row' and jsonb_typeof(c->'selectedSources')='array' then
    select coalesce(jsonb_agg(value order by job_copilot_ep_private.canonical(jsonb_build_array(value->'sectionKey',value->'factId',value->'start',value->'end',value->'evidenceType')) collate "C"),'[]')
      into result from jsonb_array_elements(c->'selectedSources');
    return jsonb_set(c,'{selectedSources}',result);
  end if;
  return c;
end;
$$;

create function job_copilot_ep_private.row_eligible(p jsonb, r jsonb) returns boolean
language plpgsql set search_path='' as $$
declare rebuilt jsonb; c jsonb;
begin
  if r->>'choice'='pending' or r->'confirmation' is null or r->'confirmation'='null'::jsonb
    or r->'confirmation'->>'materialDigest' is distinct from p->>'materialDigest'
    or r->'confirmation'->>'rowDigest' is distinct from job_copilot_ep_private.row_digest(r)
    or r->'confirmation'->>'rowSourceDigest' is distinct from job_copilot_ep_private.hash(r->'sources') then return false; end if;
  select coalesce(jsonb_agg(value - array['sourceKey','quote','scene'] order by n),'[]') into c
    from jsonb_array_elements(r->'sources') with ordinality x(value,n);
  rebuilt:=job_copilot_ep_private.review_row(p->'material',jsonb_build_object('jdId',r->'jdId','choice',r->'choice',
    'selectedSources',c,'missingScope',r->'missingScope','pendingReason',r->'pendingReason','intent','confirm_and_continue','acknowledged',true),
    p->>'materialDigest',r->'confirmation'->>'confirmedAt');
  return rebuilt=r;
exception when sqlstate 'P2001' then return false; -- Pure material validation only; never catches SQL/network errors.
end;
$$;

create function public.read_evidence_plan(p_user_id uuid,p_plan_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p jsonb; d public.jd_drafts%rowtype; profile public.profiles%rowtype; valid boolean; eligible jsonb; confirmed boolean;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null then raise sqlstate '42501' using message='SERVER_ONLY'; end if;
  select plan into p from public.evidence_plans where id=p_plan_id and user_id=p_user_id;
  if not found then return null; end if;
  -- Read-only validity projection; no row locks, no silent changes to historical snapshots.
  select * into d from public.jd_drafts where id=(p->'material'->'binding'->>'draftId')::uuid and user_id=p_user_id;
  select * into profile from public.profiles where user_id=p_user_id;
  valid:=d.id is not null and profile.user_id is not null
    and d.revision::text=p->'material'->'binding'->>'draftRevision'
    and d.draft->'confirmation'->>'digest'=p->'material'->'binding'->>'confirmationDigest'
    and profile.version::text=p->'material'->'binding'->>'profileVersion' and profile.profile_data=p->'material'->'profile';
  valid:=coalesce(valid,false);
  select coalesce(jsonb_agg(r->'jdId' order by n),'[]') into eligible from jsonb_array_elements(p->'rows') with ordinality x(r,n)
    where valid and job_copilot_ep_private.row_eligible(p,r);
  confirmed:=valid and jsonb_array_length(eligible)=jsonb_array_length(p->'material'->'requirements')
    and p->'confirmation'->>'revision'=p->>'revision'
    and p->'confirmation'->>'sourceDigest'=job_copilot_ep_private.source_digest(p)
    and p->'confirmation'->>'planDigest'=job_copilot_ep_private.plan_digest(p);
  return (p-'ownerId')||jsonb_build_object('validity',case when valid then 'valid' else 'stale' end,
    'status',case when not valid then 'stale' when coalesce(confirmed,false) then 'confirmed' else 'draft' end,
    'eligibleJdIds',eligible,'confirmation',case when coalesce(confirmed,false) then p->'confirmation' else 'null'::jsonb end);
end;
$$;

create function public.read_evidence_plan_operation(p_user_id uuid,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null then raise sqlstate '42501' using message='SERVER_ONLY'; end if;
  select receipt into result from public.evidence_plan_operations where user_id=p_user_id and operation_id=p_operation_id;
  return result;
end;
$$;

create function public.execute_evidence_plan_operation(p_user_id uuid,p_operation_id uuid,p_plan_id uuid,p_command jsonb,p_material jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb; action_name text; fingerprint text; prior public.evidence_plan_operations%rowtype;
  original public.evidence_plans%rowtype; d public.jd_drafts%rowtype; profile public.profiles%rowtype;
  plan_id uuid; next_plan jsonb; next_row jsonb; rows_value jsonb; row_value jsonb; material_digest text;
  next_revision integer; expected_revision integer; receipt_value jsonb; failure text; now_text text;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null then raise sqlstate '42501' using message='SERVER_ONLY'; end if;
  if p_operation_id is null or jsonb_typeof(p_command) is distinct from 'object' or octet_length(p_command::text)>262144 then
    raise sqlstate '23514' using message='INVALID_INPUT'; end if;
  action_name:=p_command->>'action';
  if action_name not in ('create_plan','review_row','confirm_plan','delete') or action_name is null
    or ((action_name='create_plan') is distinct from (p_plan_id is null)) then raise sqlstate '23514' using message='INVALID_INPUT'; end if;
  if (action_name='create_plan' and p_command - array['action','draftId','expectedDraftRevision','expectedProfileVersion']<>'{}')
    or (action_name='review_row' and p_command - array['action','expectedRevision','jdId','choice','selectedSources','missingScope','pendingReason','intent','acknowledged']<>'{}')
    or (action_name='confirm_plan' and p_command - array['action','expectedRevision','acknowledged']<>'{}')
    or (action_name='delete' and p_command - array['action','expectedRevision']<>'{}') then raise sqlstate '23514' using message='INVALID_INPUT'; end if;
  c:=job_copilot_ep_private.canonical_command(p_command);
  fingerprint:=job_copilot_ep_private.hash(jsonb_build_array('evidence-plan-write/2',p_user_id::text,p_plan_id::text,c));
  -- MUTEX: operation first. Collisions only serialize unrelated operations, never grant ownership.
  perform pg_advisory_xact_lock(hashtextextended('ep-operation/2:'||p_user_id::text||':'||p_operation_id::text,0));
  select * into prior from public.evidence_plan_operations where user_id=p_user_id and operation_id=p_operation_id;
  if found then
    if prior.request_fingerprint is distinct from fingerprint then raise sqlstate 'PT409' using message='OPERATION_CONFLICT'; end if;
    return jsonb_build_object('receipt',prior.receipt,'resource',public.read_evidence_plan(p_user_id,
      case when prior.receipt->>'outcome'='applied' then (prior.receipt->>'planId')::uuid else prior.target_plan_id end));
  end if;
  plan_id:=coalesce(p_plan_id,gen_random_uuid());
  -- LOCK 1: logical plan identity (also works before INSERT), then the existing plan row.
  perform pg_advisory_xact_lock(hashtextextended('ep-plan/2:'||p_user_id::text||':'||plan_id::text,0));
  if action_name<>'create_plan' then
    select * into original from public.evidence_plans where id=plan_id and user_id=p_user_id for update;
  end if;
  now_text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  -- Business validation and mutation subtransaction. ONLY the dedicated business SQLSTATE is caught.
  begin
    if action_name<>'create_plan' and original.id is null then raise sqlstate 'P2001' using message='NOT_FOUND'; end if;
    if action_name='create_plan' then
      expected_revision:=job_copilot_ep_private.integer_field(c->'expectedDraftRevision',1);
      perform job_copilot_ep_private.integer_field(c->'expectedProfileVersion',1);
      if coalesce(c->>'draftId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
    else
      expected_revision:=job_copilot_ep_private.integer_field(c->'expectedRevision',1);
      if expected_revision<>original.revision then raise sqlstate 'P2001' using message='PLAN_CONFLICT'; end if;
    end if;
    if action_name<>'delete' then
      -- LOCK 2: JD. Then LOCK 3: profile. Never read/lock profile first.
      select * into d from public.jd_drafts where id=case when action_name='create_plan' then (c->>'draftId')::uuid
        else (original.plan->'material'->'binding'->>'draftId')::uuid end and user_id=p_user_id for update;
      if not found then raise sqlstate 'P2001' using message=case when action_name='create_plan' then 'JD_DRAFT_CONFLICT' else 'PLAN_SOURCE_CHANGED' end; end if;
      select * into profile from public.profiles where user_id=p_user_id for update;
      if not found then raise sqlstate 'P2001' using message=case when action_name='create_plan' then 'PROFILE_VERSION_CONFLICT' else 'PLAN_SOURCE_CHANGED' end; end if;
      if action_name='create_plan' then
        if d.revision<>expected_revision then raise sqlstate 'P2001' using message='JD_DRAFT_CONFLICT'; end if;
        if profile.version<>job_copilot_ep_private.integer_field(c->'expectedProfileVersion',1) then raise sqlstate 'P2001' using message='PROFILE_VERSION_CONFLICT'; end if;
        perform job_copilot_ep_private.check_material(p_material,d.draft,profile.profile_data,profile.version);
        material_digest:=job_copilot_ep_private.material_digest(p_material);
        select jsonb_agg(jsonb_build_object('jdId',r->'jdId','choice','pending','sources','[]'::jsonb,'existingAction','',
          'missingScope','','pendingReason','','confirmation',null) order by n) into rows_value from jsonb_array_elements(p_material->'requirements') with ordinality x(r,n);
        next_plan:=jsonb_build_object('id',plan_id,'ownerId',p_user_id,'revision',1,'policyVersion','source-review/2',
          'material',p_material,'materialDigest',material_digest,'rows',rows_value,'confirmation',null);
        next_revision:=1;
        insert into public.evidence_plans(id,user_id,revision,plan) values(plan_id,p_user_id,1,next_plan);
      else
        if d.revision::text is distinct from original.plan->'material'->'binding'->>'draftRevision'
          or d.draft->'confirmation'->>'digest' is distinct from original.plan->'material'->'binding'->>'confirmationDigest'
          or profile.version::text is distinct from original.plan->'material'->'binding'->>'profileVersion'
          or profile.profile_data is distinct from original.plan->'material'->'profile' then raise sqlstate 'P2001' using message='PLAN_SOURCE_CHANGED'; end if;
      end if;
    end if;
    if action_name<>'create_plan' then
      next_revision:=original.revision+1;
      next_plan:=original.plan||jsonb_build_object('revision',next_revision,'confirmation',null);
      if action_name='review_row' then
        next_row:=job_copilot_ep_private.review_row(original.plan->'material',c,original.plan->>'materialDigest',now_text);
        select jsonb_agg(case when r->>'jdId'=c->>'jdId' then next_row else r end order by n) into rows_value
          from jsonb_array_elements(original.plan->'rows') with ordinality x(r,n);
        next_plan:=jsonb_set(next_plan,'{rows}',rows_value);
      elsif action_name='confirm_plan' then
        if c->'acknowledged' is distinct from 'true'::jsonb then raise sqlstate 'P2001' using message='INVALID_INPUT'; end if;
        if jsonb_array_length(next_plan->'rows')<>jsonb_array_length(next_plan->'material'->'requirements')
          or exists(select 1 from jsonb_array_elements(next_plan->'rows') x where not job_copilot_ep_private.row_eligible(next_plan,x)) then
          raise sqlstate 'P2001' using message='PLAN_REVIEW_REQUIRED'; end if;
        next_plan:=jsonb_set(next_plan,'{confirmation}',jsonb_build_object('revision',next_revision,
          'sourceDigest',job_copilot_ep_private.source_digest(next_plan),'planDigest',job_copilot_ep_private.plan_digest(next_plan)));
      end if;
      if action_name='delete' then delete from public.evidence_plans where id=plan_id and user_id=p_user_id;
      else update public.evidence_plans set revision=next_revision,plan=next_plan where id=plan_id and user_id=p_user_id; end if;
    end if;
  exception when sqlstate 'P2001' then
    get stacked diagnostics failure=MESSAGE_TEXT;
    if failure not in ('INVALID_INPUT','PLAN_CONFLICT','PLAN_SOURCE_CHANGED','JD_DRAFT_CONFLICT','PROFILE_VERSION_CONFLICT','EVIDENCE_NOT_ALLOWED','PLAN_REVIEW_REQUIRED','NOT_FOUND') then raise; end if;
    -- The subtransaction undoes every plan mutation. Do not turn any OTHER error into rejection.
  end;
  if failure is null then
    receipt_value:=jsonb_build_object('contractVersion','evidence-plan-receipt/2','operationId',p_operation_id,'operation',action_name,
      'outcome','applied','planId',plan_id,'resultingRevision',next_revision,'failureCode',null,'resolvedAt',now_text);
  else
    receipt_value:=jsonb_build_object('contractVersion','evidence-plan-receipt/2','operationId',p_operation_id,'operation',action_name,
      'outcome','rejected','planId',null,'resultingRevision',null,'failureCode',failure,'resolvedAt',now_text);
  end if;
  -- Both writes share the caller transaction. Failure here rolls back the plan too.
  insert into public.evidence_plan_operations(user_id,operation_id,request_fingerprint,operation,target_plan_id,receipt)
    values(p_user_id,p_operation_id,fingerprint,action_name,plan_id,receipt_value);
  return jsonb_build_object('receipt',receipt_value,'resource',public.read_evidence_plan(p_user_id,plan_id));
end;
$$;

-- Owner-only implementation, NOT granted to service_role and NOT a formal generation entry.
-- Future complete-v2 RPC must call this only after P1 full validator and in the run transaction.
create function job_copilot_ep_private.store_report(p_user_id uuid,p_plan_id uuid,p_revision integer,p_record jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.evidence_plans%rowtype; d public.jd_drafts%rowtype; profile public.profiles%rowtype; id_value uuid; r jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('ep-plan/2:'||p_user_id::text||':'||p_plan_id::text,0));
  select * into p from public.evidence_plans where id=p_plan_id and user_id=p_user_id for update;
  if not found then raise sqlstate 'P0002' using message='NOT_FOUND'; end if;
  if p.revision is distinct from p_revision or p.plan->'confirmation' is null or p.plan->'confirmation'='null'::jsonb
    or p.plan->'confirmation'->>'revision' is distinct from p.revision::text
    or p.plan->>'materialDigest' is distinct from job_copilot_ep_private.material_digest(p.plan->'material')
    or p.plan->'confirmation'->>'sourceDigest' is distinct from job_copilot_ep_private.source_digest(p.plan)
    or p.plan->'confirmation'->>'planDigest' is distinct from job_copilot_ep_private.plan_digest(p.plan) then
    raise sqlstate 'PT409' using message='PLAN_CONFLICT'; end if;
  select * into d from public.jd_drafts where id=(p.plan->'material'->'binding'->>'draftId')::uuid and user_id=p_user_id for update;
  select * into profile from public.profiles where user_id=p_user_id for update;
  if d.id is null or profile.user_id is null or d.revision::text is distinct from p.plan->'material'->'binding'->>'draftRevision'
    or d.draft->'confirmation'->>'digest' is distinct from p.plan->'material'->'binding'->>'confirmationDigest'
    or profile.version::text is distinct from p.plan->'material'->'binding'->>'profileVersion'
    or profile.profile_data is distinct from p.plan->'material'->'profile' then raise sqlstate 'PT409' using message='PLAN_SOURCE_CHANGED'; end if;
  if jsonb_typeof(p_record) is distinct from 'object' or octet_length(p_record::text)>2097152
    or p_record->>'userId' is distinct from p_user_id::text or p_record->'versions'->>'reportStructureVersion' is distinct from '2.0.0'
    or p_record->'report'->>'reportStructureVersion' is distinct from '2.0.0'
    or p_record->'provenance'->'planSnapshot' is distinct from p.plan
    or p_record->'provenance'->>'planRevision' is distinct from p.revision::text
    or p_record->'provenance'->'jdConfirmationSnapshot' is distinct from d.draft
    or p_record->'provenance'->'profileSnapshot' is distinct from profile.profile_data
    or p_record->'provenance'->>'profileVersion' is distinct from profile.version::text
    or p_record->'provenance'->>'planDigest' is distinct from p.plan->'confirmation'->>'planDigest'
    or p_record->'provenance'->>'sourceDigest' is distinct from p.plan->'confirmation'->>'sourceDigest'
    or p_record->'provenance'->>'slotManifestDigest' is distinct from p_record->'report'->>'manifestDigest'
    or coalesce(p_record->'provenance'->>'slotManifestDigest','') !~ '^[a-f0-9]{64}$' then
    raise sqlstate '23514' using message='REPORT_V2_INVALID'; end if;
  for r in select value from jsonb_array_elements(p.plan->'rows') loop
    if not job_copilot_ep_private.row_eligible(p.plan,r) then raise sqlstate '23514' using message='REPORT_V2_INVALID'; end if;
  end loop;
  id_value:=(p_record->>'id')::uuid;
  insert into public.job_analyses_v2(id,user_id,record) values(id_value,p_user_id,p_record);
  return id_value;
end;
$$;
create function public.read_evidence_report_v2(p_user_id uuid,p_analysis_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null then raise sqlstate '42501' using message='SERVER_ONLY'; end if;
  select record into result from public.job_analyses_v2 where id=p_analysis_id and user_id=p_user_id;
  return result; -- Private server result; future HTTP projection removes internal owner fields.
end;
$$;

revoke all on all functions in schema job_copilot_ep_private from public,anon,authenticated,service_role;
revoke all on function public.execute_evidence_plan_operation(uuid,uuid,uuid,jsonb,jsonb),public.read_evidence_plan(uuid,uuid),
  public.read_evidence_plan_operation(uuid,uuid),public.read_evidence_report_v2(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.execute_evidence_plan_operation(uuid,uuid,uuid,jsonb,jsonb),public.read_evidence_plan(uuid,uuid),
  public.read_evidence_plan_operation(uuid,uuid),public.read_evidence_report_v2(uuid,uuid) to service_role;

comment on table public.evidence_plan_operations is 'Permanent owner-scoped operation ledger; no plan FK or TTL; fingerprints not granted to users.';
comment on table public.job_analyses_v2 is 'Immutable report 2.0.0 only. No v1 parser or granted generation save entry. Future run integration requires separate review.';
