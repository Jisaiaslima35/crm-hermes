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
import re
import subprocess
import tempfile
from typing import Any, Optional, Tuple

import httpx

from dotenv import load_dotenv

logger = logging.getLogger("media_handler")

# Carrega .env do projeto e secrets do Hermes
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
for _secret in ("9router.env", "evolution.env", "composio.env"):
    _p = os.path.join("/root/.hermes/secrets", _secret)
    if os.path.exists(_p):
        try:
            load_dotenv(_p, override=False)
        except Exception:
            pass

# Cofre de credenciais do Claudinho (MINIMAX_API_KEY vive aqui — Sprint D 03/11).
# NUNCA gravar valor de chave em arquivo versionado: só carrega, não imprime.
_COFRE_ENV = "/home/claudeuser/claudinho-secrets/secrets.env"
if os.path.exists(_COFRE_ENV):
    try:
        load_dotenv(_COFRE_ENV, override=False)
    except Exception:
        pass

# Cache dos modelos Whisper fica na home do claudeuser (o app roda como root e
# a cache do root está vazia — sem isso ele baixaria o modelo toda vez).
if not os.environ.get("HF_HOME") and os.path.isdir("/home/claudeuser/.cache/huggingface"):
    os.environ["HF_HOME"] = "/home/claudeuser/.cache/huggingface"


def _get_9router_api_key() -> str:
    return (
        os.environ.get("NINEROUTER_API_KEY")
        or os.environ.get("HERMES_CUSTOM_9ROUTER_AUTOMACAOJS_US_API_KEY")
        or ""
    ).strip()


def _get_9router_base_url() -> str:
    return os.environ.get(
        "NINEROUTER_BASE_URL", "https://9router.automacaojs.us/v1"
    ).strip()


# Modelos Multimodal (configuráveis via ENV; nunca hardcoded em cliente final)
NINEROUTER_VISION_MODEL = os.environ.get(
    "NINEROUTER_VISION_MODEL", "gemini/gemini-2.5-flash"
)
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")
MINIMAX_API_URL = os.environ.get(
    "MINIMAX_API_URL", "https://api.minimax.io/anthropic"
)
MINIMAX_VISION_MODEL = os.environ.get("MINIMAX_VISION_MODEL", "MiniMax-M3")

# ---------------------------------------------------------------------------
# Pipeline de áudio — Sprint D (Isaías, Telegram 5999, 03/11/2026)
# Regra de ouro: "na dúvida, não qualifica". Áudio inaudível/ruído/baixa
# confiança NUNCA vira texto nem agendamento — vira [AUDIO_INAUDIVEL].
# ---------------------------------------------------------------------------
WHISPER_PRIMARY_MODEL = os.environ.get("WHISPER_MODEL_SIZE", "base")
WHISPER_FALLBACK_MODEL = os.environ.get("WHISPER_FALLBACK_MODEL_SIZE", "small")
# Limiares de confiança (calibrados no teste com áudio real da clínica)
WHISPER_MIN_AVG_LOGPROB = float(os.environ.get("WHISPER_MIN_AVG_LOGPROB", "-1.2"))
WHISPER_MAX_NO_SPEECH = float(os.environ.get("WHISPER_MAX_NO_SPEECH", "0.60"))
# Cobertura mínima de fala esperada (texto/duração do áudio) antes de desconfiar
# do corte do VAD e chamar o fallback externo
WHISPER_MIN_COVERAGE = float(os.environ.get("WHISPER_MIN_COVERAGE", "0.50"))
# Fallback externo de STT (9Router). 9Router não tem modelo com audio_input
# declarado, mas o Gemini e o MiniMax-M3 aceitam áudio inline via input_audio
# (validado em 03/11 com áudio real da clínica).
AUDIO_EXTERNAL_MODELS = [
    m.strip()
    for m in os.environ.get(
        "AUDIO_EXTERNAL_MODELS",
        "gemini/gemini-3.6-flash,nvidia/minimaxai/minimax-m3,kimi/k2-thinking",
    ).split(",")
    if m.strip()
]
AUDIO_EXTERNAL_TIMEOUT_S = float(os.environ.get("AUDIO_EXTERNAL_TIMEOUT_S", "180"))
AUDIO_EXTERNAL_MAX_SECONDS = float(os.environ.get("AUDIO_EXTERNAL_MAX_SECONDS", "600"))

