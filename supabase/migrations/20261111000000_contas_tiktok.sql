-- =====================================================================
-- Contas do TikTok: admin master adiciona, edita, exclui e restaura
-- =====================================================================
-- "Excluir" marca a conta como inativa (ativa = false): ela sai das listas
-- de escolha, mas os vídeos e as vendas já lançados nela continuam com o
-- nome certo no histórico e nos gráficos.
-- =====================================================================

-- Nome sempre em maiúsculas e sem espaços sobrando; nunca fica sem nenhuma conta ativa
create or replace function privado.proteger_conta_tiktok()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.nome := upper(regexp_replace(btrim(new.nome), '\s+', ' ', 'g'));
  if new.nome = '' then
    raise exception 'Digite o nome da conta.';
  end if;
  if tg_op = 'UPDATE' and old.ativa and not new.ativa
     and not exists (select 1 from public.contas_tiktok where ativa and id <> new.id) then
    raise exception 'Mantenha pelo menos uma conta ativa.';
  end if;
  return new;
end;
$$;

create trigger proteger_conta_tiktok
  before insert or update on public.contas_tiktok
  for each row execute function privado.proteger_conta_tiktok();

-- Vídeo ou venda novos só em conta ativa (os antigos continuam como estão)
create or replace function privado.bloquear_conta_inativa()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_nome text;
begin
  if tg_op = 'UPDATE' and new.conta_id = old.conta_id then
    return new;
  end if;
  select nome into v_nome from public.contas_tiktok where id = new.conta_id and not ativa;
  if found then
    raise exception 'A conta % foi excluída. Escolha outra conta.', v_nome;
  end if;
  return new;
end;
$$;

create trigger bloquear_conta_inativa before insert or update on public.videos
  for each row execute function privado.bloquear_conta_inativa();
create trigger bloquear_conta_inativa before insert or update on public.vendas
  for each row execute function privado.bloquear_conta_inativa();

-- Histórico: "Adicionou conta TikTok", "Renomeou conta TikTok", "Excluiu conta TikTok", "Restaurou conta TikTok"
-- (mudar só a ordem de exibição não entra no histórico)
create or replace function privado.registrar_conta_tiktok()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.registros (usuario_id, acao, tabela, registro_id, detalhe)
    values ((select auth.uid()), 'Adicionou conta TikTok', 'contas_tiktok', new.id::text, new.nome);
    return new;
  end if;
  if new.nome <> old.nome then
    insert into public.registros (usuario_id, acao, tabela, registro_id, detalhe, mudancas)
    values ((select auth.uid()), 'Renomeou conta TikTok', 'contas_tiktok', new.id::text,
            old.nome || ' → ' || new.nome,
            jsonb_build_object('nome', jsonb_build_object('de', old.nome, 'para', new.nome)));
  end if;
  if new.ativa <> old.ativa then
    insert into public.registros (usuario_id, acao, tabela, registro_id, detalhe)
    values ((select auth.uid()),
            case when new.ativa then 'Restaurou conta TikTok' else 'Excluiu conta TikTok' end,
            'contas_tiktok', new.id::text, new.nome);
  end if;
  return new;
end;
$$;

create trigger registrar_conta_tiktok
  after insert or update on public.contas_tiktok
  for each row execute function privado.registrar_conta_tiktok();

revoke all on function privado.proteger_conta_tiktok(), privado.bloquear_conta_inativa(),
  privado.registrar_conta_tiktok() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function privado.proteger_conta_tiktok(), privado.bloquear_conta_inativa(),
      privado.registrar_conta_tiktok() from anon';
  end if;
end $$;
