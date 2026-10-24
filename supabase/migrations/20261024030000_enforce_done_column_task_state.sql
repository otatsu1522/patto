begin;

-- The destination column's current is_done_column setting is authoritative for task completion.
-- A task write from an offline/stale device is normalized after patto_touch() merges fields,
-- so column_id and completed_at cannot remain inconsistent on the server.
create or replace function public.patto_enforce_task_completion_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_done boolean;
  v_column_field_updated_at jsonb;
  v_now bigint;
  v_revision bigint;
begin
  if auth.uid() is null or auth.uid() is distinct from new.owner_id then
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  select column_row.is_done_column, column_row.field_updated_at
    into v_is_done, v_column_field_updated_at
    from public.kanban_columns as column_row
   where column_row.id = new.column_id
     and column_row.owner_id = new.owner_id
     and column_row.project_id = new.project_id;

  -- Keep legacy/orphan rows importable; every task pointing to a known column is normalized.
  if not found then
    return new;
  end if;

  if (v_is_done and new.completed_at is null)
     or (not v_is_done and new.completed_at is not null) then
    v_now := (extract(epoch from clock_timestamp()) * 1000)::bigint;
    v_revision := greatest(
      v_now,
      coalesce((new.field_updated_at ->> '__taskMove')::bigint, 0),
      coalesce((new.field_updated_at ->> 'columnId')::bigint, 0),
      coalesce((new.field_updated_at ->> 'completedAt')::bigint, 0),
      coalesce((new.field_updated_at ->> 'sortKey')::bigint, 0),
      coalesce((v_column_field_updated_at ->> 'isDoneColumn')::bigint, 0)
    ) + 1;

    if v_is_done then
      new.completed_at := v_now;
    else
      new.completed_at := null;
    end if;

    -- Keep the whole move-state group at one revision. This makes subsequent stale upserts
    -- lose to the repaired state instead of independently restoring an inconsistent timestamp.
    new.field_updated_at := coalesce(new.field_updated_at, '{}'::jsonb)
      || jsonb_build_object(
        'columnId', v_revision,
        'completedAt', v_revision,
        'sortKey', v_revision,
        '__taskMove', v_revision
      );
    new.updated_at := greatest(new.updated_at, v_revision);
  end if;

  return new;
end;
$$;
revoke all on function public.patto_enforce_task_completion_state() from public;

drop trigger if exists tasks_z_enforce_done_column_state on public.tasks;
create trigger tasks_z_enforce_done_column_state
  before insert or update on public.tasks
  for each row execute function public.patto_enforce_task_completion_state();

-- When a column is made (or ceases to be) a done column, normalize its live tasks in the same
-- transaction. A task move racing this update is serialized by the existing owner write lock;
-- whichever statement runs second also applies the invariant against the committed column state.
create or replace function public.patto_sync_tasks_for_done_column()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint;
begin
  if auth.uid() is null or auth.uid() is distinct from new.owner_id then
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  if new.is_done_column is not distinct from old.is_done_column then
    return new;
  end if;

  v_now := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  with tasks_to_normalize as materialized (
    select
      task.id,
      greatest(
        v_now,
        coalesce((new.field_updated_at ->> 'isDoneColumn')::bigint, 0),
        coalesce((task.field_updated_at ->> '__taskMove')::bigint, 0),
        coalesce((task.field_updated_at ->> 'columnId')::bigint, 0),
        coalesce((task.field_updated_at ->> 'completedAt')::bigint, 0),
        coalesce((task.field_updated_at ->> 'sortKey')::bigint, 0)
      ) + 1 as revision
    from public.tasks as task
    where task.owner_id = new.owner_id
      and task.project_id = new.project_id
      and task.column_id = new.id
      and task.reset_generation = new.reset_generation
      and task.deleted_at is null
      and (
        (new.is_done_column and task.completed_at is null)
        or (not new.is_done_column and task.completed_at is not null)
      )
  )
  update public.tasks as task
     set completed_at = case
           when new.is_done_column then coalesce(task.completed_at, v_now)
           else null
         end,
         field_updated_at = coalesce(task.field_updated_at, '{}'::jsonb)
           || jsonb_build_object(
             'columnId', normalized.revision,
             'completedAt', normalized.revision,
             'sortKey', normalized.revision,
             '__taskMove', normalized.revision
           ),
         updated_at = greatest(task.updated_at, normalized.revision)
    from tasks_to_normalize as normalized
   where task.id = normalized.id;

  return new;
end;
$$;
revoke all on function public.patto_sync_tasks_for_done_column() from public;

drop trigger if exists kanban_columns_sync_done_task_state on public.kanban_columns;
create trigger kanban_columns_sync_done_task_state
  after update of is_done_column on public.kanban_columns
  for each row
  when (old.is_done_column is distinct from new.is_done_column)
  execute function public.patto_sync_tasks_for_done_column();

-- Repair inconsistencies that predate these triggers. Migration execution has no auth.uid(), so
-- temporarily disable only the two row triggers that require it, and allocate server_seq directly.
alter table public.tasks disable trigger tasks_touch;
alter table public.tasks disable trigger tasks_z_enforce_done_column_state;

with clock as materialized (
  select (extract(epoch from clock_timestamp()) * 1000)::bigint as now_ms
), inconsistent as materialized (
  select
    task.id,
    column_row.is_done_column,
    clock.now_ms,
    greatest(
      clock.now_ms,
      coalesce((column_row.field_updated_at ->> 'isDoneColumn')::bigint, 0),
      coalesce((task.field_updated_at ->> '__taskMove')::bigint, 0),
      coalesce((task.field_updated_at ->> 'columnId')::bigint, 0),
      coalesce((task.field_updated_at ->> 'completedAt')::bigint, 0),
      coalesce((task.field_updated_at ->> 'sortKey')::bigint, 0)
    ) + 1 as revision
  from public.tasks as task
  join public.kanban_columns as column_row
    on column_row.id = task.column_id
   and column_row.owner_id = task.owner_id
   and column_row.project_id = task.project_id
  cross join clock
  where task.reset_generation = column_row.reset_generation
    and task.deleted_at is null
    and (
      (column_row.is_done_column and task.completed_at is null)
      or (not column_row.is_done_column and task.completed_at is not null)
    )
)
update public.tasks as task
   set completed_at = case
         when inconsistent.is_done_column then coalesce(task.completed_at, inconsistent.now_ms)
         else null
       end,
       field_updated_at = coalesce(task.field_updated_at, '{}'::jsonb)
         || jsonb_build_object(
           'columnId', inconsistent.revision,
           'completedAt', inconsistent.revision,
           'sortKey', inconsistent.revision,
           '__taskMove', inconsistent.revision
         ),
       updated_at = greatest(task.updated_at, inconsistent.revision),
       server_seq = nextval('public.patto_seq')
  from inconsistent
 where task.id = inconsistent.id;

alter table public.tasks enable trigger tasks_touch;
alter table public.tasks enable trigger tasks_z_enforce_done_column_state;

commit;
