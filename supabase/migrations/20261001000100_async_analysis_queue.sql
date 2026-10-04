-- DS3A DRAFT ONLY. Not in migrations/: promotion requires user approval.
-- Entire migration must execute in one transaction. No Cron/Vault writes or secret values.
-- Safe duplicate detection: fail before any extension/table/function changes.
do $$ begin
  if to_regclass('public.analysis_run_jobs') is not null then
    raise exception 'ASYNC_MIGRATION_ALREADY_PRESENT' using errcode='23514';
  end if;
  if exists(select 1 from pg_catalog.pg_available_extensions where name='pgmq') is false then
    raise exception 'PGMQ_UNAVAILABLE' using errcode='23514';
  end if;
end $$;
create extension if not exists pgmq;
do $$ begin
  if to_regclass('pgmq.q_job_copilot_analysis') is not null then
    raise exception 'QUEUE_ALREADY_PRESENT' using errcode='23514';
  end if;
end $$;
select pgmq.create('job_copilot_analysis'); -- durable logged queue
alter table pgmq.q_job_copilot_analysis enable row level security;
alter table pgmq.a_job_copilot_analysis enable row level security;
revoke all on pgmq.q_job_copilot_analysis,pgmq.a_job_copilot_analysis from public,anon,authenticated,service_role;
do $$ declare seq text;begin
  seq:=pg_get_serial_sequence('pgmq.q_job_copilot_analysis','msg_id');
  if seq is not null then execute format('revoke all on sequence %s from public,anon,authenticated,service_role',seq);end if;
end $$;
-- Functions are SECURITY INVOKER in pgmq: deny direct schema access; consumers use our definer RPCs.
revoke all on schema pgmq from public,anon,authenticated,service_role;

create table public.analysis_run_jobs (
  run_id uuid primary key references public.analysis_runs(id) on delete cascade,
  message_id bigint not null unique,
  phase text not null default 'queued' check (phase in ('queued','preparing','invoking','terminal')),
  claim_token uuid,
  lease_until timestamptz,
  model_started_at timestamptz,
  reserved_cny numeric check (reserved_cny > 0 and reserved_cny <= 1),
  usage_metadata jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check ((phase='queued' and claim_token is null and model_started_at is null)
    or (phase='preparing' and claim_token is not null and lease_until is not null and model_started_at is null)
    or (phase='invoking' and claim_token is not null and lease_until is not null and model_started_at is not null)
    or phase='terminal')
);
create table public.analysis_worker_budget (
  singleton boolean primary key default true check (singleton),
  calls integer not null default 0 check (calls between 0 and 3),
  reserved_cny numeric not null default 0 check (reserved_cny between 0 and 3)
);
insert into public.analysis_worker_budget(singleton) values(true);
alter table public.analysis_run_jobs enable row level security;
alter table public.analysis_worker_budget enable row level security;
revoke all on public.analysis_run_jobs,public.analysis_worker_budget from public,anon,authenticated,service_role;

-- Allow only the invocation RPC to reset the internal deadline; other immutable columns unchanged.
create or replace function public.guard_analysis_run_transition() returns trigger
language plpgsql set search_path='' as $$ begin
  if old.status='processing' and new.status='processing'
    and (to_jsonb(new)-array['expires_at','updated_at'])=(to_jsonb(old)-array['expires_at','updated_at'])
    and new.expires_at is distinct from old.expires_at
    and exists(select 1 from public.analysis_run_jobs where run_id=old.id and phase='invoking' and model_started_at is not null) then
    new.updated_at:=clock_timestamp();return new;
  end if;
  if old.status <> 'processing' or new.status='processing'
    or (to_jsonb(new)-array['status','analysis_id','failure_code','finished_at','updated_at'])
      is distinct from (to_jsonb(old)-array['status','analysis_id','failure_code','finished_at','updated_at']) then
    raise sqlstate 'PT409' using message='ANALYSIS_RUN_STATE_CONFLICT';
  end if;
  new.updated_at:=clock_timestamp();return new;
end $$;

