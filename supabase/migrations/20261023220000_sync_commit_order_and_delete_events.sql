begin;

-- Serialize every authenticated owner's writes before row locks are taken, so server_seq order
-- follows transaction commit order for that owner. Record physical deletions so offline clients
-- can remove stale local rows instead of re-uploading them.

-- Keep schema changes and trigger installation from overlapping table mutations. SHARE ROW EXCLUSIVE
-- still allows reads; writes resume when this migration transaction commits.
lock table public.tasks, public.kanban_columns, public.projects in share row exclusive mode;

create table if not exists public.patto_delete_events (
  owner_id uuid not null references auth.users (id) on delete cascade,
  table_name text not null check (table_name in ('projects', 'kanban_columns', 'tasks')),
  record_id uuid not null,
  server_seq bigint not null,
  reset_generation bigint not null,
  created_at bigint not null default ((extract(epoch from clock_timestamp()) * 1000)::bigint),
  primary key (owner_id, table_name, record_id, reset_generation)
);

create index if not exists patto_delete_events_cursor
  on public.patto_delete_events (owner_id, table_name, reset_generation, server_seq);
create index if not exists patto_delete_events_record
  on public.patto_delete_events (owner_id, table_name, reset_generation, record_id);

alter table public.patto_delete_events enable row level security;
drop policy if exists "delete events: owner read" on public.patto_delete_events;
create policy "delete events: owner read" on public.patto_delete_events
  for select to authenticated
  using (owner_id = (select auth.uid()));
revoke all on public.patto_delete_events from public, anon, authenticated;
grant select on public.patto_delete_events to authenticated;
alter publication supabase_realtime add table public.patto_delete_events;

-- A statement-level lock is acquired before PostgreSQL locks individual rows. A row-level lock
-- alone would be unsafe for INSERT ... ON CONFLICT versus DELETE, because those paths can lock the
-- account row and data row in opposite orders. The same owner lock is used by reset/delete RPCs.
create or replace function public.patto_lock_owner_writes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  end if;
  return null;
end;
$$;
revoke all on function public.patto_lock_owner_writes() from public;

-- Keep normal row versioning, but refuse to recreate a physically deleted ID in the same reset
-- generation. Returning NULL from a BEFORE trigger safely skips that stale row; the delete event
-- will remove it from the client's local database during Pull.
create or replace function public.patto_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() is distinct from new.owner_id then
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.patto_delete_events event
     where event.owner_id = new.owner_id
       and event.table_name = tg_table_name
       and event.record_id = new.id
       and event.reset_generation = new.reset_generation
  ) then
    return null;
  end if;

  if tg_table_name in ('kanban_columns', 'tasks') then
    if exists (
      select 1
        from public.patto_delete_events event
       where event.owner_id = new.owner_id
         and event.table_name = 'projects'
         and event.record_id = new.project_id
         and event.reset_generation = new.reset_generation
    ) then
      return null;
    end if;
  end if;

  if tg_table_name = 'tasks' then
    if exists (
      select 1
        from public.patto_delete_events event
       where event.owner_id = new.owner_id
         and event.table_name = 'kanban_columns'
         and event.record_id = new.column_id
         and event.reset_generation = new.reset_generation
    ) then
      return null;
    end if;
  end if;

  new.server_seq := nextval('public.patto_seq');
  return new;
end;
$$;
revoke all on function public.patto_touch() from public;

-- The account lock above now serializes row writes with account resets. Keep the existing reset
-- generation validation as a second check, but use the statement lock first to avoid lock inversion.
create or replace function public.patto_record_delete_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Account deletion / service-role cascades do not have an end-user JWT and must not create
  -- user-visible tombstones while auth.users is being deleted.
  if pg_trigger_depth() > 1 or auth.uid() is null or auth.uid() is distinct from old.owner_id then
    return old;
  end if;
  if current_setting('patto.skip_delete_events', true) = 'on' then
    return old;
  end if;

  -- The owner's statement-level advisory lock is already held before row locks are taken.
  -- Keep the row's generation on the event; stale-generation events are ignored by current clients.
  insert into public.patto_delete_events (
    owner_id, table_name, record_id, server_seq, reset_generation
  ) values (
    old.owner_id, tg_table_name, old.id, nextval('public.patto_seq'), old.reset_generation
  )
  on conflict (owner_id, table_name, record_id, reset_generation) do nothing;

  -- Deleting a project through a direct ID path must not leave orphan rows behind. The project
  -- tombstone is sufficient for child cleanup on clients; nested child DELETE triggers therefore
  -- skip writing redundant child events when pg_trigger_depth() is greater than one.
  if tg_table_name = 'projects' then
    delete from public.tasks where owner_id = old.owner_id and project_id = old.id;
    delete from public.kanban_columns where owner_id = old.owner_id and project_id = old.id;
  end if;

  return old;
