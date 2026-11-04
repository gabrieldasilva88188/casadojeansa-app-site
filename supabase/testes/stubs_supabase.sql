-- Só para testar localmente num PostgreSQL comum.
-- Imita o mínimo do Supabase que o esquema usa: papéis, schema auth, auth.users e auth.uid().
-- NÃO rode isto no Supabase de verdade.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique not null,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- No Supabase, auth.uid() lê o usuário do token de login; aqui lê de uma configuração da sessão
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
