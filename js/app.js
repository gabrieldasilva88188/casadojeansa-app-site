/* Casa do Jeans — protótipo navegável (sem backend).
   Os dados ficam só no navegador de quem está usando. Na versão final,
   cada função "salvar" vira uma chamada ao Supabase. */
(function () {
  'use strict';

  const KEY = 'cdj-prototipo-v1';
  const PRATELEIRAS = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'C4'];
  const ESTOQUE_BAIXO = 10;

  // ---------- Estado ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function seedState() {
    return { ...clone(window.SEED), sessao: null, editId: null };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* armazenamento indisponível: segue com os dados de exemplo */ }
    return seedState();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignora */ }
  }
  let state = load();

  // ---------- Utilidades ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const app = document.getElementById('app');
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtN = (n) => Number(n).toLocaleString('pt-BR');
  const fmtData = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' +
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };
  const fmtDia = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const iniciais = (nome) => nome.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const usuario = (id) => state.usuarios.find((u) => u.id === id) || { nome: 'Desconhecido', papel: '' };
  const produto = (id) => state.produtos.find((p) => p.id === id);
  const eu = () => state.sessao && usuario(state.sessao);
  const agora = () => new Date();
  const refHoje = () => {
    const a = agora(), s = new Date(state.hoje || window.SEED.hoje);
    return a > s ? a : s;
  };
  const dentroDe = (iso, dias) => (refHoje() - new Date(iso)) / 86400000 <= dias;
  const novoId = (pref) => pref + Date.now().toString(36) + Math.floor(Math.random() * 1000);

  function registrar(acao, detalhe) {
    state.registros.unshift({ usuarioId: state.sessao, acao, detalhe, data: agora().toISOString() });
  }

  let toastTimer;
  function toast(msg) {
    const old = $('.toast'); if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 2600);
  }

  // ---------- Ícones ----------
  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    produtos: ic('<path d="M12 4a2 2 0 0 1 2 2c0 1-1 1.6-2 2.2V9l8.4 5.6a1.4 1.4 0 0 1-.8 2.6H4.4a1.4 1.4 0 0 1-.8-2.6L12 9"/>'),
    videos: ic('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>'),
    analise: ic('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    admin: ic('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
    mais: ic('<path d="M12 5v14M5 12h14"/>'),
    busca: ic('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    link: ic('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    alerta: ic('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
    voltar: ic('<path d="M15 18l-6-6 6-6"/>')
  };

  // ---------- Roteamento por hash (#produtos, #analise ...) ----------
  const PUBLICAS = ['login', 'cadastro'];
  function rotaAtual() {
    const h = (location.hash || '').replace('#', '');
    return h || (state.sessao ? 'produtos' : 'login');
  }
  function ir(rota) {
    if (location.hash === '#' + rota) render(); else location.hash = rota;
  }
  window.addEventListener('hashchange', render);

  function render() {
    let rota = rotaAtual();
    if (!state.sessao && !PUBLICAS.includes(rota)) rota = 'login';
    if (state.sessao && PUBLICAS.includes(rota)) rota = 'produtos';
    const pagina = PAGINAS[rota] || PAGINAS.produtos;
    fecharModal();
    pagina();
    window.scrollTo(0, 0);
    const h1 = $('h1'); if (h1) document.title = h1.textContent + ' | Casa do Jeans';
  }

  // ---------- Estrutura (menu lateral / navegação do celular) ----------
  function shell(ativo, conteudo) {
    const u = eu();
    const itens = [
      ['produtos', 'Produtos', ICON.produtos],
      ['videos', 'Vídeos', ICON.videos],
      ['analise', 'Análise', ICON.analise]
    ];
    if (u.papel === 'admin') itens.push(['admin', 'Admin', ICON.admin]);
    const links = itens.map(([r, n, i]) =>
      `<a href="#${r}" ${ativo === r ? 'aria-current="page"' : ''}>${i}<span>${n}</span></a>`).join('');
    app.innerHTML = `
      <div class="shell">
        <aside class="side">
          <div class="brand"><span class="brand-name">Casa do Jeans</span><span class="brand-sub">Estoque e vídeos do TikTok Shop</span></div>
          <nav class="nav" aria-label="Menu principal">${links}</nav>
          <div class="side-foot">
            <div class="user-chip">
              <span class="avatar">${iniciais(u.nome)}</span>
              <span class="who"><b>${esc(u.nome)}</b><span>${u.papel === 'admin' ? 'Admin master' : 'Funcionário'}</span></span>
            </div>
            <button class="link-btn" data-acao="sair" type="button">Sair</button>
            <p class="proto-note">Protótipo com dados de exemplo. Ainda sem conexão com o TikTok Shop.</p>
          </div>
        </aside>
        <div class="topbar-wrap">
          <header class="topbar">
            <span class="brand-name">Casa do Jeans</span>
            <button class="link-btn" style="color:inherit" data-acao="sair" type="button">Sair</button>
          </header>
          <main class="main" id="conteudo"><div class="page">${conteudo}</div></main>
        </div>
        <nav class="tabbar" aria-label="Menu principal">${links}</nav>
      </div>`;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-acao="sair"]');
    if (b) { state.sessao = null; save(); ir('login'); }
  });

  // ---------- Login ----------
  function telaAuth(formHtml) {
    app.innerHTML = `
      <div class="auth">
        <section class="auth-art">
          <div class="brand"><span class="brand-name">Casa do Jeans</span></div>
          <div>
            <div class="big">Cada peça<br>no lugar.<br>Cada vídeo<br>contado.</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:14px">
            <p>Estoque por prateleira, links do TikTok Shop e os vídeos que a equipe gravou, tudo num só lugar.</p>
            <div class="tag"><span class="stitch"></span>Loja física e TikTok Shop</div>
          </div>
        </section>
        <section class="auth-form"><div class="auth-box">${formHtml}</div></section>
      </div>`;
  }

  function entrar(id) {
    state.sessao = id; save();
    toast('Olá, ' + usuario(id).nome.split(' ')[0] + '!');
    ir('produtos');
  }

  const PAGINAS = {};

  PAGINAS.login = function () {
    document.title = 'Entrar | Casa do Jeans';
    telaAuth(`
      <div><h1>Entrar</h1><p class="muted" style="margin-top:6px">Use o e-mail cadastrado na loja.</p></div>
      <form id="f-login" novalidate>
        <div class="field"><label for="l-email">E-mail</label>
          <input class="input" id="l-email" type="email" autocomplete="email" placeholder="nome@casadojeans.com"></div>
        <div class="field"><label for="l-senha">Senha</label>
          <input class="input" id="l-senha" type="password" autocomplete="current-password"></div>
        <p class="err" id="l-err" role="alert" style="color:var(--danger);font-size:.88rem" hidden></p>
        <button class="btn" type="submit">Entrar</button>
        <p class="muted" style="font-size:.9rem">Ainda não tem acesso? <a href="#cadastro" class="link-btn">Criar conta</a></p>
      </form>
      <div class="demo-box">
        <p>Para a demonstração, entre direto com um perfil de exemplo:</p>
        <div class="demo-btns">
          <button class="btn btn-ghost" type="button" data-demo="u2">Funcionária (Camila)</button>
          <button class="btn btn-ghost" type="button" data-demo="u1">Admin master (Gabriel)</button>
        </div>
      </div>`);
    app.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => entrar(b.dataset.demo)));
    $('#f-login').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = $('#l-email').value.trim().toLowerCase();
      const senha = $('#l-senha').value;
      const err = $('#l-err');
      if (!email || !senha) { err.textContent = 'Preencha o e-mail e a senha.'; err.hidden = false; return; }
      const u = state.usuarios.find((x) => x.email.toLowerCase() === email);
      if (!u) { err.textContent = 'Não encontramos esse e-mail. Confira ou use um dos perfis de exemplo abaixo.'; err.hidden = false; return; }
      entrar(u.id);
    });
  };

  PAGINAS.cadastro = function () {
    document.title = 'Criar conta | Casa do Jeans';
    telaAuth(`
      <div><h1>Criar conta</h1><p class="muted" style="margin-top:6px">O admin master pode ajustar seu acesso depois.</p></div>
      <form id="f-cad" novalidate>
        <div class="field"><label for="c-nome">Nome completo</label><input class="input" id="c-nome" autocomplete="name"></div>
        <div class="field"><label for="c-email">E-mail</label><input class="input" id="c-email" type="email" autocomplete="email"></div>
        <div class="field"><label for="c-senha">Senha</label><input class="input" id="c-senha" type="password" autocomplete="new-password"><span class="hint">Mínimo de 6 caracteres.</span></div>
        <div class="field"><label for="c-senha2">Confirmar senha</label><input class="input" id="c-senha2" type="password" autocomplete="new-password"></div>
        <p class="err" id="c-err" role="alert" style="color:var(--danger);font-size:.88rem" hidden></p>
        <button class="btn" type="submit">Criar conta</button>
        <p class="muted" style="font-size:.9rem">Já tem conta? <a href="#login" class="link-btn">Entrar</a></p>
      </form>`);
    $('#f-cad').addEventListener('submit', (e) => {
      e.preventDefault();
      const nome = $('#c-nome').value.trim();
      const email = $('#c-email').value.trim().toLowerCase();
      const s1 = $('#c-senha').value, s2 = $('#c-senha2').value;
      const err = $('#c-err');
      const falha = (m) => { err.textContent = m; err.hidden = false; };
      if (!nome || !email || !s1) return falha('Preencha nome, e-mail e senha.');
      if (!/^\S+@\S+\.\S+$/.test(email)) return falha('Digite um e-mail válido, como nome@casadojeans.com.');
      if (state.usuarios.some((u) => u.email.toLowerCase() === email)) return falha('Esse e-mail já tem conta. Use a tela de entrar.');
      if (s1.length < 6) return falha('A senha precisa ter pelo menos 6 caracteres.');
      if (s1 !== s2) return falha('As duas senhas não são iguais.');
      const u = { id: novoId('u'), nome, email, papel: 'funcionario' };
      state.usuarios.push(u);
      state.sessao = u.id;
      registrar('Criou conta', nome);
      save();
      toast('Conta criada');
      ir('produtos');
    });
  };

  // ---------- Produtos ----------
  const videosDoProduto = (pid, dias) => state.videos.filter((v) => v.produtoId === pid && (!dias || dentroDe(v.data, dias))).length;
  let filtroBusca = '', filtroPrat = '';

  PAGINAS.produtos = function () {
    const opcoes = PRATELEIRAS.map((p) => `<option ${filtroPrat === p ? 'selected' : ''}>${p}</option>`).join('');
    const baixos = state.produtos.filter((p) => p.quantidade < ESTOQUE_BAIXO).length;
    shell('produtos', `
      <div class="page-head">
        <div><h1>Produtos</h1><p>${state.produtos.length} produtos cadastrados${baixos ? `, ${baixos} com estoque baixo` : ''}.</p></div>
        <a class="btn" href="#produto-novo">${ICON.mais}Adicionar produto</a>
      </div>
      <div class="toolbar">
        <div class="search">${ICON.busca}<input class="input" id="busca" type="search" placeholder="Buscar por código ou descrição" value="${esc(filtroBusca)}" aria-label="Buscar produto"></div>
        <select class="input" id="f-prat" aria-label="Filtrar por prateleira"><option value="">Todas as prateleiras</option>${opcoes}</select>
      </div>
      <div id="lista"></div>`);
    const desenhar = () => {
      const q = filtroBusca.toLowerCase();
      const lista = state.produtos.filter((p) =>
        (!q || p.codigo.toLowerCase().includes(q) || p.descricao.toLowerCase().includes(q)) &&
        (!filtroPrat || p.prateleira === filtroPrat));
      if (!lista.length) {
        $('#lista').innerHTML = `<div class="table-wrap"><p class="empty">Nenhum produto encontrado. Tente outro código ou <a class="link-btn" href="#produto-novo">adicione um produto</a>.</p></div>`;
        return;
      }
      $('#lista').innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Produto</th><th>Prateleira</th><th class="r">Estoque</th><th class="r hide-sm">Vídeos</th><th class="r hide-sm">Vendas 30 dias</th><th class="r"><span class="hide-sm">Ações</span></th></tr></thead>
          <tbody>${lista.map((p) => `
            <tr>
              <td class="prod"><span class="code">${esc(p.codigo)}</span><span class="muted">${esc(p.descricao)}</span></td>
              <td><span class="shelf">${esc(p.prateleira)}</span></td>
              <td class="r num">${p.quantidade < ESTOQUE_BAIXO
                ? `<span class="pill pill-low" title="Estoque baixo">${p.quantidade} un.</span>`
                : `${p.quantidade} un.`}</td>
              <td class="r num hide-sm">${videosDoProduto(p.id)}</td>
              <td class="r num hide-sm">${p.vendasLoja + p.vendasTikTok}</td>
              <td><div class="row-actions">
                <a class="btn btn-ghost btn-sm hide-sm" href="${esc(p.link)}" target="_blank" rel="noopener" aria-label="Abrir ${esc(p.codigo)} no TikTok Shop">${ICON.link}</a>
                <button class="btn btn-ghost btn-sm" type="button" data-editar="${p.id}">Editar</button>
              </div></td>
            </tr>`).join('')}
          </tbody></table></div>`;
    };
    desenhar();
    $('#busca').addEventListener('input', (e) => { filtroBusca = e.target.value; desenhar(); });
    $('#f-prat').addEventListener('change', (e) => { filtroPrat = e.target.value; desenhar(); });
    $('#lista').addEventListener('click', (e) => {
      const b = e.target.closest('[data-editar]');
      if (b) { state.editId = b.dataset.editar; save(); ir('produto-editar'); }
    });
  };

  // Formulário compartilhado entre adicionar e editar
  function formProduto(p) {
    const v = p || { codigo: '', descricao: '', quantidade: '', prateleira: '', link: '' };
    return `
      <form id="f-prod" class="panel form-panel" novalidate>
        <div class="grid-form">
          <div class="field"><label for="p-codigo">Código do produto</label>
            <input class="input" id="p-codigo" value="${esc(v.codigo)}" placeholder="CDJ-1200" autocomplete="off">
            <span class="hint">O mesmo código da etiqueta.</span><span class="err" data-err="codigo"></span></div>
          <div class="field"><label for="p-qtd">Quantidade em estoque</label>
            <input class="input num" id="p-qtd" type="number" min="0" step="1" inputmode="numeric" value="${esc(v.quantidade)}">
            <span class="err" data-err="quantidade"></span></div>
          <div class="field span-2"><label for="p-desc">Descrição</label>
            <textarea class="input" id="p-desc" placeholder="Ex.: Calça jeans skinny cintura alta, lavagem escura">${esc(v.descricao)}</textarea>
            <span class="err" data-err="descricao"></span></div>
          <div class="field"><label for="p-prat">Prateleira</label>
            <select class="input" id="p-prat"><option value="">Escolha a prateleira</option>
              ${PRATELEIRAS.map((x) => `<option ${v.prateleira === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
            <span class="err" data-err="prateleira"></span></div>
          <div class="field"><label for="p-link">Link do produto no TikTok Shop</label>
            <input class="input" id="p-link" type="url" value="${esc(v.link)}" placeholder="https://www.tiktok.com/view/product/...">
            <span class="err" data-err="link"></span></div>
        </div>
        <div class="form-actions" style="margin-top:22px">
          <button class="btn" type="submit">${p ? 'Salvar alterações' : 'Adicionar produto'}</button>
          <a class="btn btn-ghost" href="#produtos">Cancelar</a>
        </div>
      </form>`;
  }

  function lerFormProduto(idAtual) {
    const d = {
      codigo: $('#p-codigo').value.trim().toUpperCase(),
      descricao: $('#p-desc').value.trim(),
      quantidade: $('#p-qtd').value.trim(),
      prateleira: $('#p-prat').value,
      link: $('#p-link').value.trim()
    };
    const erros = {};
    if (!d.codigo) erros.codigo = 'Digite o código do produto.';
    else if (state.produtos.some((p) => p.codigo === d.codigo && p.id !== idAtual)) erros.codigo = 'Já existe um produto com esse código.';
    if (!d.descricao) erros.descricao = 'Descreva o produto (modelo, lavagem, cor).';
    if (d.quantidade === '' || !/^\d+$/.test(d.quantidade)) erros.quantidade = 'Use um número inteiro, 0 ou maior.';
    if (!d.prateleira) erros.prateleira = 'Escolha em qual prateleira ele está.';
    if (!/^https:\/\/\S+\.\S+/.test(d.link)) erros.link = 'Cole o link completo, começando com https://';
    document.querySelectorAll('#f-prod [data-err]').forEach((el) => {
      const k = el.dataset.err; el.textContent = erros[k] || '';
      const inp = el.parentElement.querySelector('.input'); if (inp) inp.setAttribute('aria-invalid', erros[k] ? 'true' : 'false');
    });
    const primeiro = document.querySelector('#f-prod [aria-invalid="true"]');
    if (primeiro) { primeiro.focus(); return null; }
    d.quantidade = parseInt(d.quantidade, 10);
    return d;
  }

  PAGINAS['produto-novo'] = function () {
    shell('produtos', `
      <div class="page-head"><div>
        <a class="link-btn" href="#produtos">Voltar para produtos</a>
        <h1 style="margin-top:10px">Adicionar produto</h1>
        <p>Cadastre a peça com o código da etiqueta, onde ela fica e o link dela no TikTok Shop.</p></div></div>
      ${formProduto(null)}`);
    $('#f-prod').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = lerFormProduto(null);
      if (!d) return;
      state.produtos.unshift({ id: novoId('p'), ...d, vendasLoja: 0, vendasTikTok: 0 });
      registrar('Adicionou produto', `${d.codigo} ${d.descricao}`);
      save();
      toast('Produto adicionado');
      ir('produtos');
    });
  };

  PAGINAS['produto-editar'] = function () {
    const p = produto(state.editId);
    if (!p) { ir('produtos'); return; }
    const hist = state.registros.filter((r) => r.detalhe.startsWith(p.codigo)).slice(0, 6);
    shell('produtos', `
      <div class="page-head"><div>
        <a class="link-btn" href="#produtos">Voltar para produtos</a>
        <h1 style="margin-top:10px">Editar ${esc(p.codigo)}</h1>
        <p>Se a descrição mudar, o sistema confirma se o link do TikTok Shop continua o mesmo.</p></div></div>
      ${formProduto(p)}
      <section class="panel form-panel">
        <div class="panel-head"><h2>Histórico deste produto</h2></div>
        ${hist.length ? `<ul class="history">${hist.map((r) => `
          <li><span class="avatar">${iniciais(usuario(r.usuarioId).nome)}</span>
          <div><b>${esc(usuario(r.usuarioId).nome)}</b> ${esc(r.acao.toLowerCase())}: ${esc(r.detalhe.replace(p.codigo + ': ', '').replace(p.codigo + ' ', ''))}<br><time>${fmtData(r.data)}</time></div></li>`).join('')}</ul>`
          : '<p class="muted">Nenhuma alteração registrada ainda.</p>'}
      </section>`);
    $('#f-prod').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = lerFormProduto(p.id);
      if (!d) return;
      if (d.descricao !== p.descricao && d.link === p.link) perguntarLink(p, d);
      else salvarEdicao(p, d, d.link !== p.link ? 'link atualizado' : null);
    });
  };

  function salvarEdicao(p, d, notaLink) {
    const mud = [];
    if (d.codigo !== p.codigo) mud.push(`código ${p.codigo} → ${d.codigo}`);
    if (d.quantidade !== p.quantidade) mud.push(`quantidade ${p.quantidade} → ${d.quantidade}`);
    if (d.prateleira !== p.prateleira) mud.push(`prateleira ${p.prateleira} → ${d.prateleira}`);
    if (d.descricao !== p.descricao) mud.push('descrição alterada');
    if (notaLink) mud.push(notaLink);
    if (!mud.length) { toast('Nada foi alterado'); return; }
    Object.assign(p, d);
    registrar('Editou produto', `${d.codigo}: ${mud.join(', ')}`);
    save();
    fecharModal();
    toast('Alterações salvas');
    ir('produtos');
  }

  // Pergunta pedida no briefing: mudou a descrição, o link ainda é o mesmo?
  function perguntarLink(p, d) {
    fecharModal();
    const m = document.createElement('div');
    m.className = 'modal-scrim';
    m.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-tit">
        <h2 id="m-tit">O link do produto continua o mesmo?</h2>
        <p class="muted">Você mudou a descrição. Se a peça no TikTok Shop também mudou, atualize o link para os vídeos e vendas continuarem ligados ao produto certo.</p>
        <div class="compare">
          <span><s>${esc(p.descricao)}</s></span>
          <span><b>${esc(d.descricao)}</b></span>
          <span class="muted" style="word-break:break-all">Link atual: ${esc(p.link)}</span>
        </div>
        <div id="m-novo" class="field" hidden>
          <label for="m-link">Novo link do TikTok Shop</label>
          <input class="input" id="m-link" type="url" placeholder="https://www.tiktok.com/view/product/...">
          <span class="err" id="m-err"></span>
        </div>
        <div class="actions" id="m-acoes">
          <button class="btn" type="button" id="m-manter">Sim, manter o link</button>
          <button class="btn btn-ghost" type="button" id="m-trocar">Não, informar novo link</button>
        </div>
        <button class="link-btn" type="button" id="m-cancelar" style="align-self:flex-start">Voltar à edição</button>
      </div>`;
    document.body.appendChild(m);
    $('#m-manter').focus();
    $('#m-manter').addEventListener('click', () => salvarEdicao(p, d, 'link mantido'));
    $('#m-cancelar').addEventListener('click', fecharModal);
    m.addEventListener('click', (e) => { if (e.target === m) fecharModal(); });
    $('#m-trocar').addEventListener('click', () => {
      $('#m-novo').hidden = false;
      $('#m-acoes').innerHTML = '<button class="btn btn-red" type="button" id="m-salvar">Salvar com o novo link</button>';
      $('#m-link').focus();
      $('#m-salvar').addEventListener('click', () => {
        const l = $('#m-link').value.trim();
        if (!/^https:\/\/\S+\.\S+/.test(l)) { $('#m-err').textContent = 'Cole o link completo, começando com https://'; $('#m-link').setAttribute('aria-invalid', 'true'); return; }
        if (l === p.link) { $('#m-err').textContent = 'Esse é o mesmo link de antes. Use "Voltar à edição" se quiser mantê-lo.'; return; }
        salvarEdicao(p, { ...d, link: l }, 'link atualizado');
      });
      $('#m-link').addEventListener('input', () => { $('#m-err').textContent = ''; $('#m-link').setAttribute('aria-invalid', 'false'); });
    });
  }
  function fecharModal() { const m = $('.modal-scrim'); if (m) m.remove(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(); });

  // ---------- Vídeos ----------
  let filtroVideos = 'meus';
  PAGINAS.videos = function () {
    const hoje = refHoje().toISOString().slice(0, 10);
    const ordenados = [...state.produtos].sort((a, b) => a.codigo.localeCompare(b.codigo));
    const meus30 = state.videos.filter((v) => v.usuarioId === state.sessao && dentroDe(v.data, 30)).length;
    shell('videos', `
      <div class="page-head"><div><h1>Vídeos</h1>
        <p>Registre cada vídeo gravado. É assim que o sistema sabe quantos vídeos cada pessoa postou e quais produtos estão com poucos vídeos.</p></div></div>
      <form id="f-video" class="panel form-panel" novalidate>
        <div class="panel-head"><h2>Registrar vídeo</h2><p>Você postou <b class="num">${meus30}</b> nos últimos 30 dias.</p></div>
        <div class="grid-form">
          <div class="field span-2"><label for="v-prod">Produto do vídeo</label>
            <select class="input" id="v-prod"><option value="">Escolha o produto</option>
              ${ordenados.map((p) => `<option value="${p.id}">${esc(p.codigo)} - ${esc(p.descricao)}</option>`).join('')}</select>
            <span class="err" data-err="prod"></span></div>
          <div class="field"><label for="v-link">Link do vídeo no TikTok</label>
            <input class="input" id="v-link" type="url" placeholder="https://www.tiktok.com/@casadojeans/video/...">
            <span class="err" data-err="link"></span></div>
          <div class="field"><label for="v-data">Data da postagem</label>
            <input class="input" id="v-data" type="date" value="${hoje}" max="${hoje}">
            <span class="err" data-err="data"></span></div>
        </div>
        <div class="form-actions" style="margin-top:22px"><button class="btn" type="submit">Registrar vídeo</button></div>
      </form>
      <section>
        <div class="panel-head">
          <h2>Vídeos recentes</h2>
          <div class="seg-toggle" role="group" aria-label="Quais vídeos mostrar">
            <button type="button" data-fv="meus" aria-pressed="${filtroVideos === 'meus'}">Meus</button>
            <button type="button" data-fv="todos" aria-pressed="${filtroVideos === 'todos'}">Da equipe</button>
          </div>
        </div>
        <div id="lista-videos"></div>
      </section>`);
    const desenhar = () => {
      const lista = state.videos.filter((v) => filtroVideos === 'todos' || v.usuarioId === state.sessao).slice(0, 20);
      $('#lista-videos').innerHTML = lista.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Data</th><th>Produto</th>${filtroVideos === 'todos' ? '<th>Quem postou</th>' : ''}<th class="r hide-sm">Visualizações</th><th class="r">Vídeo</th></tr></thead>
          <tbody>${lista.map((v) => { const p = produto(v.produtoId) || { codigo: '?', descricao: 'Produto removido' }; return `
            <tr><td class="num" style="white-space:nowrap">${fmtDia(v.data)}</td>
              <td><span class="code">${esc(p.codigo)}</span> <span class="muted hide-sm">${esc(p.descricao)}</span></td>
              ${filtroVideos === 'todos' ? `<td>${esc(usuario(v.usuarioId).nome)}</td>` : ''}
              <td class="r num hide-sm">${v.visualizacoes == null ? '<span class="muted">aguardando</span>' : fmtN(v.visualizacoes)}</td>
              <td><div class="row-actions"><a class="btn btn-ghost btn-sm" href="${esc(v.link)}" target="_blank" rel="noopener" aria-label="Abrir vídeo">${ICON.link}</a></div></td></tr>`; }).join('')}
          </tbody></table></div>`
        : `<div class="table-wrap"><p class="empty">Você ainda não registrou vídeos. Use o formulário acima depois de postar.</p></div>`;
      document.querySelectorAll('[data-fv]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fv === filtroVideos)));
    };
    desenhar();
    document.querySelectorAll('[data-fv]').forEach((b) => b.addEventListener('click', () => { filtroVideos = b.dataset.fv; desenhar(); }));
    $('#f-video').addEventListener('submit', (e) => {
      e.preventDefault();
      const pid = $('#v-prod').value, link = $('#v-link').value.trim(), data = $('#v-data').value;
      const erros = {};
      if (!pid) erros.prod = 'Escolha o produto que aparece no vídeo.';
      if (!/^https:\/\/\S+\.\S+/.test(link)) erros.link = 'Cole o link completo do vídeo, começando com https://';
      else if (state.videos.some((v) => v.link === link)) erros.link = 'Esse vídeo já foi registrado.';
      if (!data) erros.data = 'Informe a data da postagem.';
      document.querySelectorAll('#f-video [data-err]').forEach((el) => {
        el.textContent = erros[el.dataset.err] || '';
        el.parentElement.querySelector('.input').setAttribute('aria-invalid', erros[el.dataset.err] ? 'true' : 'false');
      });
      if (Object.keys(erros).length) { document.querySelector('#f-video [aria-invalid="true"]').focus(); return; }
      const quando = new Date(data + 'T' + agora().toTimeString().slice(0, 8));
      state.videos.unshift({ id: novoId('v'), produtoId: pid, usuarioId: state.sessao, link, data: quando.toISOString(), visualizacoes: null });
      state.videos.sort((a, b) => b.data.localeCompare(a.data));
      save();
      toast('Vídeo registrado');
      filtroVideos = 'meus';
      render();
    });
  };

  // ---------- Gráfico de barras horizontais (desenhado em escala) ----------
  function escala(max) {
    const bruto = Math.max(max, 1) / 4;
    const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
    const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((s) => s >= bruto);
    return { max: passo * 4, ticks: [0, 1, 2, 3, 4].map((i) => +(passo * i).toFixed(2)) };
  }
  function grafico(linhas) {
    const maior = Math.max(...linhas.map((l) => l.segs.reduce((a, s) => a + s.v, 0)));
    const e = escala(maior);
    return `<div class="bars">${linhas.map((l) => {
      const total = l.segs.reduce((a, s) => a + s.v, 0);
      const titulo = l.segs.map((s) => `${s.nome}: ${s.v}`).join(', ');
      return `<div class="bar-row">
        <span class="bar-label" title="${esc(l.titulo || l.label)}">${l.label}</span>
        <div class="bar-track" title="${esc(titulo)}" role="img" aria-label="${esc((l.titulo || '') + ' ' + titulo)}">${l.segs.filter((s) => s.v > 0).map((s) =>
          `<span class="bar-seg ${s.cls}" style="width:${(s.v / e.max) * 100}%"></span>`).join('')}</div>
        <span class="bar-val">${fmtN(total)}</span></div>`;
    }).join('')}</div>
    <div class="axis" aria-hidden="true"><span></span><div class="ticks">${e.ticks.map((t) => `<span>${fmtN(t)}</span>`).join('')}</div><span></span></div>`;
  }

  // ---------- Análise dos produtos ----------
  PAGINAS.analise = function () {
    const dados = state.produtos.map((p) => ({ ...p, total: p.vendasLoja + p.vendasTikTok, videos: videosDoProduto(p.id, 30) }));
    const totLoja = dados.reduce((a, p) => a + p.vendasLoja, 0);
    const totTik = dados.reduce((a, p) => a + p.vendasTikTok, 0);
    const vids30 = state.videos.filter((v) => dentroDe(v.data, 30)).length;
    const semVideo = dados.filter((p) => p.videos === 0).length;
    const top = [...dados].sort((a, b) => b.total - a.total).slice(0, 8);
    const porVideos = [...dados].sort((a, b) => b.videos - a.videos || b.total - a.total);
    const menos = [...dados].sort((a, b) => a.videos - b.videos || b.total - a.total).slice(0, 5);
        const oportunidades = dados.filter((p) => p.total >= 30 && p.videos <= 3).sort((a, b) => b.total - a.total);
    const rot = (p) => `<b>${esc(p.codigo)}</b>${esc(p.descricao)}`;

    shell('analise', `
      <div class="page-head"><div><h1>Análise dos produtos</h1>
        <p>Últimos 30 dias. Vendas do TikTok Shop e da loja física lado a lado, com os vídeos gravados de cada peça.</p></div></div>
      <div class="stats">
        <div class="stat"><span class="v">${fmtN(totLoja + totTik)}</span><span class="l">peças vendidas</span></div>
        <div class="stat"><span class="v">${Math.round((totTik / (totLoja + totTik)) * 100)}%</span><span class="l">das vendas pelo TikTok Shop</span></div>
        <div class="stat"><span class="v">${vids30}</span><span class="l">vídeos postados</span></div>
        <div class="stat"><span class="v">${semVideo}</span><span class="l">produtos sem nenhum vídeo</span></div>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>Mais vendidos</h2>
          <div class="legend"><span><i class="c-tiktok"></i>TikTok Shop</span><span><i class="c-loja"></i>Loja física</span></div></div>
        ${grafico(top.map((p) => ({ label: rot(p), titulo: p.descricao, segs: [
          { v: p.vendasTikTok, cls: 'c-tiktok', nome: 'TikTok Shop' },
          { v: p.vendasLoja, cls: 'c-loja', nome: 'Loja física' }] })))}
      </section>
      <div class="two-col">
        <section class="panel"><div class="panel-head"><h2>Mais vídeos gravados</h2></div>
          <ul class="rank">${porVideos.slice(0, 5).map((p) => `<li><span>${rot(p).replace('</b>', '</b> ')}</span><span class="n">${p.videos} vídeos</span></li>`).join('')}</ul></section>
        <section class="panel"><div class="panel-head"><h2>Menos vídeos gravados</h2></div>
          <ul class="rank">${menos.map((p) => `<li><span>${rot(p).replace('</b>', '</b> ')}</span><span class="n ${p.videos === 0 ? 'zero' : ''}">${p.videos === 0 ? 'nenhum' : p.videos + (p.videos === 1 ? ' vídeo' : ' vídeos')}</span></li>`).join('')}</ul></section>
      </div>
      <section>
        <div class="panel-head"><div><h2>Vendem bem e têm poucos vídeos</h2>
          <p>Produtos com 30 vendas ou mais e até 3 vídeos no mês. Boas apostas para os próximos vídeos.</p></div></div>
        ${oportunidades.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Produto</th><th class="r">Vendas</th><th class="r hide-sm">Na loja</th><th class="r hide-sm">No TikTok</th><th class="r">Vídeos</th><th class="r hide-sm">Estoque</th></tr></thead>
          <tbody>${oportunidades.map((p) => `<tr>
            <td><span class="code">${esc(p.codigo)}</span> <span class="muted">${esc(p.descricao)}</span></td>
            <td class="r num"><b>${p.total}</b></td><td class="r num hide-sm">${p.vendasLoja}</td><td class="r num hide-sm">${p.vendasTikTok}</td>
            <td class="r num">${p.videos}</td>
            <td class="r num hide-sm">${p.quantidade < ESTOQUE_BAIXO ? `<span class="pill pill-low">${p.quantidade} un.</span>` : p.quantidade + ' un.'}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="table-wrap"><p class="empty">Todos os produtos que vendem bem já têm vídeos suficientes.</p></div>'}
      </section>
      <p class="muted" style="font-size:.85rem">Na versão final, as vendas do TikTok Shop chegam automaticamente pela API; as da loja física são registradas no sistema.</p>`);
  };

  // ---------- Admin master ----------
  let periodoAdmin = 30, filtroUsuario = '', filtroAcao = '', limiteReg = 15;
  PAGINAS.admin = function () {
    if (eu().papel !== 'admin') {
      shell('admin', `<div class="page-head"><div><h1>Admin master</h1></div></div>
        <div class="notice">${ICON.alerta}<span>Esta área é só para o admin master. Peça acesso ao responsável pela loja.</span></div>`);
      return;
    }
    shell('admin', `
      <div class="page-head"><div><h1>Admin master</h1><p>Vídeos postados por cada pessoa e tudo o que a equipe alterou no sistema.</p></div></div>
      <section class="panel">
        <div class="panel-head"><h2>Vídeos por pessoa</h2>
          <div class="seg-toggle" role="group" aria-label="Período">
            <button type="button" data-per="7">7 dias</button><button type="button" data-per="30">30 dias</button>
          </div></div>
        <div id="graf-usuarios"></div>
      </section>
      <section>
        <div class="panel-head"><h2>Registros da equipe</h2>
          <div class="toolbar">
            <select class="input" id="r-user" aria-label="Filtrar por pessoa"><option value="">Todas as pessoas</option>
              ${state.usuarios.map((u) => `<option value="${u.id}" ${filtroUsuario === u.id ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select>
            <select class="input" id="r-acao" aria-label="Filtrar por tipo"><option value="">Todas as ações</option>
              ${['Adicionou produto', 'Editou produto', 'Registrou vídeo', 'Criou conta'].map((a) => `<option ${filtroAcao === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
          </div></div>
        <div id="lista-reg"></div>
      </section>
      <section class="panel" style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between">
        <p class="muted" style="max-width:60ch">Este protótipo guarda as alterações só neste navegador. Para recomeçar a demonstração do zero:</p>
        <button class="btn btn-ghost" type="button" id="reset">Restaurar dados de exemplo</button>
      </section>`);

    const desenharGrafico = () => {
      const linhas = state.usuarios.map((u) => {
        const vs = state.videos.filter((v) => v.usuarioId === u.id && dentroDe(v.data, periodoAdmin));
        return { u, n: vs.length, views: vs.reduce((a, v) => a + (v.visualizacoes || 0), 0) };
      }).sort((a, b) => b.n - a.n);
      $('#graf-usuarios').innerHTML = grafico(linhas.map((l) => ({
        label: `<b>${esc(l.u.nome)}</b>`, titulo: `${l.u.nome}, ${fmtN(l.views)} visualizações`,
        segs: [{ v: l.n, cls: 'c-denim', nome: 'Vídeos' }] })));
      document.querySelectorAll('[data-per]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.per === periodoAdmin)));
    };
    const desenharRegistros = () => {
      const deVideos = state.videos.map((v) => {
        const p = produto(v.produtoId);
        return { usuarioId: v.usuarioId, acao: 'Registrou vídeo', detalhe: p ? `${p.codigo} ${p.descricao}` : 'produto removido', data: v.data };
      });
      const todos = [...state.registros, ...deVideos]
        .filter((r) => (!filtroUsuario || r.usuarioId === filtroUsuario) && (!filtroAcao || r.acao === filtroAcao))
        .sort((a, b) => b.data.localeCompare(a.data));
      const vis = todos.slice(0, limiteReg);
      $('#lista-reg').innerHTML = vis.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Quando</th><th>Quem</th><th>O que fez</th></tr></thead>
          <tbody>${vis.map((r) => `<tr>
            <td class="num" style="white-space:nowrap">${fmtData(r.data)}</td>
            <td style="white-space:nowrap">${esc(usuario(r.usuarioId).nome)}</td>
            <td class="prod"><b>${esc(r.acao)}</b><span class="muted">${esc(r.detalhe)}</span></td></tr>`).join('')}</tbody></table></div>
        ${todos.length > limiteReg ? `<p style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" id="mais-reg">Mostrar mais ${Math.min(15, todos.length - limiteReg)} de ${todos.length - limiteReg}</button></p>` : ''}`
        : '<div class="table-wrap"><p class="empty">Nenhum registro com esses filtros.</p></div>';
      const m = $('#mais-reg'); if (m) m.addEventListener('click', () => { limiteReg += 15; desenharRegistros(); });
    };
    desenharGrafico(); desenharRegistros();
    document.querySelectorAll('[data-per]').forEach((b) => b.addEventListener('click', () => { periodoAdmin = +b.dataset.per; desenharGrafico(); }));
    $('#r-user').addEventListener('change', (e) => { filtroUsuario = e.target.value; limiteReg = 15; desenharRegistros(); });
    $('#r-acao').addEventListener('change', (e) => { filtroAcao = e.target.value; limiteReg = 15; desenharRegistros(); });
    $('#reset').addEventListener('click', () => {
      const sess = state.sessao;
      state = seedState(); state.sessao = sess; save();
      toast('Dados de exemplo restaurados'); render();
    });
  };

  render();
})();
