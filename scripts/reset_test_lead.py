#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
crm-hermes — Reset de Lead de Teste (CLI admin).

Apaga lead(s) e mensagens por telefone. Útil pra resetar o número
testador do Isaías sem acumular histórico.

USO:
    scripts/reset_test_lead.py PHONE [--tenant SLUG] [--yes] [--dry-run]

    # dry-run (PADRÃO — não apaga nada, só mostra):
    scripts/reset_test_lead.py 5584996327329

    # apagar de verdade (pede confirmação a menos que --yes):
    scripts/reset_test_lead.py 5584996327329 --yes

    # limitar a 1 tenant (ex: dr-matheus-dore):
    scripts/reset_test_lead.py 5584996327329 --tenant dr-matheus-dore --yes

SEGURANÇA:
    - default = dry-run
    - confirma via prompt se chamar com --yes sozinho é explícito
    - audit log append-only em logs/reset_test_lead.log
    - NUNCA mexe em `tenants`. Só toca `leads` + `messages`.

NÃO-INTEGRADO:
    - Calendar events NÃO são deletados aqui (id do evento fica órfão no
      Google mas o htmlLink ainda tá em `messages.content` que será apagado).
    - Histórico do WhatsApp na Evolution API NÃO é tocado.

Autor: Claudinho (Claude Code). 2026-09-16
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent  # scripts/ é 1 nível abaixo da raiz
ENV_FILE = REPO_ROOT / ".env"
LOG_FILE = REPO_ROOT / "logs" / "reset_test_lead.log"


