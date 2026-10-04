-- NOT VERIFIED on a real Supabase project. Fourth private business table.
create function public.valid_jd_draft(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(value) is distinct from 'object'
    or value->>'ruleVersion' is distinct from 'rules-1'
    or jsonb_typeof(value->'rawText') is distinct from 'string'
    or length(btrim(value->>'rawText')) = 0 or length(value->>'rawText') > 20000
    or jsonb_typeof(value->'segments') is distinct from 'array' then return false; end if;
  if jsonb_array_length(value->'segments') not between 1 and 500 then return false; end if;
  for item in select * from jsonb_array_elements(value->'segments') loop
    if jsonb_typeof(item) is distinct from 'object'
      or coalesce(item->>'id', '') !~ '^JD[0-9]+(\.[0-9]+)*$'
      or not (item ? 'category') or not (item ? 'suggestedCategory')
      or (item->'category' <> 'null'::jsonb and coalesce(item->>'category', '') not in ('qualification', 'core_duty', 'preferred', 'background'))
      or (item->'suggestedCategory' <> 'null'::jsonb and coalesce(item->>'suggestedCategory', '') not in ('qualification', 'core_duty', 'preferred', 'background'))
      or jsonb_typeof(item->'start') is distinct from 'number'
      or jsonb_typeof(item->'end') is distinct from 'number'
      or jsonb_typeof(item->'sourceStart') is distinct from 'number'
      or jsonb_typeof(item->'sourceEnd') is distinct from 'number'
      then return false; end if;
    if (item->>'start')::integer < 0 or (item->>'end')::integer <= (item->>'start')::integer
      or (item->>'sourceStart')::integer < 0
      or (item->>'sourceStart')::integer > (item->>'start')::integer
      or (item->>'sourceEnd')::integer < (item->>'end')::integer then return false; end if;
  end loop;
  if not (value ? 'confirmation') then return false; end if;
  if value->'confirmation' <> 'null'::jsonb then
    if jsonb_typeof(value->'confirmation') is distinct from 'object'
      or coalesce(value->'confirmation'->>'revision', '') <> coalesce(value->>'revision', '')
      or coalesce(value->'confirmation'->>'digest', '') !~ '^[a-f0-9]{64}$'
      or coalesce(value->'confirmation'->>'confirmedAt', '') = '' then return false; end if;
    for item in select * from jsonb_array_elements(value->'segments') loop
      if item->'category' = 'null'::jsonb then return false; end if;
    end loop;
  end if;
  return true;
exception when others then return false;
end;
$$;

create table public.jd_drafts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null check (revision > 0),
  draft jsonb not null,
  created_at timestamptz not null default now(),
  constraint jd_draft_shape check (public.valid_jd_draft(draft)),
  constraint jd_draft_identity check (
    coalesce(draft->>'id', '') = id::text and coalesce(draft->>'revision', '') = revision::text
  )
);
create index jd_drafts_owner on public.jd_drafts(user_id);
alter table public.jd_drafts enable row level security;
revoke all on public.jd_drafts from anon, authenticated;
grant select on public.jd_drafts to authenticated;
create policy jd_drafts_read_own on public.jd_drafts for select to authenticated using ((select auth.uid()) = user_id);
-- Browser cannot forge a confirmed row. Every write goes through authenticated server validation.
grant select, insert, update, delete on public.jd_drafts to service_role;

create function public.guard_jd_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    if new.revision <> 1 or new.draft->'confirmation' <> 'null'::jsonb then
      raise exception 'Draft must start unconfirmed at revision 1' using errcode = '23514';
    end if;
  else
    if new.user_id <> old.user_id or new.id <> old.id or new.revision <> old.revision + 1 then
      raise exception 'Draft owner/id immutable; revision must advance once' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger jd_revision_guard before insert or update on public.jd_drafts
for each row execute function public.guard_jd_revision();
