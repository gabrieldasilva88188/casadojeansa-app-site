-- Define Ricardo e Márcio como admins master fixos.
--
-- Quando rodar: depois que os dois criarem a conta pela tela de cadastro do sistema.
-- Onde rodar: Supabase → SQL Editor (lá o comando roda como responsável técnico,
-- então passa pela proteção que impede o app de mexer em admins fixos).
--
-- Troque os e-mails abaixo pelos e-mails reais que eles usaram no cadastro.

update public.perfis
set papel = 'admin', fixo = true
where email in (
  'ricardo@exemplo.com',   -- Ricardo Ronery
  'marcio@exemplo.com'     -- Márcio House
);

-- Confere o resultado: devem aparecer as duas linhas com papel = admin e fixo = true
select nome, email, papel, fixo from public.perfis where fixo;
