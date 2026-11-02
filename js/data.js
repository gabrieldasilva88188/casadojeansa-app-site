// Dados do protótipo.
// - Produtos: vêm da planilha de estoque da loja (js/estoque.js).
// - Funcionários, vídeos e vendas: EXEMPLOS gerados aqui só para a demonstração.
// Na versão final, tudo vem do banco (Supabase) e as vendas do TikTok chegam pela API.

window.SEED = (function () {
  // Contas do TikTok, na mesma ordem da planilha
  const contas = ['OFICIAL', 'RICARDO', 'SHAMA', 'SR LORD', 'IMAGINARIUM'];

  const usuarios = [
    { id: 'u1', nome: 'Gabriel Silva', email: 'gabriel@casadojeans.com', papel: 'admin' },
    { id: 'u2', nome: 'Camila Rocha', email: 'camila@casadojeans.com', papel: 'funcionario' },
    { id: 'u3', nome: 'Rafael Lima', email: 'rafael@casadojeans.com', papel: 'funcionario' },
    { id: 'u4', nome: 'Juliana Alves', email: 'juliana@casadojeans.com', papel: 'funcionario' },
    { id: 'u5', nome: 'Bruno Costa', email: 'bruno@casadojeans.com', papel: 'funcionario' }
  ];

  // Data da planilha (out/2026): todos os produtos importados entram cadastrados nesse dia
  const CADASTRO = '2026-10-10T09:00:00';

  const produtos = (window.ESTOQUE || []).map((p, i) => ({
    id: 'p' + (i + 1),
    codigo: '',
    local: p.local,
    prateleira: p.prateleira,
    descricao: p.descricao,
    quantidade: p.quantidade,
    fabricante: p.fabricante,
    link: '',
    criadoEm: CADASTRO,
    vendasLoja: 0,
    vendas: {} // vendas por conta do TikTok
  }));

  // Gerador pseudoaleatório com semente fixa: os exemplos são sempre os mesmos
  let s = 20261102;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const escolher = (pesos) => {
    const total = pesos.reduce((a, b) => a + b, 0);
    let r = rnd() * total;
    for (let i = 0; i < pesos.length; i++) { r -= pesos[i]; if (r <= 0) return i; }
    return pesos.length - 1;
  };

  const hoje = new Date('2026-11-02T12:30:00');
  const momento = (diasAtras, hora) => {
    const x = new Date(hoje);
    x.setDate(x.getDate() - diasAtras);
    x.setHours(hora == null ? 9 + Math.floor(rnd() * 10) : hora, Math.floor(rnd() * 60), 0, 0);
    // nunca no futuro: horários de "hoje" ficam antes do momento de referência
    if (x > hoje) x.setTime(hoje.getTime() - Math.floor(1 + rnd() * 200) * 60000);
    return x.toISOString();
  };

  // Só uma parte dos produtos já aparece em vídeos; os mais "quentes" aparecem mais
  const comVideo = produtos.filter((p, i) => i % 3 === 0 || p.quantidade >= 4);
  const pesoProduto = comVideo.map((p, i) => (i % 7 === 0 ? 8 : 1 + Math.floor(rnd() * 4)));
  const pesoUsuario = [2, 9, 5, 7, 3];
  const pesoConta = [10, 4, 6, 3, 5];

  const videos = [];
  for (let i = 0; i < 150; i++) {
    const p = comVideo[escolher(pesoProduto)];
    // vídeos entre o cadastro (10/10) e hoje
    const dias = Math.floor(rnd() * rnd() * 23);
    videos.push({
      id: 'v' + (i + 1),
      produtoId: p.id,
      usuarioId: usuarios[escolher(pesoUsuario)].id,
      conta: contas[escolher(pesoConta)],
      link: 'https://www.tiktok.com/@casadojeans/video/74' + (31000000000 + Math.floor(rnd() * 999999999)),
      data: momento(dias),
      visualizacoes: Math.floor(600 + rnd() * rnd() * 42000)
    });
  }
  videos.sort((a, b) => b.data.localeCompare(a.data));

  // Vendas de exemplo: produtos com vídeo vendem mais, e na conta onde foram postados
  videos.forEach((v) => {
    const p = produtos.find((x) => x.id === v.produtoId);
    const n = Math.floor(rnd() * 3);
    if (n) p.vendas[v.conta] = (p.vendas[v.conta] || 0) + n;
  });
  produtos.forEach((p) => { if (rnd() < 0.35) p.vendasLoja = 1 + Math.floor(rnd() * 3); });

  const pp = (prat) => produtos.find((p) => p.prateleira === prat) || produtos[0];
  const rot = (prat) => `${prat} ${pp(prat).descricao}`;
  const registros = [
    { usuarioId: 'u2', acao: 'Editou produto', detalhe: `${rot('C1')}: quantidade 12 → 10`, data: momento(0, 11) },
    { usuarioId: 'u3', acao: 'Editou produto', detalhe: `${rot('A8')}: fabricante MVA → MVA JEANS`, data: momento(1, 15) },
    { usuarioId: 'u1', acao: 'Alterou cargo', detalhe: 'Bruno Costa: admin master → funcionário', data: momento(2, 10) },
    { usuarioId: 'u4', acao: 'Editou produto', detalhe: `${rot('E2')}: prateleira E1 → E2`, data: momento(4, 16) },
    { usuarioId: 'u5', acao: 'Adicionou produto', detalhe: rot('W3'), data: momento(6, 9) },
    { usuarioId: 'u1', acao: 'Importou planilha', detalhe: `${produtos.length} produtos da planilha ESTOQUE`, data: CADASTRO }
  ].map((r) => ({ ...r, data: new Date(r.data).toISOString() }));

  return { contas, usuarios, produtos, videos, registros };
})();
