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
from fastapi.middleware.cors import CORSMiddleware
from supabase import Client, create_client

# ============================================================================
# Bootstrap
# ============================================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Carrega .env do projeto (URLs, ANON key) + cofre Hermes (chaves LLM/Evolution/Composio)
load_dotenv(os.path.join(BASE_DIR, ".env"))
for _secret in ("9router.env", "evolution.env", "composio.env"):
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

# Hermes Gateway do perfil dedicado (estilo Professor IA do Leitor).
# Quando um tenant tem `hermes_gateway_url` preenchido (ex.: perfil
# dr-matheus-dore em http://127.0.0.1:8642), o webhook roteia por ali
# em vez de ir direto ao 9router/BYOK. O gateway expõe OpenAI-compat
# em /v1/chat/completions com Bearer API_SERVER_KEY.
HERMES_GATEWAY_API_KEY = os.environ.get("HERMES_GATEWAY_API_KEY", "hermes-isaias-2026")
HERMES_GATEWAY_MODEL = os.environ.get("HERMES_GATEWAY_MODEL", "hermes-agent")
# Timeout mais curto: se o gateway cair, queremos fallback rápido pro 9router.
HERMES_GATEWAY_TIMEOUT_S = float(os.environ.get("HERMES_GATEWAY_TIMEOUT_S", "8"))

# Evolution API (WhatsApp bridge)
EVOLUTION_API_KEY = os.environ.get("EVOLUTION_API_KEY", "")
EVOLUTION_BASE_URL = os.environ.get(
    "EVOLUTION_BASE_URL", "https://evo.automacaojs.us"
)

# ============================================================================
# Composio (OAuth Connect Links para Google Calendar, Sheets, etc.)
# ============================================================================
COMPOSIO_API_KEY = os.environ.get("COMPOSIO_API_KEY", "")
COMPOSIO_BASE_URL = os.environ.get(
    "COMPOSIO_BASE_URL", "https://backend.composio.dev/api/v3"
)

# auth_config_id por toolkit (Composio-managed OAUTH2).
# Adicione novos toolkits aqui conforme a clínica for pedindo.
COMPOSIO_AUTH_CONFIG_IDS: dict[str, str] = {
    "googlecalendar": os.environ.get(
        "COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR", "ac_qs9qZemxzy_7"
    ),
    "googlesheets": os.environ.get(
        "COMPOSIO_AUTH_CONFIG_GOOGLESHEETS", "ac_EtaJ5UsM993u"
    ),
}

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
        "amanhã às", "amanha as", "próxima semana", "proxima semana",
    ],
    "falar_pessoalmente": [
        # Gatilhos de transbordo humano (Prioridade 1 — kill-switch da IA)
        "humano", "pessoalmente", "atendente", "pessoa",
        "falar com médico", "falar com medico", "falar com alguém",
        "falar com alguem", "atendimento pessoal", "atendimento humano",
        "me liga", "me liga então", "prefiro falar",
        # Emergência clínica grave
        "emergência", "emergencia", "dor no peito", "socorro",
        "sangrando", "sangramento", "desmaio", "desmaiei", "infarto",
        "avc", "muito urgente", "preciso falar com",
        "não tô bem", "nao to bem", "passando mal", "tô passando mal",
    ],
}

# Detecção de fase por prioridade:
#   1. falar_pessoalmente (humano/transbordo) → handoff_state='human'
#   2. consulta_agendada (data/horário claro)
#   3. em_atendimento (diálogo de triagem ativo)
#   4. None (sem mudança — mantém stage atual)
def _detect_stage(text: str) -> Optional[str]:
    """Heurística simples: palavra-chave na mensagem do paciente → muda stage."""
    t = text.lower()
    for stage, kws in _STAGE_KEYWORDS.items():
        for kw in kws:
            if kw in t:
                return stage
    return None


# Gatilhos EXCLUSIVOS de transbordo humano (Prioridade 1 kill-switch).
# Diferenciados de emergência clínica: aqui o paciente pede PESSOA,
# não necessariamente está em perigo. Mesmo destino de funil
# (falar_pessoalmente), mas o estado de handoff é diferente.
_HUMAN_HANDOFF_TRIGGERS: list[str] = [
    "humano", "pessoalmente", "atendente", "pessoa",
    "falar com médico", "falar com medico",
    "falar com alguém", "falar com alguem",
    "atendimento pessoal", "atendimento humano",
    "me liga", "prefiro falar",
]


