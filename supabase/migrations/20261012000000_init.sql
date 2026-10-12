-- Patto: 初期スキーマ。Supabase の SQL Editor に貼り付けて実行する（または supabase db push）。
-- すべての行は owner_id（= auth.uid()）で保護される（RLS）。ゲスト（匿名ユーザー）も認証済みユーザーとして同じ扱い。

create sequence if not exists public.patto_seq;

-- 同期の差分取得に使う: 書き込みのたびに増える番号
create or replace function public.patto_touch() returns trigger
language plpgsql as $$
begin
  new.server_seq := nextval('public.patto_seq');
  return new;
end;
$$;

-- 端末とサーバーの時計のずれを測るためのサーバー時刻（epoch ms）
create or replace function public.server_time() returns bigint
language sql stable as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;
grant execute on function public.server_time() to authenticated;

create table if not exists public.projects (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  field_updated_at jsonb not null default '{}'::jsonb,
  title text not null,
  description text not null default '',
  color text,
  is_favorite boolean not null default false,
  sort_key text not null,
  archived_at bigint,
  server_seq bigint not null default nextval('public.patto_seq')
);

create table if not exists public.kanban_columns (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  field_updated_at jsonb not null default '{}'::jsonb,
  project_id uuid not null,
  title text not null,
  color text,
  sort_key text not null,
  sort_mode text not null default 'updated',
  is_done_column boolean not null default false,
  server_seq bigint not null default nextval('public.patto_seq')
);

create table if not exists public.tasks (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  field_updated_at jsonb not null default '{}'::jsonb,
  project_id uuid not null,
  column_id uuid not null,
  title text not null,
  description text not null default '',
  color text,
  due_at bigint,
  due_has_time boolean not null default false,
  is_favorite boolean not null default false,
  sort_key text not null,
  completed_at bigint,
  archived_at bigint,
  server_seq bigint not null default nextval('public.patto_seq')
);

-- テーブルとシーケンスに対する権限設定が追加
grant select, insert, update, delete
on public.projects, public.kanban_columns, public.tasks
to authenticated;

grant usage, select on sequence public.patto_seq to authenticated;

-- 親子の外部キーは付けない: 端末ごとに届く順番が違っても同期が止まらないようにするため
create index if not exists projects_owner_seq on public.projects (owner_id, server_seq);
create index if not exists columns_owner_seq on public.kanban_columns (owner_id, server_seq);
create index if not exists tasks_owner_seq on public.tasks (owner_id, server_seq);

create trigger projects_touch before insert or update on public.projects
  for each row execute function public.patto_touch();
create trigger columns_touch before insert or update on public.kanban_columns
  for each row execute function public.patto_touch();
create trigger tasks_touch before insert or update on public.tasks
  for each row execute function public.patto_touch();

-- RLS: 自分（auth.uid()）の行だけ読み書きできる
alter table public.projects enable row level security;
alter table public.kanban_columns enable row level security;
alter table public.tasks enable row level security;

create policy "projects: owner only" on public.projects
  for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "columns: owner only" on public.kanban_columns
  for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "tasks: owner only" on public.tasks
  for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Web 版のリアルタイム反映
alter publication supabase_realtime add table public.projects, public.kanban_columns, public.tasks;