# Marcadores oficiais (o sumarizador e a UI dependem desses textos exatos)
TAG_AUDIO_INAUDIVEL = "[AUDIO_INAUDIVEL]"
TAG_CONTEUDO_IMAGEM = "[CONTEÚDO DA IMAGEM:"
TAG_IMAGEM_RECEBIDA = "[IMAGEM_RECEBIDA]"
TAG_CONTEUDO_DOCUMENTO = "[CONTEÚDO DO DOCUMENTO:"

# Singleton global para o modelo faster-whisper (um por tamanho)
_whisper_model = None
_whisper_models: dict[str, Any] = {}
_whisper_lock = asyncio.Lock()


def get_whisper_model(size: str | None = None):
    """Retorna instância singleton do WhisperModel na CPU com quantização int8.

    O tamanho default é `base` (rápido). `small` é o fallback local quando o
    base devolve vazio/baixa confiança.
    """
    global _whisper_model
    size = (size or WHISPER_PRIMARY_MODEL or "base").strip()
    if size == WHISPER_PRIMARY_MODEL and _whisper_model is not None:
        return _whisper_model
    if size in _whisper_models:
        return _whisper_models[size]
    from faster_whisper import WhisperModel

    logger.info(
        "⚡ [Whisper] Inicializando faster-whisper (%s, int8, CPU) HF_HOME=%s",
        size, os.environ.get("HF_HOME", "(default)"),
    )
    model = WhisperModel(size, device="cpu", compute_type="int8")
    _whisper_models[size] = model
    if size == WHISPER_PRIMARY_MODEL:
        _whisper_model = model
    logger.info("✅ [Whisper] Modelo %s carregado em memória.", size)
    return model


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
    """Executa a transcrição com faster-whisper local (compatibilidade)."""
    return _transcribe_whisper_detalhado(wav_path, WHISPER_PRIMARY_MODEL, vad=True).get("texto", "")


def _transcribe_whisper_detalhado(
    wav_path: str,
    size: str = "base",
    vad: bool = True,
) -> dict[str, Any]:
    """Transcreve localmente e devolve TEXTO + MÉTRICAS de confiança.

    Devolve:
      texto        — transcrição concatenada (vazia se não houver fala)
      avg_logprob  — média de log-prob do decodificador (>-1.2 = confiável)
      no_speech    — probabilidade de o trecho ser silêncio/ruído
      cobertura    — duração da fala / duração total do áudio
      duracao_s    — duração do áudio em segundos
    """
    model = get_whisper_model(size)
    segments, info = model.transcribe(
        wav_path,
        language="pt",
        beam_size=1,
        temperature=0.0,
        vad_filter=vad,
        initial_prompt="Consulta médica psiquiátrica clínica Dr. Matheus Dore agendamento receitas",
    )
    parts: list[str] = []
    logprobs: list[float] = []
    no_speech: list[float] = []
    fala_s = 0.0
    for seg in segments:
        if not seg.text:
            continue
        parts.append(seg.text.strip())
        try:
            logprobs.append(float(seg.avg_logprob))
            no_speech.append(float(seg.no_speech_prob))
            fala_s += max(0.0, float(seg.end) - float(seg.start))
        except Exception:
            pass
    duracao = float(getattr(info, "duration", 0.0) or 0.0)
    return {
        "texto": " ".join(parts).strip(),
        "avg_logprob": (sum(logprobs) / len(logprobs)) if logprobs else None,
        "no_speech": (sum(no_speech) / len(no_speech)) if no_speech else None,
        "cobertura": (fala_s / duracao) if duracao else 0.0,
        "duracao_s": duracao,
        "segmentos": len(parts),
    }


def _avaliar_transcricao(
    texto: str,
    avg_logprob: float | None = None,
    no_speech: float | None = None,
) -> tuple[str, str]:
    """Julga a transcrição: (status, motivo). status = ok | inaudivel.

    Regra de ouro da Sprint D: na dúvida NÃO qualifica. Voz inaudível, ruído
    puro ou confiança baixa NUNCA viram texto de consulta.
    """
    limpo = (texto or "").strip()
    if not limpo:
        return "inaudivel", "sem fala detectada"
    letras = sum(1 for c in limpo if c.isalpha())
    if letras < 3:
        return "inaudivel", "sem conteudo verbal"
    if no_speech is not None and no_speech > WHISPER_MAX_NO_SPEECH:
        return "inaudivel", f"no_speech_prob={no_speech:.2f} > {WHISPER_MAX_NO_SPEECH}"
    if avg_logprob is not None and avg_logprob < WHISPER_MIN_AVG_LOGPROB:
        return "inaudivel", f"avg_logprob={avg_logprob:.2f} < {WHISPER_MIN_AVG_LOGPROB}"
    # repetição/rumor: poucas palavras distintas em texto longo
    palavras = [p for p in limpo.lower().split() if p.isalpha()]
    if len(palavras) >= 8:
        distintas = len(set(palavras))
        if distintas / len(palavras) < 0.30:
            return "inaudivel", "texto repetitivo (ruido)"
    return "ok", ""