# --- helpers de .env sem depender do webhook_server.py ---------------------
def _load_env_file(path: Path) -> dict[str, str]:
    """Lê .env com parsing tolerante (com/sem aspas, com/sem comentários)."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'").strip()
    return out


def _normalize_phone(digits: str) -> str:
    """Mantém só dígitos (mesma regra do webhook_server.py)."""
    return re.sub(r"\D", "", digits or "")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _audit(msg: str) -> None:
    line = f"[{_now_iso()}] {msg}"
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    # também imprime em stderr pra ficar visível no terminal
    print(line, file=sys.stderr)


# --- cliente PostgREST enxuto ---------------------------------------------
class Postgrest:
    """Wrapper mínimo do Supabase REST API (anon key).

    Não usa supabase-py pra manter zero deps novas — só urllib.
    """

    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def _req(self, method: str, table: str, params: dict | None = None,
             body: dict | None = None) -> tuple[int, bytes, dict]:
        url = self.base + "/" + table
        if params:
            # usa urlencode puro (não &amp;) e codifica cada value
            q = "&".join(f"{k}={urllib.parse.quote(str(v), safe='')}"
                         for k, v in params.items())
            url = url + "?" + q
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method,
                                     headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers or {})

    def select(self, table: str, **filters) -> list[dict]:
        params = {"select": filters.pop("select", "*")}
        # filtros especiais: phone=eq.X, lead_id=eq.X, etc.
        params.update({k: v for k, v in filters.items()})
        status, body, _ = self._req("GET", table, params=params)
        if status >= 400:
            raise RuntimeError(f"SELECT {table} falhou HTTP {status}: {body[:300].decode(errors='replace')}")
        if not body:
            return []
        try:
            return json.loads(body)
        except Exception:
            return []

    def delete(self, table: str, **filters) -> int:
        """Deleta com filtros e retorna content-range count."""
        status, body, headers = self._req("DELETE", table, params=filters)
        if status >= 400:
            raise RuntimeError(f"DELETE {table} falhou HTTP {status}: {body[:300].decode(errors='replace')}")
        # PostgREST retorna Content-Range: 0-0/N quando usa Prefer: count=exact
        cr = headers.get("Content-Range", headers.get("content-range", ""))
        m = re.search(r"/(\d+)", cr)
        return int(m.group(1)) if m else -1


# --- core --------------------------------------------------------------------
def fetch_leads_for_phone(pg: Postgrest, phone: str,
                          tenant_filter: str | None = None) -> list[dict]:
    """Retorna leads por phone (normalizado, cross-tenant ou filtrado)."""
    leads = pg.select(
        "leads",
        # NB: algumas colunas (ai_handoff_open etc) podem variar — select=*
        # é mais robusto; PostgREST retorna só o que existe.
        select="*",
        phone=f"eq.{phone}",
        order="created_at.desc",
        limit="100",
    )
    if tenant_filter:
        # aceita nome exato (ex: "Consultório Odontológico OdontoVida") OU UUID
        t = pg.select("tenants", select="id,name", name=f"eq.{tenant_filter}", limit="1")
        if not t and re.fullmatch(r"[0-9a-f-]{36}", tenant_filter, re.I):
            t = pg.select("tenants", select="id,name", id=f"eq.{tenant_filter}", limit="1")
        if not t:
            print(f"[ERRO] tenant '{tenant_filter}' não existe (nem por nome nem por id)", file=sys.stderr)
            sys.exit(2)
        leads = [l for l in leads if l["tenant_id"] == t[0]["id"]]
    return leads


def fetch_tenants_map(pg: Postgrest, tenant_ids: list[str]) -> dict[str, str]:
    """Carrega mapa tenant_id → nome curto pra printar bonito."""
    if not tenant_ids:
        return {}
    out: dict[str, str] = {}
    for tid in tenant_ids:
        rows = pg.select("tenants", select="id,name", id=f"eq.{tid}", limit="1")
        if rows:
            n = rows[0].get("name") or tid[:8]
            out[tid] = n[:24]
    return out


def count_messages(pg: Postgrest, lead_ids: list[str]) -> dict[str, int]:
    """Mensagens por lead_id (usa Content-Range pra contar sem baixar tudo)."""
    out: dict[str, int] = {}
    for lid in lead_ids:
        # truque: select só id&limit=1 + Prefer: count=exact
        url = pg.base + "/messages?select=id&lead_id=eq." + urllib.parse.quote(lid, safe="") + "&limit=0"
        req = urllib.request.Request(url, headers={
            **pg.headers, "Prefer": "count=exact"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                cr = r.headers.get("Content-Range", "")
                m = re.search(r"/(\d+)", cr)
                out[lid] = int(m.group(1)) if m else 0
        except Exception:
            out[lid] = -1
    return out


def delete_messages(pg: Postgrest, lead_ids: list[str]) -> int:
    total = 0
    for lid in lead_ids:
        try:
            total += pg.delete("messages", lead_id=f"eq.{lid}")
        except Exception as e:
            print(f"[WARN] falha ao apagar messages de {lid[:8]}: {e}", file=sys.stderr)
    return total


def delete_leads(pg: Postgrest, lead_ids: list[str]) -> int:
    """Deleta leads em batch (até 50 por vez pra não estourar URL)."""
    total = 0
    batch_size = 50
    for i in range(0, len(lead_ids), batch_size):
        chunk = lead_ids[i:i + batch_size]
        # PostgREST: id=in.(uuid1,uuid2,...)
        in_list = "(" + ",".join(chunk) + ")"
        try:
            total += pg.delete("leads", id=f"in.{in_list}")
        except Exception as e:
            print(f"[WARN] falha no batch leads {chunk[0][:8]}..: {e}", file=sys.stderr)
    return total


# --- main --------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(
        description="Reset de lead(s) de teste no CRM-Hermes (cascata leads+messages).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("phone", help="Telefone do lead (com ou sem DDI). "
                                   "Aceita 55xx, 55 (xx) 9xxxx-xxxx, etc — normalizado.")
    ap.add_argument("--tenant", metavar="NOME-OU-UUID",
                    help="Limita a 1 tenant (nome exato OU UUID). Default = todos.")
    ap.add_argument("--yes", action="store_true",
                    help="Confirma a exclusão (sem prompt). SEM ISSO = dry-run.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Força dry-run mesmo com --yes.")
    args = ap.parse_args()

    phone = _normalize_phone(args.phone)
    if len(phone) < 8 or len(phone) > 15:
        ap.error(f"Telefone '{args.phone}' normalizado pra '{phone}' (parece inválido)")

    env = _load_env_file(ENV_FILE)
    # Env var do processo sobrescreve o .env (PM2 seta a env)
    url = os.environ.get("VITE_SUPABASE_URL") or env.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("VITE_SUPABASE_ANON_KEY") or env.get("VITE_SUPABASE_ANON_KEY", "")
    if not url or not key:
        print(f"[ERRO] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não encontrados "
              f"nem em env nem em {ENV_FILE}", file=sys.stderr)
        return 3
    pg = Postgrest(url, key)

    dry_run = args.dry_run or not args.yes

    print(f"\n🔎 Buscando leads com phone='{phone}'"
          + (f" no tenant '{args.tenant}'" if args.tenant else " (todos os tenants)")
          + " ...\n")
    leads = fetch_leads_for_phone(pg, phone, args.tenant)
    if not leads:
        print("✅ Nada encontrado. (Seus dados estão limpos pra esse número, "
              "ou o número está em formato diferente do armazenado.)")
        return 0

    tenants_map = fetch_tenants_map(pg, list({l["tenant_id"] for l in leads}))
    msg_counts = count_messages(pg, [l["id"] for l in leads])

    print(f"📋 {len(leads)} lead(s) / {sum(c for c in msg_counts.values() if c >= 0)} mensagem(ns):\n")
    for l in leads:
        tid = l["tenant_id"]
        slug = tenants_map.get(tid, "?")
        msgs = msg_counts.get(l["id"], 0)
        handoff = " 🟠 HANDOFF ABERTO" if l.get("ai_handoff_open") else ""
        name = str(l.get("name") or "<sem nome>")
        stage = str(l.get("stage") or "?")
        last = (l.get("last_interaction") or l.get("updated_at") or "-")[:19]
        print(f"  • [{slug}] {name[:20]:<20}  "
              f"id={l['id'][:8]}..  stage={stage[:22]:<22}  msgs={msgs:>3}"
              f"  last={last}{handoff}")

    if dry_run:
        print("\n⚠️  DRY-RUN: nada foi apagado. Use --yes pra confirmar a exclusão.")
        return 0

    # Confirmação interativa (a menos que --yes já foi passado)
    if not args.yes:
        print(f"\n❓ Apagar {len(leads)} lead(s) + "
              f"{sum(c for c in msg_counts.values() if c >= 0)} mensagem(ns)? "
              f"Digite 'APAGAR {phone}' pra confirmar:")
        confirm = input("> ").strip()
        if confirm != f"APAGAR {phone}":
            print("Cancelado.")
            return 0

    # EXECUÇÃO
    # Conta ANTES pra ter números precisos no audit (PostgREST DELETE não
    # devolve count confiável em todos os setups — Content-Range às vezes
    # vem vazio).
    intent_leads = len(leads)
    intent_msgs = sum(c for c in msg_counts.values() if c >= 0)
    _audit(f"INICIO phone={phone} tenant={args.tenant or '*'} "
           f"leads={intent_leads} msgs={intent_msgs} user={os.environ.get('USER', '?')}")
    lead_ids = [l["id"] for l in leads]

    msgs_deleted = delete_messages(pg, lead_ids)
    leads_deleted = delete_leads(pg, lead_ids)

    # Audit usa INTENT (pré-delete) — mais confiável que contagem do servidor.
    _audit(f"FIM phone={phone} leads_apagados={leads_deleted}/{intent_leads} "
           f"mensagens_apagadas={msgs_deleted}/{intent_msgs}")

    print(f"\n✅ Concluído: {intent_leads} lead(s) + {intent_msgs} mensagem(ns) apagados.")
    if leads_deleted != intent_leads or msgs_deleted != intent_msgs:
        print(f"⚠️  Audit reportou: leads {leads_deleted}/{intent_leads}, "
              f"msgs {msgs_deleted}/{intent_msgs}. Verifique com dry-run se sobrou algo.")
    print(f"📝 Audit: {LOG_FILE}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nCancelado.", file=sys.stderr)
        sys.exit(130)
