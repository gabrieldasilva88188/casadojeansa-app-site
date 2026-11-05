-- Testes das regras do banco. Rodar com tools/testar_banco.sh (PostgreSQL local).
-- Cada teste imprime "OK: ..." ou para tudo com "FALHOU: ...".
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

-- ---------- Ferramentas de teste ----------
create schema teste;
grant usage on schema teste to authenticated, anon;

-- Roda um comando que DEVE ser barrado (erro ou nenhuma linha afetada)
create function teste.barrado(cmd text, descricao text) returns void
language plpgsql as $$
declare n bigint;
begin
  begin
    execute cmd;
    get diagnostics n = row_count;
  exception when others then
    raise notice 'OK: % (bloqueado: %)', descricao, sqlerrm;
    return;
  end;
  if n > 0 then
    raise exception 'FALHOU: % (deveria ser bloqueado, afetou % linha(s))', descricao, n;
  end if;
  raise notice 'OK: % (nenhuma linha afetada)', descricao;
end $$;

-- Confere uma condição
create function teste.confere(ok boolean, descricao text) returns void
language plpgsql as $$
begin
  if ok is not true then raise exception 'FALHOU: %', descricao; end if;
  raise notice 'OK: %', descricao;
end $$;
grant execute on all functions in schema teste to authenticated, anon;

-- Entra como alguém (simula o login do Supabase)
create function teste.id_de(p_email text) returns text
language sql security definer as $$ select id::text from auth.users where email = p_email $$;
grant execute on function teste.id_de(text) to authenticated, anon;

-- ---------- Equipe (cadastro pelo "app") ----------
insert into auth.users (email, raw_user_meta_data) values
  ('ricardo@exemplo.com', '{"nome": "Ricardo Ronery"}'),
  ('marcio@exemplo.com',  '{"nome": "Márcio House"}'),
  ('ketlin@exemplo.com',  '{"nome": "Ketlin Raiane"}'),
  ('mariana@exemplo.com', '{"nome": "Mariana Cesar"}'),
  ('gustavo@exemplo.com', '{"nome": "Gustavo Fialho"}');

select teste.confere((select count(*) = 5 from public.perfis where papel = 'colaborador'),
  'cadastro cria o perfil automaticamente como colaborador');

-- Responsável técnico define os admins fixos (SQL Editor do Supabase)
\i supabase/definir_admins_fixos.sql
select teste.confere((select count(*) = 2 from public.perfis where fixo and papel = 'admin'),
  'Ricardo e Márcio viram admins master fixos');

-- =====================================================================
-- Cadastro com aprovação
-- =====================================================================
select set_config('request.jwt.claim.sub', teste.id_de('ketlin@exemplo.com'), false);
set role authenticated;
select teste.confere((select count(*) = 0 from public.produtos), 'cadastro aguardando aprovação não vê o estoque');
select teste.confere((select count(*) = 1 from public.perfis), 'cadastro aguardando aprovação vê só o próprio perfil');
select teste.barrado($$ update public.perfis set aprovado = true where email = 'ketlin@exemplo.com' $$,
  'ninguém aprova o próprio cadastro');
reset role;

select set_config('request.jwt.claim.sub', teste.id_de('ricardo@exemplo.com'), false);
set role authenticated;
update public.perfis set aprovado = true
where email in ('ketlin@exemplo.com', 'mariana@exemplo.com', 'gustavo@exemplo.com');
select teste.confere((select count(*) = 3 from public.registros where acao = 'Aprovou cadastro'
                        and usuario_id = teste.id_de('ricardo@exemplo.com')::uuid),
  'admin aprova cadastros e a aprovação entra nos registros');
reset role;

-- Um cadastro recusado
insert into auth.users (email, raw_user_meta_data) values ('intruso@exemplo.com', '{"nome": "Pessoa Desconhecida"}');
select set_config('request.jwt.claim.sub', teste.id_de('marcio@exemplo.com'), false);
set role authenticated;
update public.perfis set ativo = false where email = 'intruso@exemplo.com';
select teste.confere((select count(*) = 1 from public.registros where acao = 'Recusou cadastro'),
  'admin recusa cadastro e a recusa entra nos registros');
