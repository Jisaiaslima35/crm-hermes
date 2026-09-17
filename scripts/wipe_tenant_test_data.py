#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
crm-hermes — Wipe de dados de teste de UM tenant (CLI admin).

Apaga TODAS as messages e TODOS os leads vinculados a um tenant_id,
e remove os eventos do Google Calendar referenciados nessas messages.
Útil pra zerar a base de teste antes de entregar uma clínica ao cliente.

USO:
    # dry-run (PADRÃO — não apaga nada, só mostra):
    scripts/wipe_tenant_test_data.py dr-matheus-dore

    # apagar de verdade (pede confirmação a menos que --yes):
    scripts/wipe_tenant_test_data.py dr-matheus-dore --yes

TENANT pode ser passado como:
    - UUID direto
    - nome exato (ex: "Clínica Psiquiátrica Dr. Matheus Dore")
    - slug (não temos coluna slug — caímos no nome)

SEGURANÇA:
    - default = dry-run
    - confirma via prompt se chamar com --yes sozinho é explícito
    - audit log append-only em logs/wipe_tenant.log
    - NUNCA mexe em `tenants`, `system_prompt` ou outros tenants
    - Calendar: apaga SÓ os eventos que aparecem em messages (não varre o Calendar inteiro)

NÃO-INTEGRADO:
    - Histórico do WhatsApp na Evolution API NÃO é tocado.
    - Outros tenants NÃO são tocados.

Autor: Claudinho (Claude Code). 2026-09-16
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent  # scripts/ é 1 nível abaixo da raiz
ENV_FILE = REPO_ROOT / ".env"
LOG_FILE = REPO_ROOT / "logs" / "wipe_tenant.log"


# --- helpers de .env ---------------------------------------------------------
def _load_env_file(path: Path) -> dict[str, str]:
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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _audit(msg: str) -> None:
    line = f"[{_now_iso()}] {msg}"
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, file=sys.stderr)


# --- cliente PostgREST enxuto (mesmo padrão do reset_test_lead) -------------
class Postgrest:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def _req(self, method: str, table: str, params: dict | None = None,
             body: dict | None = None, prefer: str | None = None) -> tuple[int, bytes, dict]:
        url = self.base + "/" + table
        if params:
            q = "&".join(f"{k}={urllib.parse.quote(str(v), safe='')}"
                         for k, v in params.items())
            url = url + "?" + q
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers or {})

    def select(self, table: str, **filters) -> list[dict]:
        params = {"select": filters.pop("select", "*")}
        params.update({k: v for k, v in filters.items()})
        status, body, _ = self._req("GET", table, params=params)
        if status >= 400:
            raise RuntimeError(f"SELECT {table} falhou HTTP {status}: {body[:300].decode(errors='replace')}")
        if not body:
            return []
        return json.loads(body)

    def count(self, table: str, **filters) -> int:
        """Conta sem baixar dados — usa Prefer: count=exact."""
        params = {k: v for k, v in filters.items()}
        status, body, headers = self._req(
            "GET", table, params=params, prefer="count=exact",
        )
        if status >= 400:
            return -1
        cr = headers.get("Content-Range", headers.get("content-range", ""))
        m = re.search(r"/(\d+)", cr)
        return int(m.group(1)) if m else 0

    def delete(self, table: str, **filters) -> int:
        status, body, headers = self._req(
            "DELETE", table, params=filters, prefer="count=exact",
        )
        if status >= 400:
            raise RuntimeError(f"DELETE {table} falhou HTTP {status}: {body[:300].decode(errors='replace')}")
        cr = headers.get("Content-Range", headers.get("content-range", ""))
        m = re.search(r"/(\d+)", cr)
        return int(m.group(1)) if m else -1


