#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
crm-hermes — Follow-up Worker (Fase 2, msg 5601 + msg 5611).

Roda em loop infinito via PM2 (intervalo FOLLOWUP_INTERVAL_SECONDS, padrão 30 min).

ESCOPO ESTRITO (REGRA DE OURO #1 — Isaías msg 5601):
    SÓ processa leads do tenant Demo `33333333-3333-3333-3333-333333333333`.
    Tenant Dr. Matheus Dore (1111) JAMAIS é tocado — produção ativa com
    pacientes reais. A constante TARGET_TABEDA é a única fonte da verdade do
    filtro; o UPDATE também checa tenant_id explicitamente.

Regra de seleção do lead (msg 5611):
    - tenant_id = TARGET_TABEDA
    - handoff_state = 'ia_ativa'  (humano_assumiu = NÃO mexe; kill-switch preservado)
    - stage IN ('iniciou_conversa', 'em_atendimento')
    - last_message_at <= NOW() - 24h
    - followup_count = 0  (anti-spam: cada lead recebe no máximo 1 follow-up)

Ação por lead:
    1. POST Evolution /message/sendText/{instance} com msg contextual
    2. UPDATE lead: followup_count=1, followup_status='sent_1', last_interaction=NOW()
       WHERE id = X AND followup_count = 0  (idempotente em concorrência)

Anti-spam reforçado em 3 camadas:
    - WHERE na seleção já exige followup_count=0
    - UPDATE atômico com mesma condição (evita race com dispatch principal)
    - Só processa 1x por lead — após followup_count=1, sai do filtro

Auditoria: log em logs/followup_worker.log (append, rotate via logrotate).
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

TZ_CLINICA = ZoneInfo("America/Fortaleza")

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

# Carrega .env do projeto (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) e
# o secret do Evolution (EVOLUTION_API_KEY) — mesmo padrão do webhook_server.py.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(BASE_DIR / ".env")
_SECRETS_DIR = Path("/root/.hermes/secrets")
for _name in ("evolution.env",):
    _p = _SECRETS_DIR / _name
    if _p.exists():
        load_dotenv(_p, override=False)

# --- Configuração -------------------------------------------------------------
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "").rstrip("/")
# 02/11/2026: a tabela `tenants` tem RLS só para `authenticated`. Com a ANON key
# o SELECT devolvia HTTP 401 e o worker morria em silêncio (1061 ciclos no log).
# O backend é servidor -> usa SERVICE ROLE (ignora RLS), como o resto do CRM.
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    or os.environ.get("SUPABASE_KEY", "").strip()
    or os.environ.get("VITE_SUPABASE_ANON_KEY", "")
)
EVOLUTION_BASE_URL = (
    os.environ.get("EVOLUTION_API_URL")
    or os.environ.get("EVOLUTION_BASE_URL")
    or "https://evo.automacaojs.us"
).rstrip("/")
EVOLUTION_API_KEY = os.environ.get("EVOLUTION_API_KEY", "")

# Isaías msg 5611: ALVO ÚNICO = tenant Demo. Dr. Matheus (1111) é TRAVADO.
TARGET_TENANT = "33333333-3333-3333-3333-333333333333"
SILENCE_HOURS = 24
DEFAULT_SILENCE_MINUTES = 15
FOLLOWUP_INTERVAL_SECONDS = int(os.environ.get("FOLLOWUP_INTERVAL_SECONDS", "120"))  # 2 min
MAX_LEADS_PER_CYCLE = int(os.environ.get("FOLLOWUP_MAX_LEADS", "50"))

# --- Logger -----------------------------------------------------------------
LOG_FILE = BASE_DIR / "logs" / "followup_worker.log"
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("followup_worker")
logger.setLevel(logging.INFO)
_fh = logging.FileHandler(LOG_FILE)
_fh.setFormatter(
    logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%dT%H:%M:%S%z")
)
logger.addHandler(_fh)
_sh = logging.StreamHandler(sys.stdout)
_sh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%H:%M:%S"))
logger.addHandler(_sh)


