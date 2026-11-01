"""Gera dist/prototipo.html: um único arquivo com CSS e JS embutidos,
usado para publicar o protótipo como página de demonstração."""
from pathlib import Path

raiz = Path(__file__).resolve().parent.parent
css = (raiz / "styles.css").read_text(encoding="utf-8")
data_js = (raiz / "js" / "data.js").read_text(encoding="utf-8")
app_js = (raiz / "js" / "app.js").read_text(encoding="utf-8")

html = f"""<title>Casa do Jeans</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap">
<style>
{css}
</style>
<div id="app"></div>
<script>
{data_js}
</script>
<script>
{app_js}
</script>
"""

saida = raiz / "dist" / "prototipo.html"
saida.parent.mkdir(exist_ok=True)
saida.write_text(html, encoding="utf-8")
print(f"Gerado {saida} ({len(html) // 1024} KB)")
