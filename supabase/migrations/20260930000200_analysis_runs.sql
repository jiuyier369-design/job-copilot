-- Sixth migration: one server-only generation save entry, immutable idempotency ledger.
create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  draft_id uuid not null,
  expected_draft_revision integer not null check (expected_draft_revision > 0),
  expected_profile_version integer not null check (expected_profile_version > 0),
  confirmation_digest text not null check (confirmation_digest ~ '^[a-f0-9]{64}$'),
  request_context jsonb not null check (jsonb_typeof(request_context) = 'object'),
  status text not null default 'processing' check (status in ('processing','completed','failed','uncertain')),
  analysis_id uuid,
  failure_code text check (failure_code in ('MODEL_REJECTED','REPORT_INVALID','MODEL_RESULT_UNCERTAIN',
    'SAVE_RESULT_UNCERTAIN','JD_DRAFT_CONFLICT','PROFILE_VERSION_CONFLICT','JD_REVIEW_REQUIRED','NOT_FOUND','PROFILE_REQUIRED')),
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '60 seconds'),
  finished_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (user_id, request_id),
  -- Check at commit so deleting Auth cascades both ledger and reports in any trigger order.
  foreign key (analysis_id, user_id) references public.job_analyses(id,user_id) on delete no action deferrable initially deferred,
  constraint run_state_shape check (
    (status = 'processing' and analysis_id is null and failure_code is null and finished_at is null)
    or (status = 'completed' and analysis_id is not null and failure_code is null and finished_at is not null)
    or (status = 'failed' and analysis_id is null and failure_code is not null and failure_code in ('MODEL_REJECTED','REPORT_INVALID',
      'JD_DRAFT_CONFLICT','PROFILE_VERSION_CONFLICT','JD_REVIEW_REQUIRED','NOT_FOUND','PROFILE_REQUIRED') and finished_at is not null)
    or (status = 'uncertain' and analysis_id is null and failure_code is not null and failure_code in ('MODEL_RESULT_UNCERTAIN','SAVE_RESULT_UNCERTAIN') and finished_at is not null)
  )
);
alter table public.analysis_runs enable row level security;
revoke all on public.analysis_runs from public, anon, authenticated, service_role;
grant select (user_id,request_id,status,analysis_id,failure_code,started_at,finished_at) on public.analysis_runs to authenticated;
create policy analysis_runs_read_own on public.analysis_runs for select to authenticated
  using ((select auth.uid()) = user_id);

create function public.guard_analysis_run_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'processing' or new.status = 'processing'
    or (to_jsonb(new) - array['status','analysis_id','failure_code','finished_at','updated_at'])
      is distinct from (to_jsonb(old) - array['status','analysis_id','failure_code','finished_at','updated_at']) then
    raise sqlstate 'PT409' using message = 'ANALYSIS_RUN_STATE_CONFLICT';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger analysis_runs_transition before update on public.analysis_runs
  for each row execute function public.guard_analysis_run_transition();

