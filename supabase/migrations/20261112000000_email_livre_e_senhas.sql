-- =====================================================================
-- 1) O e-mail de uma conta excluída (ou cadastro recusado) fica livre
--    para um cadastro novo.
-- 2) Admin master redefine a senha de outra pessoa (senha provisória).
-- =====================================================================
-- Como funciona o item 1: ao excluir, o perfil continua com o e-mail
-- (o histórico mostra quem fez cada coisa), mas o login (auth.users) passa
-- para um endereço interno "excluido-<id>@conta-excluida.invalid". Assim o
-- Supabase aceita um cadastro novo com o e-mail original. Ao reativar, o
-- login volta para o e-mail original, se ninguém tiver usado ele depois.
-- =====================================================================

-- E-mail único só entre as contas que não foram excluídas
alter table public.perfis drop constraint if exists perfis_email_key;
create unique index if not exists perfis_email_ativo_key on public.perfis (lower(email)) where ativo;

create or replace function privado.liberar_email_conta()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_livre text := 'excluido-' || new.id || '@conta-excluida.invalid';
begin
  if old.ativo and not new.ativo then
    update auth.users set email = v_livre, updated_at = now() where id = new.id;
    update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_livre))
      where user_id = new.id and provider = 'email';
    -- tira a pessoa do sistema em todos os aparelhos
    delete from auth.sessions where user_id = new.id;
    delete from auth.refresh_tokens where user_id = new.id::text;
  elsif new.ativo and not old.ativo then
    if exists (select 1 from auth.users where lower(email) = lower(new.email) and id <> new.id) then
      raise exception 'O e-mail % já foi usado em um cadastro novo. Use a conta nova dessa pessoa.', new.email;
    end if;
    update auth.users set email = new.email, updated_at = now() where id = new.id;
    update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(new.email))
      where user_id = new.id and provider = 'email';
  end if;
  return new;
end;
$$;

create trigger liberar_email_conta
  before update of ativo on public.perfis
  for each row execute function privado.liberar_email_conta();

-- Contas que já estavam excluídas: libera o e-mail delas agora
update auth.users u set email = 'excluido-' || u.id || '@conta-excluida.invalid', updated_at = now()
  from public.perfis p
 where p.id = u.id and not p.ativo and u.email not like 'excluido-%@conta-excluida.invalid';
update auth.identities i set identity_data = jsonb_set(i.identity_data, '{email}', to_jsonb('excluido-' || i.user_id || '@conta-excluida.invalid'))
  from public.perfis p
 where p.id = i.user_id and not p.ativo and i.provider = 'email';
delete from auth.sessions s using public.perfis p where p.id = s.user_id and not p.ativo;
delete from auth.refresh_tokens t using public.perfis p where p.id::text = t.user_id and not p.ativo;

-- ---------------------------------------------------------------------
-- 2) Redefinir senha (admin master)
-- ---------------------------------------------------------------------
-- proteger_perfil: igual à versão anterior, mais a exceção para a função
-- redefinir_senha marcar "senha provisória" (ninguém mais marca pelo app)
create or replace function privado.proteger_perfil()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  quem uuid := (select auth.uid());
begin
  if quem is null then
    return new;   -- painel / SQL Editor
  end if;
  if new.id <> old.id or new.email <> old.email or new.criado_em <> old.criado_em then
    raise exception 'Esses dados do perfil não podem ser alterados pelo sistema.';
  end if;
  if new.fixo <> old.fixo then
    raise exception 'Só o responsável técnico pode definir admins master fixos.';
  end if;
  if old.fixo and (new.papel <> 'admin' or not new.ativo or not new.aprovado) then
    raise exception '% é admin master fixo: o cargo não muda e a conta não pode ser excluída.', old.nome;
  end if;
  if old.id = quem and (new.papel <> old.papel or new.ativo <> old.ativo or new.aprovado <> old.aprovado) then
    raise exception 'Você não pode mudar o próprio cargo, aprovar ou excluir a própria conta.';
  end if;
  if (new.papel <> old.papel or new.ativo <> old.ativo or new.aprovado <> old.aprovado)
     and not privado.eh_admin() then
    raise exception 'Só admin master pode aprovar cadastros, mudar cargos e excluir contas.';
  end if;
  if old.id <> quem and not privado.eh_admin() then
    raise exception 'Você só pode alterar o seu próprio perfil.';
  end if;
  -- senha provisória: só a própria pessoa desmarca; só redefinir_senha marca
  if new.senha_provisoria <> old.senha_provisoria
     and not (new.senha_provisoria and coalesce(current_setting('gev.redefinindo_senha', true), '') = 'sim')
     and (old.id <> quem or new.senha_provisoria) then
    raise exception 'Só a própria pessoa pode confirmar a troca da senha.';
  end if;

  if old.ativo and not new.ativo then
    new.excluido_em := now();
  elsif new.ativo and not old.ativo then
    new.excluido_em := null;
  end if;
  if new.aprovado and not old.aprovado then
    new.aprovado_em := now();
  end if;
  return new;
end;
$$;

-- Admin master define uma senha provisória para outra pessoa.
-- A pessoa sai de todos os aparelhos e, ao entrar com essa senha,
-- o site pede para ela criar uma senha só dela.
-- (Ninguém consegue VER a senha de ninguém: o Supabase guarda só um código embaralhado.)
create or replace function public.redefinir_senha(p_usuario uuid, p_senha text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_nome text;
begin
  if not privado.eh_admin() then
    raise exception 'Só admin master pode redefinir a senha de outra pessoa.';
  end if;
  if p_usuario = (select auth.uid()) then
    raise exception 'Para trocar a sua própria senha, use "Alterar senha".';
  end if;
  if length(coalesce(p_senha, '')) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.';
  end if;
  select nome into v_nome from public.perfis where id = p_usuario and ativo;
  if not found then
    raise exception 'Essa conta não existe ou foi excluída.';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')), updated_at = now()
   where id = p_usuario;
  perform set_config('gev.redefinindo_senha', 'sim', true);
  update public.perfis set senha_provisoria = true where id = p_usuario;
  perform set_config('gev.redefinindo_senha', '', true);
  delete from auth.sessions where user_id = p_usuario;
  delete from auth.refresh_tokens where user_id = p_usuario::text;

  insert into public.registros (usuario_id, acao, tabela, registro_id, detalhe)
  values ((select auth.uid()), 'Redefiniu senha', 'perfis', p_usuario::text, v_nome);
end;
$$;

revoke all on function public.redefinir_senha(uuid, text) from public;
revoke all on function privado.liberar_email_conta() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.redefinir_senha(uuid, text) from anon';
    execute 'revoke all on function privado.liberar_email_conta() from anon';
  end if;
end $$;
grant execute on function public.redefinir_senha(uuid, text) to authenticated;
