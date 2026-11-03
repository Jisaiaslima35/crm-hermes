#!/usr/bin/env python3
"""
backfill_miner.py — Varre e minera o histórico recente de conversas
do CRM-Hermes com o mesmo Copiloto Invisível do webhook_server.py.

Reexecutável e idempotente:
- Lead update: UPDATE por id (idempotente por construção).
- Appointment:  SELECT id WHERE tenant+lead+day antes de inserir.
- Financial:    SELECT id WHERE tenant+lead+status='pendente' antes de inserir;
                bypassa a trava do 1111 SÓ quando --include-1111 estiver setado.
- Complaint:    SELECT id WHERE tenant+lead+source+severity antes de inserir.

Uso:
    python3 backfill_miner.py --tenant 1111 --days 10 --dry-run
    python3 backfill_miner.py --tenant both --days 10
    python3 backfill_miner.py --tenant 1111 --days 10 --include-1111 --yes

O 1111 (Dr. Matheus Dore) tem trava "JAMAIS tocado" no código original
(webhook_server.py:1891, 2122, 2191). Este script só libera essa trava
quando --include-1111 é explicitamente passado (autorização manual).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
import random
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

# Reaproveita o cliente Supabase + funções de LLM já carregadas
# pelo webhook_server.py (mesma conexão, mesma config).
import webhook_server as ws

logger = logging.getLogger("backfill_miner")

TZ_CLINICA = ws.TZ_CLINICA
sb = ws.sb


def _retry(fn, *, max_attempts: int = 5, base_delay: float = 1.5, label: str = "supabase"):
    """Executa `fn()` com retry exponencial. Usado em volta de chamadas
    PostgREST que derrubam HTTP/2 por carga (Server disconnected)."""
    last = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except Exception as e:
            last = e
            err_short = str(e)[:120]
            if attempt == max_attempts:
                logger.error("[%s] ❌ Falhou após %d tentativas: %s", label, max_attempts, err_short)
                raise
            delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
            logger.warning(
                "[%s] ⚠️  Tentativa %d/%d falhou (%s) — retry em %.1fs",
                label, attempt, max_attempts, err_short, delay,
            )
            time.sleep(delay)
    raise last  # unreachable, só pra satisfazer type checker

# ============================================================================
# Constantes
# ============================================================================

TENANT_DEMO = "33333333-3333-3333-3333-333333333333"
TENANT_MATHEUS = "11111111-1111-1111-1111-111111111111"
ALLOWED_TENANTS = {
    "1111": TENANT_MATHEUS,
    "3333": TENANT_DEMO,
    "both": None,  # expanded later
}

# Números internos da clínica (Dr., secretária, bot, Casa Zen).
# O minerador NUNCA cria appointment/financial/complaint/muda stage pra esses.
# Match exato após normalizar (só dígitos). NÃO use filtro genérico —
# se aparecer novo número da clínica, adicione aqui explicitamente.
INTERNAL_PHONES_RAW = [
    "558499666262", "55849666262",       # Dr. Matheus Dore (pessoal)
    "5584991367962", "558491367962",     # Ana Beatriz / Casa Zen
    "5584991821245", "558491821245",     # Bot da Clínica / conta de teste do Dr.
]
INTERNAL_PHONE_SET: set[str] = set(INTERNAL_PHONES_RAW)

# Fallback de valor quando consulta particular é agendada MAS nenhum
# valor foi citado na conversa. Era R$ 350; calibrado para R$ 300.
FALLBACK_PARTICULAR_VALUE = 300.0


def _phone_digits(phone: str | None) -> str:
    """Normaliza telefone pra só dígitos (sem + DDI, sem espaços, sem traços)."""
    if not phone:
        return ""
    return re.sub(r"\D", "", str(phone))


def is_internal_phone(phone: str | None) -> bool:
    """True se o telefone (já em dígitos) bate com algum número interno protegido."""
    return _phone_digits(phone) in INTERNAL_PHONE_SET

MINER_PROMPT = (
    "Você é um copiloto invisível e minerador silencioso de CRM médico/clínico.\n"
    "O atendimento no WhatsApp está sendo conduzido manualmente por pessoas reais (secretária e paciente).\n"
    "Sua ÚNICA missão é minerar o histórico recente da conversa e extrair um JSON estrito para atualizar o CRM.\n"
    "NUNCA crie respostas nem envie mensagens para o paciente.\n\n"
    "Responda EXCLUSIVAMENTE um objeto JSON no formato:\n"
    "{\n"
    '  "fase_funil": "novo_contato" | "em_atendimento" | "consulta_agendada" | "consulta_realizada" | "cancelou",\n'
    '  "data_agendamento": "YYYY-MM-DD HH:mm:ss" ou null,\n'
    '  "valor_estimado": float ou null,\n'
    '  "tipo_atendimento": "particular" | "convenio" | "retorno" | "outro",\n'
    '  "sentimento": "positivo" | "neutro" | "incidente_reclamacao",\n'
    '  "sintomas_ou_queixa": "string resumida",\n'
    '  "resumo_conversa": "string curta"\n'
    "}\n\n"
    "Regras de classificação:\n"
    "- 'fase_funil':\n"
    "  * 'consulta_agendada': data/horário de consulta pactuado ou agendamento confirmado.\n"
    "  * 'consulta_realizada': atendimento já finalizado ou retorno presencial/online pós-consulta.\n"
    "  * 'cancelou': paciente desistiu, cancelou, pediu estorno ou informou que não comparecerá.\n"
    "  * 'em_atendimento': diálogo sobre valores, horários, queixas ou dúvidas.\n"
    "  * 'novo_contato': primeira saudação sem desenvolvimento.\n"
    "- 'data_agendamento': formato 'YYYY-MM-DD HH:mm:ss' (ano corrente 2026) se houver data/hora definida, senão null.\n"
    "- 'valor_estimado': float se valor foi citado (ex: 300.0), senão null.\n"
    "- 'tipo_atendimento': 'particular', 'convenio', 'retorno' ou 'outro'.\n"
    "- 'sentimento': 'incidente_reclamacao' se houver qualquer revolta, grosseria, queixa de demora ou desrespeito; 'positivo' se elogio/agradecimento; 'neutro' para normal.\n"
    "- 'sintomas_ou_queixa': queixa clínica em 1 frase resumida.\n"
    "- 'resumo_conversa': síntese de 1 frase do status da conversa."
)

FASE_VALIDAS = {
    "novo_contato", "em_atendimento", "consulta_agendada",
    "consulta_realizada", "cancelou", "desistiu",
}
SENTIMENTO_VALIDOS = {"positivo", "neutro", "incidente_reclamacao"}
TIPO_VALIDOS = {"particular", "convenio", "retorno", "outro"}


# ============================================================================
# Funções auxiliares
# ============================================================================

def get_leads_with_recent_msgs(tenant_id: str, days: int) -> list[dict[str, Any]]:
    """Busca leads do tenant com ao menos 1 mensagem nos últimos N dias.

    Critério: lead com qualquer message.created_at >= now - days.
    Ordena por última mensagem (DESC) pra minerar os mais "quentes" primeiro.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_iso = cutoff.isoformat(timespec="seconds")

    # Pega todos os leads do tenant com paginação
    leads: list[dict[str, Any]] = []
    offset = 0
    page = 200
    while True:
        res = (
            sb.table("leads")
            .select("id, name, phone, stage, tenant_id, internal_notes, clinical_summary, insurance, created_at")
            .eq("tenant_id", tenant_id)
            .range(offset, offset + page - 1)
            .execute()
        )
        chunk = res.data or []
        leads.extend(chunk)
        if len(chunk) < page:
            break
        offset += page

    # Filtra só os que têm msg recente
    leads_com_movimento: list[dict[str, Any]] = []
    for lead in leads:
        last_msg = _retry(
            lambda lid=lead["id"]: sb.table("messages")
            .select("created_at")
            .eq("lead_id", lid)
            .order("created_at", desc=True)
            .limit(1)
            .execute(),
            label=f"history-check/{lead['id'][:8]}",
        )
        if last_msg.data:
            leads_com_movimento.append(lead)

    return leads_com_movimento


