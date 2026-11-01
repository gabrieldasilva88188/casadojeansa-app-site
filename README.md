# Casa do Jeans: sistema de estoque e vídeos do TikTok Shop

Protótipo navegável do site, feito para apresentar ao cliente. Usa **dados de exemplo** e ainda **não tem backend nem conexão com a API do TikTok Shop**.

## Como abrir

Não precisa instalar nada: abra o `index.html` no navegador. Para publicar, ative o **GitHub Pages** no repositório (Settings → Pages → branch `main`, pasta raiz).

Na tela de login há dois atalhos de demonstração: **Funcionária (Camila)** e **Admin master (Gabriel)**. As alterações feitas na demonstração ficam salvas só no navegador; o botão "Restaurar dados de exemplo" (tela Admin) volta ao estado inicial.

## Telas

| Tela | Endereço | O que faz |
|---|---|---|
| Login | `#login` | Entrar com e-mail e senha ou com um perfil de demonstração |
| Cadastro | `#cadastro` | Criar conta de funcionário |
| Produtos | `#produtos` | Lista com busca, filtro por prateleira, estoque baixo destacado |
| Adicionar produto | `#produto-novo` | Código, descrição, quantidade, prateleira e link do TikTok Shop |
| Editar produto | `#produto-editar` | Se a descrição mudar, pergunta se o link continua o mesmo; mostra o histórico do produto |
| Vídeos | `#videos` | Registrar vídeo postado (produto, link, data) e ver os recentes |
| Análise | `#analise` | Mais vendidos (TikTok × loja), mais e menos vídeos, produtos que vendem bem com poucos vídeos |
| Admin master | `#admin` | Gráfico de vídeos por pessoa (7 ou 30 dias) e registros de tudo o que a equipe fez |

## Estrutura

```
index.html            página principal
styles.css            visual (tema claro e escuro, layout de celular com navegação inferior)
js/data.js            dados de exemplo (substituídos pelo banco na versão final)
js/app.js             telas, navegação e regras do protótipo
tools/build_single.py gera dist/prototipo.html, versão em arquivo único para demonstração
```

## Próximos passos

1. Criar o projeto no **Supabase** (login, banco PostgreSQL, permissões de admin/funcionário).
2. Trocar `js/data.js` pelas chamadas ao banco; cada "salvar" do `app.js` vira uma gravação.
3. Migrar as telas para React (Vite ou Next.js) reaproveitando o visual deste protótipo.
4. Criar o app no **TikTok Shop Partner Center** (tipo Custom) e a sincronização de pedidos e desempenho de vídeos.
5. Empacotar como app Android com **Capacitor**.