reset role;

-- Senha provisória (marcada pelo responsável técnico, sem usuário logado)
select set_config('request.jwt.claim.sub', '', false);
update public.perfis set senha_provisoria = true where fixo;
select set_config('request.jwt.claim.sub', teste.id_de('ketlin@exemplo.com'), false);
set role authenticated;
select teste.barrado($$ update public.perfis set senha_provisoria = false where email = 'ricardo@exemplo.com' $$,
  'só a própria pessoa confirma a troca da senha provisória');
reset role;
select set_config('request.jwt.claim.sub', teste.id_de('ricardo@exemplo.com'), false);
set role authenticated;
update public.perfis set senha_provisoria = false where email = 'ricardo@exemplo.com';
select teste.confere((select not senha_provisoria from public.perfis where email = 'ricardo@exemplo.com'),
  'a própria pessoa confirma que trocou a senha provisória');
select teste.barrado($$ update public.perfis set senha_provisoria = true where email = 'ketlin@exemplo.com' $$,
  'o app não marca senha provisória em ninguém');
reset role;

-- =====================================================================
-- Como COLABORADORA (Ketlin)
-- =====================================================================
select set_config('request.jwt.claim.sub', teste.id_de('ketlin@exemplo.com'), false);
set role authenticated;

select teste.confere((select count(*) = 239 from public.produtos), 'colaborador vê os 239 produtos da planilha');
select teste.confere((select count(*) = 5 from public.contas_tiktok), 'colaborador vê as 5 contas do TikTok');

-- Tenta registrar vídeo com data antiga e em nome de outra pessoa: o servidor corrige
insert into public.videos (produto_id, conta_id, usuario_id, postado_em)
values (1, (select id from public.contas_tiktok where nome = 'SHAMA'),
        teste.id_de('ricardo@exemplo.com')::uuid, '2020-01-01');
select teste.confere(
  (select postado_em > now() - interval '1 minute' and usuario_id = teste.id_de('ketlin@exemplo.com')::uuid
   from public.videos order by id desc limit 1),
  'data/hora e autor do vídeo vêm do servidor, não do celular');

update public.produtos set quantidade = 5, descricao = 'CALCA SARJA BOLSO RELOGIO PRETA' where prateleira = 'A1';
select teste.confere((select quantidade = 5 and atualizado_por = teste.id_de('ketlin@exemplo.com')::uuid
                      from public.produtos where prateleira = 'A1'),
  'colaborador edita produto e fica registrado quem editou');

select teste.confere((select count(*) = 0 from public.registros), 'colaborador não vê os registros');
select teste.barrado($$ update public.perfis set papel = 'admin' where email = 'ketlin@exemplo.com' $$,
  'colaborador não se promove a admin');
select teste.barrado($$ update public.perfis set ativo = false where email = 'mariana@exemplo.com' $$,
  'colaborador não exclui outra conta');
select teste.barrado($$ update public.perfis set nome = 'X' where email = 'mariana@exemplo.com' $$,
  'colaborador não altera o perfil de outra pessoa');
select teste.barrado($$ delete from public.produtos where prateleira = 'A2' $$,
  'colaborador não exclui produto');
select teste.barrado($$ insert into public.registros (acao, tabela, registro_id) values ('x', 'x', 'x') $$,
  'ninguém escreve direto nos registros');
select teste.barrado($$ insert into public.produtos (local, prateleira, descricao) values (1, 'A1', 'repetido') $$,
  'não aceita duas peças na mesma prateleira');
select teste.barrado($$ insert into public.produtos (local, prateleira, descricao) values (1, 'a-1', 'errado') $$,
  'não aceita nº de prateleira fora do padrão');
select teste.barrado($$ insert into public.produtos (local, prateleira, descricao, quantidade) values (1, 'Z1', 'x', -2) $$,
  'não aceita quantidade negativa');

insert into public.produtos (local, prateleira, descricao, quantidade) values (2, 'W4', 'CALCA TESTE', 3);
select teste.confere((select id > 239 from public.produtos where prateleira = 'W4'),
  'produto novo recebe um ID automático depois dos 239 da planilha');

reset role;