def _is_human_handoff_request(text: str) -> bool:
    """True se a mensagem do paciente pedir explicitamente atendimento humano."""
    t = text.lower()
    return any(trigger in t for trigger in _HUMAN_HANDOFF_TRIGGERS)


def _detect_stage_with_priority(text: str) -> tuple[Optional[str], bool]:
    """Hierarquia de funil (Prioridade 1 > 2 > 3).

    Returns:
        (stage, requires_handoff).
        - stage: novo estágio proposto (None = mantém atual).
        - requires_handoff: True se o paciente pediu humano/transbordo
          (Prioridade 1) — neste caso o orquestrador deve aplicar
          handoff_state='humano_assumiu' e pular a chamada LLM.
    """
    # Prioridade 1 — transbordo humano sempre vence
    if _is_human_handoff_request(text):
        return ("falar_pessoalmente", True)

    # Demais matches (urgência clínica grave conta como falar_pessoalmente
    # mas SEM handoff — ainda deixa a IA conduzir)
    stage = _detect_stage(text)
    return (stage, False)
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
    """Busca config da clínica (nome, especialidade, doctor_name, AI config)
    pra montar prompt + rotear LLM."""
    if tenant_id in _TENANT_CFG_CACHE:
        return _TENANT_CFG_CACHE[tenant_id]
    res = (
        sb.table("tenants")
        .select(
            "name, specialty, doctor_name, city, "
            "ai_mode, system_prompt, persona_name, tone_of_voice, "
            "byok_provider, byok_api_key, byok_model, "
            "hermes_gateway_url"
        )
        .eq("id", tenant_id)
        .limit(1)
        .execute()
    )
    raw = res.data[0] if res.data else {}
    cfg = {
        "name": raw.get("name") or "Clínica",
        "specialty": raw.get("specialty") or "Saúde",
        "doctor_name": raw.get("doctor_name") or "Dr(a)",
        "city": raw.get("city") or "",
        "ai_mode": raw.get("ai_mode") or "hermes_vps",
        "system_prompt": raw.get("system_prompt") or "",
        "persona_name": raw.get("persona_name") or "Assistente Virtual",
        "tone_of_voice": raw.get("tone_of_voice") or "Acolhedor & Empático",
        "byok_provider": (raw.get("byok_provider") or "").lower(),
        "byok_api_key": raw.get("byok_api_key") or "",
        "byok_model": raw.get("byok_model") or "",
        "hermes_gateway_url": (raw.get("hermes_gateway_url") or "").strip(),
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
    persona = tenant_cfg.get("persona_name") or "Assistente Virtual"
    tone = tenant_cfg.get("tone_of_voice") or "Acolhedor & Empático"
    lead_name = lead.get("name") or "paciente"
    insurance = lead.get("insurance") or "Particular"
    stage = lead.get("stage") or "novo_contato"

    # Contexto dinâmico (sempre presente)
    dynamic_ctx = (
        f"\n\nContexto operacional:\n"
        f"- Clínica: {name} ({specialty})\n"
        f"- Responsável: {doctor}\n"
        f"- Persona: {persona}\n"
        f"- Tom de voz: {tone}\n"
        f"- Paciente: {lead_name}\n"
        f"- Convênio: {insurance}\n"
        f"- Estágio atual no funil: {stage}"
    )

    # Se o tenant cadastrou system_prompt custom, usa ele como bloco principal;
    # caso contrário cai no template padrão multi-clínica.
    custom = (tenant_cfg.get("system_prompt") or "").strip()
    if custom:
        # Injeta contexto operacional ao final do prompt custom — sem isso a IA
        # esquece o nome/convênio/estágio a cada turno.
        return f"{custom}{dynamic_ctx}"

    # Template padrão (mantido pra tenants sem custom prompt)
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
        "6. Sempre termine perguntando se pode ajudar em algo mais.\n\n"
        "🛑 REGRA MANDATÓRIA DE TOOL CALL (anti-alucinação — Composio Tool Router v3.1):\n"
        "É PROIBIDO afirmar 'agendado', 'você receberá o link', 'marquei pra você' ou "
        "qualquer variação que sinalize sucesso de agendamento SEM confirmação inequívoca "
        "do tool router. A ferramenta `GOOGLECALENDAR_CREATE_EVENT` não aparece pré-registrada "
        "no model-facing list do gateway — TODA chamada obrigatoriamente passa pelas "
        "meta-tools do Composio Tool Router MCP, nesta ordem:\n"
        "  (a) `mcp__composio__COMPOSIO_SEARCH_TOOLS` com `queries=[{\"use_case\": \"create a new "
        "event on google calendar\"}]` para descobrir/confirmar o slug exato e os parâmetros esperados.\n"
        "  (b) `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` com `tools=[{\"tool_slug\": "
        "\"GOOGLECALENDAR_CREATE_EVENT\", \"arguments\": {...}}]`. Argumentos obrigatórios: "
        "`summary` = 'Consulta: {{nome}} - Dr. Matheus Dore', `start_datetime` e `end_datetime` "
        "ISO-8601 com offset -03:00 (end = start + 50 min), `description` com paciente/contato/triagem.\n"
        "A chamada só é considerada SUCESSO se a resposta trouxer `success_count:1, "
        "error_count:0` E evento criado identificado por `id` ou `htmlLink` real (campos `id`/"
        "`htmlLink`/`response_data.htmlLink` da Tool Router).\n"
        "Só depois desse sucesso inequívoco responda ao paciente incluindo `htmlLink` APENAS "
        "se ele veio literalmente na resposta (caso contrário diga 'a equipe envia o link em seguida').\n"
        "Se a tool falhar (timeout, NoActive, error_count≥1, schema inválido, sem id/htmlLink): "
        "diga com honestidade que houve falha técnica e que a equipe confirmará — nunca "
        "invente link nem horário como se tivesse criado o evento.\n\n"
        "Isolamento multi-tenant: toda chamada é escopada por `user_id=clinica_dr_matheus` "
        "(Composio Tool Router session `trs_ffSi5c5PETDX`). NÃO mencione user_id ao paciente."
    )


