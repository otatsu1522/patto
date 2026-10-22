-- Return per-project outcomes so a concurrent restore on another device is not
-- reported as a successful permanent deletion by the initiating client.
drop function if exists public.patto_delete_trashed_projects(uuid, uuid[]);

create function public.patto_delete_trashed_projects(
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

  select coalesce(array_agg(ids.id order by ids.id), array[]::uuid[])
    into requested_ids
    from (
      select distinct unnest(coalesce(p_project_ids, array[]::uuid[])) as id
    ) as ids;

  -- A project restored on another device is protected. Its deletion request is
  -- completed as a conflict outcome, allowing the client to pull the active row.
  -- Lock the requested project rows before deciding whether they can be deleted.
  -- A concurrent restore must either commit first (and be preserved below) or wait
  -- until this deletion transaction finishes; it must not race between the check and DELETE.
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
