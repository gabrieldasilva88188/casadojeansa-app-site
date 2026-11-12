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
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  encrypted_password text,
  updated_at         timestamptz
);

-- Login por e-mail, sessões e tokens (só as colunas que as regras usam)
create table auth.identities (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  provider      text not null default 'email',
  provider_id   text,
  identity_data jsonb not null default '{}'::jsonb
);
create table auth.sessions (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade
);
create table auth.refresh_tokens (
  id         bigserial primary key,
  user_id    varchar(255),
  session_id uuid references auth.sessions (id) on delete cascade,
  token      text
);

-- No Supabase, crypt() e gen_salt() ficam no schema extensions
create schema extensions;
create extension pgcrypto schema extensions;
grant usage on schema extensions to anon, authenticated;

-- No Supabase, auth.uid() lê o usuário do token de login; aqui lê de uma configuração da sessão
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