async def _post_chat_completion(
    target: dict[str, Any],
    messages: list[dict[str, Any]],
    payload_extras: dict[str, Any],
) -> str:
    """POST OpenAI-compat /chat/completions e devolve só o content da 1ª choice.

    Timeout adaptativo: gateway dedicado tem SLA menor (8s), 9router/BYOK
    toleram 20s. Levanta exceção em qualquer falha (HTTP não-2xx, timeout,
    JSON quebrado, content vazio) pra que o caller faça fallback explícito.
    """
    timeout = (
        HERMES_GATEWAY_TIMEOUT_S
        if target["source"] == "hermes_gateway"
        else 20.0
    )
    payload = {
        "model": target["model"],
        "messages": messages,
        "stream": False,
        "reasoning": {"effort": "low"},
        **payload_extras,
    }
    headers = {
        "Authorization": f"Bearer {target['apiKey']}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(
            f"{target['baseUrl']}/chat/completions",
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
        raise RuntimeError(f"LLM devolveu content vazio ({target['source']})")
    return content


def _build_chat_messages(
    system_prompt: str,
    history: list[dict[str, Any]],
    patient_msg: str,
) -> list[dict[str, Any]]:
    """Converte histórico interno em messages OpenAI-compat."""
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for m in history:
        role = "assistant" if m["sender"] in ("ai", "bot") else "user"
        messages.append({"role": role, "content": m["content"]})
    if not messages or messages[-1]["role"] != "user":
        messages.append({"role": "user", "content": patient_msg})
    return messages


async def _call_llm(
    system_prompt: str,
    history: list[dict[str, Any]],
    patient_msg: str,
    tenant_cfg: dict[str, Any] | None = None,
) -> str:
    """POST OpenAI-compat pra 9router/BYOK/Hermes Gateway do tenant (texto puro).

    Fallback: se o target for `hermes_gateway` e falhar (timeout, 5xx, content
    vazio), refaz a chamada automaticamente no 9router (Hermes VPS) pra que
    o paciente nunca fique sem resposta no WhatsApp.
    """
    tenant_cfg = tenant_cfg or {}
    target = _resolve_llm_target(tenant_cfg)
    if not target["apiKey"]:
        return ""
    messages = _build_chat_messages(system_prompt, history, patient_msg)
    payload_extras = {"max_tokens": 500, "temperature": 0.7}

    try:
        return await _post_chat_completion(target, messages, payload_extras)
    except Exception as exc:
        if target["source"] != "hermes_gateway":
            logger.warning(
                "_call_llm falhou (source=%s provider=%s): %s",
                target["source"], target["provider"], exc,
            )
            return ""
        # Gateway dedicado caiu — tenta 9router antes de devolver vazio.
        fallback = {
            "baseUrl": NINEROUTER_BASE_URL.rstrip("/"),
            "model": NINEROUTER_DEFAULT_MODEL,
            "apiKey": NINEROUTER_API_KEY,
            "provider": "hermes_vps",
            "source": "hermes_vps",
        }
        try:
            logger.warning(
                "[HERMES_FAIL] gateway=%s model=%s exc_type=%s exc=%r | caindo fallback 9router (texto puro)",
                target["baseUrl"], target["model"], type(exc).__name__, str(exc)[:200],
            )
            return await _post_chat_completion(fallback, messages, payload_extras)
        except Exception as exc2:
            logger.error(
                "_call_llm fallback 9router também falhou: %s", exc2,
            )
            return ""


# Mapa de provedores BYOK → endpoint base OpenAI-compat.
# Anthropic fica de fora (API não é OpenAI-compat; exigia refator maior).
_BROADCAST_PROVIDERS: dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
}


