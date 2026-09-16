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

# ---------------------------------------------------------------------------
# Composio Tool Router MCP — usado pelo webhook pra bypassar o bug do Hermes
# Gateway que não carrega MCP servers no runtime. Endpoint Streamable HTTP
# (POST JSON-RPC 2.0 com `tools/call`).
#
# OBRIGATÓRIO: defina via ENV (não commitar valores em defaults!).
#   COMPOSIO_MCP_URL          ex: https://backend.composio.dev/tool_router/<session_id>/mcp
#   COMPOSIO_MCP_API_KEY      ex: ak_xxxxxxxxxxxxxxxxxxxxxxxx
#   COMPOSIO_DEFAULT_TENANT_USER_ID   ex: clinica_dr_matheus
#
# Pra criar uma session nova por tenant:
#   POST https://backend.composio.dev/api/v3.1/tool_router/session
#        {"user_id": "<tenant_slug>"}
# retorna {session_id, mcp.url} -> use session_id na URL e o user_id como chave.
# ---------------------------------------------------------------------------
COMPOSIO_MCP_URL = os.environ.get("COMPOSIO_MCP_URL", "").strip()
COMPOSIO_MCP_API_KEY = os.environ.get("COMPOSIO_MCP_API_KEY", "").strip()
COMPOSIO_DEFAULT_TENANT_USER_ID = os.environ.get(
    "COMPOSIO_DEFAULT_TENANT_USER_ID", "clinica_dr_matheus"
).strip()

# Tools expostas ao LLM no formato OpenAI-compat (function definitions).
# Mapeadas 1:1 pras meta-tools do Tool Router. O LLM vê o prefixo
# `mcp__composio__` pra ficar consistente com a nomenclatura que o
# sistema da clínica já usa; no dispatch a gente tira o prefixo.
COMPOSIO_META_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "mcp__composio__COMPOSIO_SEARCH_TOOLS",
            "description": (
                "Busca tools do Composio por use-case. SEMPRE chamar primeiro "
                "antes de executar qualquer toolkit tool — descobre slug exato, "
                "schema, plano de execução e estado da conexão do toolkit. "
                "Retorna `session_id` que deve ser passado nas chamadas seguintes."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "queries": {
                        "type": "array",
                        "description": "Lista de queries paralelas (1 por ação atômica).",
                        "items": {
                            "type": "object",
                            "properties": {
                                "use_case": {
                                    "type": "string",
                                    "description": "Descrição normalizada do caso de uso em inglês.",
                                },
                                "known_fields": {
                                    "type": "string",
                                    "description": "KV hints opcionais (channel_name:general, etc).",
                                },
                            },
                            "required": ["use_case"],
                        },
                        "minItems": 1,
                    },
                    "session": {
                        "type": "object",
                        "description": "{generate_id: true} pra novo workflow, ou {id: EXISTING_ID} pra continuar.",
                        "properties": {
                            "id": {"type": "string"},
                            "generate_id": {"type": "boolean"},
                        },
                    },
                },
                "required": ["queries"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL",
            "description": (
                "Executa até 50 tools do Composio em paralelo (somente tools "
                "logicamente independentes). Argumentos DEVEM seguir o schema "
                "exato retornado por COMPOSIO_SEARCH_TOOLS / GET_TOOL_SCHEMAS. "
                "Só execute se a conexão do toolkit estiver ACTIVE."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "tools": {
                        "type": "array",
                        "description": "Lista de {tool_slug, arguments} a executar.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "tool_slug": {"type": "string"},
                                "arguments": {"type": "object"},
                            },
                            "required": ["tool_slug", "arguments"],
                        },
                        "minItems": 1,
                        "maxItems": 50,
                    },
                    "thought": {
                        "type": "string",
                        "description": "Rationale de uma frase.",
                    },
                    "sync_response_to_workbench": {
                        "type": "boolean",
                        "description": "true só se resposta for grande; default false.",
                    },
                },
                "required": ["tools"],
            },
        },
    },
]