create function public.read_analysis_run(p_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.analysis_runs%rowtype;
begin
  select * into r from public.analysis_runs where user_id=p_user_id and request_id=p_request_id for update;
  if not found then return null; end if;
  if r.status='processing' and r.expires_at <= clock_timestamp() then
    update public.analysis_runs set status='uncertain',failure_code='MODEL_RESULT_UNCERTAIN',finished_at=clock_timestamp()
      where id=r.id returning * into r;
  end if;
  return to_jsonb(r);
end;
$$;

create function public.reserve_analysis_run(p_user_id uuid,p_request_id uuid,p_fingerprint text,
  p_draft_id uuid,p_draft_revision integer,p_profile_version integer,p_digest text,p_context jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.analysis_runs%rowtype; inserted boolean;
begin
  insert into public.analysis_runs(user_id,request_id,request_fingerprint,draft_id,
    expected_draft_revision,expected_profile_version,confirmation_digest,request_context)
  values(p_user_id,p_request_id,p_fingerprint,p_draft_id,p_draft_revision,p_profile_version,p_digest,p_context)
    on conflict (user_id,request_id) do nothing returning * into r;
  inserted := found;
  if not inserted then
    select * into r from public.analysis_runs where user_id=p_user_id and request_id=p_request_id for update;
    if r.request_fingerprint is distinct from p_fingerprint then
      raise sqlstate 'PT409' using message='IDEMPOTENCY_CONFLICT';
    end if;
    if r.status='processing' and r.expires_at <= clock_timestamp() then
      update public.analysis_runs set status='uncertain',failure_code='MODEL_RESULT_UNCERTAIN',finished_at=clock_timestamp()
        where id=r.id returning * into r;
    end if;
  end if;
  return jsonb_build_object('acquired',inserted,'run',to_jsonb(r));
end;
$$;

create function public.finish_analysis_run(p_user_id uuid,p_request_id uuid,p_status text,p_failure_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.analysis_runs%rowtype;
begin
  select * into r from public.analysis_runs where user_id=p_user_id and request_id=p_request_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  -- A completion that committed but whose response was lost is never overwritten.
  if r.status <> 'processing' then return to_jsonb(r); end if;
  if p_status not in ('failed','uncertain') or p_status is null then
    raise exception 'INVALID_RUN_STATE' using errcode='23514';
  end if;
  if r.expires_at <= clock_timestamp() then p_status:='uncertain'; p_failure_code:='MODEL_RESULT_UNCERTAIN'; end if;
  update public.analysis_runs set status=p_status,failure_code=p_failure_code,finished_at=clock_timestamp()
    where id=r.id returning * into r;
  return to_jsonb(r);
end;
$$;

create function public.complete_analysis_run(p_user_id uuid,p_request_id uuid,p_expected_jd_snapshot jsonb,
  p_jd_items jsonb,p_report jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.analysis_runs%rowtype; saved jsonb;
begin
  -- Exactly one transaction: run -> JD -> profile -> immutable report -> run completion.
  select * into r from public.analysis_runs where user_id=p_user_id and request_id=p_request_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if r.status <> 'processing' then return to_jsonb(r); end if;
  if r.expires_at <= clock_timestamp() then
    update public.analysis_runs set status='uncertain',failure_code='MODEL_RESULT_UNCERTAIN',finished_at=clock_timestamp()
      where id=r.id returning * into r;
    return to_jsonb(r);
  end if;
  if p_expected_jd_snapshot->'confirmation'->>'digest' is distinct from r.confirmation_digest then
    raise sqlstate 'PT409' using message='JD_DRAFT_CONFLICT';
  end if;
  -- Owner-only internal implementation; its external service-role privilege is revoked below.
  saved := public.store_confirmed_analysis(p_user_id,r.expected_profile_version,r.draft_id,
    r.expected_draft_revision,p_expected_jd_snapshot,r.request_context->'job',p_jd_items,p_report,r.request_context->'metadata');
  update public.analysis_runs set status='completed',analysis_id=(saved->>'id')::uuid,finished_at=clock_timestamp()
    where id=r.id returning * into r;
  return to_jsonb(r);
end;
$$;

revoke all on function public.store_confirmed_analysis(uuid,integer,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.guard_analysis_run_transition() from public,anon,authenticated,service_role;
revoke all on function public.read_analysis_run(uuid,uuid),
  public.reserve_analysis_run(uuid,uuid,text,uuid,integer,integer,text,jsonb),
  public.finish_analysis_run(uuid,uuid,text,text),public.complete_analysis_run(uuid,uuid,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.read_analysis_run(uuid,uuid),
  public.reserve_analysis_run(uuid,uuid,text,uuid,integer,integer,text,jsonb),
  public.finish_analysis_run(uuid,uuid,text,text),public.complete_analysis_run(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
