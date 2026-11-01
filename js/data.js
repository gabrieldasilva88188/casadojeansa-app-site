// Dados de exemplo do protótipo. Na versão final, tudo isso vem do banco (Supabase)
// e as vendas/vídeos do TikTok chegam pela sincronização com a TikTok Shop API.

window.SEED = (function () {
  const usuarios = [
    { id: 'u1', nome: 'Gabriel Silva', email: 'gabriel@casadojeans.com', papel: 'admin' },
    { id: 'u2', nome: 'Camila Rocha', email: 'camila@casadojeans.com', papel: 'funcionario' },
    { id: 'u3', nome: 'Rafael Lima', email: 'rafael@casadojeans.com', papel: 'funcionario' },
    { id: 'u4', nome: 'Juliana Alves', email: 'juliana@casadojeans.com', papel: 'funcionario' },
    { id: 'u5', nome: 'Bruno Costa', email: 'bruno@casadojeans.com', papel: 'funcionario' }
  ];

  // [codigo, descricao, quantidade, prateleira, vendasLoja30, vendasTikTok30]
  const base = [
    ['CDJ-1042', 'Calça jeans skinny cintura alta, lavagem escura', 34, 'A1', 21, 58],
    ['CDJ-1043', 'Calça jeans mom, lavagem clara', 27, 'A1', 18, 44],
    ['CDJ-1051', 'Calça wide leg jeans, azul médio', 12, 'A2', 9, 61],
    ['CDJ-1060', 'Bermuda jeans masculina, lavagem média', 40, 'A3', 26, 12],
    ['CDJ-1077', 'Jaqueta jeans oversized, destroyed', 8, 'B1', 7, 33],
    ['CDJ-1078', 'Jaqueta jeans masculina tradicional', 15, 'B1', 11, 6],
    ['CDJ-1090', 'Saia jeans midi com fenda', 22, 'B2', 14, 27],
    ['CDJ-1101', 'Short jeans cintura alta, barra desfiada', 3, 'B3', 19, 38],
    ['CDJ-1115', 'Camisa jeans manga longa, slim', 19, 'C1', 8, 4],
    ['CDJ-1120', 'Macacão jeans pantacourt', 6, 'C2', 5, 22],
    ['CDJ-1133', 'Calça jeans reta masculina, lavagem escura', 45, 'A4', 31, 9],
    ['CDJ-1140', 'Colete jeans feminino cropped', 11, 'C3', 4, 15],
    ['CDJ-1152', 'Vestido jeans chemise', 9, 'C2', 6, 19],
    ['CDJ-1166', 'Calça jeans flare, lavagem média', 17, 'A2', 12, 47]
  ];

  const produtos = base.map((p, i) => ({
    id: 'p' + (i + 1),
    codigo: p[0],
    descricao: p[1],
    quantidade: p[2],
    prateleira: p[3],
    link: 'https://www.tiktok.com/view/product/17' + (29540012 + i * 7311) + '0001',
    vendasLoja: p[4],
    vendasTikTok: p[5]
  }));

  // Gerador pseudoaleatório com semente fixa, para os dados serem sempre os mesmos
  let s = 20261031;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);

  const hoje = new Date('2026-10-31T18:00:00');
  const diasAtras = (d, h) => {
    const x = new Date(hoje);
    x.setDate(x.getDate() - d);
    x.setHours(h || 10 + Math.floor(rnd() * 9), Math.floor(rnd() * 60));
    return x.toISOString();
  };

  // Peso de cada funcionário (quem grava mais) e de cada produto (quais aparecem mais)
  const pesoUsuario = { u1: 2, u2: 9, u3: 5, u4: 7, u5: 3 };
  const pesoProduto = [9, 6, 8, 1, 6, 1, 4, 5, 0, 3, 1, 2, 2, 7];
  const escolher = (pesos) => {
    const total = pesos.reduce((a, b) => a + b, 0);
    let r = rnd() * total;
    for (let i = 0; i < pesos.length; i++) { r -= pesos[i]; if (r <= 0) return i; }
    return pesos.length - 1;
  };

  const videos = [];
  const uids = Object.keys(pesoUsuario);
  for (let i = 0; i < 74; i++) {
    const u = uids[escolher(uids.map((k) => pesoUsuario[k]))];
    const p = produtos[escolher(pesoProduto)];
    videos.push({
      id: 'v' + (i + 1),
      produtoId: p.id,
      usuarioId: u,
      link: 'https://www.tiktok.com/@casadojeans/video/74' + (31000000000 + Math.floor(rnd() * 999999999)),
      data: diasAtras(Math.floor(rnd() * 30)),
      visualizacoes: Math.floor(800 + rnd() * rnd() * 48000)
    });
  }
  videos.sort((a, b) => b.data.localeCompare(a.data));

  const registros = [
    { usuarioId: 'u2', acao: 'Editou produto', detalhe: 'CDJ-1101: quantidade 8 → 3', data: diasAtras(0, 16) },
    { usuarioId: 'u3', acao: 'Adicionou produto', detalhe: 'CDJ-1166 Calça jeans flare', data: diasAtras(1, 11) },
    { usuarioId: 'u2', acao: 'Editou produto', detalhe: 'CDJ-1077: descrição alterada, link mantido', data: diasAtras(2, 15) },
    { usuarioId: 'u5', acao: 'Editou produto', detalhe: 'CDJ-1060: prateleira A2 → A3', data: diasAtras(3, 10) },
    { usuarioId: 'u1', acao: 'Adicionou produto', detalhe: 'CDJ-1152 Vestido jeans chemise', data: diasAtras(5, 9) },
    { usuarioId: 'u4', acao: 'Editou produto', detalhe: 'CDJ-1043: descrição alterada, link atualizado', data: diasAtras(6, 17) },
    { usuarioId: 'u3', acao: 'Editou produto', detalhe: 'CDJ-1133: quantidade 52 → 45', data: diasAtras(8, 13) },
    { usuarioId: 'u2', acao: 'Adicionou produto', detalhe: 'CDJ-1140 Colete jeans feminino cropped', data: diasAtras(11, 12) }
  ];

  return { usuarios, produtos, videos, registros, hoje: hoje.toISOString() };
})();
