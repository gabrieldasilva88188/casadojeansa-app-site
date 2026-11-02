"""Importa a planilha de controle de estoque da loja para js/estoque.js.

Uso: python3 tools/importar_planilha.py caminho/da/planilha.xlsx

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


if __name__ == "__main__":
    main()
