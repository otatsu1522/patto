-- Track account-wide data resets so offline devices cannot re-upload pre-reset rows.
-- Existing rows belong to generation 0; the generation advances atomically with a full reset.

create table if not exists public.patto_account_data_state (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  reset_generation bigint not null default 0,
  updated_at bigint not null default ((extract(epoch from clock_timestamp()) * 1000)::bigint)
);

alter table public.patto_account_data_state enable row level security;

drop policy if exists "account data state: owner read" on public.patto_account_data_state;
create policy "account data state: owner read" on public.patto_account_data_state
  for select to authenticated
  using (owner_id = (select auth.uid()));

grant select on public.patto_account_data_state to authenticated;
revoke insert, update, delete on public.patto_account_data_state from anon, authenticated;

alter table public.projects
  add column if not exists reset_generation bigint not null default 0;
alter table public.kanban_columns
  add column if not exists reset_generation bigint not null default 0;
alter table public.tasks
  add column if not exists reset_generation bigint not null default 0;

-- Serialize data writes with reset transactions. A stale client generation is rejected instead of
-- re-creating rows after another device has reset the account.
create or replace function public.patto_enforce_reset_generation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_generation bigint;
begin
  if auth.uid() is null or auth.uid() is distinct from new.owner_id then
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  insert into public.patto_account_data_state (owner_id, reset_generation, updated_at)
  values (
    new.owner_id,
    0,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  on conflict (owner_id) do nothing;

  select state.reset_generation
    into active_generation
    from public.patto_account_data_state state
   where state.owner_id = new.owner_id
   for share;

  if new.reset_generation is distinct from active_generation then
    raise exception 'Stale account data reset generation' using errcode = '40001';
  end if;

  return new;
end;
$$;

revoke all on function public.patto_enforce_reset_generation() from public;

drop trigger if exists projects_validate_reset_generation on public.projects;
create trigger projects_validate_reset_generation
  before insert or update on public.projects
  for each row execute function public.patto_enforce_reset_generation();

drop trigger if exists columns_validate_reset_generation on public.kanban_columns;
create trigger columns_validate_reset_generation
  before insert or update on public.kanban_columns
  for each row execute function public.patto_enforce_reset_generation();

drop trigger if exists tasks_validate_reset_generation on public.tasks;
create trigger tasks_validate_reset_generation
  before insert or update on public.tasks
  for each row execute function public.patto_enforce_reset_generation();

-- Store reset request IDs so a client retry after a successful server reset is idempotent.
-- This is important when the local metadata write or pending-queue cleanup fails after the RPC.
create table if not exists public.patto_account_reset_requests (
  owner_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null,
  reset_generation bigint not null,
  created_at bigint not null default ((extract(epoch from clock_timestamp()) * 1000)::bigint),
  primary key (owner_id, request_id)
);

alter table public.patto_account_reset_requests enable row level security;
revoke all on public.patto_account_reset_requests from public, anon, authenticated;

-- Recreate the full-reset RPC with a stable request ID. Repeated calls with the same ID return the
-- original generation and do not delete data created after the first successful reset.
drop function if exists public.patto_delete_all_owned_data(uuid);
drop function if exists public.patto_delete_all_owned_data(uuid, uuid);

create function public.patto_delete_all_owned_data(
  p_owner_id uuid,
  p_request_id uuid
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  current_generation bigint;
  existing_generation bigint;
  new_generation bigint;
begin
  if auth.uid() is null or auth.uid() is distinct from p_owner_id then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'Reset request ID is required' using errcode = '22023';
  end if;

  insert into public.patto_account_data_state (owner_id, reset_generation, updated_at)
  values (
    p_owner_id,
    0,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  on conflict (owner_id) do nothing;

  -- Serialize resets for the same account before checking idempotency.
  select state.reset_generation
    into current_generation
    from public.patto_account_data_state state
   where state.owner_id = p_owner_id
   for update;

  select request.reset_generation
    into existing_generation
    from public.patto_account_reset_requests request
   where request.owner_id = p_owner_id
     and request.request_id = p_request_id;
  if found then
    return existing_generation;
  end if;

  update public.patto_account_data_state
     set reset_generation = current_generation + 1,
         updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
   where owner_id = p_owner_id
   returning reset_generation into new_generation;

  insert into public.patto_account_reset_requests (owner_id, request_id, reset_generation)
  values (p_owner_id, p_request_id, new_generation);

  delete from public.tasks where owner_id = p_owner_id;
  delete from public.kanban_columns where owner_id = p_owner_id;
  delete from public.projects where owner_id = p_owner_id;

  return new_generation;
end;
$$;

revoke all on function public.patto_delete_all_owned_data(uuid, uuid) from public;
grant execute on function public.patto_delete_all_owned_data(uuid, uuid) to authenticated;