# --- PostgREST enxuto (urllib puro, sem dependência extra) -----------------
class Postgrest:
    """Wrapper mínimo da API PostgREST do Supabase (suficiente p/ SELECT, INSERT + PATCH).
    Mesmo padrão do wipe_tenant_test_data.py.
    """

    def __init__(self, url: str, key: str):
        self.base = url + "/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def _req(
        self,
        method: str,
        table: str,
        params: dict | None = None,
        body: dict | None = None,
        prefer: str | None = None,
    ) -> tuple[int, bytes, dict]:
        url = self.base + "/" + table
        if params:
            q = "&".join(
                f"{k}={urllib.parse.quote(str(v), safe='')}" for k, v in params.items()
            )
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
            raise RuntimeError(
                f"SELECT {table} HTTP {status}: {body[:300].decode(errors='replace')}"
            )
        return json.loads(body) if body else []

    def insert(self, table: str, body: dict) -> list[dict]:
        status, resp_body, _ = self._req("POST", table, body=body, prefer="return=representation")
        if status >= 400:
            raise RuntimeError(
                f"INSERT {table} HTTP {status}: {resp_body[:300].decode(errors='replace')}"
            )
        return json.loads(resp_body) if resp_body else []

    def update(self, table: str, body: dict, **filters) -> list[dict]:
        """PATCH com idempotência via query string. Retorna [] se WHERE não bateu."""
        status, resp_body, _ = self._req("PATCH", table, params=filters, body=body)
        if status >= 400:
            raise RuntimeError(
                f"UPDATE {table} HTTP {status}: {resp_body[:300].decode(errors='replace')}"
            )
        return json.loads(resp_body) if resp_body else []


