# Gerenciador de Estoque e Vídeos

Protótipo navegável do site, feito para apresentar ao cliente. Ainda **não tem backend nem conexão com a API do TikTok Shop**.

- **Produtos**: os 239 itens reais da planilha de estoque da loja (local, nº da prateleira, descrição, quantidade de peças e fabricante).
- **Equipe**: Ricardo Ronery e Márcio House (admins master fixos), Ketlin Raiane, Mariana Cesar, Gustavo Fialho, Dil Ferreira e Nicoli Nayara. Os e-mails são de exemplo.
- **Vídeos**: exemplos para a demonstração.
- **ID dos produtos**: criado automaticamente, em sequência (#0001, #0002...).
- **Contas do TikTok**: OFICIAL, RICARDO, SHAMA, SR LORD e IMAGINARIUM, como na planilha.

Para atualizar o estoque a partir de uma planilha nova: `python3 tools/importar_planilha.py ESTOQUE.xlsx` (gera `js/estoque.js`).

## Como abrir

Não precisa instalar nada: abra o `index.html` no navegador. Para publicar, ative o **GitHub Pages** no repositório (Settings → Pages → branch `main`, pasta raiz).

Na tela de login há dois atalhos de demonstração: **Admin master (Ricardo)**, **Admin master (Márcio)** e **Colaboradora (Ketlin)**. As alterações feitas na demonstração ficam salvas só no navegador; o botão "Restaurar dados de exemplo" (tela Admin) volta ao estado inicial.

## Telas

| Tela | Endereço | O que faz |
|---|---|---|
| Login | `#login` | Entrar com e-mail e senha ou com um perfil de demonstração |
| Cadastro | `#cadastro` | Criar conta de colaborador |
| Produtos | `#produtos` | Busca e filtros por local, prateleira, fabricante e conta do TikTok; vídeos e último vídeo de cada peça |
| Adicionar produto | `#produto-novo` | Local, nº da prateleira, descrição, peças, fabricante e link (opcional); o ID é automático |
| Editar produto | `#produto-editar` | Pergunta "Tem certeza das edições feitas?" com a lista do que muda; se a descrição mudar, confirma o link |
| Vídeos | `#videos` | Registrar vídeo com produto e conta do TikTok; data e hora do sistema gravadas automaticamente |
| Análise | `#analise` | Peças com mais vídeos, há mais tempo sem vídeo, nunca tiveram vídeo, vídeos por conta e semana |
| Admin master | `#admin` | Vídeos por pessoa, equipe (mudar cargo para admin, excluir conta; Ricardo e Márcio são fixos) e registros de tudo o que foi feito |

## Estrutura

```
index.html            página principal
styles.css            visual (tema claro e escuro, layout de celular com navegação inferior)
js/estoque.js         produtos importados da planilha da loja
js/data.js            contas do TikTok, equipe e vídeos de exemplo
js/app.js             telas, navegação e regras do protótipo
tools/importar_planilha.py importa a planilha ESTOQUE.xlsx para js/estoque.js
tools/build_single.py gera dist/prototipo.html, versão em arquivo único para demonstração
```

## Próximos passos

1. Criar o projeto no **Supabase** (login, banco PostgreSQL, permissões de admin/colaborador).
2. Trocar `js/data.js` pelas chamadas ao banco; cada "salvar" do `app.js` vira uma gravação.
3. Migrar as telas para React (Vite ou Next.js) reaproveitando o visual deste protótipo.
4. Criar o app no **TikTok Shop Partner Center** (tipo Custom) e a sincronização de pedidos e desempenho de vídeos.
5. Empacotar como app Android com **Capacitor**.