def get_recent_history(lead_id: str, limit: int = 15) -> list[dict[str, Any]]:
    """Últimas N mensagens do lead em ordem cronológica."""
    res = _retry(
        lambda: sb.table("messages")
        .select("sender, content, created_at")
        .eq("lead_id", lead_id)
        .order("created_at", desc=False)
        .limit(limit)
        .execute(),
        label=f"history/{lead_id[:8]}",
    )
    return res.data or []


def format_history_for_prompt(history: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for m in history:
        s = (m.get("sender") or "").lower()
        role = "Paciente" if s == "patient" else (
            "Secretária/Atendente" if s in ("human", "attendant", "user", "secretaria") else "IA"
        )
        content_str = (m.get("content") or "").strip()
        if content_str:
            lines.append(f"{role}: {content_str}")
    return "\n".join(lines[-12:])


def parse_mined_json(content: str) -> dict[str, Any]:
    if not content:
        return {}
    try:
        return json.loads(content)
    except Exception:
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
    return {}


def appointment_exists(tenant_id: str, lead_id: str, day_iso: str) -> bool:
    """Verifica se já existe appointment pro lead naquele dia."""
    day_start = day_iso[:10] + " 00:00:00-03:00"
    day_end = day_iso[:10] + " 23:59:59-03:00"
    res = (
        sb.table("appointments")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("lead_id", lead_id)
        .gte("start_time", day_start)
        .lte("start_time", day_end)
        .limit(1)
        .execute()
    )
    return bool(res.data)


def complaint_exists(tenant_id: str, lead_id: str, severity: str) -> bool:
    """Verifica se já existe complaint pro lead com mesma severidade."""
    res = (
        sb.table("customer_complaints")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("lead_id", lead_id)
        .eq("severity", severity)
        .limit(1)
        .execute()
    )
    return bool(res.data)


def pending_financial_exists(tenant_id: str, lead_id: str) -> bool:
    """Verifica se já existe financial pendente pro lead."""
    res = (
        sb.table("financial_entries")
        .select("id")
        .eq("tenant_id", tenant_id)
        .eq("lead_id", lead_id)
        .eq("status", "pendente")
        .limit(1)
        .execute()
    )
    return bool(res.data)


# ============================================================================
# Mineração de 1 lead
# ============================================================================

async def mine_one_lead(
    tenant_id: str,
    lead: dict[str, Any],
    *,
    dry_run: bool,
    include_1111: bool,
) -> dict[str, Any]:
    lead_id = lead["id"]
    name = lead.get("name") or lead.get("phone") or "Paciente"

    # Trava explícita 1111
    if tenant_id == TENANT_MATHEUS and not include_1111:
        return {
            "lead_id": lead_id,
            "name": name,
            "status": "skipped_1111_locked",
            "reason": "Tenant 1111 (Dr. Matheus) requer --include-1111 para minerar",
        }

    # Blindagem: números internos da clínica (Dr., secretária, bot, Casa Zen)
    # nunca devem ser minerados — conversa humana normal segue visível no Inbox.
    if is_internal_phone(lead.get("phone")):
        return {
            "lead_id": lead_id,
            "name": name,
            "status": "skipped_internal_phone",
            "reason": f"phone={_phone_digits(lead.get('phone'))} está na INTERNAL_PHONE_SET",
        }

    history = get_recent_history(lead_id, limit=15)
    if not history:
        return {"lead_id": lead_id, "name": name, "status": "skipped_no_messages"}

    history_text = format_history_for_prompt(history)
    if not history_text:
        return {"lead_id": lead_id, "name": name, "status": "skipped_empty_history"}

    # Chama LLM
    tenant_cfg = ws._get_tenant_config(tenant_id)
    target = ws._resolve_llm_target(tenant_cfg)
    if not target or not target.get("apiKey"):
        target = {
            "baseUrl": ws.NINEROUTER_BASE_URL.rstrip("/"),
            "model": ws.NINEROUTER_DEFAULT_MODEL,
            "apiKey": ws.NINEROUTER_API_KEY,
            "provider": "hermes_vps",
            "source": "hermes_vps",
        }

    content = ""
    try:
        content, _ = await ws._post_chat_completion(
            target,
            [
                {"role": "system", "content": MINER_PROMPT},
                {"role": "user", "content": f"Histórico:\n\n{history_text}\n\nExtraia o JSON:"},
            ],
            {"max_tokens": 400, "temperature": 0.1, "response_format": {"type": "json_object"}},
        )
    except Exception as e:
        # fallback 9router
        if target.get("source") != "hermes_vps":
            try:
                content, _ = await ws._post_chat_completion(
                    {
                        "baseUrl": ws.NINEROUTER_BASE_URL.rstrip("/"),
                        "model": ws.NINEROUTER_DEFAULT_MODEL,
                        "apiKey": ws.NINEROUTER_API_KEY,
                        "provider": "hermes_vps",
                        "source": "hermes_vps",
                    },
                    [
                        {"role": "system", "content": MINER_PROMPT},
                        {"role": "user", "content": f"Histórico:\n\n{history_text}\n\nExtraia o JSON:"},
                    ],
                    {"max_tokens": 400, "temperature": 0.1, "response_format": {"type": "json_object"}},
                )
            except Exception as e2:
                return {"lead_id": lead_id, "name": name, "status": "llm_error", "error": str(e2)[:200]}

    if not content:
        return {"lead_id": lead_id, "name": name, "status": "llm_empty"}

    data = parse_mined_json(content)
    if not data:
        return {"lead_id": lead_id, "name": name, "status": "llm_unparseable", "raw": content[:200]}

    # Monta ações
    now_iso = ws._now_iso()
    actions: list[str] = []

    fase = str(data.get("fase_funil") or "").strip().lower()
    sintomas = str(data.get("sintomas_ou_queixa") or "").strip()
    resumo = str(data.get("resumo_conversa") or "").strip()
    data_ag = data.get("data_agendamento")
    tipo = str(data.get("tipo_atendimento") or "").strip().lower()
    sentimento = str(data.get("sentimento") or "").strip().lower()
    val_est = data.get("valor_estimado")
    val_float: float | None = None
    if val_est is not None:
        try:
            val_float = float(val_est)
        except Exception:
            pass

    # 1) UPDATE leads
    lead_patch: dict[str, Any] = {"last_interaction": now_iso}
    if fase in FASE_VALIDAS:
        lead_patch["stage"] = fase
    if sintomas:
        lead_patch["clinical_summary"] = sintomas
    if data_ag and str(data_ag).lower() != "null":
        lead_patch["appointment_schedule"] = str(data_ag)
    if tipo in ("particular", "convenio"):
        lead_patch["insurance"] = tipo
    if sentimento == "incidente_reclamacao":
        lead_patch["priority"] = "urgente"
        curr_notes = lead.get("internal_notes") or ""
        if "[ALERTA_INCIDENTE]" not in curr_notes:
            lead_patch["internal_notes"] = (
                f"{curr_notes}\n[ALERTA_INCIDENTE] {resumo or sintomas}".strip()
            )

    if not dry_run:
        _retry(
            lambda: sb.table("leads").update(lead_patch).eq("id", lead_id).execute(),
            label=f"update-lead/{lead_id[:8]}",
        )
    actions.append(f"lead.update({list(lead_patch.keys())})")

    # 2) APPOINTMENT
    new_appt = False
    appt_skipped = None
    if data_ag and str(data_ag).lower() != "null":
        try:
            raw_dt = str(data_ag).replace("T", " ")
            dt_parsed = None
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
                try:
                    dt_parsed = datetime.strptime(raw_dt[:19], fmt)
                    break
                except Exception:
                    pass
            if dt_parsed:
                dt_local = dt_parsed.replace(tzinfo=TZ_CLINICA)
                start_iso = dt_local.isoformat()
                end_iso = (dt_local + timedelta(minutes=50)).isoformat()
                if appointment_exists(tenant_id, lead_id, start_iso):
                    appt_skipped = "já existe appointment nesse dia"
                else:
                    if not dry_run:
                        appt_payload = {
                            "tenant_id": tenant_id,
                            "lead_id": lead_id,
                            "title": f"Consulta: {name[:200]}",
                            "start_time": start_iso,
                            "end_time": end_iso,
                            "status": "agendado",
                            "specialty": tenant_cfg.get("specialty") or "Consulta",
                            "notes": f"[Backfill minerador] {sintomas or resumo}",
                            "source": "whatsapp",  # CHECK: manual|whatsapp|google_calendar
                            "created_at": now_iso,
                        }
                        _retry(
                            lambda: sb.table("appointments").insert(appt_payload).execute(),
                            label=f"insert-appt/{lead_id[:8]}",
                        )
                    new_appt = True
        except Exception as appt_err:
            appt_skipped = f"erro: {str(appt_err)[:120]}"

    # 3) COMPLAINT
    new_complaint = False
    complaint_skipped = None
    if sentimento == "incidente_reclamacao":
        if complaint_exists(tenant_id, lead_id, "critica"):
            complaint_skipped = "já existe complaint crítica"
        else:
            if not dry_run:
                # Mapear texto livre → enum reason do CHECK
                low = (sintomas or "").lower() + " " + (resumo or "").lower()
                if "demora" in low or "atraso" in low or "espera" in low:
                    reason_enum = "demora_atendimento"
                elif "preço" in low or "preco" in low or "caro" in low or "valor alto" in low:
                    reason_enum = "preco_alto"
                elif "ofensa" in low or "grosse" in low or "desrespei" in low or "mal educa" in low:
                    reason_enum = "ofensa_verbal"
                elif "cancel" in low or "desist" in low:
                    reason_enum = "cancelamento"
                else:
                    reason_enum = "insatisfacao_geral"
                comp_payload = {
                    "tenant_id": tenant_id,
                    "lead_id": lead_id,
                    "client_name": name[:255],
                    "reason": reason_enum,  # CHECK enum (não free text)
                    "severity": "critica",
                    "snippet": (history_text or "")[-400:],
                    "status": "pendente",
                    "source": "whatsapp",  # CHECK: whatsapp|manual|radar_silencio
                    "created_at": now_iso,
                }
                _retry(
                    lambda: sb.table("customer_complaints").insert(comp_payload).execute(),
                    label=f"insert-complaint/{lead_id[:8]}",
                )
            new_complaint = True

    # 4) FINANCIAL
    new_financial = False
    financial_skipped = None
    if fase == "consulta_agendada":
        if tenant_id == TENANT_MATHEUS and not include_1111:
            financial_skipped = "1111 bloqueado"
        elif pending_financial_exists(tenant_id, lead_id):
            financial_skipped = "já existe financial pendente"
        else:
            amount = val_float if (val_float and val_float > 0) else FALLBACK_PARTICULAR_VALUE
            if not dry_run:
                # CHECK category enum: clinica_particular|convenio|previdenciario_inss|laudo_pericial
                cat = "clinica_particular" if tipo != "convenio" else "convenio"
                fin_payload = {
                    "tenant_id": tenant_id,
                    "lead_id": lead_id,
                    "client_name": name[:255],
                    "amount": amount,
                    "category": cat,
                    "service_type": "consulta_psiquiatrica" if (tenant_cfg.get("specialty") or "").lower().find("psiquiat") >= 0 else "consulta",
                    "payment_method": "pix",
                    "status": "pendente",
                    "notes": "[Backfill minerador] Agendamento detectado em conversa histórica.",
                    "created_at": now_iso,
                }
                _retry(
                    lambda: sb.table("financial_entries").insert(fin_payload).execute(),
                    label=f"insert-fin/{lead_id[:8]}",
                )
            new_financial = True

    return {
        "lead_id": lead_id,
        "name": name,
        "status": "ok" if not dry_run else "dry_run",
        "extracted": {
            "fase": fase,
            "data_agendamento": str(data_ag) if data_ag else None,
            "valor_estimado": val_float,
            "tipo": tipo,
            "sentimento": sentimento,
            "sintomas": sintomas[:100] if sintomas else None,
        },
        "actions": actions,
        "appointment": "inserted" if new_appt else appt_skipped or "skipped",
        "complaint": "inserted" if new_complaint else complaint_skipped or "skipped",
        "financial": "inserted" if new_financial else financial_skipped or "skipped",
    }


# ============================================================================
# Main
# ============================================================================

async def main():
    parser = argparse.ArgumentParser(description="Backfill minerador silencioso")
    parser.add_argument("--tenant", choices=["1111", "3333", "both"], default="both")
    parser.add_argument("--days", type=int, default=10, help="Janela em dias (default 10)")
    parser.add_argument("--limit", type=int, default=0, help="Limite de leads (0=todos)")
    parser.add_argument("--dry-run", action="store_true", help="Não persiste, só mostra o extrato")
    parser.add_argument("--include-1111", action="store_true", help="Libera a trava do tenant 1111 (Dr. Matheus)")
    parser.add_argument("--yes", action="store_true", help="Pula confirmação interativa")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    if args.tenant in ("1111", "both") and not args.include_1111 and not args.dry_run:
        print("=" * 60)
        print("ATENÇÃO: tenant 1111 (Dr. Matheus Dore) tem trava 'JAMAIS tocado'.")
        print("Para minerar dados REAIS do 1111, é necessário passar --include-1111.")
        print("Sem essa flag, o script vai SKIPPAR todos os leads do 1111.")
        print("=" * 60)
        if not args.yes:
            resp = input("Quer continuar apenas com o 3333? (s/n): ").strip().lower()
            if resp != "s":
                print("Abortado.")
                sys.exit(0)
        else:
            print("--yes setado, prosseguindo apenas com 3333 (1111 será pulado).")

    tenants: list[str] = []
    if args.tenant in ("1111", "both"):
        tenants.append(TENANT_MATHEUS)
    if args.tenant in ("3333", "both"):
        tenants.append(TENANT_DEMO)

    summary: dict[str, Any] = {
        "tenants": tenants,
        "days": args.days,
        "dry_run": args.dry_run,
        "include_1111": args.include_1111,
        "results": [],
    }

    for tenant_id in tenants:
        tname = "Dr. Matheus (1111)" if tenant_id == TENANT_MATHEUS else "Demo (3333)"
        print(f"\n{'=' * 60}\nTENANT: {tname}\n{'=' * 60}")
        leads = get_leads_with_recent_msgs(tenant_id, args.days)
        if args.limit > 0:
            leads = leads[: args.limit]
        print(f"Leads com mensagens nos últimos {args.days} dias: {len(leads)}")

        tenant_stats = {
            "tenant": tname,
            "leads_mined": 0,
            "appointments_new": 0,
            "appointments_skipped": 0,
            "financials_new": 0,
            "financials_skipped": 0,
            "complaints_new": 0,
            "complaints_skipped": 0,
            "errors": 0,
            "total_value": 0.0,
        }

        for i, lead in enumerate(leads, 1):
            r = await mine_one_lead(
                tenant_id, lead,
                dry_run=args.dry_run,
                include_1111=args.include_1111,
            )
            status = r.get("status")
            name = r.get("name", "?")
            if status in ("ok", "dry_run"):
                tenant_stats["leads_mined"] += 1
                if r.get("appointment") == "inserted":
                    tenant_stats["appointments_new"] += 1
                elif r.get("appointment", "").startswith(("já existe", "1111")):
                    tenant_stats["appointments_skipped"] += 1
                if r.get("complaint") == "inserted":
                    tenant_stats["complaints_new"] += 1
                elif r.get("complaint", "").startswith("já existe"):
                    tenant_stats["complaints_skipped"] += 1
                if r.get("financial") == "inserted":
                    tenant_stats["financials_new"] += 1
                    ext = r.get("extracted", {})
                    v = ext.get("valor_estimado") or 0
                    tenant_stats["total_value"] += float(v) if v else 350.0
                elif r.get("financial", "").startswith(("já existe", "1111")):
                    tenant_stats["financials_skipped"] += 1
                print(
                    f"  [{i}/{len(leads)}] {name[:30]:30s} "
                    f"fase={r['extracted']['fase']:22s} "
                    f"appt={r['appointment'][:15]:15s} "
                    f"fin={r['financial'][:15]:15s} "
                    f"compl={r['complaint'][:15]:15s}"
                )
            elif status == "skipped_1111_locked":
                print(f"  [{i}/{len(leads)}] {name[:30]:30s} SKIP (1111 lockado)")
            elif status == "skipped_internal_phone":
                print(f"  [{i}/{len(leads)}] {name[:30]:30s} SKIP (número interno protegido)")
            elif status in ("llm_error", "llm_empty", "llm_unparseable"):
                tenant_stats["errors"] += 1
                print(f"  [{i}/{len(leads)}] {name[:30]:30s} ERRO: {status} - {r.get('error', r.get('raw', ''))[:80]}")
            else:
                print(f"  [{i}/{len(leads)}] {name[:30]:30s} SKIP ({status})")

            summary["results"].append(r)

            # rate limit gentil
            await asyncio.sleep(0.3)

        print(f"\n  RESUMO {tname}:")
        print(f"    Leads minerados:       {tenant_stats['leads_mined']}")
        print(f"    Appointments novos:    {tenant_stats['appointments_new']} (pulados: {tenant_stats['appointments_skipped']})")
        print(f"    Financials novos:      {tenant_stats['financials_new']} (pulados: {tenant_stats['financials_skipped']})")
        print(f"    Valor total lançado:   R$ {tenant_stats['total_value']:.2f}")
        print(f"    Complaints novos:      {tenant_stats['complaints_new']} (pulados: {tenant_stats['complaints_skipped']})")
        print(f"    Erros LLM:             {tenant_stats['errors']}")
        summary[f"stats_{tenant_id}"] = tenant_stats

    print("\n" + "=" * 60)
    print("RESUMO FINAL")
    print("=" * 60)
    if args.dry_run:
        print("MODO DRY-RUN: nada foi persistido. Use sem --dry-run pra efetivar.")
    else:
        print("PERSISTIDO no Supabase.")
    print(f"Total leads minerados: {sum(s['leads_mined'] for k, s in summary.items() if k.startswith('stats_'))}")
    print(f"Total appointments:    {sum(s['appointments_new'] for k, s in summary.items() if k.startswith('stats_'))}")
    print(f"Total financials:      {sum(s['financials_new'] for k, s in summary.items() if k.startswith('stats_'))}")
    print(f"Total value:           R$ {sum(s['total_value'] for k, s in summary.items() if k.startswith('stats_')):.2f}")
    print(f"Total complaints:      {sum(s['complaints_new'] for k, s in summary.items() if k.startswith('stats_'))}")


if __name__ == "__main__":
    asyncio.run(main())
