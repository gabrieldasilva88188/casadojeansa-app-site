"""Importa a planilha de controle de estoque da loja.

Uso: python3 tools/importar_planilha.py caminho/da/planilha.xlsx

Gera dois arquivos:
- js/estoque.js      produtos para o protótipo
- supabase/seed.sql  carga inicial do banco (contas do TikTok, fabricantes e produtos)

Colunas lidas da aba ESTOQUE (a partir da linha 3):
LOCAL | N° PRAT | DESCRIÇÃO PRODUTO | QTD PEÇAS | FABRICANTE
As colunas das contas (OFICIAL, RICARDO, SHAMA, SR LORD, IMAGINARIUM) por semana
viram os registros de vídeo e venda do sistema; a planilha atual está com elas vazias.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl


def limpar(v):
    if v is None:
        return ""
    s = re.sub(r"\s+", " ", str(v)).strip().strip("]").strip()
    return "" if s in {".", "=", "-"} else s


CONTAS_TIKTOK = ["OFICIAL", "RICARDO", "SHAMA", "SR LORD", "IMAGINARIUM"]


def sql_txt(v):
    return "'" + v.replace("'", "''") + "'"


def gerar_seed(produtos, destino):
    fabricantes = sorted({p["fabricante"] for p in produtos if p["fabricante"]})
    linhas = [
        "-- Gerado por tools/importar_planilha.py a partir da planilha ESTOQUE da loja.",
        "-- Carga inicial: contas do TikTok, fabricantes e produtos.",
        "-- O ID de cada produto segue a ordem da planilha (#0001 = primeira linha).",
        "begin;",
        "-- Não registra cada produto no histórico; no fim entra um único registro da importação",
        "alter table public.produtos disable trigger registrar_produto;",
        "",
        "insert into public.contas_tiktok (nome, ordem) values",
        ",\n".join(f"  ({sql_txt(c)}, {i + 1})" for i, c in enumerate(CONTAS_TIKTOK)),
        "on conflict (nome) do nothing;",
        "",
        "insert into public.fabricantes (nome) values",
        ",\n".join(f"  ({sql_txt(f)})" for f in fabricantes),
        "on conflict (nome) do nothing;",
        "",
        "insert into public.produtos (id, local, prateleira, descricao, quantidade, fabricante_id) values",
    ]
    valores = []
    for i, p in enumerate(produtos, start=1):
        fab = f"(select id from public.fabricantes where nome = {sql_txt(p['fabricante'])})" if p["fabricante"] else "null"
        valores.append(f"  ({i}, {p['local']}, {sql_txt(p['prateleira'])}, {sql_txt(p['descricao'])}, {p['quantidade']}, {fab})")
    linhas += [",\n".join(valores), "on conflict (prateleira) do nothing;", "",
               "-- Próximo produto cadastrado no sistema continua a numeração",
               "select setval(pg_get_serial_sequence('public.produtos', 'id'), (select max(id) from public.produtos));",
               "", "alter table public.produtos enable trigger registrar_produto;",
               "insert into public.registros (acao, tabela, registro_id, detalhe) values",
               "  ('Importou planilha', 'produtos', 'planilha', (select count(*) from public.produtos) || ' produtos da planilha ESTOQUE');",
               "", "commit;", ""]
    destino.parent.mkdir(exist_ok=True)
    destino.write_text("\n".join(linhas), encoding="utf-8")
    print(f"{len(fabricantes)} fabricantes e {len(produtos)} produtos -> {destino}")


def main():
    if len(sys.argv) < 2:
        sys.exit("Informe o arquivo .xlsx")
    wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
    ws = wb["ESTOQUE"]

    produtos, vistos = [], set()
    for linha in ws.iter_rows(min_row=3, values_only=True):
        local, prat, desc, qtd, fab = (linha + (None,) * 5)[:5]
        prat = limpar(prat).upper()
        if not prat and not limpar(desc):
            continue
        if prat in vistos:
            print(f"Aviso: prateleira {prat} repetida, mantendo a primeira")
            continue
        vistos.add(prat)
        try:
            local = int(str(local).strip())
        except ValueError:
            local = 1  # célula de local em branco: assume local 1
        try:
            qtd = int(qtd)
        except (TypeError, ValueError):
            qtd = 0
        produtos.append({
            "local": local,
            "prateleira": prat,
            "descricao": limpar(desc),
            "quantidade": qtd,
            "fabricante": limpar(fab).upper(),
        })

    saida = Path(__file__).resolve().parent.parent / "js" / "estoque.js"
    corpo = ",\n".join("  " + json.dumps(p, ensure_ascii=False) for p in produtos)
    saida.write_text(
        "// Gerado por tools/importar_planilha.py a partir da planilha ESTOQUE da loja.\n"
        f"window.ESTOQUE = [\n{corpo}\n];\n",
        encoding="utf-8",
    )
    print(f"{len(produtos)} produtos, {sum(p['quantidade'] for p in produtos)} peças -> {saida}")
    gerar_seed(produtos, saida.parent.parent / "supabase" / "seed.sql")


if __name__ == "__main__":
    main()
