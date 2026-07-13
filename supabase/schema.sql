create table if not exists public.user_vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ciphertext text not null,
  revision bigint not null default 1 check (revision > 0),
  schema_version integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.user_vaults enable row level security;
alter table public.user_vaults force row level security;

revoke all on table public.user_vaults from anon;
grant select, insert, update, delete on table public.user_vaults to authenticated;

create policy "vault_select_own"
  on public.user_vaults for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "vault_insert_own"
  on public.user_vaults for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "vault_update_own"
  on public.user_vaults for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "vault_delete_own"
  on public.user_vaults for delete
  to authenticated
  using ((select auth.uid()) = user_id);

