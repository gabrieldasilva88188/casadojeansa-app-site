/* Gerenciador de Estoque e Vídeos.
   Os dados vêm do Supabase (js/supa.js): login, perfis, produtos, vídeos e vendas.
   As regras de quem pode ver e alterar o quê ficam no próprio banco (RLS). */
(function () {
  'use strict';

  const POR_PAGINA = 40;
  const { auth, db } = window.Supa;

  // ---------- Estado (cópia do banco na memória) ----------
  const vazio = () => ({ contas: [], contaId: {}, contaNome: {}, fabricantes: [], usuarios: [], produtos: [], videos: [],
    vendas: [], registros: [], sessao: null, perfil: null, editId: null, carregadoEm: 0 });
  let state = vazio();

  async function carregarPerfil() {
    const u = auth.usuario();
    const r = await db.listar('perfis', `select=id,nome,email,papel,fixo,ativo,aprovado,senha_provisoria&id=eq.${u.id}`);
    state.sessao = u.id;
    state.perfil = r[0] || null;
  }

  async function carregarDados() {
    const admin = state.perfil && state.perfil.papel === 'admin';
    const [contas, fabs, prods, vids, perfis, vendas, regs] = await Promise.all([
      db.listar('contas_tiktok', 'select=id,nome,ordem,ativa&order=ordem,nome'),
      db.listar('fabricantes', 'select=id,nome&order=nome'),
      db.listar('produtos', 'select=id,local,prateleira,descricao,quantidade,fabricante_id,link_tiktok,criado_em,excluido_em&order=id'),
      db.listar('videos', 'select=id,produto_id,conta_id,usuario_id,postado_em&order=postado_em.desc,id.desc'),
      db.listar('perfis', 'select=id,nome,email,papel,fixo,ativo,aprovado,criado_em&order=nome'),
      admin ? db.listar('vendas', 'select=id,produto_id,conta_id,quantidade,vendido_em,criado_por,criado_em&order=vendido_em.desc,id.desc') : [],
      admin ? db.listar('registros', 'select=id,usuario_id,acao,tabela,registro_id,detalhe,mudancas,criado_em&order=criado_em.desc,id.desc') : []
    ]);
    state.contaId = {}; state.contaNome = {};
    contas.forEach((c) => { state.contaId[c.nome] = c.id; state.contaNome[c.id] = c.nome; });
    state.contas = contas.filter((c) => c.ativa).map((c) => c.nome);
    state.contasTodas = contas;   // inclui as excluídas (ativa = false), para a tela de Admin
    state.fabricantes = fabs;
    const nomeFab = Object.fromEntries(fabs.map((f) => [f.id, f.nome]));
    // produtosTodos inclui os excluídos (para vídeos, vendas e histórico); produtos = só os da lista
    state.produtosTodos = prods.map((x) => ({ id: String(x.id), num: x.id, local: x.local, prateleira: x.prateleira,
      descricao: x.descricao, quantidade: x.quantidade, fabricante: nomeFab[x.fabricante_id] || '',
      link: x.link_tiktok || '', criadoEm: x.criado_em, excluido: !!x.excluido_em }));
    state.produtos = state.produtosTodos.filter((x) => !x.excluido);
    state.videos = vids.map((v) => ({ id: String(v.id), produtoId: String(v.produto_id), usuarioId: v.usuario_id,
      conta: state.contaNome[v.conta_id] || '?', data: v.postado_em }));
    state.usuarios = perfis.map((u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, fixo: u.fixo,
      aprovado: u.aprovado, excluido: !u.ativo, criadoEm: u.criado_em }));
    state.vendas = vendas.map((v) => ({ id: String(v.id), produtoId: String(v.produto_id), conta: state.contaNome[v.conta_id] || '?',
      quantidade: v.quantidade, data: v.vendido_em, criadoPor: v.criado_por, criadoEm: v.criado_em }));
    state.registros = regs.map((x) => ({ usuarioId: x.usuario_id, acao: x.acao, tabela: x.tabela, registroId: x.registro_id,
      detalhe: x.detalhe, mudancas: x.mudancas, data: x.criado_em }));
    state.carregadoEm = Date.now();
    const meu = state.usuarios.find((u) => u.id === state.sessao);
    if (meu && state.perfil) state.perfil.papel = meu.papel;
  }

  // Telas especiais antes de entrar no sistema
  function portao() {
    if (!state.sessao) return null;
    const p = state.perfil;
    if (!p || (!p.aprovado && p.ativo)) return 'pendente';
    if (!p.ativo) return 'sem-acesso';
    if (p.senha_provisoria || recuperandoSenha) return 'nova-senha';
    return null;
  }
  let recuperandoSenha = false;   // chegou pelo link "Esqueci minha senha" do e-mail

  async function iniciar(rotaDepois) {
    if (!auth.logado()) { state = vazio(); render(); return; }
    telaSimples('Carregando…');
    try {
      await carregarPerfil();
      if (!portao()) await carregarDados();
    } catch (e) {
      if (e.status === 401 || e.status === 400 || e.status === 403) { await auth.sair(); state = vazio(); render(); return; }
      telaSimples(e.message, true);
      return;
    }
    if (rotaDepois && location.hash !== '#' + rotaDepois) { location.hash = rotaDepois; return; }
    render();
  }

  // Executa uma gravação no banco: trava o botão, mostra o erro em português
  async function executar(btn, fn, okMsg) {
    let html;
    if (btn) { html = btn.innerHTML; btn.disabled = true; btn.textContent = 'Salvando…'; }
    try {
      await fn();
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) {
      toast(e.message, true);
      return false;
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = html; }
    }
  }

  async function idFabricante(nome) {
    if (!nome) return null;
    const achar = () => state.fabricantes.find((f) => f.nome === nome);
    if (achar()) return achar().id;
    try {
      const f = await db.inserir('fabricantes', { nome });
      state.fabricantes.push(f);
      return f.id;
    } catch (e) {
      if (e.code !== '23505') throw e;
      state.fabricantes = await db.listar('fabricantes', 'select=id,nome&order=nome');
      return achar().id;
    }
  }

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
  const ativos = () => state.usuarios.filter((u) => !u.excluido && u.aprovado);
  const pendentes = () => state.usuarios.filter((u) => !u.excluido && !u.aprovado);
  const produto = (id) => (state.produtosTodos || state.produtos).find((p) => p.id === id);
  const eu = () => state.sessao && usuario(state.sessao);
  const agora = () => new Date();
  const diasDesde = (iso) => Math.max(0, Math.floor((agora() - new Date(iso)) / 86400000));
  const dentroDe = (iso, dias) => (agora() - new Date(iso)) / 86400000 <= dias;
  const descricao = (p) => p.descricao || 'Sem descrição';
  const rotulo = (p) => `${p.prateleira} ${descricao(p)}`;
  const idTxt = (p) => '#' + String(p.num).padStart(4, '0');
  const plural = (n, um, varios) => `${fmtN(n)} ${n === 1 ? um : varios}`;
  const dias = (n) => (n === 0 ? 'hoje' : n === 1 ? 'há 1 dia' : `há ${n} dias`);

  let toastTimer;
  function toast(msg, erro) {
    const old = $('.toast'); if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'toast' + (erro ? ' toast-erro' : ''); t.setAttribute('role', erro ? 'alert' : 'status'); t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), erro ? 6000 : 2800);
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
    cima: ic('<path d="m6 15 6-6 6 6"/>'),
    baixo: ic('<path d="m6 9 6 6 6-6"/>'),
    qr: ic('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>'),
    copiar: ic('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
    certo: ic('<path d="m5 12 5 5 9-10"/>'),
    relogio: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    vendas: ic('<path d="M3 5h2l2.2 10.5a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="16.5" cy="19.5" r="1.3"/>')
  };

  // ---------- Roteamento por hash (#produtos, #analise ...) ----------
  const PUBLICAS = ['login', 'cadastro', 'esqueci'];
  let relogioTimer = null;
  function rotaAtual() {
    const h = (location.hash || '').replace('#', '');
    return h || (state.sessao ? 'produtos' : 'login');
  }
  function ir(rota) {
    if (location.hash === '#' + rota) render(); else location.hash = rota;
  }
  // Ao trocar de tela, atualiza os dados se a última leitura tiver mais de 30 segundos
  window.addEventListener('hashchange', async () => {
    if (state.sessao && !portao() && Date.now() - state.carregadoEm > 30000) {
      try { await carregarDados(); } catch (e) { /* segue com o que já tem */ }
    }
    render();
  });

  function telaSimples(msg, erro) {
    app.innerHTML = `<div class="tela-simples"><p class="${erro ? 'err' : 'muted'}">${esc(msg)}</p>
      ${erro ? '<button class="btn" type="button" onclick="location.reload()">Tentar de novo</button>' : ''}</div>`;
  }

  function render() {
    let rota = rotaAtual();
    const g = portao();
    if (g) rota = g;
    else if (!state.sessao && !PUBLICAS.includes(rota)) rota = 'login';
    else if (state.sessao && PUBLICAS.includes(rota)) rota = 'produtos';
    clearInterval(relogioTimer);
    fecharModal();
    (PAGINAS[rota] || PAGINAS.produtos)();
    if (PUBLICAS.includes(rota)) return;
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
    const np = pendentes().length;
    if (u.papel === 'admin') itens.push(['vendas', 'Vendas', ICON.vendas], ['admin', np ? `Admin <b class="badge" aria-label="${np} cadastros aguardando">${np}</b>` : 'Admin', ICON.admin]);
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
              <span class="who"><b>${esc(u.nome)}</b><span>${u.papel === 'admin' ? 'Admin master' : 'Colaborador'}</span></span>
            </div>
            <div class="side-links"><button class="link-btn" data-acao="senha" type="button">Alterar senha</button>
            <button class="link-btn" data-acao="sair" type="button">Sair</button></div>
          </div>
        </aside>
        <div class="topbar-wrap">
          <header class="topbar">
            <span class="brand-name">Gerenciador de Estoque e Vídeos</span>
            <span class="top-links"><button class="link-btn" style="color:inherit" data-acao="senha" type="button">Senha</button>
            <button class="link-btn" style="color:inherit" data-acao="sair" type="button">Sair</button></span>
          </header>
          <main class="main" id="conteudo"><div class="page">${conteudo}</div></main>
        </div>
        <nav class="tabbar" aria-label="Menu principal">${links}</nav>
      </div>`;
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-acao="sair"]')) {
      recuperandoSenha = false;
      auth.sair().then(() => { state = vazio(); if (location.hash === '#login') render(); else location.hash = 'login'; });
    }
    if (e.target.closest('[data-acao="senha"]')) modalSenha();
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
          <span></span>
          <div><div class="big">Gerenciador<br>de Estoque<br>e Vídeos</div></div>
          <div style="display:flex;flex-direction:column;gap:14px">
            <p>Estoque por prateleira, fabricantes e os vídeos que a equipe postou em cada conta do TikTok.</p>
            <div class="tag"><span class="stitch"></span>Loja física e TikTok Shop</div>
          </div>
        </section>
        <section class="auth-form"><div class="auth-box">${formHtml}</div></section>
      </div>`;
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
        <p class="muted" style="font-size:.9rem">Ainda não tem acesso? <a href="#cadastro" class="link-btn">Pedir acesso</a></p>
        <p class="muted" style="font-size:.9rem"><a href="#esqueci" class="link-btn">Esqueci minha senha</a></p>
      </form>`);
    $('#f-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#l-email').value.trim().toLowerCase();
      const senha = $('#l-senha').value;
      const err = $('#l-err');
      const falha = (m) => { err.textContent = m; err.hidden = false; };
      if (!email || !senha) return falha('Preencha o e-mail e a senha.');
      err.hidden = true;
      const btn = e.submitter || $('#f-login button[type=submit]');
      btn.disabled = true; btn.textContent = 'Entrando…';
      try {
        await auth.entrar(email, senha);
        await iniciar('produtos');
      } catch (er) {
        btn.disabled = false; btn.textContent = 'Entrar';
        falha(er.message);
      }
    });
  };

  PAGINAS.cadastro = function () {
    document.title = 'Criar conta | Gerenciador de Estoque e Vídeos';
    telaAuth(`
      <div><h1>Pedir acesso</h1><p class="muted" style="margin-top:6px">Crie sua conta. Você entra como colaborador assim que um admin master aprovar o cadastro.</p></div>
      <form id="f-cad" novalidate>
        <div class="field"><label for="c-nome">Nome completo</label><input class="input" id="c-nome" autocomplete="name"></div>
        <div class="field"><label for="c-email">E-mail</label><input class="input" id="c-email" type="email" autocomplete="email"></div>
        <div class="field"><label for="c-senha">Senha</label><input class="input" id="c-senha" type="password" autocomplete="new-password"><span class="hint">Mínimo de 6 caracteres.</span></div>
        <div class="field"><label for="c-senha2">Confirmar senha</label><input class="input" id="c-senha2" type="password" autocomplete="new-password"></div>
        <p class="err" id="c-err" role="alert" hidden></p>
        <button class="btn" type="submit">Enviar cadastro</button>
        <p class="muted" style="font-size:.9rem">Já tem conta? <a href="#login" class="link-btn">Entrar</a></p>
      </form>`);
    $('#f-cad').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nome = $('#c-nome').value.trim();
      const email = $('#c-email').value.trim().toLowerCase();
      const s1 = $('#c-senha').value, s2 = $('#c-senha2').value;
      const err = $('#c-err');
      const falha = (m) => { err.textContent = m; err.hidden = false; };
      if (!nome || !email || !s1) return falha('Preencha nome, e-mail e senha.');
      if (!/^\S+@\S+\.\S+$/.test(email)) return falha('Digite um e-mail válido, como nome@loja.com.');
      if (s1.length < 6) return falha('A senha precisa ter pelo menos 6 caracteres.');
      if (s1 !== s2) return falha('As duas senhas não são iguais.');
      err.hidden = true;
      const btn = e.submitter || $('#f-cad button[type=submit]');
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        const sess = await auth.cadastrar(email, s1, nome);
        if (sess) { await iniciar(); return; }
        $('.auth-box').innerHTML = `<div><h1>Cadastro enviado</h1>
          <p class="muted" style="margin-top:8px">Confirme o e-mail que enviamos para <b>${esc(email)}</b>.
          Depois disso, um admin master precisa aprovar o seu acesso.</p></div>
          <a class="btn" href="#login">Voltar para entrar</a>`;
      } catch (er) {
        btn.disabled = false; btn.textContent = 'Enviar cadastro';
        falha(er.message);
      }
    });
  };

  PAGINAS.pendente = function () {
    const p = state.perfil || {};
    document.title = 'Cadastro em análise | Gerenciador de Estoque e Vídeos';
    telaAuth(`
      <div><h1>Cadastro aguardando aprovação</h1>
        <p class="muted" style="margin-top:8px">Olá${p.nome ? ', ' + esc(p.nome.split(' ')[0]) : ''}! Seu cadastro (${esc(p.email || '')}) foi enviado.
        Um admin master precisa aprovar seu acesso antes de você usar o sistema.</p></div>
      <button class="btn" type="button" id="b-verificar">Já fui aprovado, entrar</button>
      <button class="btn btn-ghost" type="button" data-acao="sair">Sair</button>`);
    $('#b-verificar').addEventListener('click', () => iniciar('produtos'));
  };

  PAGINAS['sem-acesso'] = function () {
    document.title = 'Sem acesso | Gerenciador de Estoque e Vídeos';
    telaAuth(`
      <div><h1>Conta sem acesso</h1>
        <p class="muted" style="margin-top:8px">Esta conta foi excluída ou o cadastro foi recusado por um admin master.
        Se acha que é um engano, fale com o responsável pela loja.</p></div>
      <button class="btn btn-ghost" type="button" data-acao="sair">Sair</button>`);
  };

  PAGINAS.esqueci = function () {
    document.title = 'Esqueci minha senha | Gerenciador de Estoque e Vídeos';
    telaAuth(`
      <div><h1>Esqueci minha senha</h1>
        <p class="muted" style="margin-top:8px">Digite o e-mail da sua conta. Vamos mandar um link para você criar uma senha nova.</p></div>
      <form id="f-esq" novalidate>
        <div class="field"><label for="esq-email">E-mail</label>
          <input class="input" id="esq-email" type="email" autocomplete="email" placeholder="nome@loja.com"></div>
        <p class="err" id="esq-err" role="alert" hidden></p>
        <button class="btn" type="submit">Enviar link</button>
        <p class="muted" style="font-size:.9rem"><a href="#login" class="link-btn">Voltar para entrar</a></p>
        <p class="muted" style="font-size:.85rem">Não chegou o e-mail ou não tem acesso a ele? Peça para um admin master criar uma senha provisória para você.</p>
      </form>`);
    $('#esq-email').focus();
    $('#f-esq').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#esq-email').value.trim().toLowerCase(), err = $('#esq-err');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Digite um e-mail válido.'; err.hidden = false; return; }
      const btn = e.submitter || $('#f-esq button[type=submit]');
      btn.disabled = true; btn.textContent = 'Enviando…'; err.hidden = true;
      try {
        await auth.recuperarSenha(email);
        $('.auth-box').innerHTML = `<div><h1>Confira seu e-mail</h1>
          <p class="muted" style="margin-top:8px">Se <b>${esc(email)}</b> tiver conta, chega em alguns minutos um e-mail com o link para criar uma senha nova. Olhe também a caixa de spam.</p></div>
          <p class="muted" style="font-size:.9rem">O link vale por pouco tempo e funciona uma vez só.</p>
          <a class="btn btn-ghost" href="#login">Voltar para entrar</a>`;
      } catch (er) {
        btn.disabled = false; btn.textContent = 'Enviar link';
        err.textContent = er.message; err.hidden = false;
      }
    });
  };

  PAGINAS['nova-senha'] = function () {
    const p = state.perfil || {};
    document.title = 'Crie sua senha | Gerenciador de Estoque e Vídeos';
    telaAuth(`
      <div><h1>${recuperandoSenha && !p.senha_provisoria ? 'Crie uma senha nova' : 'Crie sua senha'}</h1>
        <p class="muted" style="margin-top:8px">Olá, ${esc((p.nome || '').split(' ')[0])}! ${recuperandoSenha && !p.senha_provisoria
          ? 'Escolha a senha nova da sua conta.'
          : 'Você entrou com a senha provisória. Escolha uma senha só sua para continuar.'}</p></div>
      <form id="f-ns" novalidate>
        <div class="field"><label for="ns-1">Nova senha</label><input class="input" id="ns-1" type="password" autocomplete="new-password"><span class="hint">Mínimo de 6 caracteres.</span></div>
        <div class="field"><label for="ns-2">Confirmar nova senha</label><input class="input" id="ns-2" type="password" autocomplete="new-password"></div>
        <p class="err" id="ns-err" role="alert" hidden></p>
        <button class="btn" type="submit">Salvar senha e entrar</button>
        <button class="btn btn-ghost" type="button" data-acao="sair">Sair</button>
      </form>`);
    $('#f-ns').addEventListener('submit', async (e) => {
      e.preventDefault();
      const s1 = $('#ns-1').value, s2 = $('#ns-2').value, err = $('#ns-err');
      const falha = (m) => { err.textContent = m; err.hidden = false; };
      if (s1.length < 6) return falha('A senha precisa ter pelo menos 6 caracteres.');
      if (s1 !== s2) return falha('As duas senhas não são iguais.');
      const btn = e.submitter || $('#f-ns button[type=submit]');
      btn.disabled = true; btn.textContent = 'Salvando…';
      try {
        await auth.trocarSenha(s1);
        if (state.perfil.senha_provisoria) await db.alterar('perfis', `id=eq.${state.sessao}`, { senha_provisoria: false });
        state.perfil.senha_provisoria = false;
        recuperandoSenha = false;
        toast('Senha criada. Bem-vindo!');
        await iniciar('produtos');
      } catch (er) {
        btn.disabled = false; btn.textContent = 'Salvar senha e entrar';
        falha(er.message);
      }
    });
  };

  function modalSenha() {
    abrirModal({
      titulo: 'Alterar senha',
      corpo: `<div class="modal-form" id="f-ms">
        <div class="field"><label for="ms-1">Nova senha</label><input class="input" id="ms-1" type="password" autocomplete="new-password"><span class="hint">Mínimo de 6 caracteres.</span></div>
        <div class="field"><label for="ms-2">Confirmar nova senha</label><input class="input" id="ms-2" type="password" autocomplete="new-password"></div>
        <p class="err" id="ms-err" role="alert"></p></div>`,
      botoes: [
        { label: 'Salvar nova senha', acao: async (e) => {
          const s1 = $('#ms-1').value, s2 = $('#ms-2').value;
          if (s1.length < 6) { $('#ms-err').textContent = 'A senha precisa ter pelo menos 6 caracteres.'; return; }
          if (s1 !== s2) { $('#ms-err').textContent = 'As duas senhas não são iguais.'; return; }
          const ok = await executar(e.currentTarget, () => auth.trocarSenha(s1), 'Senha alterada');
          if (ok) fecharModal();
        } },
        { label: 'Cancelar', cls: 'btn-ghost', acao: fecharModal }
      ]
    });
    $('#ms-1').focus();
  }

  // ---------- Produtos ----------
  const F = { busca: '', local: '', letra: '', fab: '', limite: POR_PAGINA, unico: null };

  // Busca: ignora maiúsculas e acentos ("calca" acha "CALÇA") e aceita palavras em qualquer ordem
  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const termos = (q) => semAcento(q).replace(/^#/, '').split(/\s+/).filter(Boolean);
  function casaBusca(p, ts) {
    if (!ts.length) return true;
    const prat = semAcento(p.prateleira), texto = semAcento(descricao(p) + ' ' + (p.fabricante || ''));
    const num = String(p.num);
    return ts.every((t) => prat.startsWith(t) || texto.includes(t) || (/^\d+$/.test(t) && num === String(Number(t))));
  }
  // Ordem das sugestões: prateleira exata, prateleira que começa igual, descrição que começa igual, o resto
  function pesoBusca(p, ts) {
    const t = ts[0] || '', prat = semAcento(p.prateleira), d = semAcento(descricao(p));
    if (ts.length === 1 && prat === t) return 0;
    if (ts.length === 1 && prat.startsWith(t)) return 1;
    if (d.startsWith(ts.join(' '))) return 2;
    return 3;
  }
  // Destaca no texto as partes que bateram com a busca
  function marcar(texto, ts) {
    const t = String(texto || ''), n = semAcento(t);
    const marcas = new Array(t.length).fill(false);
    ts.forEach((q) => { let i = n.indexOf(q); while (q && i >= 0) { for (let k = i; k < i + q.length; k++) marcas[k] = true; i = n.indexOf(q, i + q.length); } });
    let out = '', aberto = false;
    for (let i = 0; i < t.length; i++) {
      if (marcas[i] !== aberto) { out += marcas[i] ? '<mark>' : '</mark>'; aberto = marcas[i]; }
      out += esc(t[i]);
    }
    return out + (aberto ? '</mark>' : '');
  }

  // Copia o link do produto (com plano B para navegadores sem acesso à área de transferência)
  async function copiarTexto(txt) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(txt); return true; } } catch (e) { /* tenta o plano B */ }
    const ta = document.createElement('textarea');
    ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  async function copiarLink(btn, p) {
    if (!p || !p.link) return;
    if (await copiarTexto(p.link)) {
      toast(`Link de ${p.prateleira} copiado`);
      const antes = btn.dataset.antes || btn.innerHTML; btn.dataset.antes = antes;
      btn.classList.add('copiado'); btn.innerHTML = ICON.certo + '<span class="copiar-txt">Copiado!</span>';
      clearTimeout(btn._t); btn._t = setTimeout(() => { btn.classList.remove('copiado'); btn.innerHTML = antes; }, 1800);
    } else {
      toast('Não deu para copiar. Segure o dedo no botão TikTok Shop e escolha "Copiar link".', true);
    }
  }
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
        <div class="head-acoes">
          <button class="btn btn-ghost" type="button" id="b-escanear">${ICON.qr}Escanear QR</button>
          <a class="btn" href="#produto-novo">${ICON.mais}Adicionar produto</a>
        </div>
      </div>
      <div class="toolbar">
        <div class="search">${ICON.busca}<input class="input" id="busca" type="search" placeholder="Buscar por prateleira, descrição, fabricante ou ID" value="${esc(F.busca)}"
            aria-label="Buscar produto" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="sugestoes" autocomplete="off">
          <ul class="sugestoes" id="sugestoes" role="listbox" aria-label="Produtos encontrados" hidden></ul></div>
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
      const ts = termos(F.busca);
      const lista = state.produtos.filter((p) =>
        (F.unico ? p.id === F.unico : casaBusca(p, ts)) &&
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
        <p class="muted" style="font-size:.85rem;margin-bottom:10px">${F.unico ? `Mostrando só o produto escolhido. <button class="btn-text" type="button" id="ver-todos">Ver todos</button>` : plural(lista.length, 'produto encontrado', 'produtos encontrados')}</p>
        <div class="table-wrap"><table class="cards cards-lead">
          <thead><tr><th>Nº prat.</th><th>Produto</th><th class="r">Peças</th><th class="r hide-sm">${tituloVid}</th><th class="hide-sm">Último vídeo</th><th class="r hide-sm">Ações</th></tr></thead>
          <tbody>${vis.map((p) => {
            const nv = videosDe(p.id, contaSel).length;
            const ult = ultimoVideo(p.id, contaSel);
            return `<tr>
              <td class="c-lead"><span class="shelf">${esc(p.prateleira)}</span><span class="local">Local ${p.local}</span></td>
              <td class="prod c-titulo"><span>${esc(descricao(p))}</span><span class="muted">${p.fabricante ? esc(p.fabricante) : 'Fabricante não informado'}</span><span class="id">ID ${idTxt(p)}</span>
                <button class="btn btn-ghost btn-sm show-sm-btn" type="button" data-editar="${p.id}">Editar</button></td>
              <td class="r num nowrap" data-label="Peças">${pillEstoque(p.quantidade)}</td>
              <td class="r num hide-sm" data-label="${tituloVid}">${nv}</td>
              <td class="hide-sm" data-label="Último vídeo">${ult ? dias(diasDesde(ult)) : '<span class="sem-video">nenhum</span>'}</td>
              <td class="hide-sm c-acoes"><div class="row-actions">
                ${p.link ? `<span class="btn-grupo"><a class="btn btn-ghost btn-sm btn-tiktok" href="${esc(p.link)}" target="_blank" rel="noopener" aria-label="Abrir ${esc(p.prateleira)} no TikTok Shop">${ICON.link}<span>TikTok Shop</span></a><button class="btn btn-ghost btn-sm btn-copiar" type="button" data-copiar-link="${p.id}" aria-label="Copiar link de ${esc(p.prateleira)}" title="Copiar link">${ICON.copiar}<span class="copiar-txt">Copiar link</span></button></span>` : ''}
                <button class="btn btn-ghost btn-sm" type="button" data-editar="${p.id}">Editar</button>
                ${eu().papel === 'admin' ? `<button class="btn btn-danger-ghost btn-sm" type="button" data-excluir-produto="${p.id}">Excluir</button>` : ''}
              </div></td></tr>`;
          }).join('')}</tbody></table></div>
        ${lista.length > F.limite ? `<p style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" id="mais-prod">Mostrar mais ${Math.min(POR_PAGINA, lista.length - F.limite)} de ${lista.length - F.limite}</button></p>` : ''}`;
      const m = $('#mais-prod'); if (m) m.addEventListener('click', () => { F.limite += POR_PAGINA; desenhar(); });
      const vt = $('#ver-todos'); if (vt) vt.addEventListener('click', () => { F.unico = null; F.busca = ''; $('#busca').value = ''; desenhar(); $('#busca').focus(); });
    };
    desenhar();
    const mudou = (fn) => (e) => { fn(e.target.value); F.limite = POR_PAGINA; desenhar(); };
    ligarSugestoes(desenhar);
    $('#b-escanear').addEventListener('click', escanearNaLista);
    $('#f-local').addEventListener('change', mudou((v) => { F.local = v; }));
    $('#f-letra').addEventListener('change', mudou((v) => { F.letra = v; }));
    $('#f-fab').addEventListener('change', mudou((v) => { F.fab = v; }));
    $('#f-conta').addEventListener('change', mudou((v) => { contaSel = v; }));
    $('#lista').addEventListener('click', (e) => {
      const b = e.target.closest('[data-editar]');
      if (b) { state.editId = b.dataset.editar; ir('produto-editar'); }
      const x = e.target.closest('[data-excluir-produto]');
      if (x) excluirProduto(produto(x.dataset.excluirProduto));
      const c = e.target.closest('[data-copiar-link]');
      if (c) copiarLink(c, produto(c.dataset.copiarLink));
    });
  };

  // Lista de sugestões embaixo da busca: mostra os produtos que combinam enquanto a pessoa digita
  const MAX_SUG = 8;
  function ligarSugestoes(desenhar) {
    const inp = $('#busca'), ul = $('#sugestoes');
    let itens = [], ativo = -1;
    const fechar = () => { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); ativo = -1; };
    const marcarAtivo = (i) => {
      ativo = i;
      [...ul.querySelectorAll('[role="option"]')].forEach((li, k) => li.setAttribute('aria-selected', k === i ? 'true' : 'false'));
      const li = ul.querySelector(`[data-i="${i}"]`);
      if (li) { inp.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); } else inp.removeAttribute('aria-activedescendant');
    };
    const abrir = () => {
      const ts = termos(inp.value);
      if (!ts.length) { fechar(); return; }
      const todos = state.produtos.filter((p) => casaBusca(p, ts))
        .sort((a, b) => pesoBusca(a, ts) - pesoBusca(b, ts) || ordemPrat(a, b));
      itens = todos.slice(0, MAX_SUG);
      if (!itens.length) {
        ul.innerHTML = '<li class="sug-vazio">Nenhum produto encontrado</li>';
      } else {
        ul.innerHTML = itens.map((p, i) => `<li role="option" id="sug-${i}" data-i="${i}" aria-selected="false">
            <span class="shelf">${marcar(p.prateleira, ts)}</span>
            <span class="sug-txt"><span class="sug-desc">${marcar(descricao(p), ts)}</span>
              <span class="sug-meta">${p.fabricante ? marcar(p.fabricante, ts) : 'Fabricante não informado'} · ID ${idTxt(p)} · Local ${p.local} · ${p.quantidade === 1 ? '1 peça' : p.quantidade + ' peças'}</span></span>
          </li>`).join('') +
          (todos.length > MAX_SUG ? `<li class="sug-mais">Mais ${todos.length - MAX_SUG} na lista abaixo</li>` : '');
      }
      ul.hidden = false; inp.setAttribute('aria-expanded', 'true'); ativo = -1;
    };
    const escolher = (i) => {
      const p = itens[i]; if (!p) return;
      F.unico = p.id; F.busca = `${p.prateleira} ${descricao(p)}`; inp.value = F.busca; F.limite = POR_PAGINA;
      fechar(); desenhar();
    };
    inp.addEventListener('input', () => { F.busca = inp.value; F.unico = null; F.limite = POR_PAGINA; desenhar(); abrir(); });
    inp.addEventListener('focus', () => { if (!F.unico && inp.value.trim()) abrir(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (ul.hidden) abrir();
        if (!itens.length) return;
        e.preventDefault();
        const n = itens.length;
        marcarAtivo(e.key === 'ArrowDown' ? (ativo + 1) % n : (ativo - 1 + n) % n);
      } else if (e.key === 'Enter') {
        if (!ul.hidden && ativo >= 0) { e.preventDefault(); escolher(ativo); } else fechar();
      } else if (e.key === 'Escape' && !ul.hidden) { e.preventDefault(); fechar(); }
    });
    // mousedown (e não click) para escolher antes de a busca perder o foco
    ul.addEventListener('mousedown', (e) => {
      const li = e.target.closest('[data-i]'); if (!li) return;
      e.preventDefault(); escolher(Number(li.dataset.i));
    });
    inp.addEventListener('blur', () => setTimeout(fechar, 120));
  }

  // Excluir produto (só admin master). Sai da lista e libera a prateleira; vídeos, vendas e histórico ficam.
  function excluirProduto(p) {
    if (!p) return;
    const nv = videosDe(p.id).length, ns = (state.vendas || []).filter((v) => v.produtoId === p.id).length;
    const fica = [nv ? plural(nv, 'vídeo', 'vídeos') : '', ns ? plural(ns, 'venda', 'vendas') : ''].filter(Boolean).join(' e ');
    abrirModal({
      titulo: `Excluir ${esc(p.prateleira)} ${esc(descricao(p))}?`,
      alerta: true,
      corpo: `<p class="muted">O produto sai da lista e a prateleira ${esc(p.prateleira)} fica livre para outra peça.
        ${fica ? `Continuam guardados no histórico: ${fica}.` : ''} A exclusão fica registrada.</p>
        <ul class="diff"><li><b>ID</b><span>${idTxt(p)}</span></li><li><b>Peças</b><span>${p.quantidade}</span></li>
        <li><b>Fabricante</b><span>${esc(p.fabricante || 'não informado')}</span></li></ul>`,
      botoes: [
        { label: 'Excluir produto', cls: 'btn-red', acao: async (e) => {
          const ok = await executar(e.currentTarget, async () => {
            await db.alterar('produtos', `id=eq.${p.id}`, { excluido_em: new Date().toISOString() });
            await carregarDados();
          }, 'Produto excluído');
          if (ok) { fecharModal(); if (location.hash === '#produtos') render(); else ir('produtos'); }
        } },
        { label: 'Cancelar', cls: 'btn-ghost', acao: fecharModal }
      ]
    });
  }

  // ---------- QR code do TikTok Shop colado na roupa ----------
  // Produto ativo que já tem esse link (compara sem https/www/parâmetros)
  function produtoDoLink(link, menosId) {
    const k = LeitorQR.chaveLink(link);
    return state.produtos.find((p) => p.link && p.id !== menosId && LeitorQR.chaveLink(p.link) === k);
  }
  function abrirProdutoEditar(p, msg) {
    state.editId = String(p.id);
    if (location.hash === '#produto-editar') render(); else ir('produto-editar');
    if (msg) toast(msg);
  }
  // Texto lido não é um link: mensagem para o leitor mostrar e continuar lendo
  const naoEhLink = (txt) => `Esse QR code não tem um link de produto${txt ? ` (diz "${String(txt).slice(0, 40)}")` : ''}. Tente o QR do TikTok Shop.`;

  // Botão da tela de Produtos: produto já cadastrado abre a edição; senão, abre Adicionar com o link
  function escanearNaLista() {
    LeitorQR.abrir({
      dica: 'Aponte a câmera para o QR code colado na roupa. Se o produto já estiver cadastrado, ele abre direto.',
      aoLer: (txt, fechar) => {
        const l = LeitorQR.lerLink(txt);
        if (!l) return naoEhLink(txt);
        fechar();
        const p = produtoDoLink(l.link);
        if (p) { abrirProdutoEditar(p, `Esse QR é da prateleira ${p.prateleira}: ${descricao(p)}`); return; }
        state.linkDoQR = l.link;
        ir('produto-novo');
        if (!l.tiktok) toast('Atenção: esse link não é do TikTok.', true);
      }
    });
  }

  // Botão ao lado do campo de link (adicionar e editar)
  function ligarBotaoQR(atual) {
    const b = $('#b-qr-link'); if (!b) return;
    b.addEventListener('click', () => LeitorQR.abrir({
      aoLer: (txt, fechar) => {
        const l = LeitorQR.lerLink(txt);
        if (!l) return naoEhLink(txt);
        fechar();
        const outro = produtoDoLink(l.link, atual && atual.id);
        const preencher = () => {
          const inp = $('#p-link'); if (!inp) return;
          inp.value = l.link; inp.setAttribute('aria-invalid', 'false');
          const er = $('#f-prod [data-err="link"]'); if (er) er.textContent = '';
          const h = $('#p-link-hint'); if (h) h.textContent = l.tiktok ? 'Link preenchido pelo QR code.' : 'Link preenchido pelo QR code. Atenção: não é um link do TikTok.';
          inp.classList.add('flash'); setTimeout(() => inp.classList.remove('flash'), 1200);
          toast('Link preenchido pelo QR code');
        };
        if (!outro) { preencher(); return; }
        abrirModal({
          titulo: 'Esse link já está cadastrado',
          corpo: `<p class="muted">O QR code é do produto da prateleira <b>${esc(outro.prateleira)}</b>: ${esc(descricao(outro))} (ID ${idTxt(outro)}).</p>`,
          botoes: [
            { label: `Abrir ${esc(outro.prateleira)}`, acao: () => { fecharModal(); abrirProdutoEditar(outro); } },
            { label: 'Usar o link mesmo assim', cls: 'btn-ghost', acao: () => { fecharModal(); preencher(); } },
            { label: 'Cancelar', cls: 'btn-text', acao: fecharModal }
          ]
        });
      }
    }));
  }

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
            <div class="input-com-botao">
              <input class="input" id="p-link" type="url" value="${esc(v.link)}" placeholder="https://www.tiktok.com/view/product/...">
              <button class="btn btn-ghost" type="button" id="b-qr-link" aria-label="Escanear o QR code do produto para preencher o link">${ICON.qr}<span>Escanear QR</span></button>
            </div>
            <span class="hint" id="p-link-hint">${p ? '' : 'Escaneie o QR code colado na roupa para preencher o link.'}</span>
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
        <p>Os mesmos dados da planilha de estoque: local, prateleira, descrição, peças e fabricante. O ID é criado automaticamente.</p></div></div>
      ${state.linkDoQR ? `<div class="notice notice-info form-panel" role="status">${ICON.qr}<span>Link preenchido pelo QR code. Complete o local, a prateleira, a descrição, as peças e o fabricante.</span></div>` : ''}
      ${formProduto(null)}`);
    if (state.linkDoQR) {
      $('#p-link').value = state.linkDoQR; state.linkDoQR = null;
      $('#p-local').focus();
    }
    ligarBotaoQR(null);
    $('#f-prod').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = lerFormProduto(null);
      if (!d) return;
      const ok = await executar(e.submitter, async () => {
        const fabId = await idFabricante(d.fabricante);
        await db.inserir('produtos', { local: d.local, prateleira: d.prateleira, descricao: d.descricao,
          quantidade: d.quantidade, fabricante_id: fabId, link_tiktok: d.link || null });
        await carregarDados();
      }, 'Produto adicionado');
      if (ok) ir('produtos');
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
    if (!p || p.excluido) { ir('produtos'); return; }
    const hist = state.registros.filter((r) => r.tabela === 'produtos' && r.registroId === p.id).slice(0, 6);
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
          <div><b>${esc(nomeDe(r.usuarioId))}</b> ${esc(r.acao.toLowerCase())}: ${esc(detalheRegistro(r).replace(/^[A-Z]{1,2}\d{1,2}[: ]\s?/, ''))}<br><time>${fmtData(r.data)}</time></div></li>`).join('')}</ul>`
          : `<p class="muted">${eu().papel === 'admin' ? 'Nenhuma alteração registrada ainda.' : 'O histórico completo fica na área do admin master.'}</p>`}
      </section>
      ${eu().papel === 'admin' ? `<section class="panel form-panel zona-perigo">
        <div><h2>Excluir produto</h2><p class="muted">Tira o produto da lista e libera a prateleira ${esc(p.prateleira)}. Vídeos, vendas e histórico continuam guardados.</p></div>
        <button class="btn btn-danger-ghost" type="button" id="b-excluir-prod">Excluir produto</button>
      </section>` : ''}`);
    const bx = $('#b-excluir-prod'); if (bx) bx.addEventListener('click', () => excluirProduto(p));
    ligarBotaoQR(p);
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
        { label: 'Sim, salvar edições', acao: (e) => salvarEdicao(p, d, m, e.currentTarget) },
        { label: 'Não, cancelar', cls: 'btn-ghost', acao: () => {
          fecharModal();
          PAGINAS['produto-editar']('Edições canceladas. Nada foi salvo; abaixo estão os dados atuais do produto.');
          window.scrollTo(0, 0);
        } }
      ]
    });
  }

  async function salvarEdicao(p, d, m, btn) {
    const ok = await executar(btn, async () => {
      const fabId = await idFabricante(d.fabricante);
      await db.alterar('produtos', `id=eq.${p.id}`, { local: d.local, prateleira: d.prateleira, descricao: d.descricao,
        quantidade: d.quantidade, fabricante_id: fabId, link_tiktok: d.link || null });
      await carregarDados();
    }, 'Edições salvas');
    if (ok) { fecharModal(); ir('produtos'); }
  }

  // ---------- Vídeos ----------
  let filtroVideos = 'meus';
  // Período da lista de vídeos: hoje, últimos 7 dias, últimos 30 dias ou tudo
  let periodoVideos = '7';
  const PERIODOS = [['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['tudo', 'Tudo']];
  function noPeriodo(iso, per) {
    if (per === 'tudo') return true;
    const ini = agora(); ini.setHours(0, 0, 0, 0);               // começo de hoje
    if (per !== 'hoje') ini.setDate(ini.getDate() - (Number(per) - 1)); // hoje + os dias anteriores
    return new Date(iso) >= ini;
  }
  const nomePeriodo = { hoje: 'hoje', 7: 'nos últimos 7 dias', 30: 'nos últimos 30 dias', tudo: '' };
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
            <span class="err" data-err="prod"></span>
            <div id="v-prod-info" class="prod-info" aria-live="polite" hidden></div></div>
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
            <div class="seg-toggle" role="group" aria-label="Período" id="fv-periodo">
              ${PERIODOS.map(([k, t]) => `<button type="button" data-per="${k}">${t} <span class="seg-n" data-n="${k}"></span></button>`).join('')}
            </div>
            ${seletorConta('fv-conta')}
          </div>
        </div>
        <div id="lista-videos"></div>
      </section>`);

    relogioTimer = setInterval(() => { const el = $('#v-agora'); if (el) el.textContent = fmtDataCompleta(agora()); }, 1000);

    // Ao escolher o produto, mostra o link dele no TikTok Shop (ou avisa que falta cadastrar)
    let mostrado = null;
    const mostrarProduto = () => {
      const box = $('#v-prod-info');
      const txt = $('#v-prod').value.trim();
      const p = txt ? acharProduto(txt) : null;
      if ((p && p.id) === mostrado) return;   // mesmo produto: não redesenha (mantém o clique nos botões)
      mostrado = p && p.id;
      if (!p) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = `
        <div class="prod-info-head">
          <span class="shelf">${esc(p.prateleira)}</span>
          <div class="prod-info-txt"><b>${esc(descricao(p))}</b>
            <span class="muted">${esc(p.fabricante || 'Fabricante não informado')}, ID ${idTxt(p)}, ${pillEstoque(p.quantidade)}</span></div>
        </div>
        ${p.link
          ? `<a class="btn btn-tiktok-cta" href="${esc(p.link)}" target="_blank" rel="noopener">${ICON.link}Ver produto no TikTok Shop</a>
             <span class="prod-info-url">${esc(p.link)}</span>`
          : `<p class="prod-info-sem">Esta peça ainda não tem link do TikTok Shop.
             <button type="button" class="link-btn" data-cadastrar-link="${p.id}">Cadastrar link</button></p>`}`;
    };
    $('#v-prod').addEventListener('input', mostrarProduto);
    $('#v-prod').addEventListener('change', mostrarProduto);
    $('#f-video').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cadastrar-link]');
      if (b) { state.editId = b.dataset.cadastrarLink; ir('produto-editar'); }
    });

    let limite = 20;
    const desenhar = () => {
      const base = state.videos.filter((v) => (filtroVideos === 'todos' || v.usuarioId === state.sessao) && (!contaSel || v.conta === contaSel));
      const lista = base.filter((v) => noPeriodo(v.data, periodoVideos));
      // quantos vídeos cada período tem (aparece no botão)
      PERIODOS.forEach(([k]) => { const el = $(`[data-n="${k}"]`); if (el) el.textContent = base.filter((v) => noPeriodo(v.data, k)).length; });
      $$('[data-per]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.per === periodoVideos)));
      const vis = lista.slice(0, limite);
      const equipe = filtroVideos === 'todos';
      $('#lista-videos').innerHTML = vis.length ? `
        <div class="table-wrap"><table class="cards">
          <thead><tr><th>Data e hora</th><th>Produto</th><th class="hide-sm">Conta</th>${equipe ? '<th class="hide-sm">Quem postou</th>' : ''}</tr></thead>
          <tbody>${vis.map((v) => { const p = produto(v.produtoId) || { prateleira: '?', descricao: 'Produto removido' }; return `
            <tr><td class="num nowrap" data-label="Data e hora">${fmtData(v.data)}</td>
              <td class="prod c-titulo"><span><b>${esc(p.prateleira)}</b> ${esc(descricao(p))}</span><span class="show-sm"><span class="conta">${esc(v.conta)}</span>${equipe ? ' ' + esc(nomeDe(v.usuarioId)) : ''}</span></td>
              <td class="hide-sm" data-label="Conta"><span class="conta">${esc(v.conta)}</span></td>
              ${equipe ? `<td class="hide-sm" data-label="Quem postou">${esc(nomeDe(v.usuarioId))}</td>` : ''}
              </tr>`; }).join('')}
          </tbody></table></div>
        ${lista.length > limite ? `<p style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" id="mais-vid">Mostrar mais ${Math.min(20, lista.length - limite)} de ${lista.length - limite}</button></p>` : ''}`
        : `<div class="table-wrap"><p class="empty">${filtroVideos === 'meus' ? 'Nenhum vídeo seu' : 'Nenhum vídeo'}${contaSel ? ' na conta ' + esc(contaSel) : ''} ${periodoVideos === 'tudo' ? 'ainda. Use o formulário acima depois de postar.' : nomePeriodo[periodoVideos] + '.'}
            ${periodoVideos !== 'tudo' && base.length ? '<button class="btn-text" type="button" data-per-ir="tudo">Ver todos</button>' : ''}</p></div>`;
      const vt = $('[data-per-ir]'); if (vt) vt.addEventListener('click', () => { periodoVideos = 'tudo'; limite = 20; desenhar(); });
      $$('[data-fv]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fv === filtroVideos)));
      const m = $('#mais-vid'); if (m) m.addEventListener('click', () => { limite += 20; desenhar(); });
    };
    desenhar();
    $$('[data-fv]').forEach((b) => b.addEventListener('click', () => { filtroVideos = b.dataset.fv; limite = 20; desenhar(); }));
    $$('[data-per]').forEach((b) => b.addEventListener('click', () => { periodoVideos = b.dataset.per; limite = 20; desenhar(); }));
    $('#fv-conta').addEventListener('change', (e) => { contaSel = e.target.value; limite = 20; desenhar(); });

    $('#f-video').addEventListener('submit', async (e) => {
      e.preventDefault();
      const txt = $('#v-prod').value.trim();
      const p = txt ? acharProduto(txt) : null;
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
      let novo;
      const ok = await executar(e.submitter, async () => {
        // a data, a hora e o autor são definidos pelo servidor
        novo = await db.inserir('videos', { produto_id: Number(p.id), conta_id: state.contaId[conta] });
        await carregarDados();
      });
      if (!ok) return;
      toast(`Vídeo registrado em ${fmtData(novo.postado_em)}`);
      filtroVideos = 'meus';
      if (periodoVideos !== 'tudo') periodoVideos = 'hoje';   // mostra o vídeo que acabou de entrar
      render();
    });
  };

  // ---------- Gráfico de barras horizontais (desenhado em escala) ----------
  function escala(max) {
    const bruto = Math.max(max, 1) / 4;
    const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
    const passo = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * pot).find((s) => s >= bruto)); // contagens: passo inteiro
    return { max: passo * 4, ticks: [0, 1, 2, 3, 4].map((i) => +(passo * i).toFixed(2)) };
  }
  function grafico(linhas, opts) {
    const o = opts || {};
    const maior = o.max != null ? o.max : Math.max(...linhas.map((l) => l.segs.reduce((a, s) => a + s.v, 0)));
    const e = o.max != null ? { max: Math.max(o.max, 1), ticks: [] } : escala(maior);   // max fixo: mesma escala em vários gráficos
    const cls = o.largo ? 'bars-largo' : '';
    return `<div class="bars ${cls}">${linhas.map((l) => {
      const total = l.segs.reduce((a, s) => a + s.v, 0);
      const titulo = l.segs.map((s) => `${s.nome}: ${s.v}`).join(', ');
      return `<div class="bar-row">
        <span class="bar-label" title="${esc(l.titulo || '')}">${l.label}</span>
        <div class="bar-track" title="${esc(titulo)}" role="img" aria-label="${esc((l.titulo || '') + ': ' + titulo)}">${l.segs.filter((s) => s.v > 0).map((s) =>
          `<span class="bar-seg ${s.cls}" style="width:${(s.v / e.max) * 100}%"></span>`).join('')}</div>
        <span class="bar-val">${l.valor != null ? l.valor : fmtN(total)}</span></div>`;
    }).join('')}</div>${o.semEixo ? '' : `
    <div class="axis ${cls}" aria-hidden="true"><span></span><div class="ticks">${e.ticks.map((t) => `<span>${fmtN(t)}</span>`).join('')}</div><span></span></div>`}`;
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
          <thead><tr><th>Conta</th>${SEMANAS.map((s) => `<th class="r"><span class="longo">${rotSemana(s)}</span><span class="curto">${s[0]}–${s[1]}</span></th>`).join('')}<th class="r">Total</th></tr></thead>
          <tbody>${state.contas.map((c) => {
            const vs = state.videos.filter((v) => v.conta === c && v.data.slice(0, 7) === mesAnalise);
            const porSem = SEMANAS.map(([a, b]) => vs.filter((v) => { const d = new Date(v.data).getDate(); return d >= a && d <= b; }).length);
            return `<tr class="${conta && conta !== c ? 'apagado' : ''}"><td class="code">${esc(c)}</td>${porSem.map((n) => `<td class="r num">${n || '<span class="muted">0</span>'}</td>`).join('')}<td class="r num"><b>${vs.length}</b></td></tr>`;
          }).join('')}</tbody></table></div>
      </section>` : ''}`);

    const desenharNunca = () => {
      const vis = nunca.slice(0, limiteNunca);
      $('#lista-nunca').innerHTML = nunca.length ? `
        <div class="table-wrap"><table class="cards cards-lead">
          <thead><tr><th>Nº prat.</th><th>Produto</th><th class="r">Peças</th><th class="r hide-sm">Sem vídeo há</th></tr></thead>
          <tbody>${vis.map((d) => `<tr>
            <td class="c-lead"><span class="shelf">${esc(d.p.prateleira)}</span><span class="local">Local ${d.p.local}</span></td>
            <td class="prod c-titulo"><span>${esc(descricao(d.p))}</span><span class="muted">${esc(d.p.fabricante || 'Fabricante não informado')}</span><span class="id">ID ${idTxt(d.p)}</span></td>
            <td class="r num nowrap" data-label="Peças">${pillEstoque(d.p.quantidade)}</td>
            <td class="r num hide-sm" data-label="Sem vídeo há"><span>${diasDesde(d.p.criadoEm)} dias <span class="muted">(desde o cadastro)</span></span></td></tr>`).join('')}</tbody></table></div>
        ${nunca.length > limiteNunca ? `<p style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" id="mais-nunca">Mostrar mais ${Math.min(20, nunca.length - limiteNunca)} de ${nunca.length - limiteNunca}</button></p>` : ''}`
        : '<div class="table-wrap"><p class="empty">Todos os produtos já têm pelo menos um vídeo.</p></div>';
      const m = $('#mais-nunca'); if (m) m.addEventListener('click', () => { limiteNunca += 20; desenharNunca(); });
    };
    desenharNunca();
    $('#a-conta').addEventListener('change', (e) => { contaSel = e.target.value; limiteNunca = 10; render(); });
    const am = $('#a-mes'); if (am) am.addEventListener('change', (e) => { mesAnalise = e.target.value; render(); });
  };

  // ---------- Vendas (só admin master) ----------
  // O TikTok não exporta as vendas por vídeo: o admin lança aqui, por conta, produto e dia.
  const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmtDia = (ymd) => ymd.split('-').reverse().join('/');
  const semanaDoDia = (dia) => SEMANAS.findIndex(([a, b]) => dia >= a && dia <= b) + 1;
  const nomeMes = (m) => new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  function acharProduto(txt) {
    const prat = txt.split(/\s+-\s+|\s+/)[0].toUpperCase();
    return state.produtos.find((x) => x.prateleira + ' - ' + descricao(x) === txt) || state.produtos.find((x) => x.prateleira === prat);
  }
  const opcoesProduto = () => [...state.produtos].sort(ordemPrat)
    .map((p) => `<option value="${esc(p.prateleira + ' - ' + descricao(p))}">`).join('');

  const V = { conta: '', mes: null, semana: 0, ordem: 'mais', limite: 15, contaForm: '' };

  PAGINAS.vendas = function () {
    if (eu().papel !== 'admin') {
      shell('vendas', `<div class="page-head"><div><h1>Vendas</h1></div></div>
        <div class="notice">${ICON.alerta}<span>Esta área é só para o admin master.</span></div>`);
      return;
    }
    const hoje = ymdLocal(agora());
    const meses = [...new Set([hoje.slice(0, 7), ...state.vendas.map((v) => v.data.slice(0, 7))])].sort().reverse();
    if (!V.mes || !meses.includes(V.mes)) V.mes = meses.find((m) => state.vendas.some((v) => v.data.startsWith(m))) || meses[0];

    shell('vendas', `
      <div class="page-head"><div><h1>Vendas</h1>
        <p>Lance as peças vendidas em cada conta do TikTok Shop e compare com os vídeos gravados.</p></div></div>

      <form id="f-venda" class="panel form-panel" novalidate>
        <div class="panel-head"><h2>Adicionar venda</h2></div>
        <div class="field">
          <span class="label-like" id="lbl-conta">Conta do TikTok Shop</span>
          <div class="chips" role="radiogroup" aria-labelledby="lbl-conta">
            ${state.contas.map((c) => `<button type="button" class="chip" role="radio" aria-checked="${V.contaForm === c}" data-conta-form="${esc(c)}">${esc(c)}</button>`).join('')}
          </div>
          <span class="err" id="err-conta"></span>
        </div>
        <div class="grid-form" style="margin-top:18px">
          <div class="field span-2"><label for="s-prod">Produto vendido</label>
            <input class="input" id="s-prod" list="lista-prod-v" placeholder="Digite a prateleira (ex.: A1) ou parte da descrição" autocomplete="off">
            <datalist id="lista-prod-v">${opcoesProduto()}</datalist>
            <span class="err" data-err="prod"></span></div>
          <div class="field"><label for="s-qtd">Peças vendidas</label>
            <input class="input num" id="s-qtd" type="number" min="1" step="1" inputmode="numeric" value="1">
            <span class="err" data-err="qtd"></span></div>
          <div class="field"><label for="s-data">Data da venda</label>
            <input class="input" id="s-data" type="date" value="${hoje}" max="${hoje}">
            <span class="err" data-err="data"></span></div>
        </div>
        <div class="form-actions" style="margin-top:22px"><button class="btn" type="submit">Adicionar venda</button></div>
      </form>

      <section class="filtros panel">
        <div class="toolbar">
          ${seletorConta('s-f-conta')}
          <select class="input" id="s-f-mes" aria-label="Mês">${meses.map((m) => `<option value="${m}" ${m === V.mes ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select>
        </div>
        <div class="seg-toggle seg-wrap" role="group" aria-label="Semana do mês">
          <button type="button" data-sem="0">Mês inteiro</button>
          ${SEMANAS.map((s, i) => `<button type="button" data-sem="${i + 1}">${rotSemana(s)}</button>`).join('')}
        </div>
      </section>
      <div id="vendas-analise"></div>
      <section>
        <div class="panel-head"><div><h2>Vendas lançadas</h2><p id="vendas-sub"></p></div></div>
        <div id="lista-vendas"></div>
      </section>`);
    $('#s-f-conta').value = V.conta;

    // período selecionado (mês + semana opcional + conta)
    const noPeriodo = (ymd, conta) => ymd.slice(0, 7) === V.mes &&
      (!V.semana || semanaDoDia(+ymd.slice(8, 10)) === V.semana) && (!V.conta || conta === V.conta);
    const periodoTxt = () => `${V.semana ? 'Semana ' + rotSemana(SEMANAS[V.semana - 1]) + ' de ' : ''}${nomeMes(V.mes)}${V.conta ? ', conta ' + V.conta : ''}`;

    const desenhar = () => {
      $$('[data-sem]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.sem === V.semana)));
      const vendas = state.vendas.filter((v) => noPeriodo(v.data, v.conta));
      const videos = state.videos.filter((v) => noPeriodo(ymdLocal(new Date(v.data)), v.conta));
      const porProduto = new Map();
      const linha = (pid) => porProduto.get(pid) || porProduto.set(pid, { p: produto(pid), pecas: 0, videos: 0 }).get(pid);
      vendas.forEach((v) => { linha(v.produtoId).pecas += v.quantidade; });
      videos.forEach((v) => { linha(v.produtoId).videos += 1; });
      const dados = [...porProduto.values()].filter((d) => d.p);
      const totPecas = vendas.reduce((a, v) => a + v.quantidade, 0);
      const rot = (p) => `<b>${esc(p.prateleira)}</b>${esc(descricao(p))}`;

      const ranking = V.ordem === 'mais'
        ? dados.filter((d) => d.pecas > 0).sort((a, b) => b.pecas - a.pecas || b.videos - a.videos).slice(0, 10)
        : dados.filter((d) => d.videos > 0).sort((a, b) => a.pecas - b.pecas || b.videos - a.videos).slice(0, 10);
      const cruz = dados.filter((d) => d.videos > 0).sort((a, b) => b.videos - a.videos || a.pecas - b.pecas).slice(0, 8);

      $('#vendas-analise').innerHTML = `
        <div class="stats">
          <div class="stat"><span class="v">${fmtN(totPecas)}</span><span class="l">peças vendidas</span></div>
          <div class="stat"><span class="v">${dados.filter((d) => d.pecas).length}</span><span class="l">produtos vendidos</span></div>
          <div class="stat"><span class="v">${videos.length}</span><span class="l">vídeos postados</span></div>
          <div class="stat"><span class="v">${videos.length ? (totPecas / videos.length).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '0'}</span><span class="l">peças vendidas por vídeo</span></div>
        </div>
        <div class="two-col">
          <section class="panel">
            <div class="panel-head"><div><h2>${V.ordem === 'mais' ? 'Mais vendidos' : 'Menos vendidos'}</h2>
              <p>${V.ordem === 'mais' ? 'Peças vendidas por produto.' : 'Peças com vídeo no período que menos venderam.'}</p></div>
              <div class="seg-toggle" role="group" aria-label="Ordem">
                <button type="button" data-ordem="mais" aria-pressed="${V.ordem === 'mais'}">Mais</button>
                <button type="button" data-ordem="menos" aria-pressed="${V.ordem === 'menos'}">Menos</button>
              </div></div>
            ${ranking.length ? grafico(ranking.map((d) => ({ label: rot(d.p), titulo: rotulo(d.p),
              valor: fmtN(d.pecas), segs: [{ v: d.pecas, cls: 'c-tiktok', nome: 'Peças vendidas' }] })))
              : `<p class="muted">${V.ordem === 'mais' ? 'Nenhuma venda lançada nesse período.' : 'Nenhuma peça com vídeo nesse período.'}</p>`}
          </section>
          <section class="panel">
            <div class="panel-head"><div><h2>Vídeos x vendas</h2><p>Peças com mais vídeos no período e quanto venderam.</p></div></div>
            ${cruz.length ? `<ul class="rank">${cruz.map((d) => `<li><span>${rot(d.p).replace('</b>', '</b> ')}</span>
              <span class="n">${plural(d.videos, 'vídeo', 'vídeos')}, <span class="${d.pecas ? '' : 'zero'}">${d.pecas ? plural(d.pecas, 'peça', 'peças') : 'sem venda'}</span></span></li>`).join('')}</ul>`
              : '<p class="muted">Nenhum vídeo nesse período.</p>'}
          </section>
        </div>
        <section>
          <div class="panel-head"><div><h2>Peças vendidas por conta e semana</h2><p>${esc(nomeMes(V.mes))}, no formato da planilha.</p></div></div>
          <div class="table-wrap"><table class="semanas">
            <thead><tr><th>Conta</th>${SEMANAS.map((s, i) => `<th class="r ${V.semana === i + 1 ? 'sel' : ''}"><span class="longo">${rotSemana(s)}</span><span class="curto">${s[0]}–${s[1]}</span></th>`).join('')}<th class="r">Total</th></tr></thead>
            <tbody>${state.contas.map((c) => {
              const vs = state.vendas.filter((v) => v.conta === c && v.data.slice(0, 7) === V.mes);
              const porSem = SEMANAS.map((s, i) => vs.filter((v) => semanaDoDia(+v.data.slice(8, 10)) === i + 1).reduce((a, v) => a + v.quantidade, 0));
              return `<tr class="${V.conta && V.conta !== c ? 'apagado' : ''}"><td class="code">${esc(c)}</td>${porSem.map((n, i) => `<td class="r num ${V.semana === i + 1 ? 'sel' : ''}">${n || '<span class="muted">0</span>'}</td>`).join('')}<td class="r num"><b>${vs.reduce((a, v) => a + v.quantidade, 0)}</b></td></tr>`;
            }).join('')}</tbody></table></div>
        </section>`;
      $$('[data-ordem]').forEach((b) => b.addEventListener('click', () => { V.ordem = b.dataset.ordem; desenhar(); }));

      // Lista
      $('#vendas-sub').textContent = `${periodoTxt()}: ${plural(vendas.length, 'lançamento', 'lançamentos')}.`;
      const vis = vendas.slice(0, V.limite);
      $('#lista-vendas').innerHTML = vis.length ? `
        <div class="table-wrap"><table class="cards">
          <thead><tr><th>Data</th><th>Produto</th><th>Conta</th><th class="r">Peças</th><th class="hide-sm">Lançado por</th><th class="r hide-sm">Ações</th></tr></thead>
          <tbody>${vis.map((v) => { const p = produto(v.produtoId) || { prateleira: '?', descricao: 'Produto removido', num: 0 }; return `<tr>
            <td class="num nowrap" data-label="Data">${fmtDia(v.data)}</td>
            <td class="prod c-titulo"><span><b>${esc(p.prateleira)}</b> ${esc(descricao(p))}</span><span class="id">ID ${idTxt(p)}</span></td>
            <td data-label="Conta"><span class="conta">${esc(v.conta)}</span></td>
            <td class="r num" data-label="Peças"><b>${v.quantidade}</b></td>
            <td class="hide-sm" data-label="Lançado por">${esc(nomeDe(v.criadoPor))}</td>
            <td class="hide-sm c-acoes"><div class="row-actions">
              <button class="btn btn-ghost btn-sm" type="button" data-editar-venda="${v.id}">Editar</button>
              <button class="btn btn-danger-ghost btn-sm" type="button" data-excluir-venda="${v.id}">Excluir</button>
            </div></td></tr>`; }).join('')}</tbody></table></div>
        ${vendas.length > V.limite ? `<p style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" id="mais-vendas">Mostrar mais ${Math.min(15, vendas.length - V.limite)} de ${vendas.length - V.limite}</button></p>` : ''}`
        : '<div class="table-wrap"><p class="empty">Nenhuma venda lançada nesse período. Use o formulário acima para adicionar.</p></div>';
      const m = $('#mais-vendas'); if (m) m.addEventListener('click', () => { V.limite += 15; desenhar(); });
    };
    desenhar();

    // filtros
    $('#s-f-conta').addEventListener('change', (e) => { V.conta = e.target.value; V.limite = 15; desenhar(); });
    $('#s-f-mes').addEventListener('change', (e) => { V.mes = e.target.value; V.limite = 15; desenhar(); });
    $$('[data-sem]').forEach((b) => b.addEventListener('click', () => { V.semana = +b.dataset.sem; V.limite = 15; desenhar(); }));

    // escolha da conta no formulário
    $$('[data-conta-form]').forEach((b) => b.addEventListener('click', () => {
      V.contaForm = b.dataset.contaForm;
      $$('[data-conta-form]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      $('#err-conta').textContent = '';
    }));

    // adicionar
    $('#f-venda').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = lerVenda({ prod: '#s-prod', qtd: '#s-qtd', data: '#s-data', conta: V.contaForm }, '#f-venda');
      if (!r) return;
      const ok = await executar(e.submitter, async () => {
        await db.inserir('vendas', { produto_id: Number(r.p.id), conta_id: state.contaId[r.conta], quantidade: r.qtd, vendido_em: r.data });
        await carregarDados();
      }, 'Venda adicionada');
      if (!ok) return;
      V.mes = r.data.slice(0, 7); V.conta = ''; V.semana = 0;
      render();
    });

    // editar / excluir
    $('#lista-vendas').addEventListener('click', (e) => {
      const be = e.target.closest('[data-editar-venda]');
      const bx = e.target.closest('[data-excluir-venda]');
      if (be) editarVenda(state.vendas.find((v) => v.id === be.dataset.editarVenda), desenhar);
      if (bx) excluirVenda(state.vendas.find((v) => v.id === bx.dataset.excluirVenda), desenhar);
    });
  };

  // Lê e valida os campos de uma venda (usado ao adicionar e ao editar)
  function lerVenda(sel, raiz) {
    const txt = $(sel.prod).value.trim();
    const p = txt ? acharProduto(txt) : null;
    const qtd = $(sel.qtd).value.trim();
    const data = $(sel.data).value;
    const conta = sel.conta;
    const hoje = ymdLocal(agora());
    const erros = {};
    if (!txt) erros.prod = 'Escolha o produto vendido.';
    else if (!p) erros.prod = 'Não achamos esse produto. Digite o nº da prateleira, como A1, e escolha da lista.';
    if (!/^\d+$/.test(qtd) || +qtd < 1) erros.qtd = 'Use um número inteiro, 1 ou maior.';
    if (!data) erros.data = 'Informe a data da venda.';
    else if (data > hoje) erros.data = 'A data da venda não pode ser no futuro.';
    $$(`${raiz} [data-err]`).forEach((el) => {
      el.textContent = erros[el.dataset.err] || '';
      const inp = el.parentElement.querySelector('.input'); if (inp) inp.setAttribute('aria-invalid', erros[el.dataset.err] ? 'true' : 'false');
    });
    const errConta = $(`${raiz} #err-conta`) || $(`${raiz} [data-err-conta]`);
    if (!conta && errConta) errConta.textContent = 'Escolha a conta onde a venda aconteceu.';
    if (Object.keys(erros).length || !conta) {
      const f = $(`${raiz} [aria-invalid="true"]`); if (f) f.focus();
      return null;
    }
    return { p, qtd: +qtd, data, conta };
  }

  function editarVenda(v, depois) {
    if (!v) return;
    const p = produto(v.produtoId);
    const hoje = ymdLocal(agora());
    abrirModal({
      titulo: 'Editar venda',
      corpo: `<div id="f-edv" class="modal-form">
        <div class="field"><label for="e-conta">Conta do TikTok Shop</label>
          <select class="input" id="e-conta">${state.contas.map((c) => `<option ${c === v.conta ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label for="e-prod">Produto vendido</label>
          <input class="input" id="e-prod" list="lista-prod-e" value="${p ? esc(p.prateleira + ' - ' + descricao(p)) : ''}" autocomplete="off">
          <datalist id="lista-prod-e">${opcoesProduto()}</datalist><span class="err" data-err="prod"></span></div>
        <div class="field"><label for="e-qtd">Peças vendidas</label>
          <input class="input num" id="e-qtd" type="number" min="1" step="1" inputmode="numeric" value="${v.quantidade}"><span class="err" data-err="qtd"></span></div>
        <div class="field"><label for="e-data">Data da venda</label>
          <input class="input" id="e-data" type="date" value="${v.data}" max="${hoje}"><span class="err" data-err="data"></span></div>
      </div>`,
      botoes: [
        { label: 'Salvar alterações', acao: () => {
          const r = lerVenda({ prod: '#e-prod', qtd: '#e-qtd', data: '#e-data', conta: $('#e-conta').value }, '#f-edv');
          if (!r) return;
          const mud = [];
          if (r.conta !== v.conta) mud.push(['Conta', `${v.conta} → ${r.conta}`]);
          if (r.p.id !== v.produtoId) mud.push(['Produto', `${p ? p.prateleira : '?'} → ${r.p.prateleira}`]);
          if (r.qtd !== v.quantidade) mud.push(['Peças', `${v.quantidade} → ${r.qtd}`]);
          if (r.data !== v.data) mud.push(['Data', `${fmtDia(v.data)} → ${fmtDia(r.data)}`]);
          if (!mud.length) { fecharModal(); toast('Nada foi alterado'); return; }
          abrirModal({
            titulo: 'Tem certeza das edições feitas?', alerta: true,
            corpo: `<p class="muted">Confira o que vai mudar nesta venda:</p>
              <ul class="diff">${mud.map(([k, t]) => `<li><b>${k}</b><span>${esc(t)}</span></li>`).join('')}</ul>`,
            botoes: [
              { label: 'Sim, salvar edições', acao: async (e) => {
                const ok = await executar(e.currentTarget, async () => {
                  await db.alterar('vendas', `id=eq.${v.id}`, { conta_id: state.contaId[r.conta], produto_id: Number(r.p.id),
                    quantidade: r.qtd, vendido_em: r.data });
                  await carregarDados();
                }, 'Edições salvas');
                if (ok) { fecharModal(); depois(); }
              } },
              { label: 'Não, cancelar', cls: 'btn-ghost', acao: () => { fecharModal(); toast('Edição cancelada. Nada foi salvo.'); } }
            ]
          });
        } },
        { label: 'Cancelar', cls: 'btn-ghost', acao: fecharModal }
      ]
    });
  }

  function excluirVenda(v, depois) {
    if (!v) return;
    const p = produto(v.produtoId);
    abrirModal({
      titulo: 'Excluir esta venda?', alerta: true,
      corpo: `<p class="muted">${plural(v.quantidade, 'peça', 'peças')} de ${esc(p ? rotulo(p) : 'produto removido')}, conta ${esc(v.conta)}, em ${fmtDia(v.data)}. A exclusão fica registrada no histórico.</p>`,
      botoes: [
        { label: 'Excluir venda', cls: 'btn-red', acao: async (e) => {
          const ok = await executar(e.currentTarget, async () => {
            await db.apagar('vendas', `id=eq.${v.id}`);
            await carregarDados();
          }, 'Venda excluída');
          if (ok) { fecharModal(); depois(); }
        } },
        { label: 'Cancelar', cls: 'btn-ghost', acao: fecharModal }
      ]
    });
  }

  // ---------- Admin master ----------
  let periodoAdmin = 30, filtroUsuario = '', filtroAcao = '', limiteReg = 15;
  let periodoTop = '30';   // Mais vendidos por conta: 'mes', '30', '90' ou 'tudo'
  const PERIODOS_TOP = [['mes', 'Este mês'], ['30', '30 dias'], ['90', '90 dias'], ['tudo', 'Tudo']];
  const TOP_N = 5;
  PAGINAS.admin = function () {
    if (eu().papel !== 'admin') {
      shell('admin', `<div class="page-head"><div><h1>Admin master</h1></div></div>
        <div class="notice">${ICON.alerta}<span>Esta área é só para o admin master. Peça acesso ao responsável pela loja.</span></div>`);
      return;
    }
    const acoes = ['Adicionou produto', 'Editou produto', 'Excluiu produto', 'Restaurou produto', 'Registrou vídeo', 'Adicionou venda', 'Editou venda', 'Excluiu venda',
      'Criou conta', 'Aprovou cadastro', 'Recusou cadastro', 'Alterou cargo', 'Excluiu conta', 'Reativou conta',
      'Redefiniu senha', 'Adicionou conta TikTok', 'Renomeou conta TikTok', 'Excluiu conta TikTok', 'Restaurou conta TikTok', 'Importou planilha'];
    shell('admin', `
      <div class="page-head"><div><h1>Admin master</h1><p>Cadastros novos, vídeos de cada pessoa, a equipe, as contas do TikTok e tudo o que foi alterado no sistema.</p></div></div>
      <section id="pendentes"></section>
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
      <section id="top-contas">
        <div class="panel-head"><div><h2>Mais vendidos por conta</h2><p id="top-sub">Os ${TOP_N} produtos com mais peças vendidas em cada conta do TikTok.</p></div>
          <div class="seg-toggle" role="group" aria-label="Período dos mais vendidos">
            ${PERIODOS_TOP.map(([k, t]) => `<button type="button" data-top="${k}">${t}</button>`).join('')}
          </div></div>
        <div id="graf-top"></div>
      </section>
      <section>
        <div class="panel-head"><div><h2>Equipe</h2><p>Mude o cargo para dar ou tirar o acesso à área Admin. Contas excluídas não conseguem mais entrar.</p></div></div>
        <div id="equipe"></div>
      </section>
      <section id="contas-tiktok">
        <div class="panel-head"><div><h2>Contas do TikTok</h2><p>As contas que aparecem para escolher ao registrar vídeos e vendas.</p></div>
          <button class="btn btn-sm" type="button" id="b-nova-conta">${ICON.mais}Adicionar conta</button></div>
        <div id="lista-contas"></div>
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
`);

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
        <div class="table-wrap"><table class="cards">
          <thead><tr><th>Pessoa</th><th>Cargo</th><th class="r hide-sm">Vídeos em 30 dias</th><th class="r hide-sm">Ações</th></tr></thead>
          <tbody>${ativos().map((u) => {
            const voce = u.id === state.sessao;
            const n = state.videos.filter((v) => v.usuarioId === u.id && dentroDe(v.data, 30)).length;
            return `<tr>
              <td class="prod c-titulo"><span><b>${esc(u.nome)}</b>${voce ? ' <span class="voce">você</span>' : ''}</span><span class="muted">${esc(u.email)}</span></td>
              <td data-label="Cargo">${voce || u.fixo
                ? `<span class="pill ${u.papel === 'admin' ? 'pill-admin' : 'pill-ok'}">${u.papel === 'admin' ? 'Admin master' : 'Colaborador'}</span>`
                : `<select class="input input-sm" data-cargo="${u.id}" aria-label="Cargo de ${esc(u.nome)}">
                    <option value="colaborador" ${u.papel !== 'admin' ? 'selected' : ''}>Colaborador</option>
                    <option value="admin" ${u.papel === 'admin' ? 'selected' : ''}>Admin master</option></select>
                  <button class="btn btn-danger-ghost btn-sm show-sm-btn" type="button" data-excluir="${u.id}">Excluir conta</button>`}
                ${voce ? '' : `<button class="btn btn-ghost btn-sm show-sm-btn" type="button" data-nova-senha="${u.id}">Nova senha</button>`}</td>
              <td class="r num hide-sm" data-label="Vídeos em 30 dias">${n}</td>
              <td class="hide-sm c-acoes"><div class="row-actions">${voce ? '<span class="muted" style="font-size:.82rem">Sua conta</span>'
                : `<button class="btn btn-ghost btn-sm" type="button" data-nova-senha="${u.id}">Nova senha</button>${u.fixo
                  ? '' : `<button class="btn btn-danger-ghost btn-sm" type="button" data-excluir="${u.id}">Excluir</button>`}`}</div></td></tr>`;
          }).join('')}</tbody></table></div>
        <p class="muted" style="font-size:.85rem;margin-top:10px">${plural(admins, 'admin master', 'admins master')} ativos. Ricardo e Márcio são admins master fixos: o cargo deles não muda e a conta não pode ser excluída. Você também não pode mudar o próprio cargo nem excluir a própria conta.
          "Nova senha" cria uma senha provisória para quem esqueceu a dela.</p>`;
    };

    const desenharRegistros = () => {
      const todos = state.registros
        .filter((r) => (!filtroUsuario || r.usuarioId === filtroUsuario) && (!filtroAcao || r.acao === filtroAcao));
      const vis = todos.slice(0, limiteReg);
      $('#lista-reg').innerHTML = vis.length ? `
        <div class="table-wrap"><table class="cards">
          <thead><tr><th>Quando</th><th class="hide-sm">Quem</th><th>O que fez</th></tr></thead>
          <tbody>${vis.map((r) => `<tr>
            <td class="num nowrap" data-label="Quando">${fmtData(r.data)}</td>
            <td class="hide-sm nowrap" data-label="Quem">${r.usuarioId ? esc(nomeDe(r.usuarioId)) : 'Sistema'}</td>
            <td class="prod c-titulo"><b>${esc(r.acao)}</b><span class="show-sm">${r.usuarioId ? esc(nomeDe(r.usuarioId)) : 'Sistema'}</span><span class="muted">${esc(detalheRegistro(r))}</span></td></tr>`).join('')}</tbody></table></div>
        ${todos.length > limiteReg ? `<p style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" id="mais-reg">Mostrar mais ${Math.min(15, todos.length - limiteReg)} de ${todos.length - limiteReg}</button></p>` : ''}`
        : '<div class="table-wrap"><p class="empty">Nenhum registro com esses filtros.</p></div>';
      const m = $('#mais-reg'); if (m) m.addEventListener('click', () => { limiteReg += 15; desenharRegistros(); });
    };

    const desenharPendentes = () => {
      const pend = pendentes();
      $('#pendentes').innerHTML = pend.length ? `
        <div class="panel panel-destaque">
          <div class="panel-head"><div><h2>Cadastros aguardando aprovação</h2>
            <p>${plural(pend.length, 'pessoa pediu', 'pessoas pediram')} acesso. Quem for aprovado entra como colaborador.</p></div></div>
          <ul class="pend-lista">${pend.map((u) => `<li>
            <div class="pend-quem"><b>${esc(u.nome)}</b><span class="muted">${esc(u.email)}, pediu em ${fmtData(u.criadoEm)}</span></div>
            <div class="row-actions">
              <button class="btn btn-sm" type="button" data-aprovar="${u.id}">Aprovar</button>
              <button class="btn btn-danger-ghost btn-sm" type="button" data-recusar="${u.id}">Recusar</button>
            </div></li>`).join('')}</ul>
        </div>` : '';
    };

    const atualizarPerfil = async (btn, u, mudancas, msg) => {
      const ok = await executar(btn, async () => {
        await db.alterar('perfis', `id=eq.${u.id}`, mudancas);
        await carregarDados();
      }, msg);
      if (ok) { fecharModal(); render(); }
      return ok;
    };

    // ---------- Contas do TikTok ----------
    const desenharContas = () => {
      const ativas = state.contasTodas.filter((c) => c.ativa);
      const excluidas = state.contasTodas.filter((c) => !c.ativa);
      const uso = (c) => ({
        v30: state.videos.filter((v) => v.conta === c.nome && dentroDe(v.data, 30)).length,
        vt: state.videos.filter((v) => v.conta === c.nome).length,
        vendas: state.vendas.filter((v) => v.conta === c.nome).reduce((t, v) => t + v.quantidade, 0)
      });
      $('#lista-contas').innerHTML = `
        <div class="table-wrap"><table class="cards tabela-contas">
          <thead><tr><th class="c-ordem"><span class="sr-only">Ordem</span></th><th>Conta</th><th class="r">Vídeos em 30 dias</th><th class="r">Vídeos no total</th><th class="r">Peças vendidas</th><th class="r hide-sm">Ações</th></tr></thead>
          <tbody>${ativas.map((c, i) => { const u = uso(c); return `<tr>
            <td class="c-ordem" data-label="Ordem na lista"><div class="ordem-btns">
              <button class="btn btn-ghost btn-icone" type="button" data-subir="${c.id}" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${esc(c.nome)} na lista">${ICON.cima}</button>
              <button class="btn btn-ghost btn-icone" type="button" data-descer="${c.id}" ${i === ativas.length - 1 ? 'disabled' : ''} aria-label="Descer ${esc(c.nome)} na lista">${ICON.baixo}</button></div></td>
            <td class="prod c-titulo"><b class="conta-nome">${esc(c.nome)}</b></td>
            <td class="r num" data-label="Vídeos em 30 dias">${u.v30}</td>
            <td class="r num" data-label="Vídeos no total">${u.vt}</td>
            <td class="r num" data-label="Peças vendidas">${u.vendas}</td>
            <td class="c-acoes"><div class="row-actions">
              <button class="btn btn-ghost btn-sm" type="button" data-editar-conta="${c.id}">Editar</button>
              <button class="btn btn-danger-ghost btn-sm" type="button" data-excluir-conta="${c.id}" ${ativas.length === 1 ? 'disabled title="Mantenha pelo menos uma conta ativa"' : ''}>Excluir</button>
            </div></td></tr>`; }).join('')}</tbody></table></div>
        ${excluidas.length ? `<details class="contas-excluidas">
          <summary>Contas excluídas (${excluidas.length})</summary>
          <ul>${excluidas.map((c) => { const u = uso(c); return `<li>
            <span><b>${esc(c.nome)}</b> <span class="muted">${plural(u.vt, 'vídeo', 'vídeos')} e ${plural(u.vendas, 'peça vendida', 'peças vendidas')} no histórico</span></span>
            <button class="btn btn-ghost btn-sm" type="button" data-restaurar-conta="${c.id}">Restaurar</button></li>`; }).join('')}</ul>
        </details>` : ''}`;
    };
    const conta = (id) => state.contasTodas.find((c) => String(c.id) === String(id));
    const normalizarNome = (t) => String(t || '').trim().replace(/\s+/g, ' ').toUpperCase();
    const salvarConta = async (btn, fn, msg) => {
      const ok = await executar(btn, async () => { await fn(); await carregarDados(); }, msg);
      if (ok) { fecharModal(); render(); }
      return ok;
    };
    // Adicionar / editar: o mesmo formulário
    const formConta = (c) => {
      abrirModal({
        titulo: c ? `Editar a conta ${esc(c.nome)}` : 'Adicionar conta do TikTok',
        corpo: `<div class="field" style="margin-top:12px"><label for="ct-nome">Nome da conta</label>
            <input class="input input-maiusculo" id="ct-nome" maxlength="30" autocomplete="off" value="${c ? esc(c.nome) : ''}" placeholder="Ex.: LOJA CENTRO">
            <span class="hint">Aparece assim nos botões de escolher a conta. Fica em letras maiúsculas.</span>
            <span class="err" id="ct-err" role="alert"></span></div>
          ${c ? `<p class="muted" style="font-size:.85rem;margin-top:10px">Os vídeos e as vendas já lançados nessa conta passam a aparecer com o nome novo.</p>` : ''}`,
        botoes: [
          { label: c ? 'Salvar' : 'Adicionar conta', acao: (ev) => enviar(ev.currentTarget) },
          { label: 'Cancelar', cls: 'btn-ghost', acao: fecharModal }
        ]
      });
      const inp = $('#ct-nome'), err = $('#ct-err');
      inp.focus(); inp.select();
      inp.addEventListener('input', () => { err.textContent = ''; inp.removeAttribute('aria-invalid'); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); enviar($('.modal [data-b="0"]')); } });
      const erro = (t) => { err.textContent = t; inp.setAttribute('aria-invalid', 'true'); inp.focus(); };
      async function enviar(btn) {
        const nome = normalizarNome(inp.value);
        if (!nome) return erro('Digite o nome da conta.');
        if (c && nome === c.nome) { fecharModal(); return; }
        const igual = state.contasTodas.find((x) => x.nome === nome && (!c || x.id !== c.id));
        if (igual && igual.ativa) return erro(`Já existe a conta ${nome}.`);
        if (igual && !igual.ativa) {
          err.innerHTML = `A conta ${esc(nome)} foi excluída antes. <button class="btn-text" type="button" id="ct-restaurar">Restaurar ${esc(nome)}</button>`;
          inp.setAttribute('aria-invalid', 'true');
          $('#ct-restaurar').addEventListener('click', (ev) =>
            salvarConta(ev.currentTarget, () => db.alterar('contas_tiktok', `id=eq.${igual.id}`, { ativa: true }), `Conta ${nome} restaurada`));
          return;
        }
        if (c) await salvarConta(btn, () => db.alterar('contas_tiktok', `id=eq.${c.id}`, { nome }), `Conta renomeada para ${nome}`);
        else {
          const ordem = Math.max(0, ...state.contasTodas.map((x) => x.ordem || 0)) + 1;
          await salvarConta(btn, () => db.inserir('contas_tiktok', { nome, ordem }), `Conta ${nome} adicionada`);
        }
      }
    };
    $('#b-nova-conta').addEventListener('click', () => formConta(null));
    $('#contas-tiktok').addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-editar-conta]'), ex = e.target.closest('[data-excluir-conta]');
      const re = e.target.closest('[data-restaurar-conta]');
      const su = e.target.closest('[data-subir]'), de = e.target.closest('[data-descer]');
      if (ed) formConta(conta(ed.dataset.editarConta));
      if (ex) {
        const c = conta(ex.dataset.excluirConta);
        const vt = state.videos.filter((v) => v.conta === c.nome).length;
        const ve = state.vendas.filter((v) => v.conta === c.nome).length;
        abrirModal({
          titulo: `Excluir a conta ${esc(c.nome)}?`, alerta: true,
          corpo: `<p class="muted">Ela deixa de aparecer para escolher ao registrar vídeos e vendas.
            ${vt || ve ? `${[vt ? plural(vt, 'vídeo', 'vídeos') : '', ve ? plural(ve, 'venda', 'vendas') : ''].filter(Boolean).join(' e ')} já ${vt + ve === 1 ? 'lançado continua' : 'lançados continuam'} no histórico e nos gráficos.` : ''}
            Dá para restaurar depois em "Contas excluídas".</p>`,
          botoes: [
            { label: 'Excluir conta', cls: 'btn-red', acao: (ev) => salvarConta(ev.currentTarget, () => db.alterar('contas_tiktok', `id=eq.${c.id}`, { ativa: false }), `Conta ${c.nome} excluída`) },
            { label: 'Cancelar', cls: 'btn-ghost', acao: fecharModal }
          ]
        });
      }
      if (re) { const c = conta(re.dataset.restaurarConta); salvarConta(re, () => db.alterar('contas_tiktok', `id=eq.${c.id}`, { ativa: true }), `Conta ${c.nome} restaurada`); }
      if (su || de) {
        const ativas = state.contasTodas.filter((c) => c.ativa);
        const i = ativas.findIndex((c) => String(c.id) === (su ? su.dataset.subir : de.dataset.descer));
        const j = su ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= ativas.length) return;
        const nova = ativas.slice(); [nova[i], nova[j]] = [nova[j], nova[i]];
        // renumera 1, 2, 3... (só grava as que mudaram)
        const ok = await executar(null, async () => {
          for (let k = 0; k < nova.length; k++) if (nova[k].ordem !== k + 1) await db.alterar('contas_tiktok', `id=eq.${nova[k].id}`, { ordem: k + 1 });
          await carregarDados();
        });
        if (ok) { desenharContas(); const b = $(`[data-${su ? 'subir' : 'descer'}="${nova[j].id}"]`); if (b && !b.disabled) b.focus(); }
      }
    });

    // ---------- Mais vendidos por conta (um quadro por conta) ----------
    const desenharTop = () => {
      const hoje = ymdLocal(agora());
      let desde = '';
      if (periodoTop === 'mes') desde = hoje.slice(0, 8) + '01';
      else if (periodoTop !== 'tudo') { const d = agora(); d.setDate(d.getDate() - (Number(periodoTop) - 1)); desde = ymdLocal(d); }
      const vendas = state.vendas.filter((v) => !desde || v.data >= desde);
      $$('[data-top]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.top === periodoTop)));
      const txtPer = { mes: 'neste mês', 30: 'nos últimos 30 dias', 90: 'nos últimos 90 dias', tudo: 'desde o começo' }[periodoTop];
      // contas ativas na ordem da lista + excluídas que venderam no período
      const contas = [...state.contasTodas.filter((c) => c.ativa),
        ...state.contasTodas.filter((c) => !c.ativa && vendas.some((v) => v.conta === c.nome))];
      const total = vendas.reduce((a, v) => a + v.quantidade, 0);
      $('#top-sub').textContent = `Os ${TOP_N} produtos com mais peças vendidas em cada conta do TikTok, ${txtPer}. ${total ? plural(total, 'peça vendida', 'peças vendidas') + ' no total.' : ''}`;
      if (!vendas.length) {
        $('#graf-top').innerHTML = `<div class="panel"><p class="muted">Nenhuma venda lançada ${txtPer}. As vendas são lançadas na tela <a href="#vendas">Vendas</a>.</p></div>`;
        return;
      }
      const listas = contas.map((c) => {
        const porProd = new Map();
        vendas.filter((v) => v.conta === c.nome).forEach((v) => porProd.set(v.produtoId, (porProd.get(v.produtoId) || 0) + v.quantidade));
        return [...porProd].map(([id, n]) => ({ p: produto(id) || { prateleira: '?', descricao: 'Produto removido', num: 0 }, n }))
          .sort((a, b) => b.n - a.n || ordemPrat(a.p, b.p));
      });
      // mesma escala em todas as contas, para as barras serem comparáveis entre elas
      const maxGeral = Math.max(1, ...listas.map((l) => (l[0] ? l[0].n : 0)));
      $('#graf-top').innerHTML = `<div class="top-grid">${contas.map((c, ci) => {
        const lista = listas[ci];
        const soma = lista.reduce((a, d) => a + d.n, 0);
        const top = lista.slice(0, TOP_N);
        return `<section class="panel top-conta" aria-label="Mais vendidos da conta ${esc(c.nome)}">
          <div class="top-head"><h3><span class="conta">${esc(c.nome)}</span>${c.ativa ? '' : ' <span class="tag-excluida">excluída</span>'}</h3>
            <span class="muted">${soma ? plural(soma, 'peça', 'peças') : 'sem vendas'}</span></div>
          ${top.length ? grafico(top.map((d, i) => ({
              label: `<span class="top-pos">${i + 1}</span><b>${esc(d.p.prateleira)}</b> ${esc(descricao(d.p))}`, titulo: rotulo(d.p),
              valor: fmtN(d.n), segs: [{ v: d.n, cls: 'c-tiktok', nome: 'Peças vendidas' }] })), { max: maxGeral, semEixo: true })
            + (lista.length > TOP_N ? `<p class="top-mais muted">Mais ${plural(lista.length - TOP_N, 'produto vendido', 'produtos vendidos')} nessa conta.</p>` : '')
            : `<p class="muted top-vazio">Nenhuma venda ${txtPer}.</p>`}
        </section>`;
      }).join('')}</div>`;
    };
    $$('[data-top]').forEach((b) => b.addEventListener('click', () => { periodoTop = b.dataset.top; desenharTop(); }));

    desenharPendentes(); desenharGrafico(); desenharTop(); desenharEquipe(); desenharContas(); desenharRegistros();
    $$('[data-per]').forEach((b) => b.addEventListener('click', () => { periodoAdmin = +b.dataset.per; desenharGrafico(); }));
    $('#ad-conta').addEventListener('change', (e) => { contaSel = e.target.value; desenharGrafico(); });
    $('#r-user').addEventListener('change', (e) => { filtroUsuario = e.target.value; limiteReg = 15; desenharRegistros(); });
    $('#r-acao').addEventListener('change', (e) => { filtroAcao = e.target.value; limiteReg = 15; desenharRegistros(); });

    // Aprovar / recusar cadastro
    $('#pendentes').addEventListener('click', (e) => {
      const ba = e.target.closest('[data-aprovar]'), br = e.target.closest('[data-recusar]');
      if (ba) {
        const u = usuario(ba.dataset.aprovar);
        abrirModal({
          titulo: `Aprovar o cadastro de ${esc(u.nome)}?`,
          corpo: `<p class="muted">${esc(u.email)} vai entrar como colaborador: vê o estoque, registra vídeos e edita produtos. Depois você pode mudar o cargo na lista da equipe.</p>`,
          botoes: [
            { label: 'Aprovar cadastro', acao: (ev) => atualizarPerfil(ev.currentTarget, u, { aprovado: true }, 'Cadastro aprovado') },
            { label: 'Cancelar', cls: 'btn-ghost', acao: fecharModal }
          ]
        });
      }
      if (br) {
        const u = usuario(br.dataset.recusar);
        abrirModal({
          titulo: `Recusar o cadastro de ${esc(u.nome)}?`, alerta: true,
          corpo: `<p class="muted">${esc(u.email)} não vai conseguir usar o sistema. A recusa fica registrada no histórico.</p>`,
          botoes: [
            { label: 'Recusar cadastro', cls: 'btn-red', acao: (ev) => atualizarPerfil(ev.currentTarget, u, { ativo: false }, 'Cadastro recusado') },
            { label: 'Cancelar', cls: 'btn-ghost', acao: fecharModal }
          ]
        });
      }
    });

    // Mudar cargo (com confirmação)
    $('#equipe').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-cargo]'); if (!sel) return;
      const u = usuario(sel.dataset.cargo), novo = sel.value;
      const voltar = () => { sel.value = u.papel === 'admin' ? 'admin' : 'colaborador'; fecharModal(); };
      const virarAdmin = novo === 'admin';
      abrirModal({
        titulo: virarAdmin ? `Tornar ${esc(u.nome)} admin master?` : `Tirar o acesso de admin de ${esc(u.nome)}?`,
        corpo: `<p class="muted">${virarAdmin
          ? 'Essa pessoa vai acessar a área Admin e as vendas: aprovar cadastros, ver os registros de todos, mudar cargos e excluir contas.'
          : 'Essa pessoa volta a ser colaborador e deixa de ver a área Admin e as vendas.'}</p>`,
        botoes: [
          { label: virarAdmin ? 'Tornar admin master' : 'Mudar para colaborador',
            acao: (ev) => atualizarPerfil(ev.currentTarget, u, { papel: novo }, 'Cargo alterado') },
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
        corpo: `<p class="muted">${esc(u.email)} não vai mais conseguir usar o sistema. ${n ? `Os ${plural(n, 'vídeo', 'vídeos')} e registros dessa pessoa continuam no histórico.` : ''}
          O e-mail fica livre: a pessoa pode pedir acesso de novo com ele, e o cadastro novo vai precisar de aprovação.</p>`,
        botoes: [
          { label: 'Excluir conta', cls: 'btn-red', acao: (ev) => atualizarPerfil(ev.currentTarget, u, { ativo: false }, 'Conta excluída') },
          { label: 'Cancelar', cls: 'btn-ghost', acao: fecharModal }
        ]
      });
    });
  };

  // ---------- Nova senha (admin master define uma senha provisória) ----------
  function gerarSenha() {
    const palavras = ['jeans', 'loja', 'denim', 'rebite', 'bolso', 'botao', 'barra', 'cinto'];
    const n = new Uint32Array(2);
    (window.crypto || window.msCrypto).getRandomValues(n);
    return `${palavras[n[0] % palavras.length]}-${String(n[1] % 10000).padStart(4, '0')}`;
  }
  function modalNovaSenha(u) {
    abrirModal({
      titulo: `Nova senha para ${esc(u.nome)}`,
      corpo: `<p class="muted">Ninguém consegue ver a senha atual de outra pessoa. Você define uma senha provisória,
          passa para ${esc(u.nome.split(' ')[0])} e, ao entrar com ela, o site pede para criar uma senha própria.</p>
        <div class="field"><label for="ns-prov">Senha provisória</label>
          <div class="input-com-botao"><input class="input senha-prov" id="ns-prov" type="text" autocomplete="off" spellcheck="false" value="${gerarSenha()}">
          <button class="btn btn-ghost" type="button" id="ns-gerar">Gerar outra</button></div>
          <span class="err" id="ns-prov-err" role="alert"></span></div>
        <p class="muted" style="font-size:.85rem">${esc(u.nome.split(' ')[0])} sai do sistema nos aparelhos em que estiver usando.</p>`,
      botoes: [
        { label: 'Definir senha provisória', acao: (ev) => definir(ev.currentTarget) },
        { label: 'Cancelar', cls: 'btn-ghost', acao: fecharModal }
      ]
    });
    const inp = $('#ns-prov'), err = $('#ns-prov-err');
    inp.focus(); inp.select();
    $('#ns-gerar').addEventListener('click', () => { inp.value = gerarSenha(); err.textContent = ''; inp.focus(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); definir($('.modal [data-b="0"]')); } });
    async function definir(btn) {
      const senha = inp.value.trim();
      if (senha.length < 6) { err.textContent = 'A senha precisa ter pelo menos 6 caracteres.'; inp.focus(); return; }
      const ok = await executar(btn, async () => { await db.rpc('redefinir_senha', { p_usuario: u.id, p_senha: senha }); });
      if (!ok) return;
      try { await carregarDados(); } catch (e) { /* segue */ }
      abrirModal({
        titulo: 'Senha provisória definida',
        corpo: `<p class="muted">Passe esta senha para ${esc(u.nome)} (${esc(u.email)}):</p>
          <div class="senha-mostrar"><code id="ns-pronta">${esc(senha)}</code>
            <button class="btn btn-ghost btn-sm" type="button" id="ns-copiar">${ICON.copiar}<span>Copiar</span></button></div>
          <p class="muted" style="font-size:.85rem">Ela não fica guardada em lugar nenhum: depois de fechar esta janela, não dá para ver de novo.
            Se perder, é só criar outra.</p>`,
        botoes: [{ label: 'Pronto', acao: () => { fecharModal(); render(); } }]
      });
      $('#ns-copiar').addEventListener('click', async (ev) => {
        const b = ev.currentTarget;
        if (await copiarTexto(senha)) { b.innerHTML = ICON.certo + '<span>Copiada</span>'; toast('Senha copiada'); }
        else { const r = document.createRange(); r.selectNodeContents($('#ns-pronta')); getSelection().removeAllRanges(); getSelection().addRange(r); }
      });
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-nova-senha]'); if (!b) return;
    const u = state.usuarios.find((x) => x.id === b.dataset.novaSenha);
    if (u) modalNovaSenha(u);
  });

  // Texto legível de um registro do histórico (traduz as mudanças guardadas pelo banco)
  const ROTULOS = { local: 'local', prateleira: 'prateleira', descricao: 'descrição', quantidade: 'peças',
    fabricante_id: 'fabricante', link_tiktok: 'link', produto_id: 'produto', conta_id: 'conta', vendido_em: 'data' };
  function valorLegivel(campo, v) {
    if (v === null || v === undefined || v === '') return 'vazio';
    if (campo === 'fabricante_id') { const f = state.fabricantes.find((x) => x.id === v); return f ? f.nome : '?'; }
    if (campo === 'produto_id') { const p = produto(String(v)); return p ? p.prateleira : '?'; }
    if (campo === 'conta_id') return state.contaNome[v] || '?';
    if (campo === 'vendido_em') return fmtDia(v);
    return String(v);
  }
  function detalheRegistro(r) {
    if (!r.mudancas || !Object.keys(r.mudancas).length) return r.detalhe;
    const partes = Object.entries(r.mudancas).map(([k, m]) => k === 'link_tiktok'
      ? (m.para ? (m.de ? 'link atualizado' : 'link adicionado') : 'link removido')
      : `${ROTULOS[k] || k} ${valorLegivel(k, m.de)} → ${valorLegivel(k, m.para)}`);
    if (r.acao === 'Editou produto') return `${r.detalhe.split(':')[0]}: ${partes.join(', ')}`;
    if (r.acao === 'Editou venda') return `${r.detalhe}: ${partes.join(', ')}`;
    return r.detalhe;
  }

  // Volta do link de confirmação do e-mail
  (async () => {
    let retorno = null;
    try { retorno = await auth.lerRetornoDoEmail(); } catch (e) { retorno = null; }
    if (retorno && retorno.ok && retorno.tipo === 'recovery') { recuperandoSenha = true; await iniciar('produtos'); return; }
    if (retorno && retorno.ok) { await iniciar('produtos'); toast('E-mail confirmado!'); return; }
    if (retorno && !retorno.ok) { location.hash = 'login'; await iniciar(); toast(retorno.msg, true); return; }
    iniciar();
  })();
})();
