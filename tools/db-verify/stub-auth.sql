-- Minimal Supabase stub for local verification of 001_initial_schema.sql
-- Provides: roles (anon/authenticated/service_role), auth schema,
-- auth.users table, auth.uid() reading the standard Supabase claim setting.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