def _convert_to_mp3(input_path: str, output_path: str, max_seconds: float | None = None) -> bool:
    """Converte para MP3 mono 16kHz/48kbps (payload pequeno para o fallback externo)."""
    try:
        cmd = ["ffmpeg", "-y", "-i", input_path, "-t", str(int(max_seconds)), "-ar", "16000",
               "-ac", "1", "-b:a", "48k", "-f", "mp3", output_path]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        return res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0
    except Exception as e:
        logger.warning("[FFmpeg] Erro ao converter áudio para mp3: %s", e)
        return False


async def _transcribe_external_9router(b64_audio: str, audio_format: str = "mp3") -> tuple[str, str]:
    """Fallback externo de STT via 9Router (Gemini / MiniMax-M3 / Kimi).

    Só é chamado quando o Whisper LOCAL não conseguiu (vazio, inaudível ou
    confiança baixa) — o áudio do paciente sai da VPS apenas nesse caso.
    Retorna (texto, motor). Motor vazio = nenhum modelo respondeu.
    """
    base_url = _get_9router_base_url()
    api_key = _get_9router_api_key()
    if not api_key:
        return "", ""
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    for model in AUDIO_EXTERNAL_MODELS:
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Transcreva este áudio em português do Brasil, de forma literal e "
                                "completa, sem resumir, sem interpretar e sem inventar. Se não houver "
                                "fala audível, responda exatamente: [SEM FALA]."
                            ),
                        },
                        {"type": "input_audio", "input_audio": {"data": b64_audio, "format": audio_format}},
                    ],
                }
            ],
            "temperature": 0.0,
            "max_tokens": 2000,
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=AUDIO_EXTERNAL_TIMEOUT_S) as client:
                resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code != 200:
                logger.warning(
                    "[STT externo] %s respondeu HTTP %d: %s",
                    model, resp.status_code, resp.text[:140],
                )
                continue
            data = resp.json()
            texto = (
                (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
            ).strip()
            if not texto:
                continue
            if "[SEM FALA]" in texto.upper() and len(texto) < 30:
                logger.info("[STT externo] %s: sem fala audível", model)
                continue
            status, motivo = _avaliar_transcricao(texto)
            if status != "ok":
                logger.warning("[STT externo] %s respondeu áudio inaudível (%s)", model, motivo)
                continue
            logger.info("🎤 [STT externo %s] OK: %r", model, texto[:80])
            return texto, f"9router:{model}"
        except Exception as exc:
            logger.error("[STT externo] %s falhou: %s", model, exc)
            continue
    return "", ""


async def process_audio_message_detalhado(b64_audio: str) -> dict[str, Any]:
    """Pipeline de áudio com fallback seguro (Sprint D, 03/11/2026).

    Cadeia:
      1. Whisper LOCAL `base` (primário, sem custo, sem sair da VPS)
      2. Whisper LOCAL `small` sem VAD (cobre o que o VAD cortou)
      3. 9Router externo (Gemini → MiniMax-M3 → Kimi) só se o local falhar
      4. Nada disso serviu → status=inaudivel e marca [AUDIO_INAUDIVEL].
         NUNCA chutar palavra, NUNCA virar agendamento.

    Devolve: {texto, status, motor, confianca, observacao}
    """
    vazio = {"texto": "", "status": "erro", "motor": "", "confianca": None, "observacao": ""}
    if not b64_audio:
        vazio["observacao"] = "sem audio"
        return vazio

    try:
        raw_bytes = base64.b64decode(b64_audio)
    except Exception as e:
        logger.error("Falha ao decodificar base64 de áudio: %s", e)
        vazio["observacao"] = f"base64 invalido: {e}"
        return vazio

    with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as raw_file, \
         tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wav_file, \
         tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as mp3_file:
        raw_path, wav_path, mp3_path = raw_file.name, wav_file.name, mp3_file.name
        raw_file.write(raw_bytes)

    try:
        wav_ok = _convert_to_wav(raw_path, wav_path)
        alvo = wav_path if wav_ok else raw_path

        # --- 1) Whisper local (primário) ---
        melhor: dict[str, Any] = {"texto": "", "status": "erro", "motor": "", "confianca": None, "observacao": ""}
        try:
            loop = asyncio.get_running_loop()
            meta = await loop.run_in_executor(
                None, _transcribe_whisper_detalhado, alvo, WHISPER_PRIMARY_MODEL, True
            )
            status, motivo = _avaliar_transcricao(meta.get("texto"), meta.get("avg_logprob"), meta.get("no_speech"))
            logger.info(
                "🎤 [Whisper %s] status=%s logprob=%s nospeech=%s cobertura=%.2f dur=%.1fs",
                WHISPER_PRIMARY_MODEL, status, meta.get("avg_logprob"), meta.get("no_speech"),
                meta.get("cobertura") or 0.0, meta.get("duracao_s") or 0.0,
            )
            melhor = {
                "texto": meta.get("texto", "") if status == "ok" else "",
                "status": status,
                "motor": f"whisper:{WHISPER_PRIMARY_MODEL}",
                "confianca": meta.get("avg_logprob"),
                "observacao": motivo,
                "_cobertura": meta.get("cobertura") or 0.0,
                "_duracao": meta.get("duracao_s") or 0.0,
            }
        except Exception as whisper_err:
            logger.warning("⚠️ [Whisper %s] Falhou: %s", WHISPER_PRIMARY_MODEL, whisper_err)
            melhor = {"texto": "", "status": "erro", "motor": f"whisper:{WHISPER_PRIMARY_MODEL}",
                      "confianca": None, "observacao": str(whisper_err)[:120],
                      "_cobertura": 0.0, "_duracao": 0.0}

        precisa_fallback = melhor["status"] != "ok"
        # Cobertura baixa demais => o VAD provavelmente cortou fala no início
        if not precisa_fallback and melhor.get("_duracao", 0) > 20 and melhor.get("_cobertura", 1.0) < WHISPER_MIN_COVERAGE:
            precisa_fallback = True
            melhor["observacao"] = f"cobertura baixa ({melhor['_cobertura']:.0%})"

        # --- 2) Whisper local `small` sem VAD ---
        if precisa_fallback and WHISPER_FALLBACK_MODEL and WHISPER_FALLBACK_MODEL != WHISPER_PRIMARY_MODEL:
            try:
                loop = asyncio.get_running_loop()
                meta2 = await loop.run_in_executor(
                    None, _transcribe_whisper_detalhado, alvo, WHISPER_FALLBACK_MODEL, False
                )
                status2, motivo2 = _avaliar_transcricao(meta2.get("texto"), meta2.get("avg_logprob"), meta2.get("no_speech"))
                logger.info("🎤 [Whisper %s] status=%s logprob=%s motivo=%s",
                            WHISPER_FALLBACK_MODEL, status2, meta2.get("avg_logprob"), motivo2)
                if status2 == "ok":
                    melhor = {
                        "texto": meta2.get("texto", ""),
                        "status": "ok",
                        "motor": f"whisper:{WHISPER_FALLBACK_MODEL}",
                        "confianca": meta2.get("avg_logprob"),
                        "observacao": "fallback local (VAD desativado)",
                        "_cobertura": meta2.get("cobertura") or 0.0,
                        "_duracao": meta2.get("duracao_s") or 0.0,
                    }
                    precisa_fallback = False
            except Exception as small_err:
                logger.warning("⚠️ [Whisper %s] falhou: %s", WHISPER_FALLBACK_MODEL, small_err)

        # --- 3) Fallback externo (9Router) ---
        if precisa_fallback:
            b64_mp3 = ""
            if _convert_to_mp3(alvo, mp3_path, AUDIO_EXTERNAL_MAX_SECONDS):
                with open(mp3_path, "rb") as fh:
                    b64_mp3 = base64.b64encode(fh.read()).decode()
            if b64_mp3:
                texto_ext, motor_ext = await _transcribe_external_9router(b64_mp3, "mp3")
                if texto_ext:
                    melhor = {
                        "texto": texto_ext,
                        "status": "ok",
                        "motor": motor_ext,
                        "confianca": None,
                        "observacao": "fallback externo (Whisper local não respondeu)",
                        "_cobertura": melhor.get("_cobertura", 0.0),
                        "_duracao": melhor.get("_duracao", 0.0),
                    }
                    precisa_fallback = False

        if melhor["status"] != "ok":
            # Regra de ouro: áudio inaudível NÃO é conteúdo, NÃO é agendamento.
            logger.warning(
                "🎤 %s áudio sem transcrição confiável (%s) — marcado como %s, NÃO entra em relatório nem agenda.",
                TAG_AUDIO_INAUDIVEL, melhor.get("observacao") or "sem fala", TAG_AUDIO_INAUDIVEL,
            )
            return {
                "texto": "",
                "status": "inaudivel",
                "motor": melhor.get("motor", ""),
                "confianca": melhor.get("confianca"),
                "observacao": melhor.get("observacao", ""),
            }

        return {
            "texto": melhor["texto"],
            "status": "ok",
            "motor": melhor["motor"],
            "confianca": melhor.get("confianca"),
            "observacao": melhor.get("observacao", ""),
        }
    finally:
        for p in (raw_path, wav_path, mp3_path):
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass


async def process_audio_message(b64_audio: str) -> str:
    """Atalho compatível: devolve só o texto transcrito ("" se inaudível/erro)."""
    res = await process_audio_message_detalhado(b64_audio)
    return res.get("texto", "") or ""


async def _call_9router_vision(
    messages: list[dict[str, Any]],
    model: str,
    timeout_s: float = 20.0,
) -> tuple[int, str]:
    """Faz UMA chamada ao 9Router com modelo multimodal explícito.
    Retorna (status_code, content). Erros de rede retornam (-1,'')."""
    base_url = _get_9router_base_url()
    api_key = _get_9router_api_key()
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
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
            logger.warning("[9Router Vision] Falhou HTTP %d (model=%s): %s", resp.status_code, model, resp.text[:150])
            return resp.status_code, ""
    except Exception as exc:
        logger.error("[9Router Vision] Erro de conexão (model=%s): %s", model, exc)
        return -1, ""


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


# ---------------------------------------------------------------------------
# Pipeline de visão / documentos — Sprint D (Isaías, Telegram 5999, 03/11/2026)
# Objetivo: extrair o CONTEÚDO OBJETIVO do documento (exame, receita,
# comprovante) e anexar como nota de contexto. Se a imagem for ilegível ou for
# uma foto comum/sticker SEM dado de saúde → marca só [IMAGEM_RECEBIDA],
# sem inventar dado clínico.
# ---------------------------------------------------------------------------

IMAGE_ANALYSIS_PROMPT = """Você é um lector de documentos clínicos e financeiros.

Analise a imagem enviada pelo paciente pelo WhatsApp e classifique o que é:

- "documento_clinico": receita, pedido médico, exame, laudo, atestado, guia
- "comprovante_pagamento": Pix, TED, DOC, recibo, boleto
- "documento_geral": outro documento legível sem conteúdo clínico
- "figura_comum": foto de pessoa, selfie, paisagem, figurinha, print sem dado de saúde
- "ilegivel": não dá para ler o conteúdo

REGRAS INEGOCIÁVEIS:
1. Descreva de forma OBJETIVA o que o documento mostra (tipo, emissor, medicamentos,
   exames, valores, datas). Sem adjetivos, sem diagnóstico inventado, sem suposição.
2. NÃO transcreva CPF, RG, CNS, endereço, telefone, dados bancários completos nem
   o nome completo do paciente. Use apenas o necessário para o contexto clínico.
3. Se não conseguir ler, diga isso. NUNCA invente conteúdo que não está legível.
4. "contem_dado_clinico" é true somente se houver conteúdo de saúde legível
   (medicamento, exame, diagnóstico, laudo). Foto comum é false.

Responda EXCLUSIVAMENTE em JSON puro (sem markdown), neste formato:
{
  "classificacao": "documento_clinico|comprovante_pagamento|documento_geral|figura_comum|ilegivel",
  "legivel": true,
  "contem_dado_clinico": true,
  "descricao": "descrição objetiva em 1-3 frases",
  "itens": ["medicamento/exame/valor legível", "..."]
}"""

_DOCUMENT_TEXT_PROMPT = """Você é um lector de documentos clínicos e financeiros.

Abaixo está o TEXTO extraído de um documento enviado pelo paciente. Classifique e
descreva objetivamente, seguindo as mesmas regras: sem inventar, sem transcrever
CPF/RG/endereço/telefone/dados bancários, sem diagnóstico presumido.

Responda EXCLUSIVAMENTE em JSON puro:
{
  "classificacao": "documento_clinico|comprovante_pagamento|documento_geral|figura_comum|ilegivel",
  "legivel": true,
  "contem_dado_clinico": true,
  "descricao": "descrição objetiva em 1-3 frases",
  "itens": ["..."]
}

TEXTO DO DOCUMENTO:
"""


def _modelos_visao() -> list[str]:
    """Modelos de visão do 9Router, em ordem de tentativa (sem repetir)."""
    reserva = os.environ.get("NINEROUTER_VISION_FALLBACK_MODEL", "gemini/gemini-3.6-flash")
    out: list[str] = []
    for m in (NINEROUTER_VISION_MODEL, reserva):
        m = (m or "").strip()
        if m and m not in out:
            out.append(m)
    return out


async def _call_9router_vision_json(
    messages: list[dict[str, Any]],
    model: str,
    timeout_s: float = 45.0,
) -> tuple[int, str]:
    """Chamada multimodal ao 9Router com JSON estável (temp 0, tokens grandes)."""
    api_key = _get_9router_api_key()
    if not api_key:
        return 0, ""
    url = f"{_get_9router_base_url().rstrip('/')}/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.0,
        "max_tokens": 1200,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(
                url, json=payload,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
        if resp.status_code == 200:
            data = resp.json()
            return 200, ((data.get("choices") or [{}])[0].get("message", {}).get("content", "") or "").strip()
        logger.warning("[9Router visão JSON] HTTP %d (%s): %s", resp.status_code, model, resp.text[:160])
        return resp.status_code, ""
    except Exception as exc:
        logger.error("[9Router visão JSON] erro (%s): %s", model, exc)
        return -1, ""


def _parse_json_llm(content: str) -> dict[str, Any] | None:
    """Extrai um JSON de uma resposta de LLM (tolera ```json e texto extra)."""
    if not content:
        return None
    txt = content.strip()
    if txt.startswith("```"):
        txt = re.sub(r"^```(?:json)?\s*", "", txt)
        txt = re.sub(r"\s*```$", "", txt)
    try:
        parsed = json.loads(txt)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        m = re.search(r"\{.*\}", txt, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
                return parsed if isinstance(parsed, dict) else None
            except Exception:
                return None
    return None


async def _call_9router_text(prompt: str, model: str | None = None, timeout_s: float = 60.0) -> str:
    """Chamada de texto simples ao 9Router (sem imagem)."""
    api_key = _get_9router_api_key()
    if not api_key:
        return ""
    url = f"{_get_9router_base_url().rstrip('/')}/chat/completions"
    payload = {
        "model": model or NINEROUTER_VISION_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0,
        "max_tokens": 900,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(
                url, json=payload,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
        if resp.status_code == 200:
            data = resp.json()
            return ((data.get("choices") or [{}])[0].get("message", {}).get("content", "") or "").strip()
        logger.warning("[9Router texto] HTTP %d (%s): %s", resp.status_code, model, resp.text[:140])
    except Exception as exc:
        logger.error("[9Router texto] erro (%s): %s", model, exc)
    return ""


async def _call_minimax_anthropic(
    content_blocks: list[dict[str, Any]],
    max_tokens: int = 700,
    timeout_s: float = 60.0,
) -> tuple[int, str]:
    """Chamada à API MiniMax no formato Anthropic Messages (vision + texto)."""
    if not MINIMAX_API_KEY:
        return 0, ""
    payload = {
        "model": MINIMAX_VISION_MODEL,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": content_blocks}],
    }
    url = f"{MINIMAX_API_URL.rstrip('/')}/v1/messages"
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(
                url, json=payload,
                headers={
                    "x-api-key": MINIMAX_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code == 200:
            data = resp.json()
            blocks = data.get("content") or []
            texto = " ".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
            return 200, texto
        logger.warning("[MiniMax anthropic] HTTP %d: %s", resp.status_code, resp.text[:160])
        return resp.status_code, ""
    except Exception as exc:
        logger.error("[MiniMax anthropic] erro: %s", exc)
        return -1, ""


_RE_NOME_IMPRESSO = re.compile(r"\b[A-ZÀ-Ú][A-ZÀ-Ú]{1,}(?:\s+[A-ZÀ-Ú][A-ZÀ-Ú]{1,}){2,}\b")


def _sem_nome_impresso(texto: str) -> str:
    """Remove sequências de nome em CAIXA ALTA (3+ palavras) tipicamente o nome
    do paciente impresso no documento. O nome do paciente vem do CRM; aqui
    só evitamos duplicar dado pessoal no texto que vai para o relatório."""
    if not texto:
        return texto
    return _RE_NOME_IMPRESSO.sub("[nome do paciente]", texto)


def _normalizar_analise_imagem(
    parsed: dict[str, Any] | None,
    motor: str,
) -> dict[str, Any]:
    """Normaliza a resposta do LLM no contrato da Sprint D."""
    base = {
        "ok": False,
        "classificacao": "ilegivel",
        "legivel": False,
        "contem_dado_clinico": False,
        "descricao": "",
        "itens": [],
        "motor": motor,
    }
    if not parsed:
        return base
    itens = parsed.get("itens")
    if isinstance(itens, str):
        itens = [itens]
    if not isinstance(itens, list):
        itens = []
    return {
        "ok": True,
        "classificacao": str(parsed.get("classificacao") or "ilegivel").strip().lower(),
        "legivel": bool(parsed.get("legivel")),
        "contem_dado_clinico": bool(parsed.get("contem_dado_clinico")),
        "descricao": _sem_nome_impresso(str(parsed.get("descricao") or "").strip()[:600]),
        "itens": [_sem_nome_impresso(str(i)[:120]) for i in itens[:12]],
        "motor": motor,
    }


async def analisar_imagem_documento(
    b64_image: str,
    mimetype: str = "image/jpeg",
    caption: str = "",
    contexto: str = "",
) -> dict[str, Any]:
    """Analisa imagem/documento e devolve o CONTEÚDO OBJETIVO (sem inventar).

    Motor: 9Router (Gemini) → MiniMax M3 API oficial.
    """
    if not b64_image:
        return _normalizar_analise_imagem(None, "")
    if not mimetype or not mimetype.startswith("image/"):
        mimetype = "image/jpeg"

    texto_pedido = "Descreva objetivamente o conteúdo desta imagem."
    if caption:
        texto_pedido += f" Legenda que acompanha: '{caption}'."
    if contexto:
        texto_pedido += f" Contexto do paciente: {contexto}."

    # Prompt vai no turno de usuário (as rotas Gemini do 9Router rejeitam
    # role=system e devolvem 400 em contents[0].parts[1]).
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": f"{IMAGE_ANALYSIS_PROMPT}\n\n{texto_pedido}"},
                {"type": "image_url", "image_url": {"url": f"data:{mimetype};base64,{b64_image}"}},
            ],
        },
    ]

    # 1) 9Router (Gemini) — tenta o modelo configurado e mais um reserva
    for model in _modelos_visao():
        status, content = await _call_9router_vision_json(messages, model, timeout_s=45.0)
        if status == 200 and content:
            analise = _normalizar_analise_imagem(_parse_json_llm(content), f"9router:{model}")
            if analise["ok"]:
                logger.info("🖼️ [Visão %s] %s | clinico=%s | %r",
                            model, analise["classificacao"],
                            analise["contem_dado_clinico"], analise["descricao"][:100])
                return analise
            logger.warning("[Visão 9Router %s] resposta sem JSON utilizável: %r", model, content[:150])
        else:
            logger.warning("[Visão 9Router %s] falhou status=%s", model, status)

    # 2) MiniMax M3 (API oficial, formato Anthropic)
    if MINIMAX_API_KEY:
        anth: list[dict[str, Any]] = [
            {"type": "text", "text": IMAGE_ANALYSIS_PROMPT},
            {"type": "text", "text": texto_pedido},
            {"type": "image", "source": {"type": "base64", "media_type": mimetype, "data": b64_image}},
        ]
        st, txt = await _call_minimax_anthropic(anth, max_tokens=700)
        if st == 200 and txt:
            analise = _normalizar_analise_imagem(_parse_json_llm(txt), "minimax-api")
            if analise["ok"]:
                logger.info("🖼️ [Visão MiniMax] %s | clinico=%s | %r",
                            analise["classificacao"], analise["contem_dado_clinico"], analise["descricao"][:100])
                return analise
            logger.warning("[Visão MiniMax] resposta sem JSON utilizável: %r", txt[:150])
    else:
        logger.warning("[Visão] MINIMAX_API_KEY ausente — fallback indisponível")

    return _normalizar_analise_imagem(None, "")


async def analisar_documento_texto(texto_documento: str, contexto: str = "") -> dict[str, Any]:
    """Analisa o TEXTO de um documento (PDF) já extraído — mesma semântica da imagem."""
    if not (texto_documento or "").strip():
        return _normalizar_analise_imagem(None, "")
    prompt = _DOCUMENT_TEXT_PROMPT + texto_documento[:6000]
    if contexto:
        prompt += f"\nContexto do paciente: {contexto}"
    raw = await _call_9router_text(prompt, NINEROUTER_VISION_MODEL, timeout_s=90.0)
    if not raw:
        return _normalizar_analise_imagem(None, "")
    analise = _normalizar_analise_imagem(_parse_json_llm(raw), f"9router:{NINEROUTER_VISION_MODEL}")
    if analise["ok"]:
        logger.info("📄 [Documento] %s | clinico=%s | %r",
                    analise["classificacao"], analise["contem_dado_clinico"], analise["descricao"][:100])
    return analise


def montar_tag_conteudo(analise: dict[str, Any], tag: str = TAG_CONTEUDO_IMAGEM) -> str:
    """Monta a nota de contexto da imagem/documento.

    Conteúdo legível e relevante  → "[CONTEÚDO DA IMAGEM: descrição]"
    Foto comum/ilegível/sem dado   → "[IMAGEM_RECEBIDA]" (sem inventar nada)
    """
    if not analise:
        return TAG_IMAGEM_RECEBIDA
    relevante = (
        analise.get("ok")
        and analise.get("legivel")
        and (
            analise.get("contem_dado_clinico")
            or analise.get("classificacao") in ("documento_clinico", "comprovante_pagamento", "documento_geral")
        )
    )
    if not relevante:
        return TAG_IMAGEM_RECEBIDA
    descricao = (analise.get("descricao") or "").strip()
    if not descricao:
        return TAG_IMAGEM_RECEBIDA
    itens = analise.get("itens") or []
    if itens:
        descricao = f"{descricao} Itens: {', '.join(itens[:8])}"
    return f"{tag} {descricao}]"


RECEIPT_EXTRACTION_PROMPT = """Você é um auditor financeiro e leitor de comprovantes bancários para CRM médico/clínico.
Analise a imagem enviada pelo paciente (comprovante Pix, TED, DOC, transferência bancária ou recibo).
Extraia estritamente um JSON no seguinte formato:
{
  "is_payment_receipt": true,
  "amount": 300.00,
  "receiver": "nome do favorecido/clínica",
  "transaction_id": "código ou id da transação",
  "date": "data e hora no comprovante",
  "bank": "nome do banco"
}
Se a imagem NÃO for um comprovante de pagamento/transferência (ex: foto de remédio, exame, receita médica, selfie, conversa), retorne:
{
  "is_payment_receipt": false,
  "amount": null,
  "receiver": null,
  "transaction_id": null,
  "date": null,
  "bank": null
}
Responda EXCLUSIVAMENTE o JSON puro, sem crases markdown."""


async def extract_receipt_data_multimodal(
    b64_image: str,
    mimetype: str = "image/jpeg",
) -> dict[str, Any]:
    """Analisa imagem com Gemini 2.5 Flash Multimodal para extrair dados estruturados de comprovante Pix/bancário."""
    default_empty = {
        "is_payment_receipt": False,
        "amount": None,
        "receiver": None,
        "transaction_id": None,
        "date": None,
        "bank": None,
    }
    if not b64_image:
        return default_empty

    if not mimetype or not mimetype.startswith("image/"):
        mimetype = "image/jpeg"

    messages = [
        {"role": "system", "content": RECEIPT_EXTRACTION_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Analise esta imagem e extraia os dados do comprovante Pix/pagamento em JSON:"},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mimetype};base64,{b64_image}"},
                },
            ],
        },
    ]

    status, content = await _call_9router_vision(messages, NINEROUTER_VISION_MODEL)
    if status == 200 and content:
        try:
            # Tenta decodificar JSON direto ou extrair bloco {...}
            clean_content = content.strip()
            if clean_content.startswith("```"):
                clean_content = re.sub(r"^```(?:json)?\s*", "", clean_content)
                clean_content = re.sub(r"\s*```$", "", clean_content)
            parsed = json.loads(clean_content)
            if isinstance(parsed, dict) and "is_payment_receipt" in parsed:
                return parsed
        except Exception as parse_err:
            m = re.search(r"\{.*\}", content, re.DOTALL)
            if m:
                try:
                    parsed = json.loads(m.group(0))
                    if isinstance(parsed, dict) and "is_payment_receipt" in parsed:
                        return parsed
                except Exception:
                    pass
            logger.warning("[Vision Receipt] Falha ao parsear JSON de comprovante: %s | Raw: %s", parse_err, content[:150])

    return default_empty

