"""Imitação local mínima do Supabase (Auth + PostgREST) para testar o site sem internet.

Sobe um PostgreSQL temporário com o mesmo esquema, regras (RLS), gatilhos e carga
inicial do projeto, e responde nas mesmas rotas que o site usa:
  POST /auth/v1/token?grant_type=password|refresh_token, POST /auth/v1/signup,
  PUT /auth/v1/user, POST /auth/v1/logout
  GET/POST/PATCH/DELETE /rest/v1/<tabela>?select=...&coluna=eq.valor&order=...&limit=&offset=

Uso: python3 tools/supabase_local.py [porta]   (padrão 54321; precisa rodar como usuário comum)
Contas criadas: ricardo@gerenciador.app e marcio@gerenciador.app, senha "estoque123" (provisória).
Só para testes. Não use em produção.
"""
import glob
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, urlparse

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORTA_API = int(sys.argv[1]) if len(sys.argv) > 1 else 54321
PORTA_PG = 54331
PASTA = tempfile.mkdtemp(prefix="supabase_local_")
BIN = os.path.dirname(subprocess.run(["bash", "-lc", "command -v pg_ctl || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1"],
                                     capture_output=True, text=True).stdout.strip())
TABELAS = {"perfis", "contas_tiktok", "fabricantes", "produtos", "videos", "vendas", "registros"}
TOKENS, REFRESH = {}, {}


def psql(sql, arquivo=None):
    cmd = [f"{BIN}/psql", "-h", PASTA, "-p", str(PORTA_PG), "-U", "postgres", "-d", "postgres",
           "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]
    cmd += ["-f", arquivo] if arquivo else ["-c", sql]
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=RAIZ)
    if r.returncode:
        m = re.search(r"ERROR:\s+([0-9A-Z]{5}):\s+(.*)", r.stderr)
        raise ErroBanco(m.group(1) if m else "XX000", m.group(2).strip() if m else r.stderr.strip())
    return r.stdout.strip()


class ErroBanco(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def lit(v):
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def ident(n):
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", n):
        raise ErroBanco("PGRST100", f"nome inválido: {n}")
    return '"' + n + '"'


def como_usuario(uid, sql):
    papel = "authenticated" if uid else "anon"
    return (f"begin; select set_config('request.jwt.claim.sub', {lit(uid or '')}, true) \\g /dev/null\n"
            f"set local role {papel};\n{sql};\ncommit;")


def rodar(uid, sql):
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, dir=PASTA) as f:
        f.write(como_usuario(uid, sql))
    os.chmod(f.name, 0o644)
    try:
        saida = psql(None, f.name)
    finally:
        os.unlink(f.name)
    return json.loads(saida.splitlines()[-1]) if saida else []


def subir_banco():
    subprocess.run([f"{BIN}/initdb", "-D", f"{PASTA}/dados", "-U", "postgres", "--auth=trust"], check=True, capture_output=True)
    subprocess.run([f"{BIN}/pg_ctl", "-D", f"{PASTA}/dados", "-o", f"-p {PORTA_PG} -k {PASTA} -c listen_addresses=''",
                    "-l", f"{PASTA}/log", "start", "-w"], check=True, capture_output=True)
    psql(None, "supabase/testes/stubs_supabase.sql")
    for m in sorted(glob.glob(os.path.join(RAIZ, "supabase/migrations/*.sql"))):
        psql(None, m)
    psql(None, "supabase/seed.sql")
    psql("create schema teste; create table teste.senhas (id uuid primary key, senha text not null);")
    for email, nome in [("ricardo@gerenciador.app", "Ricardo Ronery"), ("marcio@gerenciador.app", "Márcio House")]:
        uid = str(uuid.uuid4())
        psql(f"insert into auth.users (id, email, raw_user_meta_data) values ({lit(uid)}, {lit(email)}, "
             f"{lit(json.dumps({'nome': nome}))}); insert into teste.senhas values ({lit(uid)}, 'estoque123');")
    psql("update public.perfis set papel = 'admin', fixo = true, aprovado = true, senha_provisoria = true;")


def sessao(uid, email):
    tok, ref = "tok-" + secrets.token_hex(12), "ref-" + secrets.token_hex(12)
    TOKENS[tok] = uid
    REFRESH[ref] = (uid, email)
    return {"access_token": tok, "refresh_token": ref, "token_type": "bearer", "expires_in": 3600,
            "expires_at": int(time.time()) + 3600, "user": {"id": uid, "email": email}}


