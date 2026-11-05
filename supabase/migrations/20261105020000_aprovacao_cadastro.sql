-- =====================================================================
-- Cadastro com aprovação do admin master + senha provisória
-- =====================================================================
-- * Toda conta nova nasce "aguardando aprovação": não vê nem altera nada.
-- * Só admin master aprova (aprovado = true) ou recusa (ativo = false).
-- * senha_provisoria = true obriga a pessoa a criar a própria senha no
--   primeiro acesso; só ela mesma pode desmarcar.
-- =====================================================================

alter table public.perfis
  add column aprovado boolean not null default false,
  add column aprovado_em timestamptz,
  add column senha_provisoria boolean not null default false;

-- admins fixos estão sempre aprovados
update public.perfis set aprovado = true, aprovado_em = now() where fixo;
alter table public.perfis add constraint fixo_sempre_aprovado check (not fixo or aprovado);

-- Conta ativa = não excluída E aprovada
create or replace function privado.usuario_ativo()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
    where id = (select auth.uid()) and ativo and aprovado
  );
$$;

create or replace function privado.eh_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.perfis
    where id = (select auth.uid()) and ativo and aprovado and papel = 'admin'
  );
$$;

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
  -- senha provisória: só a própria pessoa desmarca, e ninguém marca pelo app
  if new.senha_provisoria <> old.senha_provisoria and (old.id <> quem or new.senha_provisoria) then
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

-- Histórico: inclui aprovação e recusa de cadastro
create or replace function privado.registrar_alteracao()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_acao     text;
  v_detalhe  text := '';
  v_mudancas jsonb;
  v_antes    jsonb;
  v_depois   jsonb;
  v_campos   text[];
  v_campo    text;
  v_prod     record;
  v_conta    text;
begin
  if tg_table_name = 'produtos' then
    if tg_op = 'INSERT' then
      v_acao := 'Adicionou produto';
      v_detalhe := new.prateleira || ' ' || new.descricao || ' (ID #' || lpad(new.id::text, 4, '0') || ')';
    else
      v_antes  := to_jsonb(old);
      v_depois := to_jsonb(new);
      v_campos := array['local', 'prateleira', 'descricao', 'quantidade', 'fabricante_id', 'link_tiktok'];
      v_mudancas := '{}'::jsonb;
      foreach v_campo in array v_campos loop
        if v_antes -> v_campo is distinct from v_depois -> v_campo then
          v_mudancas := v_mudancas || jsonb_build_object(
            v_campo, jsonb_build_object('de', v_antes -> v_campo, 'para', v_depois -> v_campo));
        end if;
      end loop;
      if v_mudancas = '{}'::jsonb then
        return new;
      end if;
      v_acao := 'Editou produto';
      v_detalhe := old.prateleira || ': ' || (
        select string_agg(k, ', ' order by k) from jsonb_object_keys(v_mudancas) as k);
    end if;
    insert into public.registros (usuario_id, acao, tabela, registro_id, detalhe, mudancas)
    values ((select auth.uid()), v_acao, 'produtos', new.id::text, v_detalhe, v_mudancas);

  elsif tg_table_name = 'videos' then
    select p.prateleira, p.descricao into v_prod from public.produtos p where p.id = new.produto_id;
    select c.nome into v_conta from public.contas_tiktok c where c.id = new.conta_id;
    insert into public.registros (usuario_id, acao, tabela, registro_id, detalhe)
    values (new.usuario_id, 'Registrou vídeo', 'videos', new.id::text,
            v_prod.prateleira || ' ' || v_prod.descricao || ' na conta ' || v_conta);

  elsif tg_table_name = 'perfis' then
    if tg_op = 'INSERT' then
      insert into public.registros (usuario_id, acao, tabela, registro_id, detalhe)
      values (new.id, 'Criou conta', 'perfis', new.id::text, new.nome || ' (' || new.email || '), aguardando aprovação');
    else
      if new.aprovado and not old.aprovado then
        insert into public.registros (usuario_id, acao, tabela, registro_id, detalhe)
        values ((select auth.uid()), 'Aprovou cadastro', 'perfis', new.id::text, new.nome || ' (' || new.email || ')');
      end if;
      if new.papel <> old.papel then
        insert into public.registros (usuario_id, acao, tabela, registro_id, detalhe, mudancas)
        values ((select auth.uid()), 'Alterou cargo', 'perfis', new.id::text,
                new.nome || ': ' || replace(old.papel::text, 'admin', 'admin master') || ' → ' ||
                replace(new.papel::text, 'admin', 'admin master'),
                jsonb_build_object('papel', jsonb_build_object('de', old.papel, 'para', new.papel)));
      end if;
      if old.ativo and not new.ativo then
        insert into public.registros (usuario_id, acao, tabela, registro_id, detalhe)
        values ((select auth.uid()), case when old.aprovado then 'Excluiu conta' else 'Recusou cadastro' end,
                'perfis', new.id::text, new.nome || ' (' || new.email || ')');
      elsif new.ativo and not old.ativo then
        insert into public.registros (usuario_id, acao, tabela, registro_id, detalhe)
        values ((select auth.uid()), 'Reativou conta', 'perfis', new.id::text, new.nome || ' (' || new.email || ')');
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function privado.registrar_alteracao(), privado.proteger_perfil() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function privado.registrar_alteracao(), privado.proteger_perfil(), privado.usuario_ativo(), privado.eh_admin() from anon';
  end if;
end $$;
grant execute on function privado.usuario_ativo(), privado.eh_admin() to authenticated;

-- Colunas que o app pode alterar no perfil (o gatilho decide quem pode o quê)
revoke update on public.perfis from authenticated;
grant update (nome, papel, ativo, aprovado, senha_provisoria) on public.perfis to authenticated;