def _resolve_llm_target(tenant_cfg: dict[str, Any]) -> dict[str, Any]:
    """Decide qual baseUrl/model/apiKey usar conforme ai_mode do tenant.

    Ordem de prioridade:
      1. hermes_gateway_url preenchido → perfil dedicado Hermes (modelo
         `hermes-agent`, Bearer API_SERVER_KEY). Tem skills, Calendar, visão.
      2. ai_mode='byok' com chave completa → provedor externo (OpenAI/etc)
      3. fallback: 9router (Hermes VPS) com modelo Hermes-fallbacks

    Returns dict { baseUrl, model, apiKey, provider, source } onde:
      - source = 'hermes_gateway' | 'byok' | 'hermes_vps'
      - provider = 'hermes_gateway' | 'openai' | 'openrouter' | 'gemini' | 'hermes_vps'
    """
    # 1. Gateway do perfil dedicado (estilo Professor IA do Leitor).
    #    Vence sobre ai_mode porque o tenant owner escolheu explicitamente
    #    delegar o cérebro pra um perfil Hermes (skills, calendar, vision).
    gw_url = (tenant_cfg.get("hermes_gateway_url") or "").rstrip("/")
    if gw_url:
        # Garante que o baseUrl termina em /v1 — o _post_chat_completion
        # concatena /chat/completions, então sem /v1 vira 404 no gateway
        # (que só expõe rotas em /v1/* OpenAI-compat).
        if not gw_url.endswith("/v1"):
            gw_url = gw_url + "/v1"
        return {
            "baseUrl": gw_url,
            "model": HERMES_GATEWAY_MODEL,
            "apiKey": HERMES_GATEWAY_API_KEY,
            "provider": "hermes_gateway",
            "source": "hermes_gateway",
        }

    # 2. BYOK (chave do próprio tenant).
    ai_mode = (tenant_cfg.get("ai_mode") or "hermes_vps").lower()
    if ai_mode == "byok":
        provider = (tenant_cfg.get("byok_provider") or "").lower()
        api_key = tenant_cfg.get("byok_api_key") or ""
        model = tenant_cfg.get("byok_model") or ""
        base = _BROADCAST_PROVIDERS.get(provider)
        if base and api_key and model:
            return {
                "baseUrl": base,
                "model": model,
                "apiKey": api_key,
                "provider": provider,
                "source": "byok",
            }
        logger.warning(
            "BYOK incompleto (provider=%s key=%s model=%s), caindo no Hermes VPS",
            provider, bool(api_key), bool(model),
        )

    # 3. fallback: 9router (Hermes VPS)
    return {
        "baseUrl": NINEROUTER_BASE_URL.rstrip("/"),
        "model": NINEROUTER_DEFAULT_MODEL,
        "apiKey": NINEROUTER_API_KEY,
        "provider": "hermes_vps",
        "source": "hermes_vps",
    }


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
    tenant_cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Versão estruturada: força JSON {reply, clinical_summary, symptoms}.

    Fallback: se o provider não suportar response_format json_object, usa
    instrução por prompt + tenta parsear; se quebrar, devolve dict com
    reply="" e marca de erro pra que o caller degrade com segurança.

    Se o target for o Hermes Gateway do perfil e falhar (timeout, 5xx, content
    vazio), refaz a chamada no 9router antes de devolver erro silencioso —
    assim o paciente nunca fica sem triagem no WhatsApp.
    """
    empty = {"reply": "", "clinical_summary": "", "symptoms": [], "ok": False}
    tenant_cfg = tenant_cfg or {}
    target = _resolve_llm_target(tenant_cfg)
    if not target["apiKey"]:
        return empty

    messages = _build_chat_messages(
        system_prompt + _STRUCTURED_OUTPUT_INSTRUCTIONS, history, patient_msg
    )
    payload_extras = {
        "max_tokens": 700,
        "temperature": 0.5,
        # Força JSON via OpenAI-compat (a maioria dos providers via 9router aceita).
        # Hermes gateway também aceita (OpenAI-compat strict).
        "response_format": {"type": "json_object"},
    }

    def _parse(content: str) -> dict[str, Any]:
        # Tolerância best-effort pra respostas malformadas:
        # 1) ```json ... ```
        # 2) lixo antes/depois do JSON (extrai substring do 1º '{' ao último '}')
        # 3) JSON puro
        content2 = content
        if content2.startswith("```"):
            content2 = re.sub(r"^```(?:json)?\s*", "", content2)
            content2 = re.sub(r"\s*```\s*$", "", content2)
        first = content2.find("{")
        last = content2.rfind("}")
        if first > 0 and last > first:
            content2 = content2[first:last + 1]
        try:
            parsed = json.loads(content2)
        except json.JSONDecodeError:
            # Fallback extremo: extrai campos por regex. Cobre o caso em que o
            # LLM pula o '{' inicial e/ou a primeira aspa (visto em produção
            # com MiniMax-M3 + response_format=json_object).
            parsed = {}
            for field in ("reply", "clinical_summary"):
                m = re.search(
                    rf'"?{field}"?\s*:\s*"((?:[^"\\]|\\.)*)"',
                    content2,
                    re.DOTALL,
                )
                if m:
                    # Decoda \n, \", \\ mas preserva UTF-8 (não usa unicode_escape
                    # global pra não corromper caracteres acentuados).
                    raw = m.group(1)
                    try:
                        raw = raw.encode("utf-8").decode("unicode_escape").encode("latin-1").decode("utf-8")
                    except (UnicodeDecodeError, UnicodeEncodeError):
                        pass
                    parsed[field] = raw
            sym = re.search(r'"?symptoms"?\s*:\s*\[([^\]]*)\]', content2, re.DOTALL)
            if sym:
                items = re.findall(r'"([^"]*)"', sym.group(1))
                parsed["symptoms"] = [s.strip() for s in items if s.strip()]
            else:
                parsed["symptoms"] = []
            if not parsed.get("reply"):
                # Último recurso: trata o conteúdo inteiro como reply (LLM
                # respondeu texto puro em vez de JSON).
                parsed["reply"] = content.strip()
                parsed.setdefault("clinical_summary", "")
                parsed.setdefault("symptoms", [])
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

    try:
        content = await _post_chat_completion(target, messages, payload_extras)
        return _parse(content)
    except Exception as exc:
        if target["source"] != "hermes_gateway":
            logger.warning(
                "_call_llm_structured falhou (source=%s provider=%s): %s",
                target["source"], target["provider"], exc,
            )
            return empty
        # Gateway caiu — fallback 9router antes de devolver erro silencioso.
        fallback = {
            "baseUrl": NINEROUTER_BASE_URL.rstrip("/"),
            "model": NINEROUTER_DEFAULT_MODEL,
            "apiKey": NINEROUTER_API_KEY,
            "provider": "hermes_vps",
            "source": "hermes_vps",
        }
        try:
            logger.warning(
                "[HERMES_FAIL] gateway=%s model=%s exc_type=%s exc=%r | caindo fallback 9router",
                target["baseUrl"], target["model"], type(exc).__name__, str(exc)[:200],
            )
            content = await _post_chat_completion(fallback, messages, payload_extras)
            return _parse(content)
        except Exception as exc2:
            logger.error(
                "_call_llm_structured fallback 9router também falhou: %s", exc2,
            )
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
        structured = await _call_llm_structured(
            system_prompt, history, patient_text, tenant_cfg,
        )
        ai_reply = structured.get("reply") or ""
        if not ai_reply:
            # Fallback: degrada pra chamada de texto puro
            logger.info(
                "[%s] structured vazio, caindo no _call_llm texto puro",
                instance,
            )
            ai_reply = await _call_llm(
                system_prompt, history, patient_text, tenant_cfg,
            )
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

        # 5. Atualiza stage + handoff via hierarquia de prioridade
        #    P1: humano/transbordo → falar_pessoalmente + handoff_state='humano_assumiu'
        #    P2: agendamento claro → consulta_agendada (IA continua)
        #    P3: urgência clínica → falar_pessoalmente (sem handoff, IA conduz)
        #    P4: triagem ativa (default) → em_atendimento (mantém atual)
        new_stage, requires_handoff = _detect_stage_with_priority(patient_text)
        if new_stage and new_stage != lead.get("stage"):
            patch = {"stage": new_stage, "last_interaction": _now_iso()}
            if requires_handoff:
                # Kill-switch: desativa respostas automáticas da IA.
                # Próximo inbound já é bloqueado pelo gate em
                # evolution_webhook (line ~647: handoff_state != 'ai').
                patch["handoff_state"] = "humano_assumiu"
                logger.info(
                    "[%s] lead %s TRANSTORNO HUMANO solicitado (P1) → "
                    "stage=%s, handoff_state=humano_assumiu",
                    instance, lead["id"], new_stage,
                )
            sb.table("leads").update(patch).eq("id", lead["id"]).execute()
            logger.info(
                "[%s] lead %s stage %s → %s (handoff=%s)",
                instance,
                lead["id"],
                lead.get("stage"),
                new_stage,
                requires_handoff,
            )
        elif requires_handoff:
            # Caso raro: stage já é falar_pessoalmente mas handoff ainda
            # não estava marcado. Garante kill-switch.
            if (lead.get("handoff_state") or "ai") != "humano_assumiu":
                sb.table("leads").update(
                    {
                        "handoff_state": "humano_assumiu",
                        "last_interaction": _now_iso(),
                    }
                ).eq("id", lead["id"]).execute()
                logger.info(
                    "[%s] lead %s handoff_state=humano_assumiu (já em falar_pessoalmente)",
                    instance, lead["id"],
                )
    except Exception as exc:
        logger.exception("[%s] _dispatch_ai falhou: %s", instance, exc)


# ============================================================================
# App
# ============================================================================

app = FastAPI(title="CRM-Hermes webhook receiver", version="1.1.0")

# CORS — front do CRM fica em crm.automacaojs.us (produção) e localhost:5173
# durante dev. Mantemos allow_credentials pra possibilitar headers de auth no
# futuro, mesmo que hoje as rotas /composio/* sejam públicas.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://crm.automacaojs.us",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "crm-hermes-webhook",
        "tenants_cached": len(_TENANT_BY_INSTANCE),
        "llm_configured": bool(NINEROUTER_API_KEY),
        "evolution_configured": bool(EVOLUTION_API_KEY),
        "composio_configured": bool(COMPOSIO_API_KEY),
        "composio_toolkits": sorted(COMPOSIO_AUTH_CONFIG_IDS),
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

    # 5. Dispara motor IA (apenas inbound de paciente + handoff_state='ai'/'ia_ativa')
    #    Aceita os dois valores: 'ia_ativa' é o canônico gravado pelo front
    #    (supabaseService.createLead) e 'ai' é o legado de seeds antigas.
    handoff_state = (lead.get("handoff_state") or "ia_ativa").lower()
    ai_active = handoff_state in {"ai", "ia_ativa"}
    should_dispatch_ai = (
        ok
        and not extracted["from_me"]
        and extracted["sender"] == "patient"
        and ai_active
    )
    if should_dispatch_ai:
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
        "ai_dispatched": should_dispatch_ai,
    }


# ============================================================================
# Composio — geração de OAuth Connect Links e checagem de status
# ============================================================================
async def _composio_request(
    method: str,
    path: str,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Wrapper minimalista sobre a API v3 do Composio."""
    if not COMPOSIO_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Composio não configurado (COMPOSIO_API_KEY ausente)",
        )
    url = f"{COMPOSIO_BASE_URL.rstrip('/')}{path}"
    headers = {"x-api-key": COMPOSIO_API_KEY, "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.request(method, url, headers=headers, json=json_body)
        if r.status_code >= 400:
            logger.warning("Composio %s %s → HTTP %s body=%s", method, path, r.status_code, r.text[:300])
            raise HTTPException(
                status_code=r.status_code,
                detail=f"Composio upstream error: {r.text[:300]}",
            )
        return r.json()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Falha de rede ao chamar Composio")
        raise HTTPException(status_code=502, detail=f"Composio unreachable: {exc}") from exc


@app.post("/composio/connect/{toolkit}")
async def composio_connect(toolkit: str, request: Request) -> dict[str, Any]:
    """
    Gera um redirect_url OAuth do Composio para o toolkit solicitado,
    escopado por `user_id` (ex: `clinica_dr_matheus`).
    Body esperado: { user_id: str, callback_url?: str }
    """
    auth_config_id = COMPOSIO_AUTH_CONFIG_IDS.get(toolkit.lower())
    if not auth_config_id:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Toolkit '{toolkit}' não tem auth_config mapeada. "
                f"Suportados: {sorted(COMPOSIO_AUTH_CONFIG_IDS)}"
            ),
        )

    try:
        body = await request.json()
    except Exception:
        body = {}
    user_id = (body.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="Campo 'user_id' é obrigatório")
    callback_url = (
        body.get("callback_url") or f"https://crm.automacaojs.us/integracoes/callback"
    )

    upstream = await _composio_request(
        "POST",
        "/connected_accounts/link",
        json_body={
            "auth_config_id": auth_config_id,
            "user_id": user_id,
            "callback_url": callback_url,
        },
    )
    # Resposta típica: { link_token, redirect_url, expires_at, connected_account_id }
    logger.info(
        "Composio connect toolkit=%s user_id=%s link_token=%s",
        toolkit,
        user_id,
        upstream.get("link_token"),
    )
    return {
        "ok": True,
        "toolkit": toolkit,
        "user_id": user_id,
        "redirect_url": upstream.get("redirect_url"),
        "link_token": upstream.get("link_token"),
        "expires_at": upstream.get("expires_at"),
        "connected_account_id": upstream.get("connected_account_id"),
    }


