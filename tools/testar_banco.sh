#!/usr/bin/env bash
# Sobe um PostgreSQL temporário, aplica o esquema e a carga inicial e roda os testes das regras.
# Uso (na raiz do projeto): bash tools/testar_banco.sh
# Precisa do PostgreSQL instalado (initdb, pg_ctl, psql). Não mexe em nenhum banco existente.
set -euo pipefail

BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}"
DIR="$(mktemp -d)"
PORTA="${PG_PORTA:-54329}"
trap '"$BIN/pg_ctl" -D "$DIR/dados" stop -m fast >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT

"$BIN/initdb" -D "$DIR/dados" -U postgres --auth=trust >/dev/null
"$BIN/pg_ctl" -D "$DIR/dados" -o "-p $PORTA -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null

PSQL=(psql -h "$DIR" -p "$PORTA" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f supabase/testes/stubs_supabase.sql
"${PSQL[@]}" -f supabase/migrations/20261104000000_esquema_inicial.sql
"${PSQL[@]}" -f supabase/seed.sql >/dev/null
"${PSQL[@]}" -f supabase/testes/testar_regras.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: //; s/^NOTICE:  //'
