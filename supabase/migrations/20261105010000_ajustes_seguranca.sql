-- =====================================================================
-- Ajustes de segurança e desempenho (recomendações do Supabase)
-- =====================================================================
-- As funções internas (permissões e gatilhos) saem do schema public, que é
-- exposto pela API, e vão para o schema "privado". Assim ninguém consegue
-- chamá-las pela internet; as regras de segurança e os gatilhos continuam
-- usando as mesmas funções normalmente.
-- =====================================================================

create schema if not exists privado;
revoke all on schema privado from public;
grant usage on schema privado to authenticated;

alter function public.usuario_ativo()             set schema privado;
alter function public.eh_admin()                  set schema privado;
alter function public.criar_perfil_novo_usuario() set schema privado;
alter function public.proteger_perfil()           set schema privado;
alter function public.registrar_alteracao()       set schema privado;
alter function public.registrar_venda()           set schema privado;
alter function public.carimbar_produto()          set schema privado;
alter function public.carimbar_video()            set schema privado;
alter function public.carimbar_venda()            set schema privado;

-- Só quem está logado usa as funções de permissão (dentro das regras de RLS)
revoke all on all functions in schema privado from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all functions in schema privado from anon';
  end if;
end $$;
-- O serviço de login do Supabase dispara o gatilho de criação de perfil
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema privado to supabase_auth_admin';
    execute 'grant execute on function privado.criar_perfil_novo_usuario() to supabase_auth_admin';
  end if;
end $$;
grant execute on function privado.usuario_ativo() to authenticated;
grant execute on function privado.eh_admin()      to authenticated;

-- proteger_perfil chama eh_admin pelo nome: atualiza para o novo schema
create or replace function privado.proteger_perfil()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  quem uuid := (select auth.uid());
begin
  if quem is null then
    return new;
  end if;
  if new.id <> old.id or new.email <> old.email or new.criado_em <> old.criado_em then
    raise exception 'Esses dados do perfil não podem ser alterados pelo sistema.';
  end if;
  if new.fixo <> old.fixo then
    raise exception 'Só o responsável técnico pode definir admins master fixos.';
  end if;
  if old.fixo and (new.papel <> 'admin' or not new.ativo) then
    raise exception '% é admin master fixo: o cargo não muda e a conta não pode ser excluída.', old.nome;
  end if;
  if old.id = quem and (new.papel <> old.papel or new.ativo <> old.ativo) then
    raise exception 'Você não pode mudar o próprio cargo nem excluir a própria conta.';
  end if;
  if (new.papel <> old.papel or new.ativo <> old.ativo) and not privado.eh_admin() then
    raise exception 'Só admin master pode mudar cargos e excluir contas.';
  end if;
  if old.id <> quem and not privado.eh_admin() then
    raise exception 'Você só pode alterar o seu próprio perfil.';
  end if;
  if old.ativo and not new.ativo then
    new.excluido_em := now();
  elsif new.ativo and not old.ativo then
    new.excluido_em := null;
  end if;
  return new;
end;
$$;

-- Índices nas colunas de "quem criou / quem alterou"
create index if not exists produtos_criado_por_idx     on public.produtos (criado_por);
create index if not exists produtos_atualizado_por_idx on public.produtos (atualizado_por);
create index if not exists vendas_criado_por_idx       on public.vendas (criado_por);
create index if not exists vendas_atualizado_por_idx   on public.vendas (atualizado_por);