-- =====================================================================
-- Como ADMIN MASTER FIXO (Ricardo)
-- =====================================================================
select set_config('request.jwt.claim.sub', teste.id_de('ricardo@exemplo.com'), false);
set role authenticated;

select teste.confere((select count(*) >= 3 from public.registros), 'admin vê os registros');
select teste.confere(
  (select mudancas ? 'quantidade' and mudancas ? 'descricao' from public.registros
   where acao = 'Editou produto' order by id desc limit 1),
  'edição de produto guarda o antes e o depois de cada campo');

update public.perfis set papel = 'admin' where email = 'mariana@exemplo.com';
select teste.confere((select papel = 'admin' from public.perfis where email = 'mariana@exemplo.com'),
  'admin promove colaboradora a admin master');
select teste.confere((select count(*) = 1 from public.registros
                      where acao = 'Alterou cargo' and detalhe like 'Mariana Cesar:%'
                        and usuario_id = teste.id_de('ricardo@exemplo.com')::uuid),
  'mudança de cargo entra nos registros');

update public.perfis set ativo = false where email = 'gustavo@exemplo.com';
select teste.confere((select not ativo and excluido_em is not null from public.perfis where email = 'gustavo@exemplo.com'),
  'admin exclui conta (desativa e guarda a data)');

select teste.barrado($$ update public.perfis set papel = 'colaborador' where email = 'marcio@exemplo.com' $$,
  'admin fixo (Márcio) não perde o cargo');
select teste.barrado($$ update public.perfis set ativo = false where email = 'marcio@exemplo.com' $$,
  'admin fixo (Márcio) não é excluído');
select teste.barrado($$ update public.perfis set papel = 'colaborador' where email = 'ricardo@exemplo.com' $$,
  'ninguém muda o próprio cargo');
select teste.barrado($$ update public.perfis set fixo = true where email = 'mariana@exemplo.com' $$,
  'o app não cria novos admins fixos');
select teste.barrado($$ delete from public.perfis where email = 'ketlin@exemplo.com' $$,
  'perfis nunca são apagados de verdade');
select teste.barrado($$ delete from public.produtos where prateleira = 'A1' $$,
  'produto com vídeo não pode ser apagado (o histórico fica)');

reset role;

-- Mariana (agora admin, não fixa) tenta rebaixar o Ricardo
select set_config('request.jwt.claim.sub', teste.id_de('mariana@exemplo.com'), false);
set role authenticated;
select teste.barrado($$ update public.perfis set papel = 'colaborador' where email = 'ricardo@exemplo.com' $$,
  'outro admin não rebaixa admin fixo');
reset role;

-- =====================================================================
-- Conta excluída (Gustavo) e visitante sem login
-- =====================================================================
select set_config('request.jwt.claim.sub', teste.id_de('gustavo@exemplo.com'), false);
set role authenticated;
select teste.confere((select count(*) = 0 from public.produtos), 'conta excluída não vê mais nada');
select teste.barrado($$ insert into public.videos (produto_id, conta_id) values (2, 1) $$,
  'conta excluída não registra vídeo');
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
select teste.barrado($$ select * from public.produtos $$, 'visitante sem login não acessa o estoque');
reset role;

-- =====================================================================
-- Excluir produto (só admin master; o histórico fica)
-- =====================================================================
select set_config('request.jwt.claim.sub', teste.id_de('ketlin@exemplo.com'), false);
set role authenticated;
select teste.barrado($$ update public.produtos set excluido_em = now() where prateleira = 'A3' $$,
  'colaborador não exclui produto (marcando como excluído)');
reset role;

select set_config('request.jwt.claim.sub', teste.id_de('ricardo@exemplo.com'), false);
set role authenticated;
update public.produtos set excluido_em = now() where prateleira = 'A1';
select teste.confere((select excluido_em is not null and excluido_por = teste.id_de('ricardo@exemplo.com')::uuid
                      from public.produtos where id = 1),
  'admin exclui produto com vídeo; a linha continua para o histórico');
select teste.confere((select count(*) = 1 from public.registros where acao = 'Excluiu produto'),
  'exclusão de produto entra nos registros');