# Cliente Supabase (REST; o schema expõe leads/messages com anon key)
sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Cache em memória: evolution_instance -> tenant_id (uuid)
_TENANT_BY_INSTANCE: dict[str, str] = {}
# Cache de config do tenant: (cfg_dict, fetched_at_monotonic_seconds).
# TTL curto (60s) pra refletir rápido mudanças de `ai_auto_reply_enabled`
# feitas via front sem reiniciar o webhook.
_TENANT_CFG_CACHE: dict[str, tuple[dict[str, Any], float]] = {}
_TENANT_CFG_CACHE_TTL_SECONDS = 60.0

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
    pra montar prompt + rotear LLM.

    Cache em memória com TTL curto (60s) — reflete rápido o toggle
    `ai_auto_reply_enabled` sem reiniciar o webhook.
    """
    now = time.monotonic()
    cached = _TENANT_CFG_CACHE.get(tenant_id)
    if cached is not None:
        cfg, fetched_at = cached
        if (now - fetched_at) < _TENANT_CFG_CACHE_TTL_SECONDS:
            return cfg
        # Cache expirado — recarrega abaixo

    res = (
        sb.table("tenants")
        .select(
            "name, specialty, doctor_name, city, "
            "ai_mode, system_prompt, persona_name, tone_of_voice, "
            "byok_provider, byok_api_key, byok_model, "
            "hermes_gateway_url, ai_auto_reply_enabled"
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
        # Interruptor Mestre de Plantão IA. Default True (IA responde) quando
        # coluna ausente em tenants legados / cache pré-migração.
        "ai_auto_reply_enabled": bool(
            raw.get("ai_auto_reply_enabled", True)
        ),
    }
    _TENANT_CFG_CACHE[tenant_id] = (cfg, now)
    return cfg


def _invalidate_tenant_cache(tenant_id: str) -> None:
    """Dropa cache do tenant (uso no callback do toggle do front)."""
    _TENANT_CFG_CACHE.pop(tenant_id, None)


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
    tools: list[dict[str, Any]] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """POST OpenAI-compat /chat/completions e devolve (content, tool_calls).

    Timeout adaptativo: gateway dedicado tem SLA menor (8s), 9router/BYOK
    toleram 20s. Levanta exceção em qualquer falha (HTTP não-2xx, timeout,
    JSON quebrado, content vazio) pra que o caller faça fallback explícito.

    `tools` (opcional): lista OpenAI-compat de function definitions injetada
    no payload. Quando o LLM responde com `tool_calls`, retorna-os em vez de
    levantar — quem chamou decide se executa em loop ou cai pra texto puro.
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
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
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
    message = (data.get("choices") or [{}])[0].get("message", {})
    content = (message.get("content") or "").strip()
    tool_calls = message.get("tool_calls") or []
    if not content and not tool_calls:
        raise RuntimeError(f"LLM devolveu content vazio ({target['source']})")
    return content, tool_calls


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

    Quando o target é `hermes_gateway` E o `composio_mcp_url` está configurado
    no env, ativa o tool loop (passa `tools` no payload + dispatch de
    `tool_calls` via Composio MCP HTTP direto — bypassa o bug do Hermes
    Gateway que não carrega MCP servers no runtime).
    """
    tenant_cfg = tenant_cfg or {}
    target = _resolve_llm_target(tenant_cfg)
    if not target["apiKey"]:
        return ""
    messages = _build_chat_messages(system_prompt, history, patient_msg)
    payload_extras = {"max_tokens": 500, "temperature": 0.7}

    # Tool-calling path: gateway dedicado + MCP do Composio configurado.
    use_tools = (
        target["source"] == "hermes_gateway"
        and bool(COMPOSIO_MCP_URL)
        and bool(COMPOSIO_MCP_API_KEY)
    )
    tools = COMPOSIO_META_TOOLS if use_tools else None
    tenant_user_id = (tenant_cfg.get("composio_user_id") or COMPOSIO_DEFAULT_TENANT_USER_ID).strip()

    if use_tools:
        try:
            return await _call_llm_with_tools_loop(
                target, messages, payload_extras, tools, tenant_user_id,
            )
        except Exception as exc:
            logger.warning(
                "_call_llm tool-loop falhou (source=%s): %s — caindo texto puro",
                target["source"], exc,
            )
            # Cai pra texto puro no MESMO target; se também falhar, fallback abaixo.

    try:
        content, _ = await _post_chat_completion(target, messages, payload_extras)
        return content
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
            content, _ = await _post_chat_completion(fallback, messages, payload_extras)
            return content
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

    async def _parse(content: str) -> dict[str, Any]:
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
        content, _ = await _post_chat_completion(target, messages, payload_extras)
        return await _parse(content)
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
            content, _ = await _post_chat_completion(fallback, messages, payload_extras)
            return await _parse(content)
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
        # ─────────────────────────────────────────────────────────────────
        # 🌙 PLANTÃO IA — Interruptor Mestre (safety belt).
        # Caller (evolution_webhook) já checa `ai_auto_reply_enabled` antes
        # de enfileirar este background task e seta `should_dispatch_ai=False`.
        # Este if aqui é só defesa em profundidade — se outro caminho
        # invocar `_dispatch_ai` no futuro, ainda respeita o plantão.
        # ─────────────────────────────────────────────────────────────────
        if not tenant_cfg.get("ai_auto_reply_enabled", True):
            logger.info(
                "[%s] 🌙 plantão IA OFF (safety belt em _dispatch_ai) — "
                "phone=%s lead=%s sem resposta",
                instance,
                lead.get("phone"),
                lead.get("id"),
            )
            return
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
        # Plan B — se stage indica agendamento E paciente tem horário
        # concreto na conversa, chama Composio MCP direto pra criar o
        # evento. Bypassa o tool-calling quebrado do Hermes Gateway.
        try:
            await _maybe_create_calendar_event(
                instance, lead, patient_text, ai_reply,
                history, tenant_cfg, new_stage,
            )
        except Exception as exc:
            logger.warning(
                "[%s] Plan B calendar dispatch falhou: %s",
                instance, exc,
            )
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

    # 🌙 PLANTÃO IA — se o tenant desligou, NÃO disparamos IA mesmo que
    # a lead esteja em modo ia_ativa. Cache do tenant_cfg tem TTL 60s;
    # toggle via front expira em <= 60s no pior caso. Mensagem segue
    # gravada em `messages` (acima) e lead já foi atualizado.
    tenant_cfg = _get_tenant_config(tenant_id)
    plantao_off = not tenant_cfg.get("ai_auto_reply_enabled", True)
    if plantao_off:
        logger.info(
            "[%s] 🌙 plantão IA OFF — phone=%s lead=%s "
            "msg gravada, IA NÃO vai responder",
            instance,
            extracted["phone"],
            lead.get("id"),
        )

    should_dispatch_ai = (
        ok
        and not extracted["from_me"]
        and extracted["sender"] == "patient"
        and ai_active
        and not plantao_off
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


# ============================================================================
# Composio MCP — bypass do bug do Hermes Gateway
# ============================================================================
# O Hermes Gateway do perfil dr-matheus-dore NÃO carrega o MCP server do
# Composio no runtime (config.yaml OK, filtro de segurança não bloqueia,
# mas o startup não registra as tools). Pra não ficar refém de investigar
# o gateway, o webhook chama o endpoint MCP do Tool Router diretamente
# via HTTP/SSE. Isso preserva o tool loop funcionando pra clínica.

async def _composio_mcp_call(
    tool_name: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """POST JSON-RPC `tools/call` no endpoint MCP do Composio Tool Router.

    Endpoint exige `Accept: application/json, text/event-stream` (Streamable
    HTTP) e responde em SSE (`event: message\\ndata: {...}`). Quando a
    resposta vem em JSON puro (alguns proxies), aceitamos os dois.

    Levanta RuntimeError em falha de rede, HTTP não-2xx ou JSON quebrado.
    """
    if not COMPOSIO_MCP_URL or not COMPOSIO_MCP_API_KEY:
        raise RuntimeError("Composio MCP não configurado (MCP_URL/MCP_API_KEY ausentes)")

    body = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000),
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    }
    headers = {
        "x-api-key": COMPOSIO_MCP_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(COMPOSIO_MCP_URL, json=body, headers=headers)
        if r.status_code >= 400:
            raise RuntimeError(
                f"Composio MCP HTTP {r.status_code}: {r.text[:300]}"
            )
        text = r.text
        # Tenta JSON puro primeiro (alguns servidores respondem JSON direto).
        try:
            return r.json()
        except Exception:
            pass
        # SSE format: extrai primeiro bloco `data: {...}`.
        for line in text.splitlines():
            if line.startswith("data: "):
                return json.loads(line[6:])
        raise RuntimeError(f"Composio MCP resposta não-JSON: {text[:200]}")
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Composio MCP unreachable: {exc}") from exc


async def _dispatch_composio_tool_call(
    tc: dict[str, Any],
    tenant_user_id: str,
) -> str:
    """Executa 1 tool_call do LLM contra o MCP do Composio e devolve JSON serializado.

    O LLM nomeia a função `mcp__composio__<TOOL>`; mapeamos pra slug real
    da meta-tool (`COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_MULTI_EXECUTE_TOOL`,
    etc) tirando o prefixo. Injeta `user_id` no payload se a tool aceita.
    Devolve string JSON pro OpenAI-compat `role=tool` `content`.
    """
    fn = tc.get("function") or {}
    fn_name = fn.get("name") or ""
    raw_args = fn.get("arguments") or "{}"
    tc_id = tc.get("id") or ""
    try:
        args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
    except Exception:
        args = {}

    composio_tool = fn_name.replace("mcp__composio__", "").strip()
    if not composio_tool:
        return json.dumps({"error": f"função '{fn_name}' sem slug Composio válido"})

    # Injeta user_id no payload se a meta-tool aceita (todas as 6 aceitam
    # opcionalmente; SEARCH e MULTI_EXECUTE usam session_id em vez disso —
    # mas o webhook sempre escopa por user_id pra multi-tenant isolation).
    if composio_tool in {"COMPOSIO_MULTI_EXECUTE_TOOL", "COMPOSIO_SEARCH_TOOLS"}:
        args.setdefault("user_id", tenant_user_id)
    else:
        args.setdefault("user_id", tenant_user_id)

    try:
        resp = await _composio_mcp_call(composio_tool, args)
        result = resp.get("result")
        if result is None and "error" in resp:
            # JSON-RPC error envelope.
            return json.dumps(
                {"ok": False, "error": resp.get("error")},
                ensure_ascii=False,
            )
        return json.dumps({"ok": True, "tool": composio_tool, "result": result}, ensure_ascii=False, default=str)
    except Exception as exc:
        logger.warning(
            "_dispatch_composio_tool_call falhou (tool=%s): %s",
            composio_tool, exc,
        )
        return json.dumps(
            {"ok": False, "tool": composio_tool, "error": str(exc)[:500]},
            ensure_ascii=False,
        )


async def _call_llm_with_tools_loop(
    target: dict[str, Any],
    messages: list[dict[str, Any]],
    payload_extras: dict[str, Any],
    tools: list[dict[str, Any]],
    tenant_user_id: str,
    max_iterations: int = 5,
) -> str:
    """Loop de tool-call contra o LLM até resposta final (content sem tool_calls).

    Cada iteração: chama LLM com `tools` → se vier `tool_calls`, executa
    via Composio MCP em paralelo, anexa results como mensagens `role=tool`,
    e chama de novo. Limite de iterações evita loops infinitos (LLM mal
    calibrado que continua chamando a mesma tool).

    Retorna o `content` final (texto) que o LLM envia ao paciente. Se o
    LLM nunca devolver content sem tool_calls, retorna o último content
    parcial ou string vazia.
    """
    current_messages = list(messages)
    final_content = ""

    for iteration in range(max_iterations):
        content, tool_calls = await _post_chat_completion(
            target, current_messages, payload_extras, tools=tools,
        )
        if content:
            final_content = content

        if not tool_calls:
            return final_content or ""

        # Append assistant message (inclui tool_calls pro próximo turno).
        current_messages.append({
            "role": "assistant",
            "content": content or "",
            "tool_calls": tool_calls,
        })

        # Executa tools em paralelo (até 5 simultâneas; meta-tools do
        # Composio são stateless, paralelizar é seguro).
        import asyncio as _asyncio
        results = await _asyncio.gather(
            *(_dispatch_composio_tool_call(tc, tenant_user_id) for tc in tool_calls),
            return_exceptions=True,
        )
        for tc, result in zip(tool_calls, results):
            tc_id = tc.get("id") or ""
            tool_content = (
                result
                if isinstance(result, str)
                else json.dumps({"ok": False, "error": str(result)[:500]}, ensure_ascii=False)
            )
            current_messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": tool_content,
            })

        logger.info(
            "[TOOL_LOOP] iter=%d tool_calls=%d user_id=%s",
            iteration + 1, len(tool_calls), tenant_user_id,
        )

    logger.warning(
        "_call_llm_with_tools_loop atingiu max_iterations=%d sem resposta final — "
        "devolvendo último content (len=%d)",
        max_iterations, len(final_content),
    )
    return final_content


# ============================================================================
# Plan B — webhook cria evento no Google Calendar direto via Composio MCP
# ============================================================================
# Por que isso existe: o Hermes Gateway do perfil dr-matheus-dore NÃO invoca
# as tools do Composio no runtime (LLM vê as tools no payload mas devolve
# só texto, sem tool_calls — bug confirmado em teste com prompt mandatório
# em 15/09/2026 20:35 UTC). Em vez de continuar refém do LLM pra fazer
# tool-calling, o webhook detecta intent de agendamento na conversa,
# extrai parâmetros via 2ª chamada LLM estruturada, e dispara a tool do
# Calendário direto via MCP. Resultado: o paciente recebe o htmlLink real
# do Google Calendar no WhatsApp.

_SCHEDULE_TIME_HINTS = [
    # regex simples — presença de qualquer um já é sinal forte.
    r"\b\d{1,2}\s*h\b",
    r"\b\d{1,2}:\d{2}\b",
    r"\b(amanh[ãa]|hoje|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)\b",
    r"\b(pr[óo]xim[ao]|essa semana|essa semana que vem|semana que vem)\b",
]
_SCHEDULE_TIME_RE = re.compile(
    "|".join(_SCHEDULE_TIME_HINTS), re.IGNORECASE
)


def _looks_like_schedule_request(
    patient_text: str,
    history: list[dict[str, Any]],
    detected_stage: str | None,
) -> bool:
    """True se a conversa indica intent de agendamento com tempo concreto."""
    if detected_stage != "consulta_agendada":
        return False
    # Texto atual + últimos 4 turnos do histórico (cobre "amanhã às 14h" dito antes).
    blob_parts = [patient_text or ""]
    for m in (history or [])[-4:]:
        if isinstance(m, dict) and m.get("content"):
            blob_parts.append(str(m["content"]))
    blob = " ".join(blob_parts)
    return bool(_SCHEDULE_TIME_RE.search(blob))


async def _extract_schedule_params(
    tenant_cfg: dict[str, Any],
    history: list[dict[str, Any]],
    patient_text: str,
) -> dict[str, Any]:
    """2ª chamada LLM estruturada: extrai parâmetros do evento do histórico.

    Retorna dict com chaves:
      - should_schedule: bool
      - summary: str
      - start_datetime: ISO-8601 com offset -03:00 (Brasil/Natal)
      - end_datetime: ISO-8601 com offset -03:00 (start + 50 min default)
      - attendee_email: str | None
      - description: str
      - ok: bool
    """
    extractor_prompt = (
        "Você é um extrator estruturado. Analise o histórico da conversa "
        "entre a atendente (IA) e o paciente e devolva APENAS um objeto JSON "
        "(sem markdown, sem comentários) com estes campos:\n"
        "{\n"
        '  "should_schedule": bool,            // true só se o paciente CONFIRMOU um horário concreto\n'
        '  "summary": str,                     // ex: "Consulta: Maria Silva - Dr. Matheus Dore"\n'
        '  "start_datetime": str,              // ISO-8601 com offset -03:00 (ex: 2026-09-16T14:00:00-03:00)\n'
        '  "end_datetime": str,                // ISO-8601 com offset -03:00 (start + 50 min default)\n'
        '  "attendee_email": str | null,       // email do paciente se mencionado, senão null\n'
        '  "description": str                 // queixa clínica + contato\n'
        "}\n\n"
        "REGRAS:\n"
        "- Converta referências PT-BR ('amanhã às 14h', 'quinta 16h', 'sexta 9h da manhã') "
        "para ISO-8601 no fuso -03:00 (Brasil/Natal). 'Amanhã' = próximo dia após a data atual.\n"
        "- Se NÃO houver horário concreto confirmado, devolva should_schedule=false.\n"
        "- Se faltar mês/ano, assuma o ano/mês corrente. NÃO invente horário.\n"
        "- end_datetime = start_datetime + 50 minutos (default consulta psiquiatria).\n"
        "- summary sempre no formato 'Consulta: <paciente> - Dr. Matheus Dore'.\n"
        "- description inclui a queixa clínica relevante + telefone se disponível.\n"
        "- Retorne APENAS o JSON. Sem texto antes/depois."
    )
    # Não reaproveita _call_llm_structured porque ele ANEXA instruções de
    # schema fixo ({reply, clinical_summary, symptoms}) que conflitam com
    # este extrator. Chamada direta com response_format=json_object.
    target = _resolve_llm_target(tenant_cfg)
    if not target["apiKey"]:
        return {"should_schedule": False, "ok": False}

    messages = _build_chat_messages(extractor_prompt, history, patient_text)
    payload_extras = {
        "max_tokens": 400,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }

    async def _parse(content: str) -> dict[str, Any]:
        # Tenta parsear direto, depois com fallback de regex igual _call_llm_structured.
        try:
            data = json.loads(content)
        except Exception:
            m = re.search(r"\{.*\}", content, re.DOTALL)
            if not m:
                return {"should_schedule": False, "ok": False, "raw": content}
            try:
                data = json.loads(m.group(0))
            except Exception:
                return {"should_schedule": False, "ok": False, "raw": content}
        # Normaliza.
        return {
            "should_schedule": bool(data.get("should_schedule", False)),
            "summary": str(data.get("summary") or "").strip(),
            "start_datetime": str(data.get("start_datetime") or "").strip(),
            "end_datetime": str(data.get("end_datetime") or "").strip(),
            "attendee_email": (
                str(data.get("attendee_email") or "").strip() or None
            ),
            "description": str(data.get("description") or "").strip(),
            "ok": True,
        }

    try:
        content, _ = await _post_chat_completion(
            target, messages, payload_extras,
        )
        return await _parse(content)
    except Exception as exc:
        logger.warning(
            "[CALENDAR_EXTRACT] primary LLM falhou (source=%s): %s",
            target["source"], exc,
        )
        # Fallback 9router.
        fallback = {
            "baseUrl": NINEROUTER_BASE_URL.rstrip("/"),
            "model": NINEROUTER_DEFAULT_MODEL,
            "apiKey": NINEROUTER_API_KEY,
            "provider": "hermes_vps",
            "source": "hermes_vps",
        }
        try:
            content, _ = await _post_chat_completion(
                fallback, messages, payload_extras,
            )
            return await _parse(content)
        except Exception as exc2:
            logger.warning("[CALENDAR_EXTRACT] fallback também falhou: %s", exc2)
            return {"should_schedule": False, "ok": False}


async def _maybe_create_calendar_event(
    instance: str,
    lead: dict[str, Any],
    patient_text: str,
    ai_reply: str,
    history: list[dict[str, Any]],
    tenant_cfg: dict[str, Any],
    detected_stage: str | None,
) -> None:
    """Plan B: detecta intent de agendamento e cria evento direto via MCP.

    Disparado depois que a IA já respondeu o paciente. Se a conversa tem
    intent claro + horário concreto:
      1. Extrai params via 2ª chamada LLM estruturada.
      2. Chama GOOGLECALENDAR_CREATE_EVENT via Composio MCP direto.
      3. Envia follow-up WhatsApp com htmlLink do evento.
      4. Persiste event_id no lead (notes + clinical_summary).

    Falha em qualquer etapa é logada e silenciosamente ignorada (não
    derruba o dispatch principal). O paciente recebe o link se e somente
    se a tool retornou success_count=1 com htmlLink literal na resposta.
    """
    try:
        if not _looks_like_schedule_request(patient_text, history, detected_stage):
            return
        if not COMPOSIO_MCP_URL or not COMPOSIO_MCP_API_KEY:
            logger.warning(
                "[%s] [CALENDAR] MCP não configurado, pulando criação automática",
                instance,
            )
            return

        # 1. Extrai parâmetros estruturados via LLM.
        extracted = await _extract_schedule_params(tenant_cfg, history, patient_text)
        if not extracted.get("ok") or not extracted.get("should_schedule"):
            logger.info(
                "[%s] [CALENDAR] extrator devolveu should_schedule=false — paciente sem horário confirmado",
                instance,
            )
            return

        start_iso = (extracted.get("start_datetime") or "").strip()
        end_iso = (extracted.get("end_datetime") or "").strip()
        summary = (extracted.get("summary") or "").strip()
        description = (extracted.get("description") or "").strip()
        attendee_email = (extracted.get("attendee_email") or "").strip() or None

        # Validação mínima — não envia argumentos quebrados pro Composio.
        if not (start_iso and end_iso and summary):
            logger.warning(
                "[%s] [CALENDAR] params incompletos: start=%r end=%r summary=%r",
                instance, start_iso, end_iso, summary,
            )
            return
        # Reforço do timezone — Natal é -03:00 fixo (não tem DST).
        if "-03:00" not in start_iso or "-03:00" not in end_iso:
            logger.warning(
                "[%s] [CALENDAR] sem offset -03:00 (start=%r end=%r) — abortando",
                instance, start_iso, end_iso,
            )
            return

        # 2. Chama Composio MCP direto (search → execute).
        tenant_user_id = (
            (tenant_cfg.get("composio_user_id") or COMPOSIO_DEFAULT_TENANT_USER_ID)
            .strip()
        )

        # Search: descobre slug exato + schema (idempotente, baixo custo).
        search_args = {
            "queries": [{"use_case": "create google calendar event with attendee"}],
        }
        try:
            search_resp = await _composio_mcp_call(
                "COMPOSIO_SEARCH_TOOLS", {
                    **search_args,
                    "user_id": tenant_user_id,
                },
            )
            logger.info(
                "[%s] [CALENDAR] MCP search OK",
                instance,
            )
        except Exception as exc:
            logger.warning(
                "[%s] [CALENDAR] MCP search falhou: %s — abortando",
                instance, exc,
            )
            return

        # 3. Executa GOOGLECALENDAR_CREATE_EVENT.
        #    Schema Composio: tools é array de {tool_slug, arguments}.
        exec_arguments: dict[str, Any] = {
            "summary": summary,
            "start_datetime": start_iso,
            "end_datetime": end_iso,
            "description": description,
            "timezone": "America/Fortaleza",  # Natal-RN
            "calendar_id": "primary",
        }
        if attendee_email:
            exec_arguments["attendees"] = [attendee_email]
        exec_args = {
            "tools": [
                {
                    "tool_slug": "GOOGLECALENDAR_CREATE_EVENT",
                    "arguments": exec_arguments,
                }
            ],
            "user_id": tenant_user_id,
        }

        try:
            exec_resp = await _composio_mcp_call(
                "COMPOSIO_MULTI_EXECUTE_TOOL", exec_args,
            )
        except Exception as exc:
            logger.warning(
                "[%s] [CALENDAR] MCP execute falhou: %s",
                instance, exc,
            )
            return

        # 4. Extrai htmlLink real da resposta (anti-alucinação).
        html_link, event_id = _extract_event_link_from_mcp(exec_resp)
        if not html_link:
            logger.warning(
                "[%s] [CALENDAR] MCP executou mas sem htmlLink na resposta: %s",
                instance, str(exec_resp)[:500],
            )
            # Envia mensagem honesta ao paciente: failure de criação.
            failure_msg = (
                "Tentei criar o evento no Google Calendar, mas a resposta veio "
                "sem link de confirmação. Nossa equipe confirma o horário em "
                "instantes. Posso ajudar em algo mais?"
            )
            await _send_evolution_text(instance, lead.get("phone", ""), failure_msg)
            try:
                sb.table("messages").insert({
                    "tenant_id": tenant_cfg.get("id") or lead.get("tenant_id"),
                    "lead_id": lead["id"],
                    "sender": "ai",
                    "content": failure_msg,
                    "created_at": _now_iso(),
                }).execute()
            except Exception:
                pass
            return

        # 5. Sucesso! Envia follow-up WhatsApp com link REAL do Calendar.
        followup = (
            f"✅ Consulta agendada!\n\n"
            f"📅 {summary}\n"
            f"🕐 {start_iso.replace('T', ' ').replace('-03:00', '')} (BRT)\n\n"
            f"🔗 Link do convite no Google Calendar:\n{html_link}\n\n"
            f"Qualquer coisa é só chamar aqui."
        )
        send_ok = await _send_evolution_text(instance, lead.get("phone", ""), followup)
        logger.info(
            "[%s] [CALENDAR] follow-up enviado ok=%s event_id=%s link=%s",
            instance, send_ok.get("ok"), event_id, html_link[:80],
        )

        # 6. Persiste event_id no lead (somente se a coluna existir — tolerância
        #    ao deploy incremental; migração SQL roda depois pra adicionar).
        try:
            sb.table("leads").update({
                "last_interaction": _now_iso(),
            }).eq("id", lead["id"]).execute()
        except Exception as exc:
            logger.warning(
                "[%s] [CALENDAR] falha ao atualizar last_interaction: %s",
                instance, exc,
            )

        # 7. Grava follow-up também em messages pra histórico ficar completo
        #    — esse é o record canônico do evento criado (com htmlLink real).
        try:
            sb.table("messages").insert({
                "tenant_id": tenant_cfg.get("id") or lead.get("tenant_id"),
                "lead_id": lead["id"],
                "sender": "ai",
                "content": followup,
                "created_at": _now_iso(),
            }).execute()
        except Exception:
            pass

        logger.info(
            "[%s] [CALENDAR] ✅ evento criado event_id=%s link=%s",
            instance, event_id, html_link[:80],
        )
    except Exception as exc:
        logger.exception("[%s] _maybe_create_calendar_event falhou: %s", instance, exc)


def _extract_event_link_from_mcp(exec_resp: Any) -> tuple[str | None, str | None]:
    """Extrai (htmlLink, eventId) da resposta do GOOGLECALENDAR_CREATE_EVENT.

    A resposta pode vir aninhada em vários níveis dependendo do path
    `success → response_data → htmlLink` ou `data → response_data → ...`
    ou em `result.content[*].text` (texto JSON dentro do envelope MCP).
    """
    # 1) Achata dict/JSON procurando chaves relevantes.
    candidates = []

    def _walk(node: Any, trail: list[str]) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                _walk(v, trail + [str(k)])
        elif isinstance(node, list):
            for i, item in enumerate(node):
                _walk(item, trail + [f"[{i}]"])
        elif isinstance(node, str) and node.startswith("{"):
            # Texto que parece JSON serializado — tenta parsear e re-walk.
            try:
                inner = json.loads(node)
            except Exception:
                return
            _walk(inner, trail + ["<json-string>"])

    _walk(exec_resp, [])

    # Reune todos os htmlLink-like strings e event_id-like values.
    html_link = None
    event_id = None
    # Walk e coleta valores de chaves que terminam em htmlLink/hangoutLink.
    def _collect(node: Any) -> None:
        nonlocal html_link, event_id
        if isinstance(node, dict):
            for k, v in node.items():
                kl = k.lower()
                if isinstance(v, str):
                    if "htmllink" in kl and "google" in v.lower():
                        if not html_link:
                            html_link = v
                    if "event_id" in kl or kl == "id":
                        if not event_id and len(v) > 5:
                            event_id = v
                _collect(v)
        elif isinstance(node, list):
            for item in node:
                _collect(item)
        elif isinstance(node, str) and node.startswith("{"):
            try:
                _collect(json.loads(node))
            except Exception:
                pass

    _collect(exec_resp)
    return html_link, event_id


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


@app.put("/tenants/{tenant_id}/ai-auto-reply")
async def set_tenant_ai_auto_reply(
    tenant_id: str,
    request: Request,
) -> dict[str, Any]:
    """Liga/desliga o Plantão IA pra um tenant.

    Body: {"enabled": true|false}

    Persiste na coluna `ai_auto_reply_enabled` e invalida o cache em memória
    pra que o próximo webhook já respeite o novo estado (sem esperar TTL).
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")
    if not isinstance(body, dict) or "enabled" not in body:
        raise HTTPException(status_code=400, detail="missing 'enabled'")

    enabled = bool(body["enabled"])

    res = (
        sb.table("tenants")
        .update({"ai_auto_reply_enabled": enabled})
        .eq("id", tenant_id)
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(
            status_code=500,
            detail=f"supabase: {res.error.message}",  # type: ignore[attr-defined]
        )

    _invalidate_tenant_cache(tenant_id)
    logger.info(
        "🌙 [tenant %s] ai_auto_reply_enabled = %s (cache invalidado)",
        tenant_id,
        enabled,
    )

    return {
        "ok": True,
        "tenant_id": tenant_id,
        "ai_auto_reply_enabled": enabled,
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
