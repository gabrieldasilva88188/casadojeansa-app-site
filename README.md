# Gerenciador de Estoque e Vídeos

Protótipo navegável do site, feito para apresentar ao cliente. Ainda **não tem backend nem conexão com a API do TikTok Shop**.

- **Produtos**: os 239 itens reais da planilha de estoque da loja (local, nº da prateleira, descrição, quantidade de peças e fabricante).
- **Equipe**: Ricardo Ronery e Márcio House (admins master fixos), Ketlin Raiane, Mariana Cesar, Gustavo Fialho, Dil Ferreira e Nicoli Nayara. Os e-mails são de exemplo.
- **Vídeos e vendas**: exemplos para a demonstração.
- **ID dos produtos**: criado automaticamente, em sequência (#0001, #0002...).
- **Contas do TikTok**: OFICIAL, RICARDO, SHAMA, SR LORD e IMAGINARIUM, como na planilha.

Para atualizar o estoque a partir de uma planilha nova: `python3 tools/importar_planilha.py ESTOQUE.xlsx` (gera `js/estoque.js` e `supabase/seed.sql`).

## Como abrir

Não precisa instalar nada: abra o `index.html` no navegador. Para publicar, ative o **GitHub Pages** no repositório (Settings → Pages → branch `main`, pasta raiz).

Na tela de login há três atalhos de demonstração: **Admin master (Ricardo)**, **Admin master (Márcio)** e **Colaboradora (Ketlin)**. As alterações feitas na demonstração ficam salvas só no navegador; o botão "Restaurar dados de exemplo" (tela Admin) volta ao estado inicial.

## Telas

| Tela | Endereço | O que faz |
|---|---|---|
| Login | `#login` | Entrar com e-mail e senha ou com um perfil de demonstração |
| Cadastro | `#cadastro` | Criar conta de colaborador |
| Produtos | `#produtos` | Busca e filtros por local, prateleira, fabricante e conta do TikTok; vídeos e último vídeo de cada peça; botão para abrir a peça no TikTok Shop quando o link está cadastrado |
| Adicionar produto | `#produto-novo` | Local, nº da prateleira, descrição, peças, fabricante e link (opcional); o ID é automático |
| Editar produto | `#produto-editar` | Pergunta "Tem certeza das edições feitas?" com a lista do que muda; se a descrição mudar, confirma o link |
| Vídeos | `#videos` | Registrar vídeo com produto e conta do TikTok; ao escolher o produto, mostra o botão para ver a peça no TikTok Shop (ou o atalho para cadastrar o link); data e hora do sistema gravadas automaticamente |
| Vendas | `#vendas` | Só admin master. Escolhe a conta do TikTok Shop e lança as peças vendidas de cada produto; gráfico de mais e menos vendidos, vídeos x vendas, filtros por conta, mês e semana; editar e excluir vendas |
| Análise | `#analise` | Peças com mais vídeos, há mais tempo sem vídeo, nunca tiveram vídeo, vídeos por conta e semana |
| Admin master | `#admin` | Vídeos por pessoa, equipe (mudar cargo para admin, excluir conta; Ricardo e Márcio são fixos) e registros de tudo o que foi feito |

## Estrutura

```
index.html            página principal
styles.css            visual (tema claro e escuro, layout de celular com navegação inferior)
js/estoque.js         produtos importados da planilha da loja
js/data.js            contas do TikTok, equipe e vídeos de exemplo
js/app.js             telas, navegação e regras do protótipo
tools/importar_planilha.py importa a planilha ESTOQUE.xlsx para js/estoque.js e supabase/seed.sql
tools/build_single.py gera dist/prototipo.html, versão em arquivo único para demonstração
tools/testar_banco.sh  testa o banco num PostgreSQL temporário
supabase/migrations/   esquema do banco (tabelas, segurança, gatilhos e views)
supabase/seed.sql      carga inicial: contas do TikTok, fabricantes e produtos da planilha
supabase/definir_admins_fixos.sql  torna Ricardo e Márcio admins master fixos
docs/banco-de-dados.md diagrama e explicação do banco
```

## Banco de dados

O banco já está modelado para o Supabase. Veja o diagrama, as regras e o passo a passo de
instalação em [docs/banco-de-dados.md](docs/banco-de-dados.md).

## Próximos passos

1. Criar o projeto no **Supabase** e aplicar o esquema e a carga inicial ([docs/banco-de-dados.md](docs/banco-de-dados.md)).
2. Trocar `js/data.js` pelas chamadas ao banco; cada "salvar" do `app.js` vira uma gravação.
3. Migrar as telas para React (Vite ou Next.js) reaproveitando o visual deste protótipo.
4. Criar o app no **TikTok Shop Partner Center** (tipo Custom) e a sincronização de pedidos e desempenho de vídeos.
5. Empacotar como app Android com **Capacitor**.