end;
$$;
revoke all on function public.patto_record_delete_event() from public;

-- Install owner-scoped serialization on all data tables. A transaction can update multiple tables;
-- its advisory lock is held until commit, so all its server_seq values become visible atomically.
drop trigger if exists projects_serialize_owner_writes on public.projects;
create trigger projects_serialize_owner_writes
  before insert or update or delete on public.projects
  for each statement execute function public.patto_lock_owner_writes();

drop trigger if exists columns_serialize_owner_writes on public.kanban_columns;
create trigger columns_serialize_owner_writes
  before insert or update or delete on public.kanban_columns
  for each statement execute function public.patto_lock_owner_writes();

drop trigger if exists tasks_serialize_owner_writes on public.tasks;
create trigger tasks_serialize_owner_writes
  before insert or update or delete on public.tasks
  for each statement execute function public.patto_lock_owner_writes();

-- Physical deletes from any supported path (direct ID deletes, expired trash cleanup and project
-- deletion RPCs) are recorded in the same transaction as the deletion.
drop trigger if exists projects_record_delete_event on public.projects;
create trigger projects_record_delete_event
  after delete on public.projects
  for each row execute function public.patto_record_delete_event();

drop trigger if exists columns_record_delete_event on public.kanban_columns;
create trigger columns_record_delete_event
  after delete on public.kanban_columns
  for each row execute function public.patto_record_delete_event();

drop trigger if exists tasks_record_delete_event on public.tasks;
create trigger tasks_record_delete_event
  after delete on public.tasks
  for each row execute function public.patto_record_delete_event();

-- The RPC itself locks the owner before locking state or data rows, using the same lock order as the
-- statement triggers. Its stable request ID still makes retries idempotent.
create or replace function public.patto_delete_all_owned_data(
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

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  insert into public.patto_account_data_state (owner_id, reset_generation, updated_at)
  values (
    p_owner_id,
    0,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  on conflict (owner_id) do nothing;

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

  -- The generation change already invalidates all old local snapshots. Skip individual tombstones
  -- for this bulk reset and remove old-generation tombstones to keep the event log bounded.
  perform set_config('patto.skip_delete_events', 'on', true);
  delete from public.tasks where owner_id = p_owner_id;
  delete from public.kanban_columns where owner_id = p_owner_id;
  delete from public.projects where owner_id = p_owner_id;
  delete from public.patto_delete_events where owner_id = p_owner_id;

  return new_generation;
end;
$$;
revoke all on function public.patto_delete_all_owned_data(uuid, uuid) from public;
grant execute on function public.patto_delete_all_owned_data(uuid, uuid) to authenticated;

-- The project-delete RPC takes row locks before issuing its DELETE statements, so it must acquire
-- the same owner lock before that first SELECT FOR UPDATE as well.
create or replace function public.patto_delete_trashed_projects(
  p_owner_id uuid,
  p_project_ids uuid[]
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  requested_ids uuid[] := array[]::uuid[];
  preserved_ids uuid[] := array[]::uuid[];
  target_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or auth.uid() is distinct from p_owner_id then
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  select coalesce(array_agg(ids.id order by ids.id), array[]::uuid[])
    into requested_ids
    from (
      select distinct unnest(coalesce(p_project_ids, array[]::uuid[])) as id
    ) as ids;

  perform p.id
    from public.projects p
   where p.owner_id = p_owner_id
     and p.id = any(requested_ids)
   order by p.id
   for update;

  select coalesce(array_agg(p.id order by p.id), array[]::uuid[])
    into preserved_ids
    from public.projects p
   where p.owner_id = p_owner_id
     and p.deleted_at is null
     and p.id = any(requested_ids);

  select coalesce(array_agg(ids.id order by ids.id), array[]::uuid[])
    into target_ids
    from unnest(requested_ids) as ids(id)
   where not (ids.id = any(preserved_ids));

  if cardinality(target_ids) > 0 then
    delete from public.tasks
     where owner_id = p_owner_id and project_id = any(target_ids);
    delete from public.kanban_columns
     where owner_id = p_owner_id and project_id = any(target_ids);
    delete from public.projects
     where owner_id = p_owner_id and id = any(target_ids);
  end if;

  return jsonb_build_object(
    'deleted_project_ids', to_jsonb(target_ids),
    'preserved_project_ids', to_jsonb(preserved_ids)
  );
end;
$$;
revoke all on function public.patto_delete_trashed_projects(uuid, uuid[]) from public;
grant execute on function public.patto_delete_trashed_projects(uuid, uuid[]) to authenticated;

commit;
