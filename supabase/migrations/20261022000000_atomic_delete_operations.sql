-- Atomic server-side deletion helpers for project trash cleanup and full data reset.
-- Functions run as the caller and are additionally bound to auth.uid() = p_owner_id.

create or replace function public.patto_delete_trashed_projects(
  p_owner_id uuid,
  p_project_ids uuid[]
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_ids uuid[];
  deleted_count integer := 0;
begin
  if auth.uid() is null or auth.uid() is distinct from p_owner_id then
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  -- Projects that are still active on the server are not deleted by a stale trash action.
  -- Missing parent rows are included to clean up orphans left by an older partial deletion.
  select array_agg(requested.id)
    into target_ids
    from (
      select distinct unnest(coalesce(p_project_ids, array[]::uuid[])) as id
    ) as requested
   where not exists (
     select 1
       from public.projects p
      where p.id = requested.id
        and p.owner_id = p_owner_id
        and p.deleted_at is null
   );

  if coalesce(cardinality(target_ids), 0) = 0 then
    return 0;
  end if;

  delete from public.tasks
   where owner_id = p_owner_id and project_id = any(target_ids);
  delete from public.kanban_columns
   where owner_id = p_owner_id and project_id = any(target_ids);
  delete from public.projects
   where owner_id = p_owner_id and id = any(target_ids);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.patto_delete_all_owned_data(
  p_owner_id uuid
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() is distinct from p_owner_id then
    raise exception 'Permission denied' using errcode = '42501';
  end if;

  -- A single RPC is one PostgreSQL transaction. If any statement fails, all three deletes roll back.
  delete from public.tasks where owner_id = p_owner_id;
  delete from public.kanban_columns where owner_id = p_owner_id;
  delete from public.projects where owner_id = p_owner_id;
end;
$$;

revoke all on function public.patto_delete_trashed_projects(uuid, uuid[]) from public;
revoke all on function public.patto_delete_all_owned_data(uuid) from public;
grant execute on function public.patto_delete_trashed_projects(uuid, uuid[]) to authenticated;
grant execute on function public.patto_delete_all_owned_data(uuid) to authenticated;
