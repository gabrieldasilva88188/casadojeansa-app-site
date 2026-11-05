-- =====================================================================
-- Excluir produto (só admin master)
-- =====================================================================
-- O produto sai da lista e a posição da prateleira fica livre para outra
-- peça, mas a linha continua no banco para que os vídeos, as vendas e o
-- histórico ligados a ele não se percam.
-- =====================================================================

alter table public.produtos
  add column excluido_em  timestamptz,
  add column excluido_por uuid references public.perfis (id);
create index produtos_excluido_por_idx on public.produtos (excluido_por);

-- A prateleira só precisa ser única entre os produtos que não foram excluídos
alter table public.produtos drop constraint produtos_prateleira_key;
create unique index produtos_prateleira_ativa_key on public.produtos (prateleira) where excluido_em is null;

-- Só admin master exclui ou restaura; data e autor definidos pelo servidor
create or replace function privado.proteger_produto()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.excluido_em is distinct from old.excluido_em then
    if (select auth.uid()) is not null and not privado.eh_admin() then
      raise exception 'Só admin master pode excluir produtos.';
    end if;
    if new.excluido_em is not null then
      new.excluido_em := now();
      new.excluido_por := (select auth.uid());
    else
      new.excluido_por := null;
    end if;
  elsif old.excluido_em is not null and (select auth.uid()) is not null then
    raise exception 'Este produto foi excluído e não pode ser editado.';
  end if;
  return new;
end;
$$;

create trigger proteger_produto
  before update on public.produtos
  for each row execute function privado.proteger_produto();

-- Não registra vídeo nem venda de produto excluído
create or replace function privado.bloquear_produto_excluido()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.produtos where id = new.produto_id and excluido_em is not null) then
    raise exception 'Este produto foi excluído.';
  end if;
  return new;
end;
$$;

create trigger bloquear_produto_excluido before insert on public.videos
  for each row execute function privado.bloquear_produto_excluido();
create trigger bloquear_produto_excluido before insert or update on public.vendas
  for each row execute function privado.bloquear_produto_excluido();

-- Histórico: "Excluiu produto" / "Restaurou produto"
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
    elsif new.excluido_em is distinct from old.excluido_em then
      v_acao := case when new.excluido_em is not null then 'Excluiu produto' else 'Restaurou produto' end;
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

-- A view de resumo mostra só os produtos que não foram excluídos
create or replace view public.v_produtos_resumo
with (security_invoker = true) as
select
  p.id,
  '#' || lpad(p.id::text, 4, '0')                     as id_exibicao,
  p.local,
  p.prateleira,
  p.descricao,
  p.quantidade,
  f.nome                                              as fabricante,
  p.link_tiktok,
  p.criado_em,
  count(v.id)                                         as total_videos,
  count(v.id) filter (where v.postado_em >= now() - interval '30 days') as videos_30_dias,
  max(v.postado_em)                                   as ultimo_video,
  extract(day from now() - coalesce(max(v.postado_em), p.criado_em))::int as dias_sem_video
from public.produtos p
left join public.fabricantes f on f.id = p.fabricante_id
left join public.videos v      on v.produto_id = p.id
where p.excluido_em is null
group by p.id, f.nome;

revoke all on function privado.proteger_produto(), privado.bloquear_produto_excluido(), privado.registrar_alteracao() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function privado.proteger_produto(), privado.bloquear_produto_excluido() from anon';
  end if;
end $$;