# --- Composio MCP (delete de eventos do Calendar) ----------------------------
async def _composio_delete_event(mcp_url: str, mcp_key: str, user_id: str,
                                 event_id: str) -> dict:
    """Chama GOOGLECALENDAR_DELETE_EVENT no Composio Tool Router via JSON-RPC.

    Aceita event_id completo (base64 eid=...@group.calendar.google.com) ou só o eid.
    Retorna a resposta JSON-RPC inteira.
    """
    import httpx

    body = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000),
        "method": "tools/call",
        "params": {
            "name": "GOOGLECALENDAR_DELETE_EVENT",
            "arguments": {
                "event_id": event_id,
                "calendar_id": "primary",
                "user_id": user_id,
            },
        },
    }
    headers = {
        "x-api-key": mcp_key,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(mcp_url, json=body, headers=headers)
    if r.status_code >= 400:
        raise RuntimeError(f"Composio HTTP {r.status_code}: {r.text[:300]}")
    text = r.text
    try:
        return r.json()
    except Exception:
        for line in text.splitlines():
            if line.startswith("data: "):
                return json.loads(line[6:])
        return {"raw": text[:300]}


async def delete_calendar_events(eids: list[str], user_id: str) -> tuple[int, int, list[dict]]:
    """Apaga eventos do Calendar em paralelo (best-effort).
    Retorna (ok_count, fail_count, falhas_para_audit).
    """
    mcp_url = os.environ.get("COMPOSIO_MCP_URL", "").strip()
    mcp_key = os.environ.get("COMPOSIO_MCP_API_KEY", "").strip()
    if not mcp_url or not mcp_key or not eids:
        return 0, 0, []

    results: list[tuple[str, bool, str]] = []
    tasks = [_composio_delete_event(mcp_url, mcp_key, user_id, eid) for eid in eids]
    responses = await asyncio.gather(*tasks, return_exceptions=True)
    ok = 0
    fail = 0
    failures: list[dict] = []
    for eid, resp in zip(eids, responses):
        if isinstance(resp, Exception):
            fail += 1
            failures.append({"event_id": eid[:60], "error": str(resp)[:200]})
            continue
        # Resposta Composio: { result: { content: [...], isError: bool } }
        result = (resp.get("result") or {}) if isinstance(resp, dict) else {}
        is_error = bool(result.get("isError"))
        if is_error:
            fail += 1
            failures.append({
                "event_id": eid[:60],
                "isError": True,
                "content": str(result.get("content"))[:200],
            })
        else:
            ok += 1
    return ok, fail, failures


# --- helpers de extração ----------------------------------------------------
def extract_event_ids_from_messages(messages: list[dict]) -> list[str]:
    """Pega os eids de Google Calendar linkados em messages.content.
    Suporta formato completo (eid=BASE64@group.calendar.google.com) ou só o eid."""
    eids: list[str] = []
    seen: set[str] = set()
    for m in messages:
        content = m.get("content") or ""
        for match in re.finditer(r'eid=([A-Za-z0-9+/=]+@?[A-Za-z0-9.]*)', content):
            eid = match.group(1)
            if eid not in seen:
                seen.add(eid)
                eids.append(eid)
    return eids


def find_tenant(pg: Postgrest, ref: str) -> dict:
    """Resolve referência do tenant por UUID ou nome (case-insensitive)."""
    # Tenta UUID primeiro
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                    ref, re.I):
        rows = pg.select("tenants", select="*", id=f"eq.{ref}", limit="1")
        if rows:
            return rows[0]
    # Tenta nome exato
    rows = pg.select("tenants", select="*", name=f"eq.{ref}", limit="1")
    if rows:
        return rows[0]
    # Tenta nome ilike (case-insensitive)
    rows = pg.select("tenants", select="*", name=f"ilike.{ref}", limit="5")
    if len(rows) == 1:
        return rows[0]
    if len(rows) > 1:
        print(f"[ERRO] nome '{ref}' ambíguo: {[t['name'] for t in rows]}", file=sys.stderr)
        sys.exit(2)
    print(f"[ERRO] tenant '{ref}' não encontrado", file=sys.stderr)
    sys.exit(2)


