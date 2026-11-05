/* Cliente leve do Supabase (login + banco), sem dependências externas.
   Usa as APIs padrão do Supabase: Auth (/auth/v1) e PostgREST (/rest/v1). */
window.Supa = (function () {
  'use strict';
  const BASE = window.CONFIG.SUPABASE_URL;
  const KEY = window.CONFIG.SUPABASE_KEY;
  const SK = 'gev-sessao';
  const PAGINA = 1000; // limite padrão de linhas por requisição no Supabase

  // ---------- Sessão ----------
  let sessao = (() => { try { return JSON.parse(localStorage.getItem(SK)); } catch (e) { return null; } })();
  function guardar(s) {
    sessao = s;
    try { if (s) localStorage.setItem(SK, JSON.stringify(s)); else localStorage.removeItem(SK); } catch (e) { /* ignora */ }
  }
  function aceitarSessao(r) {
    if (!r || !r.access_token) return null;
    const s = {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600),
      user: r.user ? { id: r.user.id, email: r.user.email } : (sessao && sessao.user)
    };
    guardar(s);
    return s;
  }

  // ---------- Erros em português ----------
  const MSG = {
    invalid_credentials: 'E-mail ou senha incorretos.',
    invalid_grant: 'E-mail ou senha incorretos.',
    user_already_exists: 'Esse e-mail já tem conta. Use a tela de entrar.',
    email_exists: 'Esse e-mail já tem conta. Use a tela de entrar.',
    weak_password: 'Senha fraca: use pelo menos 6 caracteres.',
    same_password: 'A nova senha precisa ser diferente da atual.',
    email_not_confirmed: 'Esse e-mail ainda não foi confirmado.',
    signup_disabled: 'O cadastro está desativado no momento.',
    over_email_send_rate_limit: 'Muitas tentativas. Espere alguns minutos e tente de novo.',
    over_request_rate_limit: 'Muitas tentativas. Espere alguns minutos e tente de novo.',
    validation_failed: 'Confira o e-mail digitado.',
    '23505': 'Já existe um registro com esse valor.',
    '42501': 'Você não tem permissão para fazer isso.',
    '23514': 'Algum dado está fora do formato aceito.',
    '23503': 'Esse item está ligado a outros registros e não pode ser removido.',
    PGRST301: 'Sua sessão expirou. Entre de novo.',
    PGRST303: 'Sua sessão expirou. Entre de novo.'
  };
  function erro(status, corpo) {
    const codigo = corpo && (corpo.error_code || corpo.code || corpo.error) || String(status);
    let msg = MSG[codigo];
    if (!msg && corpo && corpo.code === 'P0001') msg = corpo.message; // mensagens das regras do banco
    if (!msg && corpo && /sending (confirmation|magic link) email/i.test(corpo.msg || corpo.message || '')) {
      msg = 'Não foi possível enviar o e-mail de confirmação. Peça ao responsável técnico para desligar a confirmação de e-mail no Supabase.';
    }
    if (!msg) msg = (corpo && (corpo.msg || corpo.message || corpo.error_description)) || `Erro ${status}. Tente de novo.`;
    const e = new Error(msg);
    e.status = status; e.code = codigo; e.detalhe = corpo;
    return e;
  }

  async function chamar(caminho, { method = 'GET', body, headers = {}, comLogin = true } = {}) {
    const h = { apikey: KEY, 'Content-Type': 'application/json', ...headers };
    if (comLogin && sessao) h.Authorization = 'Bearer ' + sessao.access_token;
    let resp;
    try {
      resp = await fetch(BASE + caminho, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw Object.assign(new Error('Sem conexão com o servidor. Confira a internet e tente de novo.'), { status: 0 });
    }
    const texto = await resp.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch (e) { dados = texto; }
    if (!resp.ok) throw erro(resp.status, dados);
    return dados;
  }

  // Renova o login antes de expirar (o acesso vale 1 hora)
  let renovando = null;
  async function garantirSessao() {
    if (!sessao) return;
    if (sessao.expires_at - 60 > Date.now() / 1000) return;
    if (!renovando) {
      renovando = chamar('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: sessao.refresh_token }, comLogin: false
      }).then(aceitarSessao).catch((e) => { guardar(null); throw e; })
        .finally(() => { renovando = null; });
    }
    await renovando;
  }

  async function rest(caminho, opcoes) {
    await garantirSessao();
    try {
      return await chamar('/rest/v1/' + caminho, opcoes);
    } catch (e) {
      if (e.status === 401 && sessao) {           // token vencido: renova uma vez e tenta de novo
        sessao.expires_at = 0;
        await garantirSessao();
        return chamar('/rest/v1/' + caminho, opcoes);
      }
      throw e;
    }
  }

  const auth = {
    logado: () => !!sessao,
    usuario: () => sessao && sessao.user,
    async entrar(email, senha) {
      const r = await chamar('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: senha }, comLogin: false });
      return aceitarSessao(r);
    },
    async cadastrar(email, senha, nome) {
      // redirect_to: o link do e-mail de confirmação volta para este site (precisa estar liberado no Supabase)
      const volta = encodeURIComponent(location.origin + location.pathname);
      const r = await chamar('/auth/v1/signup?redirect_to=' + volta, { method: 'POST', body: { email, password: senha, data: { nome } }, comLogin: false });
      return aceitarSessao(r); // null quando o Supabase exige confirmar o e-mail
    },
    async trocarSenha(senha) {
      await garantirSessao();
      return chamar('/auth/v1/user', { method: 'PUT', body: { password: senha } });
    },
    // Quem chega pelo link do e-mail volta com #access_token=... (deu certo) ou #error=... (link usado/vencido)
    async lerRetornoDoEmail() {
      const h = location.hash.replace(/^#/, '');
      if (!/(^|&)(access_token|error|error_code)=/.test(h)) return null;
      const q = new URLSearchParams(h);
      history.replaceState(null, '', location.pathname + location.search);   // limpa o endereço
      if (q.get('access_token')) {
        sessao = null;
        aceitarSessao({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token'),
          expires_in: Number(q.get('expires_in')) || 3600, expires_at: Number(q.get('expires_at')) || undefined });
        // quem é o usuário: vem dentro do próprio token (JWT: sub, email); se não der, pergunta ao Supabase
        try {
          const b64 = q.get('access_token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          const dados = JSON.parse(decodeURIComponent(escape(atob(b64))));
          sessao.user = { id: dados.sub, email: dados.email };
        } catch (e) {
          try { const u = await chamar('/auth/v1/user'); sessao.user = { id: u.id, email: u.email }; } catch (e2) { sessao.user = null; }
        }
        if (!sessao.user || !sessao.user.id) { guardar(null); return { ok: false, msg: 'Não foi possível confirmar o e-mail por esse link. Tente entrar.' }; }
        guardar(sessao);
        return { ok: true, tipo: q.get('type') };
      }
      const codigo = q.get('error_code') || q.get('error');
      const msg = codigo === 'otp_expired'
        ? 'Esse link de confirmação já foi usado ou venceu. Se você já tinha clicado nele antes, seu e-mail já está confirmado: é só entrar.'
        : 'Não foi possível confirmar o e-mail por esse link. Tente entrar; se não der, faça o cadastro de novo.';
      return { ok: false, msg };
    },
    async sair() {
      try { if (sessao) await chamar('/auth/v1/logout', { method: 'POST' }); } catch (e) { /* sai mesmo assim */ }
      guardar(null);
    }
  };

  // ---------- Banco (PostgREST) ----------
  const db = {
    // Lê todas as linhas (de 1000 em 1000)
    async listar(tabela, consulta) {
      let todas = [];
      for (let inicio = 0; ; inicio += PAGINA) {
        const parte = await rest(`${tabela}?${consulta}&limit=${PAGINA}&offset=${inicio}`);
        todas = todas.concat(parte);
        if (parte.length < PAGINA) return todas;
      }
    },
    async inserir(tabela, linha) {
      const r = await rest(tabela, { method: 'POST', body: linha, headers: { Prefer: 'return=representation' } });
      return Array.isArray(r) ? r[0] : r;
    },
    async alterar(tabela, filtro, mudancas) {
      const r = await rest(`${tabela}?${filtro}`, { method: 'PATCH', body: mudancas, headers: { Prefer: 'return=representation' } });
      if (Array.isArray(r) && !r.length) throw Object.assign(new Error('Você não tem permissão para alterar esse item.'), { status: 403 });
      return Array.isArray(r) ? r[0] : r;
    },
    async apagar(tabela, filtro) {
      const r = await rest(`${tabela}?${filtro}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
      if (Array.isArray(r) && !r.length) throw Object.assign(new Error('Você não tem permissão para excluir esse item.'), { status: 403 });
      return r;
    }
  };

  return { auth, db };
})();
