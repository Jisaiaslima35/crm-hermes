"""
webhook_server.py — CRM-Hermes Evolution webhook receiver + IA dispatch.

Endurecido pra:
- aceitar Evolution v2 (messages.upsert / connection.update / messages.update / send_message)
- identificar tenant via evolution_instance
- identificar/criar lead por phone
- gravar mensagem em public.messages
- quando handoff_state='ai' e msg inbound, despachar pro LLM (9router),
  responder no WhatsApp via Evolution sendText e gravar a resposta como 'bot'
- detectar intenção e atualizar stage do lead
- fazer fan-out pro Mendes CRM (wacrm.automacaojs.us) pra manter compatibilidade

Boot:  uvicorn webhook_server:app --host 0.0.0.0 --port 3010
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from supabase import Client, create_client

# ============================================================================
# Bootstrap
# ============================================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Carrega .env do projeto (URLs, ANON key) + cofre Hermes (chaves LLM/Evolution)
load_dotenv(os.path.join(BASE_DIR, ".env"))
for _secret in ("9router.env", "evolution.env"):
    _p = os.path.join("/root/.hermes/secrets", _secret)
    if os.path.exists(_p):
        load_dotenv(_p, override=False)

SUPABASE_URL = os.environ["VITE_SUPABASE_URL"]
SUPABASE_KEY = os.environ["VITE_SUPABASE_ANON_KEY"]
MENDES_WEBHOOK_URL = "https://wacrm.automacaojs.us/api/whatsapp/webhook/evolution"

# 9router (LLM gateway OpenAI-compat)
NINEROUTER_API_KEY = os.environ.get("NINEROUTER_API_KEY", "")
NINEROUTER_BASE_URL = os.environ.get(
    "NINEROUTER_BASE_URL", "https://9router.automacaojs.us/v1"
)
# Modelo fixo: Hermes-fallbacks é o roteador inteligente do 9router que
# escolhe o melhor provider disponível. O default no .env da VPS aponta
# pra cerebras/llama-3.3-70b que tá arquivado, então forçamos aqui.
NINEROUTER_DEFAULT_MODEL = "Hermes-fallbacks"

# Evolution API (WhatsApp bridge)
EVOLUTION_API_KEY = os.environ.get("EVOLUTION_API_KEY", "")
EVOLUTION_BASE_URL = os.environ.get(
    "EVOLUTION_BASE_URL", "https://evo.automacaojs.us"
)

# Cliente Supabase (REST; o schema expõe leads/messages com anon key)
sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Cache em memória: evolution_instance -> tenant_id (uuid)
_TENANT_BY_INSTANCE: dict[str, str] = {}
_TENANT_CFG_CACHE: dict[str, dict[str, Any]] = {}

# Heurística de mudança de stage (palavras-chave em PT-BR, lowercase)
_STAGE_KEYWORDS: dict[str, list[str]] = {
    "consulta_agendada": [
        "agendar", "agenda", "marcar", "consulta marcada",
        "horário disponível", "horario disponivel", "reservado",
        "quinta às", "sexta às", "pode ser quinta", "confirmad",
    ],
    "falar_pessoalmente": [
        "emergência", "emergencia", "dor no peito", "socorro",
        "sangrando", "desmaio", "desmaiei", "infarto",
        "muito urgente", "preciso falar com",
    ],
}
logger = logging.getLogger("crm-hermes.webhook")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _normalize_phone(digits: str) -> str:
    """Mantém só dígitos; Evolution manda formatos variados."""
    return re.sub(r"\D", "", digits or "")


def _resolve_tenant_id(instance_name: str) -> Optional[str]:
    if not instance_name:
        return None
    if instance_name in _TENANT_BY_INSTANCE:
        return _TENANT_BY_INSTANCE[instance_name]
    res = (
        sb.table("tenants")
        .select("id")
        .eq("evolution_instance", instance_name)
        .limit(1)
        .execute()
    )
    if res.data:
        tid = res.data[0]["id"]
        _TENANT_BY_INSTANCE[instance_name] = tid
        return tid
    return None


def _get_tenant_config(tenant_id: str) -> dict[str, Any]:
    """Busca config da clínica (nome, especialidade, doctor_name) pra montar prompt."""
    if tenant_id in _TENANT_CFG_CACHE:
        return _TENANT_CFG_CACHE[tenant_id]
    res = (
        sb.table("tenants")
        .select("name, specialty, doctor_name, city, ai_mode")
        .eq("id", tenant_id)
        .limit(1)
        .execute()
    )
    cfg = res.data[0] if res.data else {}
    cfg = {
        "name": cfg.get("name") or "Clínica",
        "specialty": cfg.get("specialty") or "Saúde",
        "doctor_name": cfg.get("doctor_name") or "Dr(a)",
        "city": cfg.get("city") or "",
        "ai_mode": cfg.get("ai_mode") or "hermes_vps",
    }
    _TENANT_CFG_CACHE[tenant_id] = cfg
    return cfg


def _get_or_create_lead(
    tenant_id: str, phone: str, push_name: str
) -> Optional[dict[str, Any]]:
    """Procura lead por (tenant_id, phone). Se não achar, cria."""
    if not phone:
        return None
    res = (
        sb.table("leads")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("phone", phone)
        .limit(1)
        .execute()
    )
    if res.data:
        sb.table("leads").update({"last_interaction": _now_iso()}).eq(
            "id", res.data[0]["id"]
        ).execute()
        return res.data[0]
    insert = (
        sb.table("leads")
        .insert(
            {
                "tenant_id": tenant_id,
                "phone": phone,
                "name": push_name or "Contato WhatsApp",
                "stage": "novo_contato",
                "ai_active": True,
                "handoff_state": "ai",
                "insurance": "Particular",
                "priority": "NORMAL",
                "clinical_summary": "",
            }
        )
        .execute()
    )
    return insert.data[0] if insert.data else None


def _extract_text(data: dict[str, Any]) -> str:
    msg = data.get("message") or {}
    if isinstance(msg, dict):
        if msg.get("conversation"):
            return msg["conversation"]
        ext = msg.get("extendedTextMessage") or {}
        if ext.get("text"):
            return ext["text"]
        img = msg.get("imageMessage") or {}
        if img.get("caption"):
            return img["caption"]
        doc = msg.get("documentMessage") or {}
        if doc.get("caption"):
            return doc["caption"]
    return ""


def _extract_message(event: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """Normaliza um payload Evolution pra {sender, sender_name, content, ts, phone, from_me}."""
    if event != "messages.upsert" and event != "messages_update":
        return None
    key = data.get("key") or {}
    raw_remote = key.get("remoteJid") or ""
    phone = _normalize_phone(raw_remote.split("@")[0])
    if not phone:
        return None

    push_name = data.get("pushName") or ""
    message_ts = data.get("messageTimestamp")
    ts = (
        datetime.fromtimestamp(int(message_ts), tz=timezone.utc).isoformat(
            timespec="seconds"
        )
        if message_ts
        else _now_iso()
    )
    text = _extract_text(data)

    sender = "patient"
    if key.get("fromMe"):
        sender = "human"

    msg_type = (data.get("messageType") or "").lower()
    if msg_type in {"ai_response", "bot_response", "ai", "bot"}:
        sender = "ai"

    if not text:
        text = f"[{msg_type or 'mensagem'}]"

    return {
        "phone": phone,
        "sender": sender,
        "sender_name": push_name or ("Eu" if sender == "human" else ""),
        "content": text,
        "ts": ts,
        "from_me": bool(key.get("fromMe")),
        "message_type": msg_type or "conversation",
    }


def _detect_stage(text: str) -> Optional[str]:
    """Heurística simples: palavra-chave na mensagem do paciente → muda stage."""
    t = text.lower()
    for stage, kws in _STAGE_KEYWORDS.items():
        for kw in kws:
            if kw in t:
                return stage
    return None


async def _fetch_recent_history(
    lead_id: str, limit: int = 20
) -> list[dict[str, Any]]:
    """Busca histórico recente (últimas N mensagens) do lead."""
    res = (
        sb.table("messages")
        .select("sender, content, created_at")
        .eq("lead_id", lead_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    # OpenAI espera ordem cronológica (antigas → novas)
    return list(reversed(res.data or []))


def _build_system_prompt(tenant_cfg: dict[str, Any], lead: dict[str, Any]) -> str:
    """Monta o system prompt da persona IA a partir do tenant + contexto do lead."""
    name = tenant_cfg["name"]
    specialty = tenant_cfg["specialty"]
    doctor = tenant_cfg["doctor_name"]
    lead_name = lead.get("name") or "paciente"
    insurance = lead.get("insurance") or "Particular"
    stage = lead.get("stage") or "novo_contato"

    return (
        f"Você é a assistente clínica oficial de WhatsApp da {name} "
        f"(especialidade: {specialty}, responsável: {doctor}). "
        f"Atende em PT-BR com tom acolhedor e profissional.\n\n"
        f"Contexto do paciente:\n"
        f"- Nome: {lead_name}\n"
        f"- Convênio: {insurance}\n"
        f"- Estágio atual no funil: {stage}\n\n"
        f"Diretrizes:\n"
        f"1. Faça triagem empática e identifique a queixa principal.\n"
        f"2. Se houver sinais de emergência (dor no peito irradiando, desmaio, "
        f"sangramento intenso), alerte imediatamente para procurar pronto-socorro "
        f"e marque como caso urgente.\n"
        f"3. Para casos eletivos, pergunte convênio, ofereça horários de consulta/exames "
        f"e tente fechar o agendamento.\n"
        f"4. Seja concisa (máximo 3-4 frases por mensagem). Não invente preços nem horários.\n"
        f"5. Se o paciente pedir para falar com humano, ofereça a opção.\n"
        f"6. Sempre termine perguntando se pode ajudar em algo mais."
    )


async def _call_llm(
    system_prompt: str, history: list[dict[str, Any]], patient_msg: str
) -> str:
    """POST OpenAI-compat pra 9router (texto puro). Mantido pra compat."""
    if not NINEROUTER_API_KEY:
        return ""
    messages = [{"role": "system", "content": system_prompt}]
    for m in history:
        role = "assistant" if m["sender"] in ("ai", "bot") else "user"
        # patient e human viram user; IA/bot vira assistant
        messages.append({"role": role, "content": m["content"]})
    if not messages or messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": patient_msg})

    payload = {
        "model": NINEROUTER_DEFAULT_MODEL,
        "messages": messages,
        "max_tokens": 500,
        "temperature": 0.7,
        "stream": False,
        # reasoning low evita o bug "tokens gastos em raciocínio, content vazio"
        # (vide skill postgrest-cache-reload + project-leitor-p81-quiz-revisao)
        "reasoning": {"effort": "low"},
    }
    headers = {
        "Authorization": f"Bearer {NINEROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            f"{NINEROUTER_BASE_URL.rstrip('/')}/chat/completions",
            json=payload,
            headers=headers,
        )
        r.raise_for_status()
        data = r.json()
    return (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()


# System prompt extra que pede JSON estruturado pro LLM. Mantido separado
# do prompt "humano" pra que a triagem não fique poluída com regras de schema.
_STRUCTURED_OUTPUT_INSTRUCTIONS = (
    "\n\nIMPORTANTE — Formato de saída: responda EXCLUSIVAMENTE com um objeto JSON "
    "válido (sem markdown, sem ```), com os campos:\n"
    '  "reply": string com a resposta ao paciente em PT-BR (tom acolhedor, máx 3-4 frases),\n'
    '  "clinical_summary": string com a queixa principal consolidada em 1-2 frases '
    '(vazia "" se nada novo a acrescentar),\n'
    '  "symptoms": array de strings com sintomas/achados detectados nesta conversa '
    '(vazio [] se nenhum novo). Cada item curto (1-3 palavras).\n'
    'Responda SOMENTE o JSON. Sem texto antes/depois.'
)


async def _call_llm_structured(
    system_prompt: str,
    history: list[dict[str, Any]],
    patient_msg: str,
) -> dict[str, Any]:
    """Versão estruturada: força JSON {reply, clinical_summary, symptoms}.

    Fallback: se o provider não suportar response_format json_object, usa
    instrução por prompt + tenta parsear; se quebrar, devolve dict com
    reply="" e marca de erro pra que o caller degrade com segurança.
    """
    empty = {"reply": "", "clinical_summary": "", "symptoms": [], "ok": False}
    if not NINEROUTER_API_KEY:
        return empty

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt + _STRUCTURED_OUTPUT_INSTRUCTIONS}
    ]
    for m in history:
        role = "assistant" if m["sender"] in ("ai", "bot") else "user"
        messages.append({"role": role, "content": m["content"]})
    if not messages or messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": patient_msg})

    payload = {
        "model": NINEROUTER_DEFAULT_MODEL,
        "messages": messages,
        "max_tokens": 700,
        "temperature": 0.5,
        "stream": False,
        "reasoning": {"effort": "low"},
        # Força JSON via OpenAI-compat (a maioria dos providers via 9router aceita).
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {NINEROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                f"{NINEROUTER_BASE_URL.rstrip('/')}/chat/completions",
                json=payload,
                headers=headers,
            )
            r.raise_for_status()
            data = r.json()
        content = (
            (data.get("choices") or [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )
        if not content:
            return empty
        # Alguns providers devolvem o JSON dentro de ```json ... ``` mesmo
        # com response_format; tolerância best-effort.
        if content.startswith("```"):
            content = re.sub(r"^```(?:json)?\s*", "", content)
            content = re.sub(r"\s*```\s*$", "", content)
        parsed = json.loads(content)
        reply = str(parsed.get("reply") or "").strip()
        clinical_summary = str(parsed.get("clinical_summary") or "").strip()
        raw_symptoms = parsed.get("symptoms") or []
        if not isinstance(raw_symptoms, list):
            raw_symptoms = []
        symptoms = [str(s).strip() for s in raw_symptoms if str(s).strip()]
        return {
            "reply": reply,
            "clinical_summary": clinical_summary,
            "symptoms": symptoms,
            "ok": True,
        }
    except Exception as exc:
        logger.warning("_call_llm_structured falhou: %s", exc)
        return empty


async def _send_evolution_text(
    instance: str, phone: str, text: str
) -> dict[str, Any]:
    """POST Evolution /message/sendText/{instance}."""
    if not EVOLUTION_API_KEY:
        return {"ok": False, "reason": "no_api_key"}
    headers = {"apikey": EVOLUTION_API_KEY}
    payload = {"number": phone, "text": text}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            f"{EVOLUTION_BASE_URL.rstrip('/')}/message/sendText/{instance}",
            json=payload,
            headers=headers,
        )
        try:
            return {"ok": r.status_code < 400, "status": r.status_code, "body": r.json()}
        except Exception:
            return {"ok": r.status_code < 400, "status": r.status_code, "body": r.text}


async def _dispatch_ai(
    tenant_id: str,
    lead: dict[str, Any],
    patient_text: str,
    instance: str,
) -> None:
    """Motor IA: gera resposta → envia WhatsApp → grava messages → atualiza stage.

    Quando o provider suportar JSON estruturado, extrai também a queixa principal
    consolidada e os sintomas detectados, persistindo em leads.clinical_summary
    e leads.symptoms. Falha na extração não derruba o envio da resposta.
    """
    try:
        tenant_cfg = _get_tenant_config(tenant_id)
        history = await _fetch_recent_history(lead["id"], limit=20)
        system_prompt = _build_system_prompt(tenant_cfg, lead)

        # 1. LLM estruturado: tenta extrair {reply, clinical_summary, symptoms}
        structured = await _call_llm_structured(system_prompt, history, patient_text)
        ai_reply = structured.get("reply") or ""
        if not ai_reply:
            # Fallback: degrada pra chamada de texto puro
            logger.info(
                "[%s] structured vazio, caindo no _call_llm texto puro",
                instance,
            )
            ai_reply = await _call_llm(system_prompt, history, patient_text)
        if not ai_reply:
            logger.warning("[%s] IA sem resposta, abortando dispatch", instance)
            return

        # 2. Envia WhatsApp
        send_result = await _send_evolution_text(instance, lead["phone"], ai_reply)
        logger.info(
            "[%s] IA sendText ok=%s status=%s",
            instance,
            send_result.get("ok"),
            send_result.get("status"),
        )

        # 3. Grava resposta em messages (sender='ai' = bot)
        sb.table("messages").insert(
            {
                "tenant_id": tenant_id,
                "lead_id": lead["id"],
                "sender": "ai",
                "content": ai_reply,
                "created_at": _now_iso(),
            }
        ).execute()

        # 4. Persiste extração estruturada em leads (queixa + sintomas)
        new_clinical = structured.get("clinical_summary") or ""
        new_symptoms = structured.get("symptoms") or []
        if new_clinical or new_symptoms:
            patch: dict[str, Any] = {"last_interaction": _now_iso()}
            if new_clinical:
                patch["clinical_summary"] = new_clinical
            if new_symptoms:
                # Merge: união de sintomas antigos + novos (sem duplicatas)
                existing = lead.get("symptoms") or []
                if isinstance(existing, str):
                    try:
                        existing = json.loads(existing)
                    except Exception:
                        existing = []
                if not isinstance(existing, list):
                    existing = []
                merged = list(existing)
                for s in new_symptoms:
                    if s and s not in merged:
                        merged.append(s)
                patch["symptoms"] = merged
            try:
                sb.table("leads").update(patch).eq("id", lead["id"]).execute()
                logger.info(
                    "[%s] lead %s clin=%d chars, symptoms=%d",
                    instance,
                    lead["id"],
                    len(new_clinical),
                    len(patch.get("symptoms") or []),
                )
            except Exception as exc:
                logger.warning(
                    "[%s] falha ao persistir extração estruturada: %s",
                    instance,
                    exc,
                )

        # 5. Atualiza stage se heurística detectar intenção
        new_stage = _detect_stage(patient_text)
        if new_stage and new_stage != lead.get("stage"):
            sb.table("leads").update(
                {
                    "stage": new_stage,
                    "last_interaction": _now_iso(),
                }
            ).eq("id", lead["id"]).execute()
            logger.info(
                "[%s] lead %s stage %s → %s",
                instance,
                lead["id"],
                lead.get("stage"),
                new_stage,
            )
    except Exception as exc:
        logger.exception("[%s] _dispatch_ai falhou: %s", instance, exc)


# ============================================================================
# App
# ============================================================================

app = FastAPI(title="CRM-Hermes webhook receiver", version="1.1.0")


@app.get("/")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "crm-hermes-webhook",
        "tenants_cached": len(_TENANT_BY_INSTANCE),
        "llm_configured": bool(NINEROUTER_API_KEY),
        "evolution_configured": bool(EVOLUTION_API_KEY),
        "ts": _now_iso(),
    }


@app.post("/webhook/evolution/{instance}")
async def evolution_webhook(
    instance: str,
    request: Request,
    background: BackgroundTasks,
    apikey: str | None = Header(default=None),
) -> dict[str, Any]:
    body_bytes = await request.body()
    try:
        payload = json.loads(body_bytes) if body_bytes else {}
    except json.JSONDecodeError:
        logger.warning("[%s] payload não-JSON: %r", instance, body_bytes[:120])
        raise HTTPException(status_code=400, detail="invalid json")

    event = payload.get("event") or "unknown"
    data = payload.get("data") or {}
    logger.info(
        "[%s] event=%s messageType=%s fromMe=%s",
        instance,
        event,
        data.get("messageType"),
        (data.get("key") or {}).get("fromMe"),
    )

    # 1. Resolve tenant
    tenant_id = _resolve_tenant_id(instance)
    if not tenant_id:
        logger.warning("[%s] sem tenant mapeado pro instance, ignorando", instance)
        background.add_task(_fanout, instance, payload)
        return {"ok": True, "tenant_resolved": False}

    # 2. Extrai mensagem (se houver)
    extracted = _extract_message(event, data)
    if extracted is None:
        background.add_task(_fanout, instance, payload)
        return {"ok": True, "event": event, "stored": False}

    # 3. Resolve/cria lead
    lead = _get_or_create_lead(
        tenant_id, extracted["phone"], extracted["sender_name"]
    )
    if not lead:
        background.add_task(_fanout, instance, payload)
        return {"ok": True, "lead_missing": True}

    # 4. Grava mensagem do paciente/humano
    insert_payload = {
        "tenant_id": tenant_id,
        "lead_id": lead["id"],
        "sender": extracted["sender"],
        "content": extracted["content"],
        "created_at": extracted["ts"],
    }
    res = sb.table("messages").insert(insert_payload).execute()
    ok = bool(res.data)
    logger.info(
        "[%s] stored=%s sender=%s phone=%s",
        instance,
        ok,
        extracted["sender"],
        extracted["phone"],
    )

    # 5. Dispara motor IA (apenas inbound de paciente + handoff_state='ai')
    if (
        ok
        and not extracted["from_me"]
        and extracted["sender"] == "patient"
        and (lead.get("handoff_state") or "ai") == "ai"
    ):
        background.add_task(
            _dispatch_ai, tenant_id, lead, extracted["content"], instance
        )

    # 6. Fan-out pro Mendes CRM
    background.add_task(_fanout, instance, payload)

    return {
        "ok": ok,
        "event": event,
        "stored": ok,
        "tenant_id": tenant_id,
        "lead_id": lead["id"],
        "message_id": res.data[0]["id"] if res.data else None,
        "ai_dispatched": (
            ok
            and not extracted["from_me"]
            and extracted["sender"] == "patient"
            and (lead.get("handoff_state") or "ai") == "ai"
        ),
    }


async def _fanout(instance: str, payload: dict[str, Any]) -> None:
    """Re-envia o payload pro Mendes CRM pra preservar compatibilidade."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                f"{MENDES_WEBHOOK_URL.rstrip('/')}/{instance}",
                json=payload,
            )
            logger.info("fan-out Mendes HTTP %s", r.status_code)
    except Exception as exc:
        logger.warning("fan-out Mendes falhou: %s", exc)