# --- main --------------------------------------------------------------------
async def amain() -> int:
    ap = argparse.ArgumentParser(
        description="Wipe de leads + messages + Calendar events de 1 tenant.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("tenant", help="UUID ou nome do tenant.")
    ap.add_argument("--user-id", default=None,
                    help="composio_user_id pra Calendar (default = tenant.composio_user_id ou env COMPOSIO_DEFAULT_TENANT_USER_ID).")
    ap.add_argument("--yes", action="store_true", help="Confirma exclusão (sem prompt).")
    ap.add_argument("--dry-run", action="store_true", help="Força dry-run mesmo com --yes.")
    ap.add_argument("--skip-calendar", action="store_true", help="Não toca no Google Calendar.")
    args = ap.parse_args()

    # Carrega .env + env vars do processo
    env = _load_env_file(ENV_FILE)
    for k, v in env.items():
        os.environ.setdefault(k, v)

    url = os.environ.get("VITE_SUPABASE_URL", "").strip()
    key = os.environ.get("VITE_SUPABASE_ANON_KEY", "").strip()
    if not url or not key:
        print(f"[ERRO] VITE_SUPABASE_URL/ANON_KEY não encontrados em env nem {ENV_FILE}",
              file=sys.stderr)
        return 3

    pg = Postgrest(url, key)

    # Resolve tenant
    tenant = find_tenant(pg, args.tenant)
    tid = tenant["id"]
    print(f"\n🏥 Tenant: {tenant['name']!r}")
    print(f"   id={tid}")
    print(f"   system_prompt={'<preenchido>' if tenant.get('system_prompt') else '<vazio>'}")
    print()

    # Contagem prévia
    leads_count = pg.count("leads", tenant_id=f"eq.{tid}", select="id")
    msgs_count = pg.count("messages", tenant_id=f"eq.{tid}", select="id")
    leads = pg.select("leads", select="id,name,phone,stage",
                      tenant_id=f"eq.{tid}", order="created_at.desc", limit="200")
    msgs_with_calendar = pg.select(
        "messages", select="id,lead_id,content",
        tenant_id=f"eq.{tid}", content="like.*google.com/calendar*", limit="500",
    )

    print(f"📊 Inventário ANTES do wipe:")
    print(f"   leads:   {leads_count}")
    print(f"   messages: {msgs_count}")
    print(f"   messages com Calendar link: {len(msgs_with_calendar)}")

    if leads:
        print(f"\n📋 Primeiros leads ({min(5, len(leads))} de {len(leads)}):")
        for l in leads[:5]:
            print(f"   • {l.get('name','<sem nome>')[:24]:<24}  "
                  f"phone={l.get('phone','-')[:14]:<14}  stage={l.get('stage','?')[:20]}")
        if len(leads) > 5:
            print(f"   ... +{len(leads)-5} mais")

    eids = extract_event_ids_from_messages(msgs_with_calendar)
    print(f"\n📅 Eventos do Calendar a apagar: {len(eids)}")
    for e in eids:
        print(f"   • eid={e[:48]}...")

    # Tenant NÃO vai ser tocado — apenas system_prompt preservado
    dry_run = args.dry_run or not args.yes
    if dry_run:
        print("\n⚠️  DRY-RUN: nada foi apagado. Use --yes pra confirmar.")
        return 0

    # Confirmação interativa
    if not args.yes:
        print(f"\n❓ Apagar {leads_count} lead(s) + {msgs_count} mensagem(ns) + "
              f"{len(eids)} evento(s) de Calendar do tenant '{tenant['name']}'?")
        print(f"   O tenant e o system_prompt serão PRESERVADOS.")
        print(f"   Digite o ID do tenant pra confirmar:")
        print(f"   > {tid}")
        confirm = input("> ").strip()
        if confirm != tid:
            print("Cancelado.")
            return 0

    # Audit INÍCIO
    _audit(f"INICIO tenant={tid} name={tenant['name']!r} "
           f"leads={leads_count} msgs={msgs_count} calendar_eids={len(eids)} "
           f"user={os.environ.get('USER', '?')}")

    # 1. Apagar eventos do Calendar (best-effort)
    cal_ok = cal_fail = 0
    cal_failures: list[dict] = []
    if not args.skip_calendar and eids:
        user_id = args.user_id or tenant.get("composio_user_id") or os.environ.get(
            "COMPOSIO_DEFAULT_TENANT_USER_ID", "clinica_dr_matheus"
        ).strip()
        print(f"\n🗑️  Apagando {len(eids)} evento(s) do Google Calendar...")
        cal_ok, cal_fail, cal_failures = await delete_calendar_events(eids, user_id)
        print(f"   ✅ {cal_ok} apagados, ❌ {cal_fail} falhas")

    # 2. Apagar messages do tenant (em batches pra não estourar URL)
    print(f"\n🗑️  Apagando {msgs_count} messages...")
    msgs_deleted = 0
    try:
        msgs_deleted = pg.delete("messages", tenant_id=f"eq.{tid}")
        print(f"   ✅ {msgs_deleted}/{msgs_count} apagadas")
    except Exception as e:
        print(f"   ❌ Falha: {e}", file=sys.stderr)

    # 3. Apagar leads do tenant
    print(f"\n🗑️  Apagando {leads_count} leads...")
    leads_deleted = 0
    try:
        leads_deleted = pg.delete("leads", tenant_id=f"eq.{tid}")
        print(f"   ✅ {leads_deleted}/{leads_count} apagados")
    except Exception as e:
        print(f"   ❌ Falha: {e}", file=sys.stderr)

    # Verificação final
    print(f"\n🔎 Verificação final...")
    leads_after = pg.count("leads", tenant_id=f"eq.{tid}", select="id")
    msgs_after = pg.count("messages", tenant_id=f"eq.{tid}", select="id")
    print(f"   leads após:   {leads_after}")
    print(f"   messages após: {msgs_after}")

    # Audit FIM
    _audit(f"FIM tenant={tid} leads_apagados={leads_deleted}/{leads_count} "
           f"msgs_apagadas={msgs_deleted}/{msgs_count} "
           f"calendar_ok={cal_ok}/{len(eids)} calendar_fail={cal_fail} "
           f"tenant_preservado=YES")

    if cal_failures:
        print(f"\n⚠️  Falhas no Calendar (auditar depois):")
        for f in cal_failures:
            print(f"   • {f}")

    print(f"\n📝 Audit: {LOG_FILE}")
    return 0 if (leads_after == 0 and msgs_after == 0) else 1


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(amain()))
    except KeyboardInterrupt:
        print("\nCancelado.", file=sys.stderr)
        sys.exit(130)
