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

-- Registration gate for the Before User Created Auth Hook.
-- The real code is stored only as a bcrypt hash in the private schema. Set it
-- in the Supabase SQL Editor after applying this schema; never commit it here.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.registration_gate (
  id smallint primary key default 1 check (id = 1),
  code_hash text not null
);

revoke all on table private.registration_gate from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant select on table private.registration_gate to supabase_auth_admin;
grant usage on schema extensions to supabase_auth_admin;
grant execute on function extensions.crypt(text, text) to supabase_auth_admin;

create or replace function public.hook_require_registration_code(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  submitted_code text := coalesce(event->'user'->'user_metadata'->>'registration_code', '');
  expected_hash text;
begin
  select code_hash into expected_hash
  from private.registration_gate
  where id = 1;

  if expected_hash is null
    or extensions.crypt(submitted_code, expected_hash) <> expected_hash then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', '注册暗号错误。'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

grant execute on function public.hook_require_registration_code(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_require_registration_code(jsonb) from public, anon, authenticated;
