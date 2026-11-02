/* Gerenciador de Estoque e Vídeos — protótipo navegável (sem backend).
   Os dados ficam só no navegador de quem está usando. Na versão final,
   cada função "salvar" vira uma chamada ao Supabase. */
(function () {
  'use strict';

  const KEY = 'gev-prototipo-v3';
  const POR_PAGINA = 40;

  // ---------- Estado ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const seedState = () => ({ ...clone(window.SEED), sessao: null, editId: null });
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
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const app = document.getElementById('app');
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtN = (n) => Number(n).toLocaleString('pt-BR');
  const hora = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fmtData = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' às ' + hora(d);
  };
  const fmtDataCompleta = (d) => d.toLocaleDateString('pt-BR') + ' às ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const iniciais = (nome) => nome.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const usuario = (id) => state.usuarios.find((u) => u.id === id) || { nome: 'Desconhecido', papel: '', excluido: true };
  const nomeDe = (id) => { const u = usuario(id); return u.nome + (u.excluido ? ' (conta excluída)' : ''); };
  const ativos = () => state.usuarios.filter((u) => !u.excluido);
  const produto = (id) => state.produtos.find((p) => p.id === id);
  const eu = () => state.sessao && usuario(state.sessao);
  const agora = () => new Date();
  const diasDesde = (iso) => Math.max(0, Math.floor((agora() - new Date(iso)) / 86400000));
  const dentroDe = (iso, dias) => (agora() - new Date(iso)) / 86400000 <= dias;
  const novoId = (pref) => pref + Date.now().toString(36) + Math.floor(Math.random() * 1000);
  const descricao = (p) => p.descricao || 'Sem descrição';
  const rotulo = (p) => `${p.prateleira} ${descricao(p)}`;
  const idTxt = (p) => '#' + String(p.num).padStart(4, '0');
  const proximoNum = () => state.produtos.reduce((m, p) => Math.max(m, p.num || 0), 0) + 1;
  const plural = (n, um, varios) => `${fmtN(n)} ${n === 1 ? um : varios}`;
  const dias = (n) => (n === 0 ? 'hoje' : n === 1 ? 'há 1 dia' : `há ${n} dias`);

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
    toastTimer = setTimeout(() => t.remove(), 2800);
  }

  // Vídeos de um produto (opcionalmente só de uma conta / período)
  function videosDe(pid, conta, diasJanela) {
    return state.videos.filter((v) => v.produtoId === pid && (!conta || v.conta === conta) &&
      (!diasJanela || dentroDe(v.data, diasJanela)));
  }
  function ultimoVideo(pid, conta) {
    const vs = videosDe(pid, conta);
    return vs.length ? vs.reduce((a, v) => (v.data > a ? v.data : a), vs[0].data) : null;
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
    relogio: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')
  };

  // ---------- Roteamento por hash (#produtos, #analise ...) ----------
  const PUBLICAS = ['login', 'cadastro'];
  let relogioTimer = null;
  function rotaAtual() {
    const h = (location.hash || '').replace('#', '');
    return h || (state.sessao ? 'produtos' : 'login');
  }
  function ir(rota) {
    if (location.hash === '#' + rota) render(); else location.hash = rota;
  }
  window.addEventListener('hashchange', render);

  function render() {
    // sessão de alguém cuja conta foi excluída cai para o login
    if (state.sessao && usuario(state.sessao).excluido) { state.sessao = null; save(); }
    let rota = rotaAtual();
    if (!state.sessao && !PUBLICAS.includes(rota)) rota = 'login';
    if (state.sessao && PUBLICAS.includes(rota)) rota = 'produtos';
    clearInterval(relogioTimer);
    fecharModal();
    (PAGINAS[rota] || PAGINAS.produtos)();
    window.scrollTo(0, 0);
    const h1 = $('h1'); if (h1) document.title = h1.textContent + ' | Gerenciador de Estoque e Vídeos';
  }

  // ---------- Modal (substitui confirm/alert) ----------
  function abrirModal({ titulo, corpo, botoes, alerta }) {
    fecharModal();
    const m = document.createElement('div');
    m.className = 'modal-scrim';
    m.innerHTML = `
      <div class="modal ${alerta ? 'modal-alerta' : ''}" role="dialog" aria-modal="true" aria-labelledby="m-tit">
        <h2 id="m-tit">${titulo}</h2>
        <div class="modal-corpo">${corpo || ''}</div>
        <div class="actions">${botoes.map((b, i) => `<button class="btn ${b.cls || ''}" type="button" data-b="${i}">${b.label}</button>`).join('')}</div>
      </div>`;
    document.body.appendChild(m);
    botoes.forEach((b, i) => $(`[data-b="${i}"]`, m).addEventListener('click', b.acao));
    m.addEventListener('click', (e) => { if (e.target === m) (botoes[botoes.length - 1].acao)(); });
    $('[data-b="0"]', m).focus();
    return m;
  }
  function fecharModal() { const m = $('.modal-scrim'); if (m) m.remove(); }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const m = $('.modal-scrim'); if (!m) return;
    const bs = $$('.actions .btn', m); bs[bs.length - 1].click(); // Esc = última opção (cancelar)
  });

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
          <div class="brand"><span class="brand-name">Gerenciador de Estoque e Vídeos</span><span class="brand-sub">Loja física e TikTok Shop</span></div>
          <nav class="nav" aria-label="Menu principal">${links}</nav>
          <div class="side-foot">
            <div class="user-chip">
              <span class="avatar">${iniciais(u.nome)}</span>
              <span class="who"><b>${esc(u.nome)}</b><span>${u.papel === 'admin' ? 'Admin master' : 'Funcionário'}</span></span>
            </div>
            <button class="link-btn" data-acao="sair" type="button">Sair</button>
            <p class="proto-note">Protótipo. Estoque da planilha da loja; os vídeos são exemplos.</p>
          </div>
        </aside>
        <div class="topbar-wrap">
          <header class="topbar">
            <span class="brand-name">Gerenciador de Estoque e Vídeos</span>
            <button class="link-btn" style="color:inherit" data-acao="sair" type="button">Sair</button>
          </header>
          <main class="main" id="conteudo"><div class="page">${conteudo}</div></main>
        </div>
        <nav class="tabbar" aria-label="Menu principal">${links}</nav>
      </div>`;
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-acao="sair"]')) { state.sessao = null; save(); ir('login'); }
  });

  // Filtro de conta do TikTok, reaproveitado em várias telas
  let contaSel = '';
  function seletorConta(id) {
    return `<select class="input" id="${id}" aria-label="Conta do TikTok">
      <option value="">Todas as contas</option>
      ${state.contas.map((c) => `<option value="${esc(c)}" ${contaSel === c ? 'selected' : ''}>Conta ${esc(c)}</option>`).join('')}</select>`;
  }

  // ---------- Login e cadastro ----------
  function telaAuth(formHtml) {
    app.innerHTML = `
      <div class="auth">
        <section class="auth-art">
          <div class="brand"><span class="brand-name">Gerenciador de Estoque e Vídeos</span></div>
          <div><div class="big">Cada peça<br>no lugar.<br>Cada vídeo<br>contado.</div></div>
          <div style="display:flex;flex-direction:column;gap:14px">
            <p>Estoque por prateleira, fabricantes e os vídeos que a equipe postou em cada conta do TikTok.</p>
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
    document.title = 'Entrar | Gerenciador de Estoque e Vídeos';
    telaAuth(`
      <div><h1>Entrar</h1><p class="muted" style="margin-top:6px">Use o e-mail cadastrado na loja.</p></div>
      <form id="f-login" novalidate>
        <div class="field"><label for="l-email">E-mail</label>
          <input class="input" id="l-email" type="email" autocomplete="email" placeholder="nome@loja.com"></div>
        <div class="field"><label for="l-senha">Senha</label>
          <input class="input" id="l-senha" type="password" autocomplete="current-password"></div>
        <p class="err" id="l-err" role="alert" hidden></p>
        <button class="btn" type="submit">Entrar</button>
        <p class="muted" style="font-size:.9rem">Ainda não tem acesso? <a href="#cadastro" class="link-btn">Criar conta</a></p>
      </form>
      <div class="demo-box">
        <p>Para a demonstração, entre direto com um perfil de exemplo:</p>
        <div class="demo-btns">
          <button class="btn btn-ghost" type="button" data-demo="u2">Funcionário (Márcio)</button>
          <button class="btn btn-ghost" type="button" data-demo="u1">Admin master (Ricardo)</button>
        </div>
      </div>`);
    $$('[data-demo]').forEach((b) => b.addEventListener('click', () => {
      const u = usuario(b.dataset.demo);
      if (u.excluido) { const err = $('#l-err'); err.textContent = 'Essa conta de exemplo foi excluída. Restaure os dados de exemplo pela área Admin.'; err.hidden = false; return; }
      entrar(b.dataset.demo);
    }));
    $('#f-login').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = $('#l-email').value.trim().toLowerCase();
      const senha = $('#l-senha').value;
      const err = $('#l-err');
      const falha = (m) => { err.textContent = m; err.hidden = false; };
      if (!email || !senha) return falha('Preencha o e-mail e a senha.');
      const u = state.usuarios.find((x) => x.email.toLowerCase() === email);
      if (!u) return falha('Não encontramos esse e-mail. Confira ou use um dos perfis de exemplo abaixo.');
      if (u.excluido) return falha('Essa conta foi excluída pelo admin master. Fale com o responsável pela loja.');
      entrar(u.id);
    });
  };

  PAGINAS.cadastro = function () {
    document.title = 'Criar conta | Gerenciador de Estoque e Vídeos';
    telaAuth(`
      <div><h1>Criar conta</h1><p class="muted" style="margin-top:6px">Toda conta nova começa como funcionário. O admin master pode mudar o cargo depois.</p></div>
      <form id="f-cad" novalidate>
        <div class="field"><label for="c-nome">Nome completo</label><input class="input" id="c-nome" autocomplete="name"></div>
        <div class="field"><label for="c-email">E-mail</label><input class="input" id="c-email" type="email" autocomplete="email"></div>
        <div class="field"><label for="c-senha">Senha</label><input class="input" id="c-senha" type="password" autocomplete="new-password"><span class="hint">Mínimo de 6 caracteres.</span></div>
        <div class="field"><label for="c-senha2">Confirmar senha</label><input class="input" id="c-senha2" type="password" autocomplete="new-password"></div>
        <p class="err" id="c-err" role="alert" hidden></p>
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
      if (!/^\S+@\S+\.\S+$/.test(email)) return falha('Digite um e-mail válido, como nome@loja.com.');
      if (state.usuarios.some((u) => !u.excluido && u.email.toLowerCase() === email)) return falha('Esse e-mail já tem conta. Use a tela de entrar.');
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
  const F = { busca: '', local: '', letra: '', fab: '', limite: POR_PAGINA };
  const fabricantes = () => [...new Set(state.produtos.map((p) => p.fabricante).filter(Boolean))].sort();
  const letras = () => [...new Set(state.produtos.map((p) => (p.prateleira.match(/^[A-Z]+/) || [''])[0]).filter(Boolean))].sort();
  const ordemPrat = (a, b) => a.local - b.local || a.prateleira.localeCompare(b.prateleira, 'pt-BR', { numeric: true });

  function pillEstoque(q) {
    if (q === 0) return '<span class="pill pill-out">Esgotado</span>';
    return q === 1 ? '1 peça' : `${q} peças`;
  }

  PAGINAS.produtos = function () {
    const total = state.produtos.reduce((a, p) => a + p.quantidade, 0);
    shell('produtos', `
      <div class="page-head">
        <div><h1>Produtos</h1><p>${plural(state.produtos.length, 'produto', 'produtos')} e ${plural(total, 'peça', 'peças')} em estoque, nos locais 1 e 2.</p></div>
        <a class="btn" href="#produto-novo">${ICON.mais}Adicionar produto</a>
      </div>
      <div class="toolbar">
        <div class="search">${ICON.busca}<input class="input" id="busca" type="search" placeholder="Buscar por prateleira, descrição, fabricante ou ID" value="${esc(F.busca)}" aria-label="Buscar produto"></div>
        <select class="input" id="f-local" aria-label="Local"><option value="">Todos os locais</option>
          ${[1, 2].map((l) => `<option value="${l}" ${F.local == l ? 'selected' : ''}>Local ${l}</option>`).join('')}</select>
        <select class="input" id="f-letra" aria-label="Prateleira"><option value="">Todas as prateleiras</option>
          ${letras().map((l) => `<option ${F.letra === l ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="input" id="f-fab" aria-label="Fabricante"><option value="">Todos os fabricantes</option>
          ${fabricantes().map((f) => `<option ${F.fab === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
        ${seletorConta('f-conta')}
      </div>
      <div id="lista"></div>`);

    const desenhar = () => {
      const q = F.busca.trim().toLowerCase();
      const lista = state.produtos.filter((p) =>
        (!q || p.prateleira.toLowerCase() === q || descricao(p).toLowerCase().includes(q) ||
          p.fabricante.toLowerCase().includes(q) || idTxt(p) === (q.startsWith('#') ? q : '#' + q.padStart(4, '0')) || p.prateleira.toLowerCase().startsWith(q)) &&
        (!F.local || p.local == F.local) &&
        (!F.letra || (p.prateleira.match(/^[A-Z]+/) || [''])[0] === F.letra) &&
        (!F.fab || p.fabricante === F.fab)).sort(ordemPrat);
      if (!lista.length) {
        $('#lista').innerHTML = `<div class="table-wrap"><p class="empty">Nenhum produto com esses filtros. Limpe a busca ou <a class="link-btn" href="#produto-novo">adicione um produto</a>.</p></div>`;
        return;
      }
      const vis = lista.slice(0, F.limite);
      const tituloVid = contaSel ? `Vídeos (${esc(contaSel)})` : 'Vídeos';
      $('#lista').innerHTML = `
        <p class="muted" style="font-size:.85rem;margin-bottom:10px">${plural(lista.length, 'produto encontrado', 'produtos encontrados')}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Nº prat.</th><th>Produto</th><th class="r">Peças</th><th class="r hide-sm">${tituloVid}</th><th class="hide-sm">Último vídeo</th><th class="r hide-sm">Ações</th></tr></thead>
          <tbody>${vis.map((p) => {
            const nv = videosDe(p.id, contaSel).length;
            const ult = ultimoVideo(p.id, contaSel);
            return `<tr>
              <td><span class="shelf">${esc(p.prateleira)}</span><span class="local">Local ${p.local}</span></td>
              <td class="prod"><span>${esc(descricao(p))}</span><span class="muted">${p.fabricante ? esc(p.fabricante) : 'Fabricante não informado'}</span><span class="id">ID ${idTxt(p)}</span>
                <button class="btn btn-ghost btn-sm show-sm-btn" type="button" data-editar="${p.id}">Editar</button></td>
              <td class="r num nowrap">${pillEstoque(p.quantidade)}</td>
              <td class="r num hide-sm">${nv}</td>
              <td class="hide-sm">${ult ? dias(diasDesde(ult)) : '<span class="sem-video">nenhum</span>'}</td>
              <td class="hide-sm"><div class="row-actions">
                ${p.link ? `<a class="btn btn-ghost btn-sm hide-sm" href="${esc(p.link)}" target="_blank" rel="noopener" aria-label="Abrir ${esc(p.prateleira)} no TikTok Shop">${ICON.link}</a>` : ''}
                <button class="btn btn-ghost btn-sm" type="button" data-editar="${p.id}">Editar</button>
              </div></td></tr>`;
          }).join('')}</tbody></table></div>
        ${lista.length > F.limite ? `<p style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" id="mais-prod">Mostrar mais ${Math.min(POR_PAGINA, lista.length - F.limite)} de ${lista.length - F.limite}</button></p>` : ''}`;
      const m = $('#mais-prod'); if (m) m.addEventListener('click', () => { F.limite += POR_PAGINA; desenhar(); });
    };
    desenhar();
    const mudou = (fn) => (e) => { fn(e.target.value); F.limite = POR_PAGINA; desenhar(); };
    $('#busca').addEventListener('input', mudou((v) => { F.busca = v; }));
    $('#f-local').addEventListener('change', mudou((v) => { F.local = v; }));
    $('#f-letra').addEventListener('change', mudou((v) => { F.letra = v; }));
    $('#f-fab').addEventListener('change', mudou((v) => { F.fab = v; }));
    $('#f-conta').addEventListener('change', mudou((v) => { contaSel = v; }));
    $('#lista').addEventListener('click', (e) => {
      const b = e.target.closest('[data-editar]');
      if (b) { state.editId = b.dataset.editar; save(); ir('produto-editar'); }
    });
  };

  // Formulário compartilhado entre adicionar e editar (mesmas colunas da planilha)
  function formProduto(p) {
    const v = p || { local: '', prateleira: '', descricao: '', quantidade: '', fabricante: '', link: '' };
    return `
      <form id="f-prod" class="panel form-panel" novalidate>
        <div class="grid-form">
          <div class="field"><label for="p-local">Local</label>
            <select class="input" id="p-local"><option value="">Escolha o local</option>
              ${[1, 2].map((l) => `<option value="${l}" ${v.local == l ? 'selected' : ''}>Local ${l}</option>`).join('')}</select>
            <span class="err" data-err="local"></span></div>
          <div class="field"><label for="p-prat">Nº da prateleira</label>
            <input class="input" id="p-prat" value="${esc(v.prateleira)}" placeholder="Ex.: A1" autocomplete="off" autocapitalize="characters">
            <span class="hint">Letra da prateleira e número da posição, como na planilha.</span><span class="err" data-err="prateleira"></span></div>
          <div class="field span-2"><label for="p-desc">Descrição do produto</label>
            <input class="input" id="p-desc" value="${esc(v.descricao)}" placeholder="Ex.: CALCA JEANS SKINNY CINTURA ALTA">
            <span class="err" data-err="descricao"></span></div>
          <div class="field"><label for="p-qtd">Quantidade de peças</label>
            <input class="input num" id="p-qtd" type="number" min="0" step="1" inputmode="numeric" value="${esc(v.quantidade)}">
            <span class="err" data-err="quantidade"></span></div>
          <div class="field"><label for="p-fab">Fabricante</label>
            <input class="input" id="p-fab" list="lista-fab" value="${esc(v.fabricante)}" placeholder="Ex.: DIXON JEANS" autocomplete="off">
            <datalist id="lista-fab">${fabricantes().map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
            <span class="hint">Escolha da lista para não repetir o mesmo fabricante com outro nome.</span></div>
          <div class="field span-2"><label for="p-link">Link no TikTok Shop <span class="opt">(opcional)</span></label>
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
      local: parseInt($('#p-local').value, 10) || '',
      prateleira: $('#p-prat').value.trim().toUpperCase().replace(/\s+/g, ''),
      descricao: $('#p-desc').value.trim().replace(/\s+/g, ' '),
      quantidade: $('#p-qtd').value.trim(),
      fabricante: $('#p-fab').value.trim().replace(/\s+/g, ' ').toUpperCase(),
      link: $('#p-link').value.trim()
    };
    const erros = {};
    if (!d.local) erros.local = 'Escolha o local 1 ou 2.';
    if (!/^[A-Z]{1,2}\d{1,2}$/.test(d.prateleira)) erros.prateleira = 'Use a letra e o número da posição, como A1 ou M12.';
    else {
      const ocupada = state.produtos.find((p) => p.prateleira === d.prateleira && p.id !== idAtual);
      if (ocupada) erros.prateleira = `A posição ${d.prateleira} já tem: ${descricao(ocupada)}.`;
    }
    if (!d.descricao) erros.descricao = 'Descreva o produto (modelo, tecido, público).';
    if (d.quantidade === '' || !/^\d+$/.test(d.quantidade)) erros.quantidade = 'Use um número inteiro, 0 ou maior.';
    if (d.link && !/^https:\/\/\S+\.\S+/.test(d.link)) erros.link = 'Cole o link completo, começando com https://, ou deixe em branco.';
    $$('#f-prod [data-err]').forEach((el) => {
      const k = el.dataset.err; el.textContent = erros[k] || '';
      const inp = el.parentElement.querySelector('.input'); if (inp) inp.setAttribute('aria-invalid', erros[k] ? 'true' : 'false');
    });
    const primeiro = $('#f-prod [aria-invalid="true"]');
    if (primeiro) { primeiro.focus(); return null; }
    d.quantidade = parseInt(d.quantidade, 10);
    return d;
  }

  PAGINAS['produto-novo'] = function () {
    shell('produtos', `
      <div class="page-head"><div>
        <a class="link-btn" href="#produtos">Voltar para produtos</a>
        <h1 style="margin-top:10px">Adicionar produto</h1>
        <p>Os mesmos dados da planilha de estoque: local, prateleira, descrição, peças e fabricante. O ID ${'#' + String(proximoNum()).padStart(4, '0')} é criado automaticamente.</p></div></div>
      ${formProduto(null)}`);
    $('#f-prod').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = lerFormProduto(null);
      if (!d) return;
      const num = proximoNum();
      state.produtos.push({ id: novoId('p'), num, ...d, criadoEm: agora().toISOString() });
      registrar('Adicionou produto', `${d.prateleira} ${d.descricao} (ID #${String(num).padStart(4, '0')})`);
      save();
      toast('Produto adicionado');
      ir('produtos');
    });
  };

  // Lista legível das mudanças entre o produto salvo e o formulário
  function mudancas(p, d) {
    const m = [];
    const v = (x) => (x === '' || x == null ? 'vazio' : x);
    if (d.local !== p.local) m.push(['Local', `${p.local} → ${d.local}`]);
    if (d.prateleira !== p.prateleira) m.push(['Prateleira', `${p.prateleira} → ${d.prateleira}`]);
    if (d.descricao !== p.descricao) m.push(['Descrição', `${v(p.descricao)} → ${d.descricao}`]);
    if (d.quantidade !== p.quantidade) m.push(['Peças', `${p.quantidade} → ${d.quantidade}`]);
    if (d.fabricante !== p.fabricante) m.push(['Fabricante', `${v(p.fabricante)} → ${v(d.fabricante)}`]);
    if (d.link !== (p.link || '')) m.push(['Link', d.link ? (p.link ? 'link atualizado' : 'link adicionado') : 'link removido']);
    return m;
  }

  PAGINAS['produto-editar'] = function (aviso) {
    const p = produto(state.editId);
    if (!p) { ir('produtos'); return; }
    const hist = state.registros.filter((r) => r.detalhe.startsWith(p.prateleira + ' ') || r.detalhe.startsWith(p.prateleira + ':')).slice(0, 6);
    const nv = videosDe(p.id).length, ult = ultimoVideo(p.id);
    shell('produtos', `
      <div class="page-head"><div>
        <a class="link-btn" href="#produtos">Voltar para produtos</a>
        <h1 style="margin-top:10px">Editar prateleira ${esc(p.prateleira)}</h1>
        <p>ID ${idTxt(p)}. ${esc(descricao(p))}. ${nv ? `${plural(nv, 'vídeo', 'vídeos')}, o último ${dias(diasDesde(ult))}.` : 'Ainda sem vídeos.'}</p></div></div>
      ${aviso ? `<div class="notice notice-info form-panel" role="status">${ICON.alerta}<span>${aviso}</span></div>` : ''}
      ${formProduto(p)}
      <section class="panel form-panel">
        <div class="panel-head"><h2>Histórico deste produto</h2></div>
        ${hist.length ? `<ul class="history">${hist.map((r) => `
          <li><span class="avatar">${iniciais(usuario(r.usuarioId).nome)}</span>
          <div><b>${esc(nomeDe(r.usuarioId))}</b> ${esc(r.acao.toLowerCase())}: ${esc(r.detalhe.replace(/^[A-Z]{1,2}\d{1,2}[: ]\s?/, ''))}<br><time>${fmtData(r.data)}</time></div></li>`).join('')}</ul>`
          : '<p class="muted">Nenhuma alteração registrada ainda.</p>'}
      </section>`);
    $('#f-prod').addEventListener('submit', (e) => {
      e.preventDefault();
      const d = lerFormProduto(p.id);
      if (!d) return;
      if (!mudancas(p, d).length) { toast('Nada foi alterado'); return; }
      // Mudou a descrição e o link é o mesmo: pergunta se o link continua valendo
      if (p.link && d.descricao !== p.descricao && d.link === p.link) perguntarLink(p, d);
      else confirmarEdicao(p, d);
    });
  };

  function perguntarLink(p, d) {
    const m = abrirModal({
      titulo: 'O link do produto continua o mesmo?',
      corpo: `<p class="muted">Você mudou a descrição. Se a peça no TikTok Shop também mudou, atualize o link para os vídeos e vendas continuarem ligados ao produto certo.</p>
        <div class="compare"><span><s>${esc(p.descricao)}</s></span><span><b>${esc(d.descricao)}</b></span>
        <span class="muted" style="word-break:break-all">Link atual: ${esc(p.link)}</span></div>
        <div id="m-novo" class="field" hidden><label for="m-link">Novo link do TikTok Shop</label>
          <input class="input" id="m-link" type="url" placeholder="https://www.tiktok.com/view/product/..."><span class="err" id="m-err"></span></div>`,
      botoes: [
        { label: 'Sim, manter o link', acao: () => confirmarEdicao(p, d) },
        { label: 'Não, informar novo link', cls: 'btn-ghost', acao: () => {
          const novo = $('#m-novo');
          if (novo.hidden) { novo.hidden = false; $('[data-b="1"]').textContent = 'Continuar com o novo link'; $('#m-link').focus(); return; }
          const l = $('#m-link').value.trim();
          if (!/^https:\/\/\S+\.\S+/.test(l)) { $('#m-err').textContent = 'Cole o link completo, começando com https://'; $('#m-link').setAttribute('aria-invalid', 'true'); return; }
          if (l === p.link) { $('#m-err').textContent = 'Esse é o mesmo link de antes. Use "Sim, manter o link".'; return; }
          confirmarEdicao(p, { ...d, link: l });
        } },
        { label: 'Voltar à edição', cls: 'btn-text', acao: fecharModal }
      ]
    });
    $('#m-link', m).addEventListener('input', () => { $('#m-err').textContent = ''; $('#m-link').setAttribute('aria-invalid', 'false'); });
  }

  // Pergunta final pedida: "Tem certeza das edições feitas?"
  function confirmarEdicao(p, d) {
    const m = mudancas(p, d);
    abrirModal({
      titulo: 'Tem certeza das edições feitas?',
      alerta: true,
      corpo: `<p class="muted">Confira o que vai mudar na prateleira ${esc(p.prateleira)}:</p>
        <ul class="diff">${m.map(([k, v]) => `<li><b>${k}</b><span>${esc(v)}</span></li>`).join('')}</ul>`,
      botoes: [
        { label: 'Sim, salvar edições', acao: () => salvarEdicao(p, d, m) },
        { label: 'Não, cancelar', cls: 'btn-ghost', acao: () => {
          fecharModal();
          PAGINAS['produto-editar']('Edições canceladas. Nada foi salvo; abaixo estão os dados atuais do produto.');
          window.scrollTo(0, 0);
        } }
      ]
    });
  }

  function salvarEdicao(p, d, m) {
    const prat = p.prateleira;
    Object.assign(p, d);
    registrar('Editou produto', `${prat}: ${m.map(([k, v]) => k === 'Link' ? v : `${k.toLowerCase()} ${v}`).join(', ')}`);
    save();
    fecharModal();
    toast('Edições salvas');
    ir('produtos');
  }

  // ---------- Vídeos ----------
  let filtroVideos = 'meus';
  PAGINAS.videos = function () {
    const meus30 = state.videos.filter((v) => v.usuarioId === state.sessao && dentroDe(v.data, 30)).length;
    const opcoes = [...state.produtos].sort(ordemPrat);
    shell('videos', `
      <div class="page-head"><div><h1>Vídeos</h1>
        <p>Registre cada vídeo logo depois de postar. A data e a hora são as do sistema, no momento do registro.</p></div></div>
      <form id="f-video" class="panel form-panel" novalidate>
        <div class="panel-head"><h2>Registrar vídeo</h2><p>Você postou <b class="num">${meus30}</b> nos últimos 30 dias.</p></div>
        <div class="grid-form">
          <div class="field span-2"><label for="v-prod">Produto do vídeo</label>
            <input class="input" id="v-prod" list="lista-prod" placeholder="Digite a prateleira (ex.: A1) ou parte da descrição" autocomplete="off">
            <datalist id="lista-prod">${opcoes.map((p) => `<option value="${esc(p.prateleira + ' - ' + descricao(p))}">`).join('')}</datalist>
            <span class="err" data-err="prod"></span></div>
          <div class="field"><label for="v-conta">Conta do TikTok</label>
            <select class="input" id="v-conta"><option value="">Em qual conta foi postado?</option>
              ${state.contas.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
            <span class="err" data-err="conta"></span></div>
          <div class="field"><span class="label-like">Data e hora da postagem</span>
            <div class="clock" aria-live="off">${ICON.relogio}<span id="v-agora" class="num">${fmtDataCompleta(agora())}</span></div><span class="hint">Horário do sistema, salvo no momento do registro.</span></div>
        </div>
        <div class="form-actions" style="margin-top:22px"><button class="btn" type="submit">Registrar vídeo</button></div>
      </form>
      <section>
        <div class="panel-head">
          <h2>Vídeos registrados</h2>
          <div class="toolbar">
            <div class="seg-toggle" role="group" aria-label="De quem">
              <button type="button" data-fv="meus">Meus</button>
              <button type="button" data-fv="todos">Da equipe</button>
            </div>
            ${seletorConta('fv-conta')}
          </div>
        </div>
        <div id="lista-videos"></div>
      </section>`);

    relogioTimer = setInterval(() => { const el = $('#v-agora'); if (el) el.textContent = fmtDataCompleta(agora()); }, 1000);

    let limite = 20;
    const desenhar = () => {
      const lista = state.videos.filter((v) => (filtroVideos === 'todos' || v.usuarioId === state.sessao) && (!contaSel || v.conta === contaSel));
      const vis = lista.slice(0, limite);
      const equipe = filtroVideos === 'todos';
      $('#lista-videos').innerHTML = vis.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Data e hora</th><th>Produto</th><th class="hide-sm">Conta</th>${equipe ? '<th class="hide-sm">Quem postou</th>' : ''}</tr></thead>
          <tbody>${vis.map((v) => { const p = produto(v.produtoId) || { prateleira: '?', descricao: 'Produto removido' }; return `
            <tr><td class="num" style="white-space:nowrap">${fmtData(v.data)}</td>
              <td class="prod"><span><b>${esc(p.prateleira)}</b> ${esc(descricao(p))}</span><span class="show-sm"><span class="conta">${esc(v.conta)}</span>${equipe ? ' ' + esc(nomeDe(v.usuarioId)) : ''}</span></td>
              <td class="hide-sm"><span class="conta">${esc(v.conta)}</span></td>
              ${equipe ? `<td class="hide-sm">${esc(nomeDe(v.usuarioId))}</td>` : ''}
              </tr>`; }).join('')}
          </tbody></table></div>
        ${lista.length > limite ? `<p style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" id="mais-vid">Mostrar mais ${Math.min(20, lista.length - limite)} de ${lista.length - limite}</button></p>` : ''}`
        : `<div class="table-wrap"><p class="empty">${filtroVideos === 'meus' ? 'Nenhum vídeo seu' : 'Nenhum vídeo'}${contaSel ? ' na conta ' + esc(contaSel) : ''} ainda. Use o formulário acima depois de postar.</p></div>`;
      $$('[data-fv]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fv === filtroVideos)));
      const m = $('#mais-vid'); if (m) m.addEventListener('click', () => { limite += 20; desenhar(); });
    };
    desenhar();
    $$('[data-fv]').forEach((b) => b.addEventListener('click', () => { filtroVideos = b.dataset.fv; limite = 20; desenhar(); }));
    $('#fv-conta').addEventListener('change', (e) => { contaSel = e.target.value; limite = 20; desenhar(); });

    $('#f-video').addEventListener('submit', (e) => {
      e.preventDefault();
      const txt = $('#v-prod').value.trim();
      const prat = txt.split(/\s+-\s+|\s+/)[0].toUpperCase();
      const p = state.produtos.find((x) => x.prateleira + ' - ' + descricao(x) === txt) || state.produtos.find((x) => x.prateleira === prat);
      const conta = $('#v-conta').value;
      const erros = {};
      if (!txt) erros.prod = 'Escolha o produto que aparece no vídeo.';
      else if (!p) erros.prod = 'Não achamos esse produto. Digite o nº da prateleira, como A1, e escolha da lista.';
      if (!conta) erros.conta = 'Escolha a conta onde o vídeo foi postado.';
      $$('#f-video [data-err]').forEach((el) => {
        el.textContent = erros[el.dataset.err] || '';
        el.parentElement.querySelector('.input').setAttribute('aria-invalid', erros[el.dataset.err] ? 'true' : 'false');
      });
      if (Object.keys(erros).length) { $('#f-video [aria-invalid="true"]').focus(); return; }
      const quando = agora(); // data e hora do sistema
      state.videos.unshift({ id: novoId('v'), produtoId: p.id, usuarioId: state.sessao, conta, data: quando.toISOString() });
      save();
      toast(`Vídeo registrado em ${fmtData(quando.toISOString())}`);
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
  function grafico(linhas, opts) {
    const o = opts || {};
    const maior = Math.max(...linhas.map((l) => l.segs.reduce((a, s) => a + s.v, 0)));
    const e = escala(maior);
    const cls = o.largo ? 'bars-largo' : '';
    return `<div class="bars ${cls}">${linhas.map((l) => {
      const total = l.segs.reduce((a, s) => a + s.v, 0);
      const titulo = l.segs.map((s) => `${s.nome}: ${s.v}`).join(', ');
      return `<div class="bar-row">
        <span class="bar-label" title="${esc(l.titulo || '')}">${l.label}</span>
        <div class="bar-track" title="${esc(titulo)}" role="img" aria-label="${esc((l.titulo || '') + ': ' + titulo)}">${l.segs.filter((s) => s.v > 0).map((s) =>
          `<span class="bar-seg ${s.cls}" style="width:${(s.v / e.max) * 100}%"></span>`).join('')}</div>
        <span class="bar-val">${l.valor != null ? l.valor : fmtN(total)}</span></div>`;
    }).join('')}</div>
    <div class="axis ${cls}" aria-hidden="true"><span></span><div class="ticks">${e.ticks.map((t) => `<span>${fmtN(t)}</span>`).join('')}</div><span></span></div>`;
  }

  // Semanas do mês, como nas colunas da planilha
  const SEMANAS = [[1, 3], [4, 10], [11, 17], [18, 24], [25, 31]];
  const rotSemana = ([a, b]) => `${String(a).padStart(2, '0')} a ${String(b).padStart(2, '0')}`;

  // ---------- Análise dos produtos ----------
  let mesAnalise = null, limiteNunca = 10;
  PAGINAS.analise = function () {
    const conta = contaSel;
    const dados = state.produtos.map((p) => {
      const vs = videosDe(p.id, conta);
      const ult = vs.length ? vs.reduce((a, v) => (v.data > a ? v.data : a), vs[0].data) : null;
      return { p, videos: vs.length, ult, semVideo: ult ? diasDesde(ult) : null };
    });
    const vids30 = state.videos.filter((v) => (!conta || v.conta === conta) && dentroDe(v.data, 30)).length;
    const nunca = dados.filter((d) => !d.videos).sort((a, b) => b.p.quantidade - a.p.quantidade || ordemPrat(a.p, b.p));
    const nuncaComEstoque = nunca.filter((d) => d.p.quantidade > 0).length;
    const maisVideos = dados.filter((d) => d.videos).sort((a, b) => b.videos - a.videos || ordemPrat(a.p, b.p)).slice(0, 10);
    const parados = dados.filter((d) => d.videos && d.p.quantidade > 0).sort((a, b) => b.semVideo - a.semVideo || a.videos - b.videos).slice(0, 10);
    const pecasSemVideo = nunca.reduce((a, d) => a + d.p.quantidade, 0);
    const rot = (p) => `<b>${esc(p.prateleira)}</b>${esc(descricao(p))}`;

    // meses que têm vídeos, para a tabela por semana
    const meses = [...new Set(state.videos.map((v) => v.data.slice(0, 7)))].sort().reverse();
    // começa pelo mês com mais vídeos registrados
    const qtdMes = (m) => state.videos.filter((v) => v.data.slice(0, 7) === m).length;
    if (!mesAnalise || !meses.includes(mesAnalise)) mesAnalise = [...meses].sort((a, b) => qtdMes(b) - qtdMes(a))[0];
    const nomeMes = (m) => new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    shell('analise', `
      <div class="page-head"><div><h1>Análise dos produtos</h1>
        <p>${conta ? `Só a conta ${esc(conta)}.` : 'Todas as contas do TikTok.'} Quais peças têm mais vídeos e quais estão paradas.</p></div>
        ${seletorConta('a-conta')}</div>
      <div class="stats">
        <div class="stat"><span class="v">${vids30}</span><span class="l">vídeos nos últimos 30 dias</span></div>
        <div class="stat"><span class="v">${dados.filter((d) => d.videos).length}</span><span class="l">produtos com vídeo</span></div>
        <div class="stat"><span class="v">${nunca.length}</span><span class="l">produtos sem nenhum vídeo</span></div>
        <div class="stat"><span class="v">${fmtN(pecasSemVideo)}</span><span class="l">peças em estoque sem vídeo</span></div>
      </div>
      <div class="two-col">
        <section class="panel">
          <div class="panel-head"><div><h2>Peças com mais vídeos</h2><p>Total de vídeos por produto.</p></div></div>
          ${maisVideos.length ? grafico(maisVideos.map((d) => ({ label: rot(d.p), titulo: rotulo(d.p),
            segs: [{ v: d.videos, cls: 'c-denim', nome: 'Vídeos' }] }))) : '<p class="muted">Nenhum vídeo registrado nessa conta.</p>'}
        </section>
        <section class="panel">
          <div class="panel-head"><div><h2>Há mais tempo sem vídeo</h2><p>Peças em estoque, em dias desde o último vídeo.</p></div></div>
          ${parados.length ? grafico(parados.map((d) => ({ label: rot(d.p), titulo: `${rotulo(d.p)}, último vídeo em ${fmtData(d.ult)}`,
            valor: `${d.semVideo} d`, segs: [{ v: d.semVideo, cls: 'c-tiktok', nome: 'Dias sem vídeo' }] })), { largo: true }) : '<p class="muted">Nenhum produto com vídeo nessa conta.</p>'}
        </section>
      </div>
      <section>
        <div class="panel-head"><div><h2>Nunca tiveram vídeo</h2>
          <p>${plural(nunca.length, 'produto', 'produtos')}${conta ? ' nessa conta' : ''}, ${nuncaComEstoque} com peças em estoque. Os com mais peças aparecem primeiro.</p></div></div>
        <div id="lista-nunca"></div>
      </section>
      ${mesAnalise ? `<section>
        <div class="panel-head"><div><h2>Vídeos por conta e semana</h2><p>No formato da planilha da loja.</p></div>
          <select class="input" id="a-mes" aria-label="Mês" style="width:auto">${meses.map((m) => `<option value="${m}" ${m === mesAnalise ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select></div>
        <div class="table-wrap"><table class="semanas">
          <thead><tr><th>Conta</th>${SEMANAS.map((s) => `<th class="r">${rotSemana(s)}</th>`).join('')}<th class="r">Total</th></tr></thead>
          <tbody>${state.contas.map((c) => {
            const vs = state.videos.filter((v) => v.conta === c && v.data.slice(0, 7) === mesAnalise);
            const porSem = SEMANAS.map(([a, b]) => vs.filter((v) => { const d = new Date(v.data).getDate(); return d >= a && d <= b; }).length);
            return `<tr class="${conta && conta !== c ? 'apagado' : ''}"><td class="code">${esc(c)}</td>${porSem.map((n) => `<td class="r num">${n || '<span class="muted">0</span>'}</td>`).join('')}<td class="r num"><b>${vs.length}</b></td></tr>`;
          }).join('')}</tbody></table></div>
      </section>` : ''}`);

    const desenharNunca = () => {
      const vis = nunca.slice(0, limiteNunca);
      $('#lista-nunca').innerHTML = nunca.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Nº prat.</th><th>Produto</th><th class="r">Peças</th><th class="r hide-sm">Sem vídeo há</th></tr></thead>
          <tbody>${vis.map((d) => `<tr>
            <td><span class="shelf">${esc(d.p.prateleira)}</span><span class="local">Local ${d.p.local}</span></td>
            <td class="prod"><span>${esc(descricao(d.p))}</span><span class="muted">${esc(d.p.fabricante || 'Fabricante não informado')}</span></td>
            <td class="r num">${pillEstoque(d.p.quantidade)}</td>
            <td class="r num hide-sm">${diasDesde(d.p.criadoEm)} dias <span class="muted">(desde o cadastro)</span></td></tr>`).join('')}</tbody></table></div>
        ${nunca.length > limiteNunca ? `<p style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" id="mais-nunca">Mostrar mais ${Math.min(20, nunca.length - limiteNunca)} de ${nunca.length - limiteNunca}</button></p>` : ''}`
        : '<div class="table-wrap"><p class="empty">Todos os produtos já têm pelo menos um vídeo.</p></div>';
      const m = $('#mais-nunca'); if (m) m.addEventListener('click', () => { limiteNunca += 20; desenharNunca(); });
    };
    desenharNunca();
    $('#a-conta').addEventListener('change', (e) => { contaSel = e.target.value; limiteNunca = 10; render(); });
    const am = $('#a-mes'); if (am) am.addEventListener('change', (e) => { mesAnalise = e.target.value; render(); });
  };

  // ---------- Admin master ----------
  let periodoAdmin = 30, filtroUsuario = '', filtroAcao = '', limiteReg = 15;
  PAGINAS.admin = function () {
    if (eu().papel !== 'admin') {
      shell('admin', `<div class="page-head"><div><h1>Admin master</h1></div></div>
        <div class="notice">${ICON.alerta}<span>Esta área é só para o admin master. Peça acesso ao responsável pela loja.</span></div>`);
      return;
    }
    const acoes = ['Adicionou produto', 'Editou produto', 'Registrou vídeo', 'Criou conta', 'Alterou cargo', 'Excluiu conta', 'Importou planilha'];
    shell('admin', `
      <div class="page-head"><div><h1>Admin master</h1><p>Vídeos de cada pessoa, a equipe e tudo o que foi alterado no sistema.</p></div></div>
      <section class="panel">
        <div class="panel-head"><h2>Vídeos por pessoa</h2>
          <div class="toolbar">
            <div class="seg-toggle" role="group" aria-label="Período">
              <button type="button" data-per="7">7 dias</button><button type="button" data-per="30">30 dias</button>
            </div>
            ${seletorConta('ad-conta')}
          </div></div>
        <div id="graf-usuarios"></div>
      </section>
      <section>
        <div class="panel-head"><div><h2>Equipe</h2><p>Mude o cargo para dar ou tirar o acesso à área Admin. Contas excluídas não conseguem mais entrar.</p></div></div>
        <div id="equipe"></div>
      </section>
      <section>
        <div class="panel-head"><h2>Registros da equipe</h2>
          <div class="toolbar">
            <select class="input" id="r-user" aria-label="Filtrar por pessoa"><option value="">Todas as pessoas</option>
              ${state.usuarios.map((u) => `<option value="${u.id}" ${filtroUsuario === u.id ? 'selected' : ''}>${esc(nomeDe(u.id))}</option>`).join('')}</select>
            <select class="input" id="r-acao" aria-label="Filtrar por tipo"><option value="">Todas as ações</option>
              ${acoes.map((a) => `<option ${filtroAcao === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
          </div></div>
        <div id="lista-reg"></div>
      </section>
      <section class="panel" style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between">
        <p class="muted" style="max-width:60ch">Este protótipo guarda as alterações só neste navegador. Para recomeçar a demonstração do zero:</p>
        <button class="btn btn-ghost" type="button" id="reset">Restaurar dados de exemplo</button>
      </section>`);

    const desenharGrafico = () => {
      const linhas = ativos().map((u) => {
        const vs = state.videos.filter((v) => v.usuarioId === u.id && (!contaSel || v.conta === contaSel) && dentroDe(v.data, periodoAdmin));
        return { u, n: vs.length };
      }).sort((a, b) => b.n - a.n);
      $('#graf-usuarios').innerHTML = grafico(linhas.map((l) => ({
        label: `<b>${esc(l.u.nome)}</b>`, titulo: l.u.nome,
        segs: [{ v: l.n, cls: 'c-denim', nome: 'Vídeos' }] })));
      $$('[data-per]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.per === periodoAdmin)));
    };

    const desenharEquipe = () => {
      const admins = ativos().filter((u) => u.papel === 'admin').length;
      $('#equipe').innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>Pessoa</th><th>Cargo</th><th class="r hide-sm">Vídeos em 30 dias</th><th class="r hide-sm">Ações</th></tr></thead>
          <tbody>${ativos().map((u) => {
            const voce = u.id === state.sessao;
            const n = state.videos.filter((v) => v.usuarioId === u.id && dentroDe(v.data, 30)).length;
            return `<tr>
              <td class="prod"><span><b>${esc(u.nome)}</b>${voce ? ' <span class="voce">você</span>' : ''}</span><span class="muted">${esc(u.email)}</span></td>
              <td>${voce
                ? `<span class="pill ${u.papel === 'admin' ? 'pill-admin' : 'pill-ok'}">${u.papel === 'admin' ? 'Admin master' : 'Funcionário'}</span>`
                : `<select class="input input-sm" data-cargo="${u.id}" aria-label="Cargo de ${esc(u.nome)}">
                    <option value="funcionario" ${u.papel !== 'admin' ? 'selected' : ''}>Funcionário</option>
                    <option value="admin" ${u.papel === 'admin' ? 'selected' : ''}>Admin master</option></select>
                  <button class="btn btn-danger-ghost btn-sm show-sm-btn" type="button" data-excluir="${u.id}">Excluir conta</button>`}</td>
              <td class="r num hide-sm">${n}</td>
              <td class="hide-sm"><div class="row-actions">${voce ? '<span class="muted" style="font-size:.82rem">Sua conta</span>'
                : `<button class="btn btn-danger-ghost btn-sm" type="button" data-excluir="${u.id}">Excluir</button>`}</div></td></tr>`;
          }).join('')}</tbody></table></div>
        <p class="muted" style="font-size:.85rem;margin-top:10px">${plural(admins, 'admin master', 'admins master')} ativos. Você não pode mudar o próprio cargo nem excluir a própria conta.</p>`;
    };

    const desenharRegistros = () => {
      const deVideos = state.videos.map((v) => {
        const p = produto(v.produtoId);
        return { usuarioId: v.usuarioId, acao: 'Registrou vídeo', detalhe: `${p ? rotulo(p) : 'produto removido'} na conta ${v.conta}`, data: v.data };
      });
      const todos = [...state.registros, ...deVideos]
        .filter((r) => (!filtroUsuario || r.usuarioId === filtroUsuario) && (!filtroAcao || r.acao === filtroAcao))
        .sort((a, b) => b.data.localeCompare(a.data));
      const vis = todos.slice(0, limiteReg);
      $('#lista-reg').innerHTML = vis.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Quando</th><th class="hide-sm">Quem</th><th>O que fez</th></tr></thead>
          <tbody>${vis.map((r) => `<tr>
            <td class="num" style="white-space:nowrap">${fmtData(r.data)}</td>
            <td class="hide-sm" style="white-space:nowrap">${esc(nomeDe(r.usuarioId))}</td>
            <td class="prod"><b>${esc(r.acao)}</b><span class="show-sm">${esc(nomeDe(r.usuarioId))}</span><span class="muted">${esc(r.detalhe)}</span></td></tr>`).join('')}</tbody></table></div>
        ${todos.length > limiteReg ? `<p style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" id="mais-reg">Mostrar mais ${Math.min(15, todos.length - limiteReg)} de ${todos.length - limiteReg}</button></p>` : ''}`
        : '<div class="table-wrap"><p class="empty">Nenhum registro com esses filtros.</p></div>';
      const m = $('#mais-reg'); if (m) m.addEventListener('click', () => { limiteReg += 15; desenharRegistros(); });
    };

    desenharGrafico(); desenharEquipe(); desenharRegistros();
    $$('[data-per]').forEach((b) => b.addEventListener('click', () => { periodoAdmin = +b.dataset.per; desenharGrafico(); }));
    $('#ad-conta').addEventListener('change', (e) => { contaSel = e.target.value; desenharGrafico(); });
    $('#r-user').addEventListener('change', (e) => { filtroUsuario = e.target.value; limiteReg = 15; desenharRegistros(); });
    $('#r-acao').addEventListener('change', (e) => { filtroAcao = e.target.value; limiteReg = 15; desenharRegistros(); });

    // Mudar cargo (com confirmação)
    $('#equipe').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-cargo]'); if (!sel) return;
      const u = usuario(sel.dataset.cargo), novo = sel.value;
      const voltar = () => { sel.value = u.papel === 'admin' ? 'admin' : 'funcionario'; fecharModal(); };
      const virarAdmin = novo === 'admin';
      abrirModal({
        titulo: virarAdmin ? `Tornar ${esc(u.nome)} admin master?` : `Tirar o acesso de admin de ${esc(u.nome)}?`,
        corpo: `<p class="muted">${virarAdmin
          ? 'Essa pessoa vai acessar a área Admin: ver os registros de todos, mudar cargos e excluir contas.'
          : 'Essa pessoa volta a ser funcionário e deixa de ver a área Admin.'}</p>`,
        botoes: [
          { label: virarAdmin ? 'Tornar admin master' : 'Mudar para funcionário', acao: () => {
            const antes = u.papel === 'admin' ? 'admin master' : 'funcionário';
            u.papel = novo;
            registrar('Alterou cargo', `${u.nome}: ${antes} → ${virarAdmin ? 'admin master' : 'funcionário'}`);
            save(); fecharModal(); toast('Cargo alterado'); desenharEquipe(); desenharRegistros();
          } },
          { label: 'Cancelar', cls: 'btn-ghost', acao: voltar }
        ]
      });
    });

    // Excluir conta (com confirmação)
    $('#equipe').addEventListener('click', (e) => {
      const b = e.target.closest('[data-excluir]'); if (!b) return;
      const u = usuario(b.dataset.excluir);
      const n = state.videos.filter((v) => v.usuarioId === u.id).length;
      abrirModal({
        titulo: `Excluir a conta de ${esc(u.nome)}?`,
        alerta: true,
        corpo: `<p class="muted">${esc(u.email)} não vai mais conseguir entrar no sistema. ${n ? `Os ${plural(n, 'vídeo', 'vídeos')} e registros dessa pessoa continuam no histórico.` : ''}</p>`,
        botoes: [
          { label: 'Excluir conta', cls: 'btn-red', acao: () => {
            u.excluido = true; u.papel = 'funcionario';
            registrar('Excluiu conta', `${u.nome} (${u.email})`);
            save(); fecharModal(); toast('Conta excluída'); desenharGrafico(); desenharEquipe(); desenharRegistros();
          } },
          { label: 'Cancelar', cls: 'btn-ghost', acao: fecharModal }
        ]
      });
    });

    $('#reset').addEventListener('click', () => {
      abrirModal({
        titulo: 'Restaurar os dados de exemplo?',
        corpo: '<p class="muted">Tudo o que foi alterado neste navegador será desfeito, inclusive cargos e contas excluídas.</p>',
        botoes: [
          { label: 'Restaurar', acao: () => {
            const sess = state.sessao;
            state = seedState(); state.sessao = usuario(sess).excluido ? 'u1' : sess; save();
            fecharModal(); toast('Dados de exemplo restaurados'); render();
          } },
          { label: 'Cancelar', cls: 'btn-ghost', acao: fecharModal }
        ]
      });
    });
  };

  render();
})();