@app.get("/composio/status/{toolkit}")
async def composio_status(toolkit: str, user_id: str) -> dict[str, Any]:
    """
    Lista contas conectadas para um toolkit + user_id. Retorna a primeira
    ACTIVE encontrada (que é o que importa para a UI).

    O endpoint v3 /connected_accounts não aceita toolkit_slug/user_id como
    query params — retornamos a página completa e filtramos no servidor.
    """
    if not user_id.strip():
        raise HTTPException(status_code=400, detail="Query 'user_id' é obrigatória")

    upstream = await _composio_request(
        "GET",
        "/connected_accounts?limit=200",
    )
    items = upstream.get("items") or []
    matches = [
        it for it in items
        if (it.get("toolkit") or {}).get("slug", "").lower() == toolkit.lower()
        and (it.get("user_id") or "") == user_id
    ]
    active = next(
        (it for it in matches if (it.get("status") or "").upper() == "ACTIVE"),
        None,
    )
    return {
        "ok": True,
        "toolkit": toolkit,
        "user_id": user_id,
        "connected": active is not None,
        "account_id": (active or {}).get("id"),
        "alias": (active or {}).get("alias"),
        "connected_at": (active or {}).get("created_at"),
        "matched_total": len(matches),
        "total_items": upstream.get("total_items", 0),
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
