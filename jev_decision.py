"""
jev_decision.py — Subsistema de Julgamento Estruturado JEV (TypeSafe / System One).
Adaptado para o contexto de recepção e triagem da Clínica Psiquiátrica Dr. Matheus Dore.

1. Classificação estrita de intenções médicas (7 categorias).
2. Cálculo de score de urgência/relevância clínica (0 a 100).
3. Mapeamento tipado para as 4 etapas do funil clínico humanizado.
4. Extração de sintomas e medicações controladas de latência zero.
5. Fallback resiliente e invisível com timeout curto.
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

import httpx
from dotenv import load_dotenv
from pydantic import BaseModel, Field

logger = logging.getLogger("crm-matheus-jev")

# Carrega .env do app e cofre Hermes
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
for _p in (
    Path("/root/.hermes/.env"),
    Path.home() / ".hermes" / ".env",
    Path("/root/.hermes/secrets/9router.env"),
):
    if _p.exists():
        try:
            load_dotenv(_p, override=False)
        except Exception:
            pass

JEV_BASE_URL = os.environ.get("JEV_BASE_URL", "https://openrouter.ai/api/v1/systemone").strip()
JEV_MODEL = os.environ.get("JEV_MODEL", "typesafe/jev-1.13").strip()
JEV_API_KEY = (os.environ.get("JEV_API_KEY") or os.environ.get("OPENROUTER_API_KEY") or "").strip()

INTENCOES_CLINICAS: dict[str, str] = {
    "acolhimento_abertura": "Saudação inicial, bom dia/tarde, apresentação do paciente ou primeiro contato sem queixas detalhadas",
    "relato_sintomas": "Relato de sintomas emocionais/mentais (ansiedade, insônia, pânico, tristeza, depressão, burnout) ou menção a remédios controlados",
    "duvida_valor_convenio": "Dúvidas sobre valores de consulta, formas de pagamento, planos/convênios atendidos ou recibo de reembolso",
    "agendamento_novo": "Pedido explícito ou interesse em agendar primeira consulta médica com Dr. Matheus Dore",
    "retorno_reconsulta": "Já é paciente do Dr. Matheus e deseja agendar retorno, reconsulta, acompanhamento ou renovação de receita",
    "emergencia_urgencia": "Urgência crítica, desespero agudo, menção a ideação suicida, crise grave incapacitante ou risco iminente",
    "opt_out": "Solicitação para parar, descadastrar, cancelar mensagens ou recusa expressa de contato",
}

# Dicionário de detecção rápida (0.1ms) de medicações psiquiátricas e sintomas frequentes
LEXICO_MEDICACOES: dict[str, str] = {
    "sertralina": "Sertralina",
    "escitalopram": "Escitalopram",
    "fluoxetina": "Fluoxetina",
    "clonazepam": "Clonazepam",
    "rivotril": "Rivotril (Clonazepam)",
    "alprazolam": "Alprazolam",
    "frontal": "Frontal (Alprazolam)",
    "diazepam": "Diazepam",
    "zolpidem": "Zolpidem",
    "quetiapina": "Quetiapina",
    "olanzapina": "Olanzapina",
    "risperidona": "Risperidona",
    "venlafaxina": "Venlafaxina",
    "desvenlafaxina": "Desvenlafaxina",
    "bupropiona": "Bupropiona",
    "bup": "Bup (Bupropiona)",
    "ritalina": "Ritalina",
    "venvanse": "Venvanse",
    "atentah": "Atentah",
    "lamotrigina": "Lamotrigina",
    "litio": "Lítio",
    "lítio": "Lítio",
}

LEXICO_SINTOMAS: dict[str, str] = {
    "insonia": "Insônia",
    "insônia": "Insônia",
    "nao durmo": "Insônia",
    "não durmo": "Insônia",
    "sem dormir": "Insônia",
    "dificuldade para dormir": "Insônia",
    "ansiedade": "Ansiedade",
    "ansioso": "Ansiedade",
    "ansiosa": "Ansiedade",
    "panico": "Síndrome do Pânico",
    "pânico": "Síndrome do Pânico",
    "depressao": "Depressão",
    "depressão": "Depressão",
    "desanimo": "Desânimo / Fadiga",
    "desânimo": "Desânimo / Fadiga",
    "falta de ar": "Falta de Ar",
    "angustia": "Angústia",
    "angústia": "Angústia",
    "burnout": "Burnout / Esgotamento",
    "esgotamento": "Burnout / Esgotamento",
    "tristeza": "Tristeza Profunda",
    "choro": "Crises de Choro",
    "palpitacao": "Palpitações",
    "palpitação": "Palpitações",
    "taquicardia": "Taquicardia",
}



class DecisaoClinicaJEV(BaseModel):
    intencao: str = Field(..., description="Classificação estrita da intenção médica")
    score: float = Field(default=50.0, ge=0.0, le=100.0, description="Score de relevância/urgência 0 a 100")
    etapa_funil: int = Field(default=1, ge=1, le=4, description="Etapa do funil clínico 1 a 4")
    medicacoes_citadas: list[str] = Field(default_factory=list, description="Medicações identificadas")
    sintomas_detectados: list[str] = Field(default_factory=list, description="Sintomas identificados")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    fallback: bool = Field(default=False, description="True se ativado fallback silencioso")
    motivo_fallback: Optional[str] = None
    model: Optional[str] = None
    raw: Optional[dict[str, Any]] = None


def extrair_lexico_clinico(texto: str) -> tuple[list[str], list[str]]:
    """Varredura lexical ultra-rápida sem custo de token."""
    t = (texto or "").lower()
    meds: list[str] = []
    sints: list[str] = []

    for kw, label in LEXICO_MEDICACOES.items():
        if re.search(r"\b" + re.escape(kw) + r"\b", t):
            if label not in meds:
                meds.append(label)

    for kw, label in LEXICO_SINTOMAS.items():
        if " " in kw:
            if kw in t and label not in sints:
                sints.append(label)
        elif re.search(r"\b" + re.escape(kw) + r"\b", t):
            if label not in sints:
                sints.append(label)

    return meds, sints


def mapa_etapa_funil(intencao: str) -> int:
    """Mapeia a intenção classificada para a etapa do funil Dr. Matheus Dore."""
    if intencao == "acolhimento_abertura":
        return 1
    if intencao in ("relato_sintomas", "emergencia_urgencia"):
        return 2
    if intencao == "duvida_valor_convenio":
        return 3
    if intencao in ("agendamento_novo", "retorno_reconsulta"):
        return 4
    return 1


def _fallback_result(texto: str, reason: str, exc: Optional[Exception] = None) -> DecisaoClinicaJEV:
    """Fallback silencioso que preserva a integridade do fluxo."""
    logger.warning("Fallback silencioso JEV ativado (%s): %s", reason, exc or "sem detalhes")
    meds, sints = extrair_lexico_clinico(texto)

    # Heurística mínima de segurança para fallback
    t = (texto or "").lower()
    intencao = "acolhimento_abertura"
    if any(k in t for k in ("emergencia", "socorro", "suicid", "morrer", "nao aguento mais")):
        intencao = "emergencia_urgencia"
    elif any(k in t for k in ("agendar", "marcar", "horario", "consulta")):
        intencao = "agendamento_novo"
    elif any(k in t for k in ("valor", "quanto custa", "preco", "convenio", "plano", "unimed")):
        intencao = "duvida_valor_convenio"
    elif sints or meds:
        intencao = "relato_sintomas"

    etapa = mapa_etapa_funil(intencao)
    return DecisaoClinicaJEV(
        intencao=intencao,
        score=50.0,
        etapa_funil=etapa,
        medicacoes_citadas=meds,
        sintomas_detectados=sints,
        confidence=0.5,
        fallback=True,
        motivo_fallback=f"{reason}: {exc}" if exc else reason,
    )


async def avaliar_lead_clinico(texto_mensagem: str, timeout_s: float = 3.5) -> DecisaoClinicaJEV:
    """
    Avalia a intenção e a relevância clínica da mensagem com o modelo TypeSafe/JEV System One.
    Retorna sempre um objeto DecisaoClinicaJEV tipado e validado.
    """
    txt = (texto_mensagem or "").strip()
    if not txt:
        return _fallback_result(txt, "mensagem vazia")

    meds, sints = extrair_lexico_clinico(txt)

    if not JEV_API_KEY:
        return _fallback_result(txt, "JEV_API_KEY ausente")

    payload = {
        "model": JEV_MODEL,
        "state": {
            "mensagem": txt,
            "contexto": "Clínica de Psiquiatria Dr. Matheus Dore",
        },
        "questions": {
            "intencao": {
                "type": "choice",
                "instructions": (
                    "Classifique com rigor a intenção principal da mensagem do paciente "
                    "no WhatsApp da clínica de psiquiatria."
                ),
                "criteria": INTENCOES_CLINICAS,
            },
            "score": {
                "type": "score",
                "instructions": (
                    "Avalie o nível de urgência e relevância clínica da queixa apresentada "
                    "em uma escala de 0 a 100."
                ),
                "criteria": ["0", "100"],
            },
        },
    }

    headers = {
        "Authorization": f"Bearer {JEV_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(JEV_BASE_URL, json=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                answers = data.get("answers") or {}

                # 1. Intenção
                intencao_data = answers.get("intencao") or {}
                intencao = intencao_data.get("choice")
                if not intencao or intencao not in INTENCOES_CLINICAS:
                    intencao = "relato_sintomas" if (meds or sints) else "acolhimento_abertura"

                confidence = float(intencao_data.get("confidence", 0.95))

                # 2. Score de 0 a 100
                score_data = answers.get("score") or {}
                score_raw = score_data.get("score")
                score = 50.0
                if score_raw is not None:
                    try:
                        s_val = float(score_raw)
                        legend = score_data.get("legend") or {}
                        if s_val <= 1.0 and legend.get("1") == "100":
                            score = round(s_val * 100.0, 1)
                        else:
                            score = round(max(0.0, min(100.0, s_val)), 1)
                    except (ValueError, TypeError):
                        score = 50.0

                etapa = mapa_etapa_funil(intencao)
                return DecisaoClinicaJEV(
                    intencao=intencao,
                    score=score,
                    etapa_funil=etapa,
                    medicacoes_citadas=meds,
                    sintomas_detectados=sints,
                    confidence=confidence,
                    fallback=False,
                    model=data.get("model", JEV_MODEL),
                    raw=answers,
                )

            return _fallback_result(txt, f"HTTP {resp.status_code}", Exception(resp.text[:120]))

    except httpx.TimeoutException as exc:
        return _fallback_result(txt, "timeout JEV excedido", exc)
    except Exception as exc:
        return _fallback_result(txt, "erro de rede/conexao", exc)


if __name__ == "__main__":
    import asyncio
    import json
    import sys

    teste = sys.argv[1] if len(sys.argv) > 1 else "Olá, boa tarde! Gostaria de saber como funciona a consulta"
    print(f"Testando JEV Clínico: {teste!r}")
    resultado = asyncio.run(avaliar_lead_clinico(teste))
    print(json.dumps(resultado.model_dump(), indent=2, ensure_ascii=False))
