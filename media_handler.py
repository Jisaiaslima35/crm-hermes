"""
media_handler.py — Processador de Mídia Local (Whisper + 9Router Multimodal)
Para CRM Hermes e Prospector.

ATUALIZADO 01/10 — Isaías msg 5441:
- STT roda 100% LOCAL via faster-whisper. Removido fallback Gemini/9Router
  (dava 429 quando many tenants batiam em paralelo).
- Vision (imagens) usa 9Router com fallback automático Gemini → MiniMax M3
  quando Gemini rate-limit. Modelo configurável via NINEROUTER_VISION_MODEL
  (default: gemini-2.5-flash). Imagem vai como image_url data:{};base64 via
  /chat/getBase64FromMediaMessage da Evolution API.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import subprocess
import tempfile
from typing import Any, Optional, Tuple

import httpx

logger = logging.getLogger("media_handler")

# Configurações do 9Router (porta 20128 local)
NINEROUTER_BASE_URL = os.environ.get(
    "NINEROUTER_BASE_URL", "http://127.0.0.1:20128/v1"
)
NINEROUTER_API_KEY = os.environ.get("NINEROUTER_API_KEY", "")
# Modelos Multimodal (configuráveis via ENV; nunca hardcoded em cliente final)
NINEROUTER_VISION_MODEL = os.environ.get(
    "NINEROUTER_VISION_MODEL", "gemini/gemini-2.5-flash"
)
# ATENÇÃO 01/10: o "nvidia/minimaxai/minimax-m3" via 9Router está EOL desde
# 2026-09-09 (confirmado via curl — retorna HTTP 410 Gone). Pipeline de visão
# agora é: 9Router (Gemini) → MiniMax API oficial (último recurso).
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")
MINIMAX_API_URL = os.environ.get(
    "MINIMAX_API_URL", "https://api.minimax.io/anthropic"
)
MINIMAX_VISION_MODEL = os.environ.get("MINIMAX_VISION_MODEL", "MiniMax-M3")

# Singleton global para o modelo faster-whisper
_whisper_model = None
_whisper_lock = asyncio.Lock()


def get_whisper_model():
    """Retorna instância singleton do WhisperModel na CPU com quantização int8."""
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        logger.info("⚡ [Whisper] Inicializando modelo faster-whisper (base, int8)...")
        # 'base' já está em cache em /root/.cache/huggingface/hub/
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
        logger.info("✅ [Whisper] Modelo carregado em memória com sucesso.")
    return _whisper_model


async def get_media_base64_from_evolution(
    instance: str,
    message_data: dict[str, Any],
    evo_base_url: str,
    evo_api_key: str,
) -> Optional[Tuple[str, str]]:
    """
    Obtém o base64 e mimetype de uma mensagem de mídia da Evolution API.
    Retorna (base64_str, mimetype) ou None se não conseguir.
    """
    msg = message_data.get("message") or {}

    # 1. Verifica se o base64 já veio embutido no payload
    for loc in (
        message_data,
        msg,
        msg.get("audioMessage") or {},
        msg.get("imageMessage") or {},
        msg.get("documentMessage") or {},
    ):
        b64 = loc.get("base64")
        if b64:
            mimetype = loc.get("mimetype") or "application/octet-stream"
            # Limpa prefixos data:URL se houver
            if "," in b64 and ";base64," in b64:
                header, b64 = b64.split(";base64,", 1)
                if ":" in header:
                    mimetype = header.split(":", 1)[1]
            return b64.strip(), mimetype

    # 2. Se não veio embutido, busca no endpoint oficial da Evolution
    url = f"{evo_base_url.rstrip('/')}/chat/getBase64FromMediaMessage/{instance}"
    headers = {"apikey": evo_api_key, "Content-Type": "application/json"}
    payload = {"message": message_data, "convertToMp4": False}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            # FIX 01/10: Evolution API v2.3.7 retorna 201 Created nesse endpoint
            # (não 200 OK). Aceitar qualquer 2xx pra não quebrar o pipeline de
            # mídia. Bug afetou áudio+imagem em prod — Whisper/Vision nunca
            # recebiam o base64, IA só via placeholder.
            if 200 <= resp.status_code < 300:
                res_data = resp.json()
                b64 = res_data.get("base64")
                if b64:
                    mimetype = res_data.get("mimetype") or "application/octet-stream"
                    if "," in b64 and ";base64," in b64:
                        header, b64 = b64.split(";base64,", 1)
                        if ":" in header:
                            mimetype = header.split(":", 1)[1]
                    return b64.strip(), mimetype
                logger.warning(
                    "[Evolution] getBase64FromMediaMessage %d sem campo base64: %s",
                    resp.status_code, resp.text[:100],
                )
            else:
                logger.warning(
                    "[Evolution] getBase64FromMediaMessage status=%d body=%s",
                    resp.status_code,
                    resp.text[:100],
                )
    except Exception as exc:
        logger.error("[Evolution] Falha ao consultar getBase64FromMediaMessage: %s", exc)

    return None


def _convert_to_wav(input_path: str, output_path: str) -> bool:
    """Converte qualquer formato de áudio (opus, ogg, m4a) para WAV 16kHz mono via ffmpeg."""
    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            input_path,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-f",
            "wav",
            output_path,
        ]
        res = subprocess.run(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10
        )
        return res.returncode == 0
    except Exception as e:
        logger.warning("[FFmpeg] Erro ao converter áudio: %s", e)
        return False


def _transcribe_with_whisper(wav_path: str) -> str:
    """Executa a transcrição com faster-whisper local."""
    model = get_whisper_model()
    segments, info = model.transcribe(
        wav_path,
        language="pt",
        beam_size=1,
        temperature=0.0,
        vad_filter=True,
    )
    parts = [seg.text.strip() for seg in segments if seg.text]
    return " ".join(parts).strip()


async def _transcribe_with_9router(b64_audio: str, audio_format: str = "wav") -> str:
    """
    DEPRECATED 01/10 — mantido só pra referência histórica. Não é mais chamado
    pelo process_audio_message (Isaías msg 5440 — STT 100% local).
    """
    return ""


async def process_audio_message(b64_audio: str) -> str:
    """
    Pipeline completo de transcrição de áudio:
    1. Salva buffer e converte com ffmpeg para WAV 16kHz
    2. Transcreve com faster-whisper local (100% local, sem fallback externo)

    Removido 01/10 (Isaías msg 5441) o fallback 9Router/Gemini — dava HTTP 429
    quando múltiplos tenants batiam em paralelo. Whisper local atende todos
    os clientes sem rate limit. Se Whisper falhar/retornar vazio, retorna ""
    e o caller marca `[Áudio enviado pelo paciente]` no log de contexto.
    """
    if not b64_audio:
        return ""

    try:
        raw_bytes = base64.b64decode(b64_audio)
    except Exception as e:
        logger.error("Falha ao decodificar base64 de áudio: %s", e)
        return ""

    with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as raw_file, \
         tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wav_file:
        raw_path = raw_file.name
        wav_path = wav_file.name
        raw_file.write(raw_bytes)

    transcribed_text = ""
    try:
        # Converte para WAV padrão 16kHz
        if _convert_to_wav(raw_path, wav_path):
            transcribe_target = wav_path
        else:
            transcribe_target = raw_path

        # Whisper Local é o ÚNICO caminho agora (sem fallback externo)
        try:
            loop = asyncio.get_running_loop()
            transcribed_text = await loop.run_in_executor(
                None, _transcribe_with_whisper, transcribe_target
            )
            if transcribed_text:
                logger.info("🎤 [Whisper Local] Transcrição concluída: %r", transcribed_text[:80])
            else:
                logger.warning("⚠️ [Whisper Local] Retornou vazio (sem fala detectada?)")
        except Exception as whisper_err:
            logger.warning("⚠️ [Whisper Local] Falhou: %s", whisper_err)

    finally:
        # Limpa arquivos temporários
        for p in (raw_path, wav_path):
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass

    return transcribed_text.strip()


async def _call_9router_vision(
    messages: list[dict[str, Any]],
    model: str,
    timeout_s: float = 20.0,
) -> tuple[int, str]:
    """Faz UMA chamada ao 9Router com modelo multimodal explícito.
    Retorna (status_code, content). Erros de rede retornam (-1,'')."""
    url = f"{NINEROUTER_BASE_URL.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {NINEROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 500,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                content = (
                    (data.get("choices") or [{}])[0]
                    .get("message", {})
                    .get("content", "")
                )
                return 200, (content or "").strip()
            return resp.status_code, resp.text[:200]
    except Exception as exc:
        logger.error("[9Router Vision] Erro de conexão (model=%s): %s", model, exc)
        return -1, str(exc)[:200]


async def process_image_message(
    b64_image: str,
    mimetype: str = "image/jpeg",
    system_instruction: str = "",
    caption: str = "",
) -> str:
    """
    Pipeline de análise de imagem (WhatsApp inbound):
    1. Monta payload multimodal com image_url data:{mimetype};base64,{b64}
       (o base64 é capturado via Evolution API /chat/getBase64FromMediaMessage)
    2. Tenta Gemini (default gemini-2.5-flash) — modelo primário multimodal
    3. Se Gemini retornar 429/503/timeout/erro, cai pra MiniMax M3 (nvidia
       route) automaticamente — assim a clínica nunca fica sem leitura de
       imagem, mesmo se Gemini rate-limit.
    """
    if not b64_image:
        return ""

    if not mimetype or not mimetype.startswith("image/"):
        mimetype = "image/jpeg"

    user_prompt = "O usuário enviou uma imagem pelo WhatsApp."
    if caption:
        user_prompt += f" Mensagem/Legenda acompanhante: '{caption}'."
    user_prompt += " Por favor, analise a imagem e forneça a resposta ou orientação apropriada:"

    messages: list[dict[str, Any]] = []
    if system_instruction:
        messages.append({"role": "system", "content": system_instruction})
    messages.append({
        "role": "user",
        "content": [
            {"type": "text", "text": user_prompt},
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mimetype};base64,{b64_image}"},
            },
        ],
    })

    # Tentativa 1: Gemini via 9Router (primary, validado em smoke test 01/10)
    status, content = await _call_9router_vision(messages, NINEROUTER_VISION_MODEL)
    if status == 200 and content:
        logger.info("🖼️ [Vision Gemini 9Router] OK (%s): %r", NINEROUTER_VISION_MODEL, content[:80])
        return content
    logger.warning("[Vision Gemini 9Router] Falhou model=%s status=%d body=%r — acionando MiniMax API oficial",
                   NINEROUTER_VISION_MODEL, status, content[:120])

    # Tentativa 2: MiniMax M3 API oficial (último recurso, plano pago do token plan)
    # O 9Router parou de rotear minimax-m3 (EOL 09/09), então a contingência
    # é bater direto na API MiniMax. Isaías msg 5443 confirmou esse caminho.
    if MINIMAX_API_KEY:
        try:
            # Converte formato OpenAI (image_url) → Anthropic (image base64 source)
            # porque a API MiniMax-Anthropic usa Messages API com content blocks.
            anth_content: list[dict[str, Any]] = []
            if system_instruction:
                anth_content.append({"type": "text", "text": system_instruction})
            # Extrai image do messages original
            user_content = (messages[-1] or {}).get("content", [])
            if isinstance(user_content, list):
                for block in user_content:
                    if block.get("type") == "text":
                        anth_content.append({"type": "text", "text": block["text"]})
                    elif block.get("type") == "image_url":
                        url = block["image_url"]["url"]
                        # data:image/jpeg;base64,XXXX → media_type + data
                        if url.startswith("data:") and ";base64," in url:
                            header, b64_data = url.split(";base64,", 1)
                            media_type = header.split(":", 1)[1] if ":" in header else "image/jpeg"
                            anth_content.append({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": b64_data,
                                },
                            })
            anth_payload = {
                "model": MINIMAX_VISION_MODEL,
                "max_tokens": 500,
                "messages": [{"role": "user", "content": anth_content}],
            }
            url_minimax = f"{MINIMAX_API_URL.rstrip('/')}/v1/messages"
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    url_minimax,
                    json=anth_payload,
                    headers={
                        "x-api-key": MINIMAX_API_KEY,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    },
                )
            if resp.status_code == 200:
                data = resp.json()
                # Anthropic Messages API: content é lista de blocks {type,text}
                blocks = data.get("content") or []
                text_chunks = [b.get("text", "") for b in blocks if b.get("type") == "text"]
                full_text = " ".join(t for t in text_chunks if t).strip()
                if full_text:
                    logger.info("🖼️ [Vision MiniMax API OFICIAL] OK fallback: %r", full_text[:80])
                    return full_text
                logger.warning("[Vision MiniMax API OFICIAL] Resposta 200 sem texto: %r", str(data)[:200])
            else:
                logger.error("[Vision MiniMax API OFICIAL] HTTP %d: %s", resp.status_code, resp.text[:200])
        except Exception as exc:
            logger.error("[Vision MiniMax API OFICIAL] Erro: %s", exc)
    else:
        logger.error("[Vision MiniMax API OFICIAL] MINIMAX_API_KEY ausente — fallback indisponível")

    return ""