select teste.confere((select count(*) = 1 from public.videos where produto_id = 1),
  'vídeos do produto excluído continuam no histórico');
insert into public.produtos (local, prateleira, descricao, quantidade) values (1, 'A1', 'PECA NOVA NA A1', 2);
select teste.confere((select count(*) = 2 from public.produtos where prateleira = 'A1'),
  'a prateleira do produto excluído fica livre para outra peça');
select teste.barrado($$ insert into public.videos (produto_id, conta_id) values (1, 1) $$,
  'não registra vídeo de produto excluído');
select teste.barrado($$ update public.produtos set quantidade = 9 where id = 1 $$,
  'produto excluído não pode ser editado');
update public.produtos set excluido_em = null where prateleira = 'A1' and descricao = 'PECA NOVA NA A1';
reset role;

-- =====================================================================
-- Vendas (só admin master)
-- =====================================================================
select set_config('request.jwt.claim.sub', teste.id_de('ketlin@exemplo.com'), false);
set role authenticated;
select teste.barrado($$ insert into public.vendas (produto_id, conta_id, quantidade) values (1, 1, 2) $$,
  'colaborador não lança venda');
reset role;

select set_config('request.jwt.claim.sub', teste.id_de('ricardo@exemplo.com'), false);
set role authenticated;
insert into public.vendas (produto_id, conta_id, quantidade, vendido_em)
values (2, (select id from public.contas_tiktok where nome = 'SHAMA'), 3, current_date - 1);
select teste.confere((select count(*) = 1 and bool_and(criado_por = teste.id_de('ricardo@exemplo.com')::uuid) from public.vendas),
  'admin lança venda e fica registrado quem lançou');
update public.vendas set quantidade = 4 where produto_id = 2;
select teste.confere((select quantidade = 4 from public.vendas where produto_id = 2), 'admin edita venda');
select teste.confere((select mudancas -> 'quantidade' ->> 'para' = '4' from public.registros
                      where acao = 'Editou venda' order by id desc limit 1),
  'edição de venda entra nos registros com o antes e o depois');
select teste.confere((select sum(pecas_vendidas) = 4 from public.v_vendas_semana where conta = 'SHAMA' and prateleira = 'A2'),
  'v_vendas_semana: peças vendidas por produto, conta e semana');
select teste.barrado($$ insert into public.vendas (produto_id, conta_id, quantidade) values (1, 1, 0) $$,
  'venda precisa ter pelo menos 1 peça');
select teste.barrado($$ insert into public.vendas (produto_id, conta_id, quantidade, vendido_em) values (1, 1, 1, current_date + 10) $$,
  'venda não pode ter data no futuro');
delete from public.vendas where produto_id = 2;
select teste.confere((select count(*) = 0 from public.vendas) and
                     (select count(*) = 1 from public.registros where acao = 'Excluiu venda'),
  'admin exclui venda e a exclusão fica nos registros');
reset role;

select set_config('request.jwt.claim.sub', teste.id_de('ketlin@exemplo.com'), false);
set role authenticated;
select teste.confere((select count(*) = 0 from public.vendas), 'colaborador não vê vendas');
reset role;

-- =====================================================================
-- Views de análise
-- =====================================================================
select set_config('request.jwt.claim.sub', teste.id_de('ricardo@exemplo.com'), false);
set role authenticated;
select teste.confere((select count(*) = 1 and bool_and(total_videos = 0 and descricao = 'PECA NOVA NA A1')
                      from public.v_produtos_resumo where prateleira = 'A1'),
  'v_produtos_resumo: mostra só o produto ativo da prateleira A1');
select teste.confere((select count(*) = 0 from public.v_produtos_resumo where id = 1),
  'v_produtos_resumo: produto excluído não aparece');
select teste.confere((select sum(videos) = 1 from public.v_videos_semana where conta = 'SHAMA'),
  'v_videos_semana: vídeo contado na conta e semana certas');
select teste.confere((select videos_7_dias = 1 from public.v_videos_por_pessoa where nome = 'Ketlin Raiane'),
  'v_videos_por_pessoa: vídeos da Ketlin nos últimos 7 dias');
reset role;

\o
\echo
\echo 'Todos os testes passaram.'