# --- Evolution API -----------------------------------------------------------
def send_evolution_text(instance: str, phone: str, text: str) -> dict:
    """POST Evolution /message/sendText/{instance}. Retorna dict com ok/status."""
    url = f"{EVOLUTION_BASE_URL}/message/sendText/{instance}"
    payload = {"number": phone, "text": text}
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "apikey": EVOLUTION_API_KEY,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8", errors="replace")
            try:
                j = json.loads(raw)
            except Exception:
                j = {"raw": raw[:300]}
            return {"ok": True, "status": r.status, "resp": j}
    except urllib.error.HTTPError as e:
        return {
            "ok": False,
            "status": e.code,
            "error": e.read().decode("utf-8", errors="replace")[:300],
        }
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def _parse_ts(ts_str: str | None) -> float | None:
    if not ts_str:
        return None
    try:
        dt = datetime.fromisoformat(str(ts_str).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return None


# --- Mensagens contextuais em 2 tempos --------------------------------------
def build_followup_message(shot: int, lead: dict, tenant_name: str) -> str:
    """Mensagem de follow-up em 2 tempos:
    - Disparo 1: Cutucada rápida (15 min) acolhedora.
    - Disparo 2: Resgate final (24 horas) amigável de encerramento.
    """
    full_name = (lead.get("name") or "").strip()
    first = full_name.split()[0] if full_name and full_name not in ("Contato WhatsApp", "Novo Contato", "Paciente") else ""
    if shot == 1:
        greeting = f"Oi, {first}! " if first else "Oi! "
        return (
            f"{greeting}Vi que você não conseguiu concluir a mensagem. "
            f"Se quiser que eu te ajude a verificar os horários disponíveis com o doutor, estou por aqui! 😊"
        )
    else:
        greeting = f"Olá, {first}! " if first else "Olá! "
        return (
            f"{greeting}Passando para saber se ainda gostaria de orientações sobre a consulta ou agendamento. "
            f"Se preferir falar diretamente com nossa recepcionista, me avise por aqui. Tenha um excelente dia!"
        )


# --- 1 ciclo do worker ------------------------------------------------------
def run_once(pg: Postgrest) -> dict:
    """1 varredura: lê tenant cfg → filtra devidos → envia Evolution + UPDATE."""

    # 0. Trave defensiva de Horário Comercial (08:00 às 20:00 no fuso da clínica)
    now_local = datetime.now(TZ_CLINICA)
    if not (8 <= now_local.hour < 20):
        logger.info(
            f"🌙 Fora do horário comercial (08:00 às 20:00). Hora local: {now_local.strftime('%H:%M')}. Resgate pausado."
        )
        return {"outside_business_hours": True, "sent": 0}

    # 1. Tenant config (instance Evolution + regras de follow-up + nome pra msg)
    tenants = pg.select(
        "tenants",
        select="id,name,evolution_instance,followup_rules",
        id=f"eq.{TARGET_TENANT}",
        limit="1",
    )
    if not tenants:
        logger.error(f"Tenant {TARGET_TENANT} não encontrado — ciclo abortado.")
        return {"error": "tenant_not_found"}
    tenant = tenants[0]
    instance = (tenant.get("evolution_instance") or "").strip()
    tenant_name = tenant.get("name") or "nossa clínica"
    if not instance:
        logger.error(f"Tenant {tenant_name} sem evolution_instance configurada. Skip.")
        return {"error": "no_instance"}

    followup_rules = tenant.get("followup_rules") or {}
    if isinstance(followup_rules, str):
        try:
            followup_rules = json.loads(followup_rules)
        except Exception:
            followup_rules = {}

    if not followup_rules.get("enabled", True):
        logger.info(f"⏸️ Follow-up automático PAUSADO nas configurações do tenant {tenant_name}. Skip.")
        return {"disabled_by_rules": True, "sent": 0}

    # Limite para a 1ª mensagem (em minutos, default 15 min)
    silence_minutes = int(
        followup_rules.get("silence_minutes")
        or (int(followup_rules.get("silence_hours", 0)) * 60 if followup_rules.get("silence_hours") else DEFAULT_SILENCE_MINUTES)
    )

    # 2. Busca candidatos nos estágios iniciais com followup_count 0 ou 1
    candidates = pg.select(
        "leads",
        select="id,name,phone,clinical_summary,last_message_at,last_interaction,last_followup_at,tenant_id,handoff_state,stage,followup_count",
        tenant_id=f"eq.{TARGET_TENANT}",  # trava anti-Doutor: SEMPRE explícito
        stage="in.(novo_contato,triagem_em_andamento,iniciou_conversa,em_atendimento)",
        followup_count="in.(0,1)",
        order="last_message_at.asc",
        limit=str(MAX_LEADS_PER_CYCLE),
    )

    # 3. Classifica e filtra por silêncio dinâmico no Python
    now_ts = time.time()
    due: list[tuple[dict, int]] = []
    ignored_stages = {"opt_out", "cancelou", "consulta_agendada", "consulta_realizada", "desistiu"}

    for lead in candidates:
        # Defesa em profundidade: confere tenant_id mesmo após o filtro SQL
        if lead.get("tenant_id") != TARGET_TENANT:
            logger.error(
                f"VIOLATION 1: lead {lead.get('id')[:8]} retornou tenant_id={lead.get('tenant_id')} — esperado {TARGET_TENANT}. SKIP."
            )
            continue

        st = (lead.get("stage") or "").lower()
        if st in ignored_stages:
            continue

        # Trava anti-opt-out e respeita atendimento humano
        h_state = (lead.get("handoff_state") or "").lower()
        if h_state in ("opt_out", "humano_assumiu"):
            continue

        f_count = int(lead.get("followup_count") or 0)

        if f_count == 0:
            # Disparo 1 (Cutucada Rápida - silence_minutes, default 15 min)
            ref_ts = _parse_ts(lead.get("last_message_at") or lead.get("last_interaction"))
            if ref_ts is None:
                continue
            if (now_ts - ref_ts) >= (silence_minutes * 60):
                due.append((lead, 1))

        elif f_count == 1:
            # Disparo 2 (Resgate Final - 24 horas após 1º disparo)
            ref_ts = _parse_ts(lead.get("last_followup_at") or lead.get("last_message_at") or lead.get("last_interaction"))
            if ref_ts is None:
                continue
            if (now_ts - ref_ts) >= (24 * 3600):
                due.append((lead, 2))

    if not due:
        logger.info(
            f"Nenhum lead devido no ciclo (1º disparo={silence_minutes}m, 2º disparo=24h). "
            f"(escaneados: {len(candidates)})"
        )
        return {"scanned": len(candidates), "due": 0, "sent": 0, "skipped": 0}

    logger.info(
        f"Encontrados {len(due)} leads devidos (de {len(candidates)} ativos). Processando..."
    )

    sent = 0
    skipped = 0
    for lead, shot in due:
        msg = build_followup_message(shot, lead, tenant_name)
        result = send_evolution_text(instance, lead["phone"], msg)
        if not result.get("ok"):
            logger.warning(
                f"Falha Evolution p/ lead {lead['id'][:8]} ({lead.get('phone')}): {result}"
            )
            # Se for 400 (número não existe no WhatsApp / JID inválido), arquiva para não reprocessar
            if result.get("status") == 400 or "exists" in str(result.get("error", "")):
                try:
                    pg.update(
                        "leads",
                        {
                            "followup_count": 99,
                            "followup_status": "archived",
                            "last_interaction": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        },
                        id=f"eq.{lead['id']}",
                        tenant_id=f"eq.{TARGET_TENANT}",
                    )
                except Exception:
                    pass
            skipped += 1
            continue

        now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

        # UPDATE idempotente atômico por disparo:
        if shot == 1:
            updated = pg.update(
                "leads",
                {
                    "followup_count": 1,
                    "followup_status": "sent_1",
                    "last_followup_at": now_iso,
                    "last_interaction": now_iso,
                },
                id=f"eq.{lead['id']}",
                tenant_id=f"eq.{TARGET_TENANT}",
                followup_count="eq.0",
            )
        else:  # shot == 2
            updated = pg.update(
                "leads",
                {
                    "followup_count": 99,
                    "followup_status": "archived",
                    "last_followup_at": now_iso,
                    "last_interaction": now_iso,
                },
                id=f"eq.{lead['id']}",
                tenant_id=f"eq.{TARGET_TENANT}",
                followup_count="eq.1",
            )

        if not updated:
            logger.info(
                f"Lead {lead['id'][:8]} já tinha followup ao chegar — pulando (race ok)."
            )
            skipped += 1
            continue

        # Insere mensagem no histórico para acompanhamento na recepção
        try:
            pg.insert(
                "messages",
                {
                    "tenant_id": TARGET_TENANT,
                    "lead_id": lead["id"],
                    "sender": "ai",
                    "content": msg,
                    "created_at": now_iso,
                },
            )
        except Exception:
            pass

        logger.info(
            f"✅ Follow-up Disparo #{shot} enviado p/ {lead.get('name','?')} ({lead.get('phone')}) — "
            f"lead_id={lead['id'][:8]} status={result.get('status')}"
        )
        sent += 1

    return {
        "scanned": len(candidates),
        "due": len(due),
        "sent": sent,
        "skipped": skipped,
    }


# --- main loop --------------------------------------------------------------
def main() -> int:
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error("SUPABASE_URL / SERVICE_ROLE_KEY ausentes. Abort.")
        return 2
    if not EVOLUTION_API_KEY:
        logger.error("EVOLUTION_API_KEY ausente. Abort.")
        return 2

    pg = Postgrest(SUPABASE_URL, SUPABASE_KEY)
    logger.info("=" * 70)
    logger.info(f"Follow-up Worker CRM-Hermes — Fase 2 (msg 5601+5611)")
    logger.info(f"  Tenant ALVO: {TARGET_TENANT} (Demo)")
    logger.info(f"  Régua: 2 tempos (Disparo 1: ~15m, Disparo 2: 24h)")
    logger.info(f"  Intervalo varredura: {FOLLOWUP_INTERVAL_SECONDS}s ({FOLLOWUP_INTERVAL_SECONDS // 60} min)")
    logger.info(f"  Max leads/ciclo: {MAX_LEADS_PER_CYCLE}")
    logger.info("=" * 70)

    cycle_count = 0
    while True:
        cycle_count += 1
        try:
            stats = run_once(pg)
            logger.info(f"[ciclo #{cycle_count}] OK: {stats}")
        except Exception as exc:
            logger.exception(f"[ciclo #{cycle_count}] ERRO: {exc}")
        time.sleep(FOLLOWUP_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        logger.info("Interrompido por SIGINT. Bye.")
        sys.exit(0)