#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cron_automations.py — Serviço de Agendamento e Disparo de Réguas de Automação (ESVC Turismo).

Executa verificações periódicas no banco de dados e dispara mensagens via Evolution API:
  a) Cobrança D+1 para cotações pendentes (stage='cotacao_enviada')
  b) Pré-viagem D-2 da data de ida do registro em lead_trips
  c) Pós-viagem D+2 da data de volta do registro em lead_trips
"""

import os
import sys
import time
import json
import logging
import re
import urllib.request
import urllib.error
from datetime import datetime, date, timedelta, timezone
from urllib.parse import quote as _urlquote
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any, Optional

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from dotenv import load_dotenv

load_dotenv(BASE_DIR / ".env")
_SECRETS_DIR = Path("/root/.hermes/secrets")
if (_SECRETS_DIR / "evolution.env").exists():
    load_dotenv(_SECRETS_DIR / "evolution.env", override=False)

# Configurações do Supabase e Evolution API
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "https://supabase.automacaojs.us").rstrip("/")
# 02/11/2026: rota INTERNA do PostgREST (Kong local na VPS). O host público via
# Cloudflare custava ~150ms por chamada e occasionally resetava a conexão — o
# worker lia a flag de automações com erro e tratava como "DESLIGADO".
SUPABASE_INTERNAL_BASE = (
    os.environ.get("SUPABASE_INTERNAL_URL", "").strip() or "http://127.0.0.1:28000"
).rstrip("/")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("VITE_SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("VITE_SUPABASE_ANON_KEY")
    or ""
)

EVOLUTION_BASE_URL = (
    os.environ.get("EVOLUTION_API_URL")
    or os.environ.get("VITE_EVOLUTION_API_URL")
    or "https://evo.automacaojs.us"
).rstrip("/")

EVOLUTION_API_KEY = (
    os.environ.get("EVOLUTION_API_KEY")
    or os.environ.get("VITE_EVOLUTION_GLOBAL_KEY")
    or ""
)

TARGET_TENANT_ID = "44444444-4444-4444-4444-444444444444"
POLL_INTERVAL_SECONDS = int(os.environ.get("AUTOMATION_POLL_INTERVAL", "60"))

# Logger
LOG_FILE = BASE_DIR / "logs" / "cron_automations.log"
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("cron_automations")
logger.setLevel(logging.INFO)

_fh = logging.FileHandler(LOG_FILE)
_fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%dT%H:%M:%S%z"))
logger.addHandler(_fh)

_sh = logging.StreamHandler(sys.stdout)
_sh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%H:%M:%S"))
logger.addHandler(_sh)


def _supabase_request(path: str, method: str = "GET", payload: Optional[Any] = None) -> Any:
    """Faz requisição REST ao PostgREST do Supabase.

    Ordem: rota interna (Kong 127.0.0.1:28000) -> host público (Cloudflare).
    Erro 4xx volta na hora (é erro de dado/auth); rede ou 5xx tenta a outra rota.
    """
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    data_bytes = json.dumps(payload).encode("utf-8") if payload is not None else None

    for base in (SUPABASE_INTERNAL_BASE, SUPABASE_URL):
        url = f"{base}/rest/v1/{path.lstrip('/')}"
        req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = resp.read().decode("utf-8")
                if body:
                    return json.loads(body)
                return None
        except urllib.error.HTTPError as he:
            err_msg = he.read().decode("utf-8", errors="ignore")
            logger.error("[SUPABASE HTTP %s] %s: %s", he.code, url, err_msg)
            if he.code < 500:
                return None
            continue
        except Exception as exc:
            logger.error("[SUPABASE ERR] %s: %s", url, exc)
            continue
    return None


def _get_appointment_anchor(tenant_id: str, lead_id: str, prefer: str = "future") -> str | None:
    """Data da consulta a partir da tabela appointments (fonte da verdade).

    31/10/2026: os gatilhos usavam leads.appointment_schedule (campo
    frequentemente desatualizado) e caiam para hoje/10:00 quando vazio.
    prefer='future': proxima consulta futura com status 'agendado'
    (lembrete D-1). prefer='past': ultima consulta passada nao cancelada
    (pos-consulta D+3 / manutencao D+28). Canceladas nunca sao ancora.
    Retorna a string ISO de start_time ou None. O filtro de janela do
    chamador (0..2 dias) descarta ancoras fora do prazo, entao o fallback
    cruzado (futuro quando nao ha passado e vice-versa) e inofensivo.
    """
    try:
        rows = _supabase_request(
            f"appointments?tenant_id=eq.{tenant_id}&lead_id=eq.{lead_id}&select=start_time,status&order=start_time.asc"
        )
    except Exception:
        return None
    if not rows:
        return None
    now_utc = datetime.now(timezone.utc)
    future: list[tuple[datetime, str]] = []
    past: list[tuple[datetime, str]] = []
    for r in rows:
        st = (r.get("start_time") or "").strip()
        if not st or r.get("status") == "cancelou":
            continue
        try:
            dt = datetime.fromisoformat(st.replace("Z", "+00:00"))
        except Exception:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt >= now_utc:
            future.append((dt, st))
        else:
            past.append((dt, st))
    if prefer == "future":
        if future:
            return future[0][1]
        if past:
            return past[-1][1]
        return None
    if past:
        return past[-1][1]
    if future:
        return future[0][1]
    return None


def _appointment_state(tenant_id: str, lead_id: str) -> dict[str, Any]:
    """Estado das consultas do lead — fonte da verdade: tabela appointments.

    01/11/2026: a tabela appointments NAO possui status 'realizada' (so
    'agendado' e 'cancelou'). Por isso a unica prova de que a consulta JA
    OCORREU e a propria data/hora (start_time) no passado, com status
    diferente de 'cancelou'.

    Retorna:
      futura:         ISO da proxima consulta ainda por vir (ou None)
      ultima_passada: ISO da ultima consulta ja ocorrida (ou None)
      total:          quantas consultas nao canceladas existem
    """
    vazio = {"futura": None, "ultima_passada": None, "total": 0}
    try:
        rows = _supabase_request(
            f"appointments?tenant_id=eq.{tenant_id}&lead_id=eq.{lead_id}&select=start_time,status&order=start_time.asc"
        )
    except Exception:
        return vazio
    if not rows:
        return vazio

    now_utc = datetime.now(timezone.utc)
    futura: str | None = None
    ultima_passada: str | None = None
    total = 0
    for r in rows:
        st = (r.get("start_time") or "").strip()
        if not st or r.get("status") == "cancelou":
            continue
        try:
            dt = datetime.fromisoformat(st.replace("Z", "+00:00"))
        except Exception:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        total += 1
        if dt >= now_utc:
            if futura is None:
                futura = st
        else:
            ultima_passada = st
    return {"futura": futura, "ultima_passada": ultima_passada, "total": total}


# ─────────────────────────────────────────────────────────────────────────
# TRAVA DE CONFIRMAÇÃO (03/11/2026 — auditoria clínica Dr. Matheus Dore)
# ─────────────────────────────────────────────────────────────────────────
# Incidente de 03/11/2026 10:00:43 (BRT): a Eduarda (lead 93e18b78) recebeu
# "Lembrando que sua consulta com o Dr. Matheus Dore está agendada para
# amanhã, 04/11/2026 às 19:00. Podemos confirmar sua presença?" — e NÃO
# tinha consulta confirmada na agenda (a recepção nunca formalizou nada).
#
# Causa raiz: o Copiloto Invisível (minerador silencioso da conversa da
# recepção, em webhook_server.py) grava o que a IA INFERE da conversa como
# appointments (status='agendado', source='whatsapp') — inclusive horários
# inventados (19:00, 04:30, 00:00) e dias que nem são da grade da clínica.
# O gatilho D-1 tratava essa linha como "fonte da verdade" e disparava a
# confirmação para qualquer um.
#
# Travas novas (fail-closed), ativas quando a etapa tem
# require_confirmed_appointment = true:
#   1. tenants.schedule_rules.confirmacao_automatica precisa estar true;
#   2. o appointment precisa estar com status='confirmado' (a equipe valida
#      com 1 clique na tela da Agenda Integrada);
#   3. a consulta precisa ser FUTURA (nunca confirmar consulta de ontem);
#   4. leads.appointment_schedule (campo legado) nunca mais serve de âncora
#      para confirmação.
# ─────────────────────────────────────────────────────────────────────────


def _get_confirmed_appointments(
    tenant_id: str,
    lead_id: str,
    statuses: tuple[str, ...] = ("confirmado",),
) -> dict[str, Any]:
    """Consultas CONFIRMADAS/REALIZADAS pela equipe.

    1 requisição por lead (filtro em Python, como _appointment_state).
    - status 'confirmado' = a equipe validou na Agenda (1 clique).
    - status 'compareceu' = a consulta aconteceu de fato (vale para as
      etapas pós-atendimento: D+3, D+28).
    Retorna {"futura": ISO|None, "ultima_passada": ISO|None, "total": int}.
    """
    vazio: dict[str, Any] = {"futura": None, "ultima_passada": None, "total": 0}
    try:
        rows = _supabase_request(
            f"appointments?tenant_id=eq.{tenant_id}&lead_id=eq.{lead_id}"
            f"&select=start_time,status&order=start_time.asc"
        )
    except Exception:
        return vazio
    if not rows:
        return vazio
    now_utc = datetime.now(timezone.utc)
    future: list[str] = []
    past: list[str] = []
    for r in rows:
        if (r.get("status") or "") not in statuses:
            continue
        st = (r.get("start_time") or "").strip()
        if not st:
            continue
        try:
            dt = datetime.fromisoformat(st.replace("Z", "+00:00"))
        except Exception:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt >= now_utc:
            future.append(st)
        else:
            past.append(st)
    return {
        "futura": future[0] if future else None,
        "ultima_passada": past[-1] if past else None,
        "total": len(future) + len(past),
    }


def _anchor_confirmado(conf: dict[str, Any], prefer: str | None) -> str | None:
    """Escolhe a âncora confirmada conforme o modo da etapa."""
    if prefer == "past":
        return conf.get("ultima_passada") or conf.get("futura")
    return conf.get("futura") or conf.get("ultima_passada")


def _confirmacao_automatica_permitida(tenant_info: dict[str, Any]) -> bool:
    """Flag do tenant: schedule_rules.confirmacao_automatica.

    Ausente  = permitido (compatibilidade com os outros tenants que já usam
                gatilho D-1).
    Presente e false = bloqueia a confirmação automática (modo assistido:
                a equipe confirma na tela da Agenda e a IA só avisa).
    """
    rules = tenant_info.get("schedule_rules") or {}
    if not isinstance(rules, dict) or "confirmacao_automatica" not in rules:
        return True
    return rules.get("confirmacao_automatica") is True


def _turno_por_hora(hora: int) -> str:
    """Turno da clínica — a Dr. Matheus não trabalha com horário cravado."""
    if hora < 12:
        return "Manhã"
    if hora < 18:
        return "Tarde"
    return "Noite"


# Sinais de que o lead ja e paciente em tratamento (usado pela TRAVA 2b
# da regua de triagem). 01/11/2026: caso da Anabela Vieira, que perguntou
# "posso suspender o uso da Quetiapina" e mesmo assim recebeu a mensagem
# de boas-vindas de novo lead. A busca e feita nas ultimas 30 dias de
# mensagens enviadas pelo PACIENTE (sender='patient').
_SINASIS_PACIENTE_EXISTENTE = (
    "já fiz a consulta", "ja fiz a consulta",
    "já fiz a teleconsulta", "ja fiz a teleconsulta",
    "já fui atendido", "ja fui atendido",
    "já foi atendida", "ja foi atendida",
    "minha consulta", "a consulta foi", "a teleconsulta foi",
    "já teve consulta", "ja teve consulta",
    "renovar receita", "renovação de receita", "renovacao de receita",
    "renovar minhas receitas", "continuar o tratamento",
    "continuando o tratamento", "continuo o tratamento",
    "suspender o uso", "posso suspender",
    "ajustar a dose", "mudar a dose",
    "meu tratamento", "meu remédio", "meu remedio",
    "minha medicação", "minha medicacao",
    "desde a última consulta", "desde a ultima consulta",
    "pós-consulta", "pos consulta",
    "estou usando", "to usando",
)


def _paciente_existente_por_mensagem(tenant_id: str, lead_id: str) -> bool:
    """True se as ultimas mensagens do paciente indicam tratamento em curso.

    Usado pela TRAVA 2b da regua 'triagem' (boas-vindas D+0): evita enviar
    "Seja muito bem-vindo(a)" para quem ja e paciente da clinica.
    """
    try:
        desde = (datetime.now(timezone.utc) - timedelta(days=30)).strftime(
            "%Y-%m-%dT%H:%M:%S.000Z"
        )
        msgs = _supabase_request(
            f"messages?tenant_id=eq.{tenant_id}&lead_id=eq.{lead_id}"
            f"&sender=eq.patient&created_at=gte.{desde}"
            f"&select=id,content&order=created_at.desc&limit=20"
        )
    except Exception:
        return False
    if not msgs:
        return False
    for m in msgs:
        content = (m.get("content") or "").lower()
        if not content:
            continue
        for sinal in _SINASIS_PACIENTE_EXISTENTE:
            if sinal in content:
                return True
    return False


def _send_evolution_message(instance: str, phone: str, text: str) -> bool:
    """Dispara mensagem de texto no WhatsApp do cliente via Evolution API."""
    clean_phone = "".join(filter(str.isdigit, phone))
    if not clean_phone.startswith("55") and len(clean_phone) in (10, 11):
        clean_phone = f"55{clean_phone}"

    url = f"{EVOLUTION_BASE_URL}/message/sendText/{instance}"
    headers = {
        "apikey": EVOLUTION_API_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "number": clean_phone,
        "text": text,
        "linkPreview": False,
    }

    try:
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as he:
        body = he.read().decode("utf-8", errors="ignore")
        logger.error("[EVOLUTION HTTP %s] %s -> %s: %s", he.code, clean_phone, url, body)
        return False
    except Exception as exc:
        logger.error("[EVOLUTION ERR] %s: %s", clean_phone, exc)
        return False


def _get_tenant_info(tenant_id: str) -> dict[str, Any]:
    res = _supabase_request(f"tenants?id=eq.{tenant_id}&select=*")
    if res and len(res) > 0:
        return res[0]
    return {}


def _get_stage_automations(tenant_id: str) -> dict[str, dict[str, Any]]:
    res = _supabase_request(f"stage_automations?tenant_id=eq.{tenant_id}&select=*")
    result = {}
    if res:
        for r in res:
            result[r.get("stage_key")] = r
    return result


def process_cotacao_followups(tenant_id: str, tenant_info: dict[str, Any], automations: dict[str, dict[str, Any]]):
    """
    Régua A: Cobrança D+1 para cotações pendentes (stage = 'cotacao_enviada')
    """
    cotacao_cfg = automations.get("cotacao")
    if not cotacao_cfg or not cotacao_cfg.get("is_active", True):
        return

    trigger_days = cotacao_cfg.get("trigger_days") or 1
    template = cotacao_cfg.get("message_template") or (
        "Olá, {nome}! Tudo bem? Passando para saber o que achou da cotação que preparamos para {destino}. "
        "Ficou com alguma dúvida ou gostaria de ajustar opções de datas e voos?"
    )
    instance = tenant_info.get("evolution_instance") or "esvc_turismo_prod_01"

    # Busca leads na etapa cotacao_enviada com last_quote_at preenchido e quote_followup_sent = false
    leads = _supabase_request(
        f"leads?tenant_id=eq.{tenant_id}&stage=eq.cotacao_enviada&quote_followup_sent=eq.false&opt_out_reactivation=eq.false&last_quote_at=not.is.null&select=id,name,phone,last_quote_at,clinical_summary"
    )

    if not leads:
        return

    now_utc = datetime.now(timezone.utc)
    for lead in leads:
        try:
            quote_str = lead.get("last_quote_at")
            if not quote_str:
                continue
            quote_dt = datetime.fromisoformat(quote_str.replace("Z", "+00:00"))
            deadline = quote_dt + timedelta(days=trigger_days)

            if now_utc >= deadline:
                lead_id = lead["id"]
                name = lead.get("name") or "Viajante"
                summary = lead.get("clinical_summary") or ""
                destino = "seu destino"
                if "Destino:" in summary or "Interesse:" in summary:
                    destino = summary.split(":")[-1].strip()

                msg_text = template.replace("{nome}", name).replace("{destino}", destino)

                logger.info(
                    "✈️ [COTAÇÃO D+%d] Enviando follow-up para lead=%s (%s, tel=%s)",
                    trigger_days, lead_id, name, lead.get("phone")
                )

                sent_ok = _send_evolution_message(instance, lead.get("phone"), msg_text)
                if sent_ok:
                    # Registra mensagem no banco
                    _supabase_request("messages", method="POST", payload={
                        "tenant_id": tenant_id,
                        "lead_id": lead_id,
                        "sender": "ai",
                        "content": msg_text,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })

                    # Atualiza lead para evitar reenvio
                    _supabase_request(f"leads?id=eq.{lead_id}", method="PATCH", payload={
                        "quote_followup_sent": True,
                        "last_interaction": datetime.now(timezone.utc).isoformat(),
                    })
        except Exception as exc:
            logger.error("[COTAÇÃO FOLLOW-UP] Erro no lead %s: %s", lead.get("id"), exc)


def process_pre_trip_reminders(tenant_id: str, tenant_info: dict[str, Any], automations: dict[str, dict[str, Any]]):
    """
    Régua B: Pré-viagem D-2 da data de ida do registro em lead_trips
    """
    pre_cfg = automations.get("pre_viagem")
    if not pre_cfg or not pre_cfg.get("is_active", True):
        return

    trigger_days = pre_cfg.get("trigger_days") or 2
    template = pre_cfg.get("message_template") or (
        "Olá, {nome}! Sua viagem para {destino} está chegando! Faltam apenas {dias} dias para o seu embarque. "
        "Lembre-se de conferir documentos e fazer o check-in online. Boa viagem! ✈️"
    )
    instance = tenant_info.get("evolution_instance") or "esvc_turismo_prod_01"

    # Busca viagens onde pre_trip_sent = false
    trips = _supabase_request(
        f"lead_trips?tenant_id=eq.{tenant_id}&pre_trip_sent=eq.false&select=id,lead_id,destination,departure_date,return_date"
    )
    if not trips:
        return

    today = date.today()

    for trip in trips:
        try:
            dep_date_str = trip.get("departure_date")
            if not dep_date_str:
                continue
            dep_date = date.fromisoformat(dep_date_str)
            target_date = dep_date - timedelta(days=trigger_days)

            # Regra do cliente: dispara SOMENTE no dia exato D-2. Se a viagem
            # foi cadastrada ja dentro da janela (< 2 dias p/ o embarque), o
            # pre-viagem NAO e enviado (nada de disparo no passado).
            if today == target_date:
                lead_id = trip.get("lead_id")
                # Busca dados do lead
                lead_res = _supabase_request(f"leads?id=eq.{lead_id}&select=id,name,phone,opt_out_reactivation")
                if not lead_res or len(lead_res) == 0:
                    continue
                lead = lead_res[0]
                if lead.get("opt_out_reactivation", False):
                    continue

                name = lead.get("name") or "Viajante"
                destino = trip.get("destination") or "sua viagem"

                msg_text = (
                    template
                    .replace("{nome}", name)
                    .replace("{destino}", destino)
                    .replace("{dias}", str(trigger_days))
                )

                logger.info(
                    "✈️ [PRÉ-VIAGEM D-%d] Enviando aviso para lead=%s trip=%s (%s)",
                    trigger_days, lead_id, trip["id"], destino
                )

                sent_ok = _send_evolution_message(instance, lead.get("phone"), msg_text)
                if sent_ok:
                    _supabase_request("messages", method="POST", payload={
                        "tenant_id": tenant_id,
                        "lead_id": lead_id,
                        "sender": "ai",
                        "content": msg_text,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })

                    _supabase_request(f"lead_trips?id=eq.{trip['id']}", method="PATCH", payload={
                        "pre_trip_sent": True,
                    })
        except Exception as exc:
            logger.error("[PRÉ-VIAGEM] Erro na trip %s: %s", trip.get("id"), exc)


def process_post_trip_followups(tenant_id: str, tenant_info: dict[str, Any], automations: dict[str, dict[str, Any]]):
    """
    Régua C: Pós-viagem D+2 da data de volta do registro em lead_trips
    """
    pos_cfg = automations.get("pos_viagem")
    if not pos_cfg or not pos_cfg.get("is_active", True):
        return

    trigger_days = pos_cfg.get("trigger_days") or 2
    template = pos_cfg.get("message_template") or (
        "Olá, {nome}! Seja bem-vindo(a) de volta! Como foi sua viagem para {destino}? "
        "Esperamos que tenha sido inesquecível! Conte-nos como foi a sua experiência!"
    )
    instance = tenant_info.get("evolution_instance") or "esvc_turismo_prod_01"

    # Busca viagens onde post_trip_sent = false
    trips = _supabase_request(
        f"lead_trips?tenant_id=eq.{tenant_id}&post_trip_sent=eq.false&select=id,lead_id,destination,departure_date,return_date"
    )
    if not trips:
        return

    today = date.today()

    for trip in trips:
        try:
            # Viagem so de ida (sem data de retorno): o pos-viagem conta
            # a partir da data de ida + trigger_days.
            ret_date_str = trip.get("return_date") or trip.get("departure_date")
            if not ret_date_str:
                continue
            ret_date = date.fromisoformat(ret_date_str)
            target_date = ret_date + timedelta(days=trigger_days)

            # Se hoje já passou da data de retorno + trigger_days
            if today >= target_date:
                lead_id = trip.get("lead_id")
                lead_res = _supabase_request(f"leads?id=eq.{lead_id}&select=id,name,phone,opt_out_reactivation")
                if not lead_res or len(lead_res) == 0:
                    continue
                lead = lead_res[0]
                if lead.get("opt_out_reactivation", False):
                    continue

                name = lead.get("name") or "Viajante"
                destino = trip.get("destination") or "sua viagem"

                msg_text = template.replace("{nome}", name).replace("{destino}", destino)

                logger.info(
                    "✈️ [PÓS-VIAGEM D+%d] Enviando pesquisa retorno para lead=%s trip=%s (%s)",
                    trigger_days, lead_id, trip["id"], destino
                )

                sent_ok = _send_evolution_message(instance, lead.get("phone"), msg_text)
                if sent_ok:
                    _supabase_request("messages", method="POST", payload={
                        "tenant_id": tenant_id,
                        "lead_id": lead_id,
                        "sender": "ai",
                        "content": msg_text,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })

                    _supabase_request(f"lead_trips?id=eq.{trip['id']}", method="PATCH", payload={
                        "post_trip_sent": True,
                    })

                    # Move lead para a coluna Pos-venda (pos-viagem e fluxo de
                    # bastidor vinculado a lead_trips, nao coluna do Kanban)
                    _supabase_request(f"leads?id=eq.{lead_id}", method="PATCH", payload={
                        "stage": "pos_venda",
                        "last_interaction": datetime.now(timezone.utc).isoformat(),
                    })
        except Exception as exc:
            logger.error("[PÓS-VIAGEM] Erro na trip %s: %s", trip.get("id"), exc)


def process_perdido_segunda_chance(tenant_id: str, tenant_info: dict[str, Any], automations: dict[str, dict[str, Any]]):
    """
    Regua D: Segunda Chance — lead em 'perdido' ha trigger_days dias recebe
    uma nova abordagem (template da stage_automations, chave 'perdido').
    """
    cfg = automations.get("perdido")
    if not cfg or not cfg.get("is_active", True):
        return
    trigger_days = cfg.get("trigger_days") or 1
    template = cfg.get("message_template") or ""
    if not template:
        return
    instance = tenant_info.get("evolution_instance") or "esvc_turismo_prod_01"

    leads = _supabase_request(
        f"leads?tenant_id=eq.{tenant_id}&stage=eq.perdido&lost_followup_sent=eq.false&perdido_at=not.is.null&select=id,name,phone,perdido_at,trip_destination,opt_out_reactivation"
    )
    if not leads:
        return

    now_utc = datetime.now(timezone.utc)
    for lead in leads:
        try:
            if lead.get("opt_out_reactivation", False):
                continue
            perdido_dt = datetime.fromisoformat(str(lead.get("perdido_at")).replace("Z", "+00:00"))
            if now_utc < perdido_dt + timedelta(days=trigger_days):
                continue
            name = lead.get("name") or "Viajante"
            destino = lead.get("trip_destination") or "sua viagem"
            msg_text = template.replace("{nome}", name).replace("{destino}", destino)
            logger.info("[SEGUNDA CHANCE D+%d] Enviando para lead=%s (%s)", trigger_days, lead["id"], name)
            sent_ok = _send_evolution_message(instance, lead.get("phone"), msg_text)
            if sent_ok:
                _supabase_request("messages", method="POST", payload={
                    "tenant_id": tenant_id, "lead_id": lead["id"], "sender": "ai",
                    "content": msg_text, "created_at": datetime.now(timezone.utc).isoformat(),
                })
                _supabase_request(f"leads?id=eq.{lead['id']}", method="PATCH", payload={"lost_followup_sent": True})
        except Exception as exc:
            logger.error("[SEGUNDA CHANCE] Erro no lead %s: %s", lead.get("id"), exc)


_REACTIVATION_TEMPLATE = (
    "Olá, {nome}! Tudo bem? Aqui é da ESVC Turismo. "
    "Não queria que você perdesse as condições atuais {frase_destino}. "
    "Quer que eu monte uma cotação sem compromisso pra você?"
)


def process_reactivation_cadence(tenant_id: str, tenant_info: dict[str, Any], automations: dict[str, dict[str, Any]] | None = None):
    """
    Regua E: cadencia infinita do Lead Real — D+4, D+7, D+15, D+30 e depois
    a cada 30 dias. Pela regra do cliente, NAO e cancelada por mudanca de
    stage do card; para apenas em opt-out (LGPD) ou exclusao do lead.
    Dispara somente em horario comercial (America/Sao_Paulo, 08h-20h).
    """
    _re_cfg = (automations or {}).get("reativacao")
    if _re_cfg and not _re_cfg.get("is_active", True):
        return
    _re_template = (_re_cfg or {}).get("message_template") or _REACTIVATION_TEMPLATE
    instance = tenant_info.get("evolution_instance") or "esvc_turismo_prod_01"
    now_utc = datetime.now(timezone.utc)
    schedules = _supabase_request(
        f"lead_reactivation_schedules?tenant_id=eq.{tenant_id}&is_active=eq.true&next_due_at=lte.{_urlquote(now_utc.isoformat())}&select=*"
    )
    if not schedules:
        return
    local_hour = datetime.now(ZoneInfo("America/Sao_Paulo")).hour
    if not (8 <= local_hour < 20):
        return
    steps = [4, 7, 15, 30]
    for sch in schedules:
        try:
            lead_res = _supabase_request(f"leads?id=eq.{sch.get('lead_id')}&select=id,name,phone,trip_destination,opt_out_reactivation")
            if not lead_res:
                continue
            lead = lead_res[0]
            if lead.get("opt_out_reactivation", False):
                _supabase_request(f"lead_reactivation_schedules?id=eq.{sch['id']}", method="PATCH", payload={"is_active": False})
                continue
            name = lead.get("name") or "Viajante"
            dest = lead.get("trip_destination")
            frase_destino = f"pra sua viagem pra {dest}" if dest else "pra sua próxima viagem"
            msg_text = _re_template.replace("{nome}", name).replace("{frase_destino}", frase_destino)
            logger.info("[REATIVACAO] Enviando para lead=%s (%s), passo %s", lead["id"], name, sch.get("step_index"))
            sent_ok = _send_evolution_message(instance, lead.get("phone"), msg_text)
            if sent_ok:
                _supabase_request("messages", method="POST", payload={
                    "tenant_id": tenant_id, "lead_id": lead["id"], "sender": "ai",
                    "content": msg_text, "created_at": datetime.now(timezone.utc).isoformat(),
                })
                idx = min(int(sch.get("step_index") or 0) + 1, 3)
                _supabase_request(f"lead_reactivation_schedules?id=eq.{sch['id']}", method="PATCH", payload={
                    "step_index": idx,
                    "next_due_at": (now_utc + timedelta(days=steps[idx])).isoformat(),
                    "last_sent_at": now_utc.isoformat(),
                })
        except Exception as exc:
            logger.error("[REATIVACAO] Erro no agendamento %s: %s", sch.get("id"), exc)


def process_kanban_stages_config_automations():
    """
    Avalia diariamente leads com base na data de referência + trigger_days configurados
    em kanban_stages_config. Se is_active == false, ignora os disparos automáticos daquela etapa.
    """
    try:
        # Busca todas as regras de etapas ativas que possuem template de mensagem automática
        stages = _supabase_request(
            "kanban_stages_config?is_active=eq.true&auto_message_template=not.is.null&select=*"
        )
        if not stages:
            return

        now_utc = datetime.now(timezone.utc)
        # Horário local para checagem de envio
        tz_br = ZoneInfo("America/Fortaleza")
        now_local = datetime.now(tz_br)

        for cfg in stages:
            try:
                # Regra estrita: se is_active == false, ignora
                if not cfg.get("is_active", True):
                    continue

                # Se a etapa for exclusiva para humanos, não dispara automação de IA
                if cfg.get("requires_human_only", False):
                    continue

                template = (cfg.get("auto_message_template") or "").strip()
                if not template:
                    continue

                tenant_id = cfg.get("tenant_id")
                stage_key = cfg.get("stage_key")
                # 02/11/2026 (sprint dedetização): trigger_days NULL = etapa SEM
                # gatilho temporal (ex.: contrato_recorrente) — depende de
                # acionamento humano. Antes caía em 0 e disparava D+0.
                if cfg.get("trigger_days") is None:
                    logger.info(
                        "⏭️ [KANBAN STAGE] Etapa '%s' sem trigger_days (acionamento manual) — não dispara",
                        stage_key,
                    )
                    continue
                trigger_days = int(cfg.get("trigger_days") or 0)
                trigger_time_str = cfg.get("trigger_time") or "10:00:00"

                tenant_info = _get_tenant_info(tenant_id)
                instance = tenant_info.get("evolution_instance")
                if not instance:
                    continue

                # Checagem de horário do dia configurado
                try:
                    target_hour = int(trigger_time_str.split(":")[0])
                except Exception:
                    target_hour = 10

                # Só dispara a partir do horário programado
                if now_local.hour < target_hour:
                    continue

                # Define aliases de busca de leads para a etapa
                aliases = [stage_key]
                if stage_key == "triagem":
                    aliases.extend(["novo_contato", "iniciou_conversa"])
                elif stage_key == "agendados_d1":
                    aliases.extend(["consulta_agendada"])
                elif stage_key == "compareceu_atendido":
                    aliases.extend(["consulta_realizada"])
                elif stage_key == "cancelou_inativos":
                    aliases.extend(["cancelou", "desistiu"])
                # 02/11/2026 (sprint dedetização): aliases configuráveis por
                # etapa (coluna kanban_stages_config.stage_aliases). Sem isso
                # cada tenant tinha só os 4 pares fixos acima e nenhuma etapa
                # nova (ex.: servico_realizado) enxergava o lead.
                extra_aliases = cfg.get("stage_aliases") or []
                if isinstance(extra_aliases, str):
                    extra_aliases = [extra_aliases]
                for alias in extra_aliases:
                    alias = str(alias or "").strip()
                    if alias and alias not in aliases:
                        aliases.append(alias)

                stage_filter = ",".join(aliases)
                # 02/11/2026 (sprint de métricas): a etapa de TRIAGEM buscava TODOS
                # os leads em novo_contato (2018 linhas só na clínica) e o ciclo
                # levava ~50min. Triagem é ação de primeira resposta, não de
                # arquivo histórico -> filtra pela última movimentação (48h).
                extra_filter = ""
                if stage_key == "triagem":
                    desde_48h = datetime.now(timezone.utc) - timedelta(hours=48)
                    extra_filter = (
                        f"&updated_at=gte.{_urlquote(desde_48h.isoformat())}"
                    )
                leads = _supabase_request(
                    f"leads?tenant_id=eq.{tenant_id}&stage=in.({stage_filter})&opt_out_reactivation=eq.false{extra_filter}&select=id,name,phone,stage,appointment_schedule,last_interaction,created_at,updated_at,has_incident_history,ai_auto_silence,handoff_state"
                )
                if not leads:
                    continue

                for lead in leads:
                    try:
                        # Segurança: se humano assumiu ou tem atrito com auto-silence, não dispara
                        if lead.get("handoff_state") == "humano_assumiu":
                            continue
                        if lead.get("has_incident_history") and lead.get("ai_auto_silence"):
                            continue

                        # ========== TRAVA 1 (01/11/2026) ==========
                        # Regua de lembrete (D-1 / agendados_d1): se a consulta
                        # de referencia JA PASSOU da data/hora atual, o
                        # paciente ja foi atendido — nao ha o que confirmar.
                        # Causa raiz do bug 30/10: a Thais recebeu "Lembrando
                        # que sua consulta esta agendada para amanha" MESMO
                        # tendo a teleconsulta ja realizada em 28/10.
                        # ==============================================
                        if stage_key == "agendados_d1" or trigger_days < 0:
                            appt_state = _appointment_state(tenant_id, lead["id"])
                            ancora_futura = appt_state.get("futura")
                            ancora_passada = appt_state.get("ultima_passada")

                            # 1a) Ancoragem futura = consulta ainda vai acontecer
                            #     -> mantem o lembrete (fluxo normal).
                            if ancora_futura:
                                try:
                                    fut_dt = datetime.fromisoformat(
                                        ancora_futura.replace("Z", "+00:00")
                                    )
                                    if fut_dt.tzinfo is None:
                                        fut_dt = fut_dt.replace(tzinfo=timezone.utc)
                                except Exception:
                                    fut_dt = None
                                if fut_dt and fut_dt <= now_utc:
                                    logger.info(
                                        "⛔ [SKIP] Lead %s - consulta ja passou da data/hora prevista (%s)",
                                        lead["id"], ancora_futura,
                                    )
                                    continue

                            # 1b) Sem consulta futura, mas existe consulta
                            #     PASSADA e nao ha ancora futura -> o agendamento
                            #     de lembreiro ja foi consumido. Nao dispara.
                            elif ancora_passada:
                                logger.info(
                                    "⛔ [SKIP] Lead %s - agendamento ja realizado (%s), sem consulta futura pendente",
                                    lead["id"], ancora_passada,
                                )
                                continue

                        # ========== TRAVA 1B (03/11/2026) ==========
                        # CONFIRMAÇÃO ASSISTIDA (auditoria Dr. Matheus):
                        # quando a etapa tem require_confirmed_appointment,
                        # o ÚNICO gatilho válido é um appointment com
                        # status='confirmado' — validado pela equipe com 1
                        # clique na tela da Agenda Integrada. O que o
                        # Copiloto Invisível infere da conversa
                        # (source='whatsapp', status='agendado') fica FORA.
                        # Foi assim que a Eduarda recebeu confirmação de
                        # uma "consulta" de 19:00 que nunca existiu
                        # (03/11/2026 10:00, lead 93e18b78).
                        # ==============================================
                        exige_confirmacao = bool(cfg.get("require_confirmed_appointment"))
                        conf_state: dict[str, Any] = {}
                        if exige_confirmacao:
                            if not _confirmacao_automatica_permitida(tenant_info):
                                logger.info(
                                    "⛔ [SKIP] Lead %s - confirmação automática DESLIGADA no tenant "
                                    "(schedule_rules.confirmacao_automatica=false)",
                                    lead["id"],
                                )
                                continue
                            # Etapa de CONFIRMAÇÃO (pré-consulta) exige só
                            # 'confirmado'. Etapa PÓS-atendimento (D+3, D+28)
                            # aceita 'confirmado' ou 'compareceu' — a consulta
                            # precisa ter sido confirmada/realizada de fato.
                            estados_exigidos = (
                                ("confirmado", "compareceu")
                                if trigger_days > 0
                                else ("confirmado",)
                            )
                            conf_state = _get_confirmed_appointments(
                                tenant_id, lead["id"], estados_exigidos
                            )
                            if not conf_state.get("total"):
                                logger.info(
                                    "⛔ [SKIP] Lead %s - nenhuma consulta %s pela equipe "
                                    "— mensagem não sai",
                                    lead["id"],
                                    "confirmada/realizada"
                                    if trigger_days > 0
                                    else "CONFIRMADA",
                                )
                                continue

                        # ========== TRAVA 2 (01/11/2026) ==========
                        # Reguas de boas-vindas (triagem D+0): nao enviar
                        # "Seja muito bem-vindo(a)" para quem JA e paciente
                        # com consulta realizada. Causa raiz: a Anabela Vieira
                        # (ja em tratamento, perguntando sobre suspender
                        # Quetiapina) recebeu mensagem de novo lead em 01/11.
                        # ==============================================
                        if stage_key == "triagem":
                            appt_state = _appointment_state(tenant_id, lead["id"])
                            if appt_state.get("total", 0) > 0:
                                logger.info(
                                    "⛔ [SKIP] Lead %s - paciente ja possui %d consulta(s) registrada(s), "
                                    "nao e novo lead (triagem)",
                                    lead["id"], appt_state.get("total", 0),
                                )
                                continue

                            # TRAVA 2b: o lead pode nao ter appointment (a
                            # Anabela nunca foi agendada por aqui), mas as
                            # mensagens do paciente denunciam que e paciente
                            # antigo ("posso suspender o uso da Quetiapina",
                            # "renovar minhas receitas", "ja fiz a consulta").
                            if _paciente_existente_por_mensagem(tenant_id, lead["id"]):
                                logger.info(
                                    "⛔ [SKIP] Lead %s - mensagens do paciente indicam paciente em "
                                    "tratamento (nao e novo lead para triagem)",
                                    lead["id"],
                                )
                                continue

                        # Determina data de referência — fonte da verdade é a
                        # tabela appointments (31/10/2026); appointment_schedule
                        # fica só como fallback legado. ref_anchor é reusado
                        # abaixo em {data}/{horario} para ser a MESMA consulta
                        # que o gatilho referencia.
                        #
                        # 02/11/2026 (sprint dedetização): anchor_mode
                        # configurável por etapa (kanban_stages_config).
                        #   auto   = comportamento legado (abaixo)
                        #   future = ancora na próxima consulta (D-1, pré-serviço)
                        #   past   = ancora na última consulta já realizada
                        #            (D+1/D+15/D+180 contados a partir da DATA
                        #             DO SERVIÇO, não da última conversa)
                        anchor_mode = str(cfg.get("anchor_mode") or "auto").strip().lower()
                        if anchor_mode not in ("auto", "future", "past"):
                            anchor_mode = "auto"
                        prefer = None
                        if anchor_mode == "future":
                            prefer = "future"
                        elif anchor_mode == "past":
                            prefer = "past"
                        elif trigger_days < 0 or stage_key == "agendados_d1":
                            prefer = "future"
                        elif stage_key in ("pos_consulta_d3", "manutencao_d28"):
                            prefer = "past"

                        ref_anchor = None
                        if exige_confirmacao:
                            # SOMENTE o appointment confirmado pela equipe —
                            # nunca o fallback legado leads.appointment_schedule.
                            ref_anchor = _anchor_confirmado(conf_state, prefer)
                            ref_str = ref_anchor
                        elif prefer == "future":
                            ref_anchor = _get_appointment_anchor(tenant_id, lead["id"], "future")
                            ref_str = ref_anchor or lead.get("appointment_schedule")
                        elif prefer == "past":
                            ref_anchor = _get_appointment_anchor(tenant_id, lead["id"], "past")
                            ref_str = ref_anchor or lead.get("appointment_schedule") or lead.get("last_interaction") or lead.get("updated_at")
                        else:
                            ref_str = lead.get("last_interaction") or lead.get("updated_at") or lead.get("created_at")

                        if not ref_str:
                            continue

                        try:
                            clean_ref = ref_str.replace("Z", "+00:00")
                            ref_dt = datetime.fromisoformat(clean_ref)
                            if ref_dt.tzinfo is None:
                                ref_dt = ref_dt.replace(tzinfo=timezone.utc)
                            ref_date = ref_dt.astimezone(tz_br).date()
                        except Exception:
                            continue

                        # Calcula data alvo do gatilho
                        target_date = ref_date + timedelta(days=trigger_days)
                        today_local = now_local.date()

                        # Avalia se a data de disparo chegou (janela de tolerância de 2 dias para não disparar eventos pré-históricos)
                        days_diff = (today_local - target_date).days
                        if not (0 <= days_diff <= 2):
                            continue

                        # TRAVA 1C (03/11/2026): com appointment confirmado, o
                        # disparo acontece SÓ na véspera da consulta. Nunca
                        # numa consulta que já passou (aí o texto "amanhã"
                        # mentiria) e nunca com data no futuro distante.
                        if exige_confirmacao:
                            # Pré-consulta (D-1): a consulta precisa ser FUTURA.
                            # Pós-atendimento (D+3/D+28): a âncora é a consulta
                            # JÁ REALIZADA (o que precisa ser futuro é o
                            # gatilho, não a data da consulta).
                            if trigger_days < 0 or stage_key == "agendados_d1":
                                if ref_date <= today_local:
                                    logger.info(
                                        "⛔ [SKIP] Lead %s - consulta (%s) não é futura — confirmação só na véspera",
                                        lead["id"], ref_str,
                                    )
                                    continue
                            if days_diff != 0:
                                continue

                        # Evita disparo duplicado: verifica se já enviou mensagem com este template recentemente
                        lead_id = lead["id"]
                        # 01/11/2026: a query anterior (sem ORDER BY) podia
                        # devolver mensagens antigas e fora de ordem, e a
                        # janela era de apenas 15 mensagens — o que permitiu
                        # o D-1 da Thais ser enviado 2x em 12 segundos.
                        # Agora: ordena por data (mais recente primeiro) e
                        # limita a busca aos ultimos 30 dias.
                        desde_dedup = (now_utc - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
                        recent_msgs = _supabase_request(
                            f"messages?tenant_id=eq.{tenant_id}&lead_id=eq.{lead_id}"
                            f"&sender=eq.ai&created_at=gte.{desde_dedup}"
                            f"&select=id,created_at,content&order=created_at.desc&limit=30"
                        )
                        already_sent = False
                        if recent_msgs:
                            const_parts = [p.strip() for p in re.split(r"\{[a-zA-Z_]+\}", template) if len(p.strip()) >= 8]
                            for m in recent_msgs:
                                content = m.get("content") or ""
                                if const_parts and any(p in content for p in const_parts):
                                    already_sent = True
                                    break
                                elif not const_parts and template in content:
                                    already_sent = True
                                    break
                        if already_sent:
                            continue

                        # Formata mensagem com variáveis {nome}, {data}, {horario}, {turno}
                        name = lead.get("name") or "Paciente"
                        appt_str = ref_anchor or _get_appointment_anchor(tenant_id, lead["id"], "future") or lead.get("appointment_schedule")
                        turno = "Tarde"
                        if appt_str:
                            try:
                                a_dt = datetime.fromisoformat(appt_str.replace("Z", "+00:00")).astimezone(tz_br)
                                fmt_data = a_dt.strftime("%d/%m/%Y")
                                fmt_horario = a_dt.strftime("%H:%M")
                                turno = _turno_por_hora(a_dt.hour)
                            except Exception:
                                fmt_data = today_local.strftime("%d/%m/%Y")
                                fmt_horario = "10:00"
                        else:
                            fmt_data = today_local.strftime("%d/%m/%Y")
                            fmt_horario = "10:00"

                        msg_text = (
                            template
                            .replace("{nome}", name)
                            .replace("{data}", fmt_data)
                            .replace("{horario}", fmt_horario)
                            .replace("{turno}", turno)
                        )

                        logger.info(
                            "⚙️ [KANBAN AUTOMATION D%+d] Disparando etapa '%s' para lead=%s (%s, tel=%s)",
                            trigger_days, stage_key, lead_id, name, lead.get("phone")
                        )

                        sent_ok = _send_evolution_message(instance, lead.get("phone"), msg_text)
                        if sent_ok:
                            _supabase_request("messages", method="POST", payload={
                                "tenant_id": tenant_id,
                                "lead_id": lead_id,
                                "sender": "ai",
                                "content": msg_text,
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            })
                            _supabase_request(f"leads?id=eq.{lead_id}", method="PATCH", payload={
                                "last_interaction": datetime.now(timezone.utc).isoformat(),
                            })
                    except Exception as lead_exc:
                        logger.error("[KANBAN STAGE] Erro ao avaliar lead %s na etapa %s: %s", lead.get("id"), stage_key, lead_exc)

            except Exception as stage_exc:
                logger.error("[KANBAN STAGE] Erro ao processar etapa %s: %s", cfg.get("stage_key"), stage_exc)

    except Exception as exc:
        logger.error("[KANBAN STAGES CRON] Erro geral: %s", exc)


def _automation_control_row() -> dict | None:
    """Lê a linha única da chave global (tabela automation_control, id=1)."""
    try:
        rows = _supabase_request("automation_control?id=eq.1&select=enabled,last_heartbeat")
        return rows[0] if rows else None
    except Exception:
        return None


def _automations_enabled() -> bool:
    """True só se a flag global estiver ligada. Sem linha ou sem leitura,
    trata como DESLIGADO (fail-closed: sem confirmação, sem disparo)."""
    row = _automation_control_row()
    if row is None:
        logger.warning("[CRON] automation_control sem linha id=1 ou ilegível — tratando como DESLIGADO.")
        return False
    return bool(row.get("enabled"))


def _automation_heartbeat() -> None:
    """Registra vida do processo a cada ciclo (mesmo pausado), para o
    endpoint /api/automations/status distinguir 'pausado' de 'morto'."""
    try:
        _supabase_request("automation_control?id=eq.1", method="PATCH", payload={"last_heartbeat": datetime.now(timezone.utc).isoformat()})
    except Exception as exc:
        logger.warning("[CRON] Falha ao registrar heartbeat: %s", exc)


def run_cycle():
    """Executa um ciclo completo de checagem das réguas."""
    try:
        # Chave global (31/10/2026): heartbeat primeiro (mesmo pausado),
        # depois a flag. Se desligada, aborta a varredura INTEIRA — nenhuma
        # régua (Kanban, cotação, pré/pós-viagem, perdido, reativação)
        # dispara mensagem ativa via Evolution. O atendimento em tempo
        # real não passa por aqui.
        _automation_heartbeat()
        if not _automations_enabled():
            logger.info("[CRON] Automações DESLIGADAS (flag) — ciclo abortado sem disparos.")
            return
        # Rotina de etapas parametrizadas do Kanban (todas as etapas ativas de kanban_stages_config)
        process_kanban_stages_config_automations()

        tenant_info = _get_tenant_info(TARGET_TENANT_ID)
        if not tenant_info:
            logger.warning("[CRON] Tenant %s não encontrado no banco.", TARGET_TENANT_ID)
            return

        automations = _get_stage_automations(TARGET_TENANT_ID)

        # 1. Cotação D+1
        process_cotacao_followups(TARGET_TENANT_ID, tenant_info, automations)

        # 2. Pré-viagem D-2
        process_pre_trip_reminders(TARGET_TENANT_ID, tenant_info, automations)

        # 3. Pós-viagem D+2
        process_post_trip_followups(TARGET_TENANT_ID, tenant_info, automations)

        # 4. Segunda Chance do Perdido (D+1)
        process_perdido_segunda_chance(TARGET_TENANT_ID, tenant_info, automations)

        # 5. Cadencia infinita de reativacao (Lead Real)
        process_reactivation_cadence(TARGET_TENANT_ID, tenant_info, automations)

    except Exception as exc:
        logger.error("[CRON CICLO] Erro geral: %s", exc, exc_info=True)


def main():
    logger.info("🚀 Iniciando cron_automations.py para Tenant %s (ESVC Turismo)", TARGET_TENANT_ID)

    if "--run-once" in sys.argv:
        logger.info("[CRON] Executando ciclo único (--run-once)...")
        run_cycle()
        logger.info("[CRON] Ciclo único concluído com sucesso.")
        return

    logger.info("[CRON] Modo contínuo iniciado. Intervalo: %d segundos.", POLL_INTERVAL_SECONDS)
    while True:
        run_cycle()
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
