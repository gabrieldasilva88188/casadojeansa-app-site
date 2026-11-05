# Gerenciador de Estoque e Vídeos

Sistema de estoque, vídeos do TikTok e vendas da loja.

- **Site:** https://gerenciador-estoque-videos.vercel.app (Vercel; publica sozinho a cada envio para a branch `main`)
- **Banco e login:** Supabase, projeto `gerenciador-estoque-videos` (região São Paulo)

## Acesso

- **Admins master fixos:** Ricardo Ronery (`ricardo@gerenciador.app`) e Márcio House (`marcio@gerenciador.app`).
  Entram com a senha provisória `estoque123` e o sistema obriga a criar uma senha própria no primeiro acesso.
- **Novos colaboradores:** clicam em "Pedir acesso", criam a conta e ficam aguardando. Um admin master aprova
  (ou recusa) na área Admin; quem é aprovado entra como colaborador.
- Qualquer pessoa pode trocar a própria senha pelo menu ("Alterar senha").

## Dados

- **Produtos:** os 239 itens da planilha de estoque (local, nº da prateleira, descrição, peças e fabricante),
  com ID automático (#0001, #0002...).
- **Contas do TikTok:** OFICIAL, RICARDO, SHAMA, SR LORD e IMAGINARIUM.
- Vídeos, vendas e equipe são gravados no banco pelo próprio sistema.

Para atualizar o estoque a partir de uma planilha nova: `python3 tools/importar_planilha.py ESTOQUE.xlsx`
(gera `js/estoque.js` e `supabase/seed.sql`).

## Telas

| Tela | Endereço | O que faz |
|---|---|---|
| Login | `#login` | Entrar com e-mail e senha |
| Pedir acesso | `#cadastro` | Criar conta; fica aguardando a aprovação de um admin master |
| Produtos | `#produtos` | Busca e filtros por local, prateleira, fabricante e conta do TikTok; vídeos e último vídeo de cada peça; botão para abrir a peça no TikTok Shop quando o link está cadastrado |
| Adicionar produto | `#produto-novo` | Local, nº da prateleira, descrição, peças, fabricante e link (opcional); o ID é automático |
| Editar produto | `#produto-editar` | Pergunta "Tem certeza das edições feitas?" com a lista do que muda; se a descrição mudar, confirma o link |
| Vídeos | `#videos` | Registrar vídeo com produto e conta do TikTok; ao escolher o produto, mostra o botão para ver a peça no TikTok Shop (ou o atalho para cadastrar o link); data e hora do sistema gravadas automaticamente |
| Vendas | `#vendas` | Só admin master. Escolhe a conta do TikTok Shop e lança as peças vendidas de cada produto; gráfico de mais e menos vendidos, vídeos x vendas, filtros por conta, mês e semana; editar e excluir vendas |
| Análise | `#analise` | Peças com mais vídeos, há mais tempo sem vídeo, nunca tiveram vídeo, vídeos por conta e semana |
| Admin master | `#admin` | Aprovar ou recusar cadastros, vídeos por pessoa, equipe (mudar cargo para admin, excluir conta; Ricardo e Márcio são fixos) e registros de tudo o que foi feito |

## Estrutura

```
index.html             página principal
styles.css             visual (tema claro e escuro, layout de celular com navegação inferior)
js/config.js           endereço do Supabase e chave pública
js/supa.js             cliente leve do Supabase (login e banco), sem dependências
js/app.js              telas e regras do sistema
js/estoque.js          produtos da planilha (fonte da carga inicial)
supabase/migrations/   esquema do banco (tabelas, segurança, gatilhos e views)
supabase/seed.sql      carga inicial: contas do TikTok, fabricantes e produtos da planilha
supabase/testes/       testes das regras do banco
tools/importar_planilha.py  importa a planilha ESTOQUE.xlsx
tools/testar_banco.sh  testa as regras do banco num PostgreSQL temporário
tools/supabase_local.py     imitação local do Supabase para testar o site sem internet
docs/banco-de-dados.md diagrama e explicação do banco
dist/prototipo.html    versão de demonstração antiga (dados de exemplo, sem banco)
```

## Banco de dados

O banco já está modelado para o Supabase. Veja o diagrama, as regras e o passo a passo de
instalação em [docs/banco-de-dados.md](docs/banco-de-dados.md).

## Próximos passos

1. Desligar a confirmação de e-mail no Supabase (Authentication → Sign In / Providers → Email → Confirm email),
   já que o acesso é liberado pela aprovação do admin.
2. Recuperação de senha por e-mail (precisa de um serviço de envio de e-mails configurado no Supabase).
3. Integração com a API do TikTok Shop (Partner Center, app tipo Custom).
4. App Android com Capacitor.
