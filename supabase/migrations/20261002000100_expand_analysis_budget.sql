-- Dedicated test acceptance pool expansion, authorized 2026-10-02.
-- Preserve accumulated calls/reservation. No data reset, grants, policies or queue changes.
-- CLI transaction makes constraint/function replacement atomic. Replay is blocked by migration history.
alter table public.analysis_worker_budget
  drop constraint analysis_worker_budget_calls_check,
  add constraint analysis_worker_budget_calls_check check(calls between 0 and 12),
  drop constraint analysis_worker_budget_reserved_cny_check,
  add constraint analysis_worker_budget_reserved_cny_check check(reserved_cny between 0 and 5);

-- CREATE OR REPLACE retains owner and execution ACL. Only the two cumulative comparisons change.
create or replace function public.start_analysis_job_model(p_run_id uuid,p_claim_token uuid,p_upper_cny numeric) returns boolean
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
  if p_upper_cny is null or p_upper_cny<=0 or p_upper_cny>1 or b.calls>=12 or b.reserved_cny+p_upper_cny>5
    then raise exception 'MODEL_REJECTED' using errcode='23514';end if;
  update public.analysis_worker_budget set calls=calls+1,reserved_cny=reserved_cny+p_upper_cny where singleton;
  end if;
  update public.analysis_run_jobs set phase='invoking',model_started_at=clock_timestamp(),reserved_cny=case when r.request_context->'metadata'->>'modelProvider'='fixture' then null else p_upper_cny end,
    lease_until=clock_timestamp()+interval '90 seconds' where run_id=r.id;
  update public.analysis_runs set expires_at=clock_timestamp()+interval '90 seconds' where id=r.id;
  return true; -- Commit marker before the transport is allowed to send; no automatic reset.
end $$;
