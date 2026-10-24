begin;

-- Merge incoming fields against the latest committed row inside the write transaction.
-- Also remove sequence defaults because patto_touch() is the single server_seq allocator.

alter table public.projects alter column server_seq drop default;
alter table public.kanban_columns alter column server_seq drop default;
alter table public.tasks alter column server_seq drop default;

create or replace function public.patto_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_row jsonb;
  v_input_row jsonb;
  v_merged_row jsonb;
  v_field_timestamps jsonb;
  v_columns text[];
  v_fields text[];
  v_field text;
  v_column text;
  v_existing_timestamp bigint;
  v_input_timestamp bigint;
  v_existing_value jsonb;
  v_input_value jsonb;
  v_index integer;
begin
  if auth.uid() is null or auth.uid() is distinct from new.owner_id then
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  v_input_row := to_jsonb(new);
  if tg_op = 'UPDATE' then
    v_existing_row := to_jsonb(old);
  else
    -- For INSERT ... ON CONFLICT, merge against an already-existing row. The statement-level
    -- owner lock is held before this row trigger, so same-owner writes are serialized.
    execute format(
      'select to_jsonb(row_data) from public.%I as row_data where row_data.id = $1 and row_data.owner_id = $2',
      tg_table_name
    )
      into v_existing_row
      using new.id, new.owner_id;
  end if;

  if v_existing_row is not null then
    case tg_table_name
      when 'projects' then
        v_columns := array['deleted_at', 'title', 'description', 'color', 'is_favorite', 'sort_key', 'archived_at'];
        v_fields := array['deletedAt', 'title', 'description', 'color', 'isFavorite', 'sortKey', 'archivedAt'];
      when 'kanban_columns' then
        v_columns := array['deleted_at', 'project_id', 'title', 'color', 'sort_key', 'sort_mode', 'is_done_column'];
        v_fields := array['deletedAt', 'projectId', 'title', 'color', 'sortKey', 'sortMode', 'isDoneColumn'];
      when 'tasks' then
        v_columns := array['deleted_at', 'project_id', 'column_id', 'title', 'description', 'color', 'due_at', 'due_has_time', 'is_favorite', 'sort_key', 'completed_at', 'archived_at'];
        v_fields := array['deletedAt', 'projectId', 'columnId', 'title', 'description', 'color', 'dueAt', 'dueHasTime', 'isFavorite', 'sortKey', 'completedAt', 'archivedAt'];
      else
        raise exception 'Unsupported Patto table: %', tg_table_name using errcode = '22023';
    end case;

    v_merged_row := v_existing_row || v_input_row;
    v_field_timestamps := coalesce(v_existing_row -> 'field_updated_at', '{}'::jsonb);

    for v_index in 1..array_length(v_columns, 1) loop
      v_column := v_columns[v_index];
      v_field := v_fields[v_index];
      v_existing_timestamp := coalesce((v_existing_row -> 'field_updated_at' ->> v_field)::bigint, 0);
      v_input_timestamp := coalesce((v_input_row -> 'field_updated_at' ->> v_field)::bigint, 0);
      v_existing_value := coalesce(v_existing_row -> v_column, 'null'::jsonb);
      v_input_value := coalesce(v_input_row -> v_column, 'null'::jsonb);

      -- Match the client merge rule: the newest field timestamp wins. Equal timestamps use a
      -- stable JSON representation so simultaneous edits eventually converge to one value.
      if v_input_timestamp > v_existing_timestamp
         or (
           v_input_timestamp = v_existing_timestamp
           and (v_input_value::text collate "C") > (v_existing_value::text collate "C")
         ) then
        v_merged_row := jsonb_set(v_merged_row, array[v_column], v_input_value, true);
        v_field_timestamps := jsonb_set(
          v_field_timestamps,
          array[v_field],
          to_jsonb(v_input_timestamp),
          true
        );
      else
        v_merged_row := jsonb_set(v_merged_row, array[v_column], v_existing_value, true);
        v_field_timestamps := jsonb_set(
          v_field_timestamps,
          array[v_field],
          to_jsonb(v_existing_timestamp),
          true
        );
      end if;
    end loop;

    v_merged_row := jsonb_set(v_merged_row, '{field_updated_at}', v_field_timestamps, true);
    v_merged_row := jsonb_set(
      v_merged_row,
      '{created_at}',
      to_jsonb(least((v_existing_row ->> 'created_at')::bigint, (v_input_row ->> 'created_at')::bigint)),
      true
    );
    v_merged_row := jsonb_set(
      v_merged_row,
      '{updated_at}',
      to_jsonb(greatest((v_existing_row ->> 'updated_at')::bigint, (v_input_row ->> 'updated_at')::bigint)),
      true
    );
    new := jsonb_populate_record(new, v_merged_row);
  end if;

  -- Refuse to recreate a physically deleted ID in the same reset generation. Returning NULL from
  -- a BEFORE trigger skips a stale write; the delete event removes it from the client's local DB.
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

  -- An upsert against an existing row fires BEFORE INSERT and then BEFORE UPDATE. Do not consume
  -- a sequence value during the INSERT attempt; the UPDATE trigger allocates the new sequence.
  if tg_op = 'INSERT' and v_existing_row is not null then
    new.server_seq := (v_existing_row ->> 'server_seq')::bigint;
  else
    new.server_seq := nextval('public.patto_seq');
  end if;
  return new;
end;
$$;

revoke all on function public.patto_touch() from public;

commit;