create function public.enqueue_analysis_run(p_user_id uuid,p_request_id uuid,p_fingerprint text,
  p_draft_id uuid,p_draft_revision integer,p_profile_version integer,p_digest text,p_context jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.analysis_runs%rowtype; j public.jd_drafts%rowtype; p public.profiles%rowtype; acquired boolean; mid bigint;
begin
  insert into public.analysis_runs(user_id,request_id,request_fingerprint,draft_id,expected_draft_revision,
    expected_profile_version,confirmation_digest,request_context,expires_at)
    values(p_user_id,p_request_id,p_fingerprint,p_draft_id,p_draft_revision,p_profile_version,p_digest,p_context,clock_timestamp()+interval '24 hours')
    on conflict(user_id,request_id) do nothing returning * into r;
  acquired:=found;
  if not acquired then
    select * into r from public.analysis_runs where user_id=p_user_id and request_id=p_request_id for update;
    if r.request_fingerprint is distinct from p_fingerprint then raise sqlstate 'PT409' using message='IDEMPOTENCY_CONFLICT';end if;
    return jsonb_build_object('acquired',false,'run',to_jsonb(r));
  end if;
  -- Same ordered locks: run -> JD -> profile. Failure rolls back run and queue send together.
  select * into j from public.jd_drafts where id=p_draft_id and user_id=p_user_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  if j.revision<>p_draft_revision then raise sqlstate 'PT409' using message='JD_DRAFT_CONFLICT';end if;
  if j.draft->'confirmation'='null'::jsonb or j.draft->'confirmation'->>'digest' is distinct from p_digest
    or (j.draft->'confirmation'->>'revision')::integer<>j.revision then
    raise exception 'JD_REVIEW_REQUIRED' using errcode='23514';end if;
  select * into p from public.profiles where user_id=p_user_id for update;
  if not found then raise exception 'PROFILE_REQUIRED' using errcode='P0002';end if;
  if p.version<>p_profile_version then raise sqlstate 'PT409' using message='PROFILE_VERSION_CONFLICT';end if;
  select * into mid from pgmq.send('job_copilot_analysis',jsonb_build_object('runId',r.id,'requestId',r.request_id,
    'userId',r.user_id,'draftRevision',r.expected_draft_revision,'profileVersion',r.expected_profile_version));
  insert into public.analysis_run_jobs(run_id,message_id) values(r.id,mid);
  return jsonb_build_object('acquired',true,'run',to_jsonb(r));
end $$;

create function public.read_analysis_job_message() returns jsonb
language plpgsql security definer set search_path='' as $$
declare m pgmq.message_record;
begin
  select * into m from pgmq.read('job_copilot_analysis',180,1);
  if not found then return null;end if;
  return jsonb_build_object('messageId',m.msg_id,'message',m.message);
end $$;

create function public.claim_analysis_job(p_message_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.analysis_runs%rowtype; j public.analysis_run_jobs%rowtype;
begin
  select r0.* into r from public.analysis_runs r0 join public.analysis_run_jobs j0 on j0.run_id=r0.id
    where j0.message_id=p_message_id for update of r0;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  select * into j from public.analysis_run_jobs where run_id=r.id for update;
  if r.status<>'processing' then return jsonb_build_object('mode','terminal','token',null,'run',to_jsonb(r));end if;
  if j.lease_until>clock_timestamp() then return jsonb_build_object('mode','busy','token',null,'run',to_jsonb(r));end if;
  if j.model_started_at is not null then
    update public.analysis_runs set status='uncertain',failure_code='MODEL_RESULT_UNCERTAIN',finished_at=clock_timestamp()
      where id=r.id returning * into r;
    update public.analysis_run_jobs set phase='terminal' where run_id=r.id;
    return jsonb_build_object('mode','terminal','token',null,'run',to_jsonb(r));
  end if;
  update public.analysis_run_jobs set phase='preparing',claim_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds'
    where run_id=r.id returning * into j;
  return jsonb_build_object('mode','acquired','token',j.claim_token,'run',to_jsonb(r));
end $$;

create function public.read_analysis_worker_context(p_run_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.analysis_runs%rowtype;j public.analysis_run_jobs%rowtype;d public.jd_drafts%rowtype;p public.profiles%rowtype;
begin
  select * into r from public.analysis_runs where id=p_run_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  select * into j from public.analysis_run_jobs where run_id=r.id for update;
  if j.claim_token is distinct from p_claim_token or j.lease_until<=clock_timestamp() or r.status<>'processing'
    then raise sqlstate 'PT409' using message='ANALYSIS_RUN_STATE_CONFLICT';end if;
  select * into d from public.jd_drafts where id=r.draft_id and user_id=r.user_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  if d.revision<>r.expected_draft_revision or d.draft->'confirmation'->>'digest' is distinct from r.confirmation_digest
    then raise sqlstate 'PT409' using message='JD_DRAFT_CONFLICT';end if;
  select * into p from public.profiles where user_id=r.user_id for update;
  if not found then raise exception 'PROFILE_REQUIRED' using errcode='P0002';end if;
  if p.version<>r.expected_profile_version then raise sqlstate 'PT409' using message='PROFILE_VERSION_CONFLICT';end if;
  return jsonb_build_object('run',to_jsonb(r),'draft',d.draft,
    'profile',jsonb_build_object('profile',p.profile_data,'version',p.version,'updatedAt',p.updated_at));
end $$;

create function public.start_analysis_job_model(p_run_id uuid,p_claim_token uuid,p_upper_cny numeric) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.analysis_runs%rowtype;j public.analysis_run_jobs%rowtype;b public.analysis_worker_budget%rowtype;
begin
  select * into r from public.analysis_runs where id=p_run_id for update;
  select * into j from public.analysis_run_jobs where run_id=r.id for update;
  if r.status<>'processing' or j.claim_token is distinct from p_claim_token or j.lease_until<=clock_timestamp()
    or j.phase<>'preparing' or j.model_started_at is not null then return false;end if;
  -- Revalidate source versions immediately before the durable model marker.
  perform public.read_analysis_worker_context(p_run_id,p_claim_token);
  if r.request_context->'metadata'->>'modelProvider'<>'fixture' then
  select * into b from public.analysis_worker_budget where singleton for update;
  if p_upper_cny is null or p_upper_cny<=0 or p_upper_cny>1 or b.calls>=3 or b.reserved_cny+p_upper_cny>3
    then raise exception 'MODEL_REJECTED' using errcode='23514';end if;
  update public.analysis_worker_budget set calls=calls+1,reserved_cny=reserved_cny+p_upper_cny where singleton;
  end if;
  update public.analysis_run_jobs set phase='invoking',model_started_at=clock_timestamp(),reserved_cny=case when r.request_context->'metadata'->>'modelProvider'='fixture' then null else p_upper_cny end,
    lease_until=clock_timestamp()+interval '90 seconds' where run_id=r.id;
  update public.analysis_runs set expires_at=clock_timestamp()+interval '90 seconds' where id=r.id;
  return true; -- Commit marker before the transport is allowed to send; no automatic reset.
end $$;

create function public.finish_queued_analysis(p_run_id uuid,p_claim_token uuid,p_status text,p_failure_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.analysis_runs%rowtype;j public.analysis_run_jobs%rowtype;
begin
  select * into r from public.analysis_runs where id=p_run_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  if r.status<>'processing' then return to_jsonb(r);end if;
  select * into j from public.analysis_run_jobs where run_id=r.id for update;
  if j.claim_token is distinct from p_claim_token then raise sqlstate 'PT409' using message='ANALYSIS_RUN_STATE_CONFLICT';end if;
  if p_status not in ('failed','uncertain') or p_status is null then raise exception 'INVALID_RUN_STATE' using errcode='23514';end if;
  if j.model_started_at is not null and j.lease_until<=clock_timestamp() then
    p_status:='uncertain';p_failure_code:='MODEL_RESULT_UNCERTAIN';
  end if;
  update public.analysis_runs set status=p_status,failure_code=p_failure_code,finished_at=clock_timestamp() where id=r.id returning * into r;
  update public.analysis_run_jobs set phase='terminal' where run_id=r.id;return to_jsonb(r);
end $$;

create function public.complete_queued_analysis(p_run_id uuid,p_claim_token uuid,p_expected_jd_snapshot jsonb,p_jd_items jsonb,p_report jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.analysis_runs%rowtype;j public.analysis_run_jobs%rowtype;saved jsonb;
begin
  select * into r from public.analysis_runs where id=p_run_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
  if r.status<>'processing' then return to_jsonb(r);end if;
  select * into j from public.analysis_run_jobs where run_id=r.id for update;
  if j.claim_token is distinct from p_claim_token or j.phase<>'invoking' or j.model_started_at is null
    then raise sqlstate 'PT409' using message='ANALYSIS_RUN_STATE_CONFLICT';end if;
  if j.lease_until<=clock_timestamp() then return public.finish_queued_analysis(p_run_id,p_claim_token,'uncertain','MODEL_RESULT_UNCERTAIN');end if;
  -- Existing save transaction retains run -> JD -> profile locking and frozen snapshots/A2 server precondition.
  saved:=public.complete_analysis_run(r.user_id,r.request_id,p_expected_jd_snapshot,p_jd_items,p_report);
  update public.analysis_run_jobs set phase='terminal' where run_id=r.id;return saved;
end $$;

create function public.record_analysis_job_usage(p_run_id uuid,p_claim_token uuid,p_metrics jsonb) returns void
language plpgsql security definer set search_path='' as $$ begin
  if p_metrics is not null and (jsonb_typeof(p_metrics)<>'object'
    or (p_metrics-array['event','provider','model','promptVersion','reportStructureVersion','pricingVersion','inputTokens',
      'outputTokens','totalTokens','cacheHitTokens','elapsedMs','finishReason','outcome','estimatedUsd','estimateBasis',
      'networkMs','validationMs','responseModelMatched','usdToCny','estimatedCny','cnyEstimateBasis'])<>'{}'::jsonb) then
    raise exception 'INVALID_USAGE_METADATA' using errcode='23514';end if;
  update public.analysis_run_jobs set usage_metadata=p_metrics where run_id=p_run_id and claim_token=p_claim_token
    and phase='invoking' and lease_until>clock_timestamp() and usage_metadata is null;
end $$;

create function public.archive_analysis_job_message(p_message_id bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.analysis_runs%rowtype;
begin
  select r0.* into r from public.analysis_runs r0 join public.analysis_run_jobs j on j.run_id=r0.id
    where j.message_id=p_message_id for update of r0;
  if not found or r.status='processing' then raise sqlstate 'PT409' using message='ANALYSIS_RUN_STATE_CONFLICT';end if;
  return pgmq.archive('job_copilot_analysis',p_message_id);
end $$;

-- Queued work does NOT expire merely because Cron is stopped. Only expired invoking work becomes uncertain.
create or replace function public.read_analysis_run(p_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.analysis_runs%rowtype;j public.analysis_run_jobs%rowtype;
begin
  select * into r from public.analysis_runs where user_id=p_user_id and request_id=p_request_id for update;
  if not found then return null;end if;
  select * into j from public.analysis_run_jobs where run_id=r.id for update;
  if r.status='processing' and ((j.run_id is null and r.expires_at<=clock_timestamp())
    or (j.model_started_at is not null and j.lease_until<=clock_timestamp())) then
    update public.analysis_runs set status='uncertain',failure_code='MODEL_RESULT_UNCERTAIN',finished_at=clock_timestamp()
      where id=r.id returning * into r;
    if j.run_id is not null then update public.analysis_run_jobs set phase='terminal' where run_id=r.id;end if;
  end if;
  return to_jsonb(r);
end $$;

create function public.purge_analysis_job_message() returns trigger
language plpgsql security definer set search_path='' as $$ begin
  perform pgmq.delete('job_copilot_analysis',old.message_id);
  delete from pgmq.a_job_copilot_analysis where msg_id=old.message_id;
  return old;
end $$;
create trigger analysis_job_cleanup before delete on public.analysis_run_jobs for each row execute function public.purge_analysis_job_message();

-- Disable all legacy external reservation/save/finish paths. Existing functions remain internal only.
revoke all on function public.reserve_analysis_run(uuid,uuid,text,uuid,integer,integer,text,jsonb),
  public.complete_analysis_run(uuid,uuid,jsonb,jsonb,jsonb),public.finish_analysis_run(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.purge_analysis_job_message() from public,anon,authenticated,service_role;
revoke all on function public.enqueue_analysis_run(uuid,uuid,text,uuid,integer,integer,text,jsonb),
  public.read_analysis_job_message(),public.claim_analysis_job(bigint),public.read_analysis_worker_context(uuid,uuid),
  public.start_analysis_job_model(uuid,uuid,numeric),public.finish_queued_analysis(uuid,uuid,text,text),
  public.complete_queued_analysis(uuid,uuid,jsonb,jsonb,jsonb),public.record_analysis_job_usage(uuid,uuid,jsonb),
  public.archive_analysis_job_message(bigint) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_analysis_run(uuid,uuid,text,uuid,integer,integer,text,jsonb),
  public.read_analysis_job_message(),public.claim_analysis_job(bigint),public.read_analysis_worker_context(uuid,uuid),
  public.start_analysis_job_model(uuid,uuid,numeric),public.finish_queued_analysis(uuid,uuid,text,text),
  public.complete_queued_analysis(uuid,uuid,jsonb,jsonb,jsonb),public.record_analysis_job_usage(uuid,uuid,jsonb),
  public.archive_analysis_job_message(bigint) to service_role;
-- read_analysis_run retains existing service-role grant and owner filtering; business table RLS is unchanged.
