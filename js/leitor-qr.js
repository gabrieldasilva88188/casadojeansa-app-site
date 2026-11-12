/* Leitor de QR code pela câmera do celular (ou por uma foto).
   Usa o leitor nativo do navegador (BarcodeDetector, Chrome/Android) quando existe;
   nos outros (iPhone/Safari, Firefox) carrega o jsQR (js/vendor/jsQR.js) só na hora de usar. */
window.LeitorQR = (function () {
  'use strict';
  const VERSAO = '20261112b';

  // ---------- Decodificador ----------
  let detectorNativo; // undefined = ainda não testado; null = não tem
  async function nativo() {
    if (detectorNativo !== undefined) return detectorNativo;
    detectorNativo = null;
    try {
      if ('BarcodeDetector' in window) {
        const formatos = await window.BarcodeDetector.getSupportedFormats();
        if (formatos.includes('qr_code')) detectorNativo = new window.BarcodeDetector({ formats: ['qr_code'] });
      }
    } catch (e) { detectorNativo = null; }
    return detectorNativo;
  }
  let carregandoJsQR = null;
  function carregarJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (!carregandoJsQR) {
      carregandoJsQR = new Promise((ok, falha) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/jsQR.js?v=' + VERSAO;
        s.onload = () => ok(window.jsQR);
        s.onerror = () => { carregandoJsQR = null; falha(new Error('Não foi possível carregar o leitor. Confira a internet.')); };
        document.head.appendChild(s);
      });
    }
    return carregandoJsQR;
  }
  const tela = document.createElement('canvas');
  const ctx = tela.getContext('2d', { willReadFrequently: true });
  // Lê um quadro (vídeo, imagem ou canvas); devolve o texto do QR ou null
  async function decodificar(fonte, largura, altura, maxLado) {
    const det = await nativo();
    if (det) {
      try { const r = await det.detect(fonte); if (r.length) return r[0].rawValue; } catch (e) { /* tenta o jsQR */ }
      if (fonte instanceof HTMLVideoElement) return null;
    }
    const jsQR = await carregarJsQR();
    const esc = Math.min(1, maxLado / Math.max(largura, altura));
    tela.width = Math.round(largura * esc); tela.height = Math.round(altura * esc);
    ctx.drawImage(fonte, 0, 0, tela.width, tela.height);
    const img = ctx.getImageData(0, 0, tela.width, tela.height);
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    return r && r.data ? r.data : null;
  }

  // ---------- Janela do leitor ----------
  const ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  function abrir({ titulo = 'Escanear QR code', dica = 'Aponte a câmera para o QR code colado na roupa.', aoLer }) {
    fecharAberto();
    const m = document.createElement('div');
    m.className = 'modal-scrim leitor-qr';
    m.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="qr-tit">
        <h2 id="qr-tit">${titulo}</h2>
        <div class="qr-visor" aria-hidden="true">
          <video playsinline muted></video>
          <div class="qr-mira"><span></span></div>
          <div class="qr-sem-camera" hidden>${ICONE}<path d="M3 7h3l2-3h8l2 3h3v13H3z"/><circle cx="12" cy="13" r="4"/><path d="m3 3 18 18"/></svg></div>
        </div>
        <p class="qr-status" role="status">Abrindo a câmera…</p>
        <input type="file" accept="image/*" class="qr-arquivo" hidden>
        <div class="actions">
          <button class="btn btn-ghost" type="button" data-qr="foto">${ICONE}<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 19"/></svg>Usar uma foto</button>
          <button class="btn btn-ghost" type="button" data-qr="cancelar">Cancelar</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const video = m.querySelector('video'), status = m.querySelector('.qr-status');
    const arquivo = m.querySelector('.qr-arquivo');
    let stream = null, parado = false, ultimo = 0, pausaAte = 0, lendo = false;

    const avisar = (txt, erro) => { status.textContent = txt; status.classList.toggle('qr-erro', !!erro); };
    function parar() {
      parado = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    function fechar() { parar(); m.remove(); abertoAtual = null; }
    abertoAtual = fechar;

    // Recebe o texto lido; aoLer devolve uma mensagem de erro (string) para continuar lendo
    async function achou(texto) {
      if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* ignora */ } }
      const problema = aoLer(texto, fechar);
      if (typeof problema === 'string') { avisar(problema, true); pausaAte = Date.now() + 2500; return; }
    }

    async function quadro() {
      if (parado || !m.isConnected) { parar(); return; }  // a tela mudou: desliga a câmera
      requestAnimationFrame(quadro);
      const agora = Date.now();
      if (lendo || agora - ultimo < 180 || agora < pausaAte || video.readyState < 2) return;
      ultimo = agora; lendo = true;
      try {
        const txt = await decodificar(video, video.videoWidth, video.videoHeight, 720);
        if (txt && !parado) await achou(txt);
        else if (agora >= pausaAte && status.classList.contains('qr-erro')) avisar(dica);
      } catch (e) { avisar(e.message, true); }
      lendo = false;
    }

    async function ligarCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) {
        semCamera('Este navegador não deixa o site usar a câmera. Use uma foto do QR code.'); return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (parado || !m.isConnected) { parar(); return; }
        video.srcObject = stream;
        await video.play();
        avisar(dica);
        nativo(); if (!detectorNativo) carregarJsQR().catch((e) => avisar(e.message, true));
        requestAnimationFrame(quadro);
      } catch (e) {
        const nome = e && e.name;
        if (nome === 'NotAllowedError' || nome === 'SecurityError') semCamera('A câmera foi bloqueada. Toque no cadeado ao lado do endereço do site, permita a câmera e abra o leitor de novo. Ou use uma foto.');
        else if (nome === 'NotFoundError' || nome === 'OverconstrainedError') semCamera('Nenhuma câmera encontrada neste aparelho. Use uma foto do QR code.');
        else if (nome === 'NotReadableError') semCamera('A câmera está sendo usada por outro aplicativo. Feche-o e tente de novo, ou use uma foto.');
        else semCamera('Não foi possível abrir a câmera. Use uma foto do QR code.');
      }
    }
    function semCamera(txt) {
      m.querySelector('.qr-sem-camera').hidden = false;
      m.querySelector('.qr-mira').hidden = true;
      avisar(txt, true);
    }

    // Plano B: escolher ou tirar uma foto do QR code
    arquivo.addEventListener('change', async () => {
      const f = arquivo.files && arquivo.files[0];
      arquivo.value = '';
      if (!f) return;
      avisar('Lendo a foto…');
      try {
        const img = await createImageBitmap(f);
        let txt = null;
        for (const lado of [1024, 1800, 640]) { txt = await decodificar(img, img.width, img.height, lado); if (txt) break; }
        if (txt) { pausaAte = 0; await achou(txt); }
        else avisar('Não achei um QR code nessa foto. Tente uma foto mais de perto e sem reflexo.', true);
      } catch (e) { avisar('Não foi possível abrir essa foto.', true); }
    });
    m.querySelector('[data-qr="foto"]').addEventListener('click', () => arquivo.click());
    m.querySelector('[data-qr="cancelar"]').addEventListener('click', fechar);
    m.addEventListener('click', (e) => { if (e.target === m) fechar(); });
    m.querySelector('[data-qr="cancelar"]').focus();
    ligarCamera();
    return { fechar };
  }
  let abertoAtual = null;
  function fecharAberto() { if (abertoAtual) abertoAtual(); }

  // ---------- Links ----------
  // Arruma o texto lido: aceita "www..."/"vt.tiktok.com/..." sem https e troca http por https
  function lerLink(texto) {
    let t = String(texto || '').trim();
    if (!t || /\s/.test(t)) return null;
    if (/^http:\/\//i.test(t)) t = 'https://' + t.slice(7);
    if (!/^https:\/\//i.test(t)) {
      if (/^(www\.|[a-z0-9-]+\.)+[a-z]{2,}(\/|$)/i.test(t)) t = 'https://' + t; else return null;
    }
    try {
      const u = new URL(t);
      return { link: u.href, tiktok: /(^|\.)tiktok\.com$/i.test(u.hostname) };
    } catch (e) { return null; }
  }
  // Chave para comparar links: sem https, sem www, sem parâmetros de rastreio e sem barra no fim
  function chaveLink(link) {
    try {
      const u = new URL(link);
      return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '')).toLowerCase();
    } catch (e) { return String(link || '').trim().toLowerCase(); }
  }

  return { abrir, fechar: fecharAberto, lerLink, chaveLink };
})();