def montar_where(params, tabela):
    conds = []
    for k, v in params:
        if k in ("select", "order", "limit", "offset"):
            continue
        op, _, val = v.partition(".")
        col = ident(k)
        if op == "eq":
            conds.append(f"{col}::text = {lit(val)}")
        elif op == "in":
            itens = [x.strip().strip('"') for x in val.strip("()").split(",") if x.strip()]
            conds.append(f"{col}::text in ({', '.join(lit(x) for x in itens)})" if itens else "false")
        elif op == "is":
            conds.append(f"{col} is {'null' if val == 'null' else val}")
        else:
            raise ErroBanco("PGRST100", f"operador não suportado: {op}")
    return (" where " + " and ".join(conds)) if conds else ""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def responder(self, status, corpo=None):
        dados = b"" if corpo is None else json.dumps(corpo, default=str, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(dados)

    def do_OPTIONS(self):
        self.responder(204)

    def corpo(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"null")

    def uid(self):
        a = self.headers.get("Authorization", "")
        return TOKENS.get(a[7:]) if a.startswith("Bearer ") else None

    def tratar(self, metodo):
        url = urlparse(self.path)
        q = dict(parse_qsl(url.query))
        try:
            if url.path.startswith("/auth/v1/"):
                return self.auth(metodo, url.path[9:], q)
            if url.path.startswith("/rest/v1/"):
                return self.rest(metodo, url.path[9:], parse_qsl(url.query))
            self.responder(404, {"message": "não encontrado"})
        except ErroBanco as e:
            status = {"42501": 403, "23505": 409, "PGRST301": 401}.get(e.code, 400)
            self.responder(status, {"code": e.code, "message": e.message, "details": None, "hint": None})

    def auth(self, metodo, rota, q):
        b = self.corpo() if metodo in ("POST", "PUT") else None
        if rota == "token" and q.get("grant_type") == "password":
            r = json.loads(psql(f"select coalesce(jsonb_agg(x), '[]'::jsonb) from (select u.id, u.email from auth.users u "
                                f"join teste.senhas s on s.id = u.id where u.email = {lit(b['email'].lower())} "
                                f"and s.senha = {lit(b['password'])}) x"))
            if not r:
                return self.responder(400, {"code": 400, "error_code": "invalid_credentials", "msg": "Invalid login credentials"})
            return self.responder(200, sessao(r[0]["id"], r[0]["email"]))
        if rota == "token" and q.get("grant_type") == "refresh_token":
            if b.get("refresh_token") not in REFRESH:
                return self.responder(400, {"error_code": "refresh_token_not_found", "msg": "Invalid Refresh Token"})
            return self.responder(200, sessao(*REFRESH.pop(b["refresh_token"])))
        if rota == "signup":
            email = b["email"].lower()
            if json.loads(psql(f"select count(*) from auth.users where email = {lit(email)}")):
                return self.responder(422, {"code": 422, "error_code": "user_already_exists", "msg": "User already registered"})
            if len(b.get("password", "")) < 6:
                return self.responder(422, {"code": 422, "error_code": "weak_password", "msg": "Password should be at least 6 characters"})
            uid = str(uuid.uuid4())
            psql(f"insert into auth.users (id, email, raw_user_meta_data) values ({lit(uid)}, {lit(email)}, "
                 f"{lit(json.dumps(b.get('data') or {}))}); insert into teste.senhas values ({lit(uid)}, {lit(b['password'])});")
            return self.responder(200, sessao(uid, email))
        if rota == "user" and metodo == "PUT":
            uid = self.uid()
            if not uid:
                return self.responder(401, {"msg": "not logged in"})
            atual = psql(f"select senha from teste.senhas where id = {lit(uid)}")
            if atual == b["password"]:
                return self.responder(422, {"error_code": "same_password", "msg": "same password"})
            psql(f"update teste.senhas set senha = {lit(b['password'])} where id = {lit(uid)}")
            return self.responder(200, {"id": uid})
        if rota == "logout":
            return self.responder(204)
        self.responder(404, {"msg": "rota de auth não suportada"})

    def rest(self, metodo, tabela, params):
        if tabela not in TABELAS:
            raise ErroBanco("42P01", f"relation {tabela} does not exist")
        a = self.headers.get("Authorization", "")
        if a.startswith("Bearer ") and a[7:] not in TOKENS:
            raise ErroBanco("PGRST301", "JWT expired")
        uid, p = self.uid(), dict(params)
        t = "public." + ident(tabela)
        where = montar_where(params, tabela)
        if metodo == "GET":
            cols = ", ".join(ident(c) for c in p.get("select", "*").split(",")) if p.get("select", "*") != "*" else "*"
            order = ""
            if p.get("order"):
                partes = []
                for o in p["order"].split(","):
                    c, _, d = o.partition(".")
                    partes.append(ident(c) + (" desc" if d == "desc" else ""))
                order = " order by " + ", ".join(partes)
            lim = f" limit {int(p['limit'])}" if "limit" in p else ""
            off = f" offset {int(p['offset'])}" if "offset" in p else ""
            sql = f"select coalesce(jsonb_agg(x), '[]'::jsonb) from (select {cols} from {t}{where}{order}{lim}{off}) x"
            return self.responder(200, rodar(uid, sql))
        if metodo == "POST":
            b = self.corpo()
            cols = ", ".join(ident(c) for c in b)
            sql = (f"with r as (insert into {t} ({cols}) select {cols} from json_populate_record(null::{t}, "
                   f"{lit(json.dumps(b))}) returning *) select coalesce(jsonb_agg(r), '[]'::jsonb) from r")
            return self.responder(201, rodar(uid, sql))
        if metodo == "PATCH":
            b = self.corpo()
            cols = ", ".join(ident(c) for c in b)
            sql = (f"with r as (update {t} set ({cols}) = (select {cols} from json_populate_record(null::{t}, "
                   f"{lit(json.dumps(b))})){where} returning *) select coalesce(jsonb_agg(r), '[]'::jsonb) from r")
            return self.responder(200, rodar(uid, sql))
        if metodo == "DELETE":
            sql = f"with r as (delete from {t}{where} returning *) select coalesce(jsonb_agg(r), '[]'::jsonb) from r"
            return self.responder(200, rodar(uid, sql))

    def do_GET(self):
        self.tratar("GET")

    def do_POST(self):
        self.tratar("POST")

    def do_PATCH(self):
        self.tratar("PATCH")

    def do_PUT(self):
        self.tratar("PUT")

    def do_DELETE(self):
        self.tratar("DELETE")


if __name__ == "__main__":
    subir_banco()
    print(f"Supabase local em http://127.0.0.1:{PORTA_API} (banco em {PASTA})", flush=True)
    try:
        ThreadingHTTPServer(("127.0.0.1", PORTA_API), Handler).serve_forever()
    finally:
        subprocess.run([f"{BIN}/pg_ctl", "-D", f"{PASTA}/dados", "stop", "-m", "fast"], capture_output=True)
