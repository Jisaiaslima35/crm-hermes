"""
jev_copilot_engine.py — Motor de Decisão e Copiloto Preditivo de Vendas / Agendamentos Clínicos JEV.
Contexto: Clínica Psiquiátrica Dr. Matheus Dore (R$ 300 / retorno 30 dias) e Customer 360 Hermes.
"""

from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

import httpx
from dotenv import load_dotenv

logger = logging.getLogger("jev-copilot")

# Carrega variáveis de ambiente de todos os pontos conhecidos
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

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL", "")
# 27/10/2026: RLS foi activada em `tenants`. O backend tem de falar com o
# Supabase com a SERVICE ROLE (ignora RLS) — a anon key já não lê o tenant.
# A SERVICE ROLE fica em primeiro; a anon key só é fallback para setups
# sem service role (onde a leitura de `tenants` ficará bloqueada).
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("SUPABASE_KEY")
    or os.environ.get("VITE_SUPABASE_ANON_KEY")
    or ""
)

sb_instance = None


def get_sb(client_override=None):
    """Retorna cliente Supabase inicializado."""
    global sb_instance
    if client_override is not None:
        return client_override
    if sb_instance is not None:
        return sb_instance
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            from supabase import create_client
            sb_instance = create_client(SUPABASE_URL, SUPABASE_KEY)
            return sb_instance
        except Exception as exc:
            logger.error("[JEV_COPILOT] Erro ao instanciar cliente Supabase: %s", exc)
    return None


NINEROUTER_API_KEY = (
    os.environ.get("NINEROUTER_API_KEY")
    or os.environ.get("OPENROUTER_API_KEY")
    or os.environ.get("OMNIROUTE_API_KEY")
    or ""
)
NINEROUTER_BASE_URL = os.environ.get("NINEROUTER_BASE_URL", "https://9router.automacaojs.us/v1").rstrip("/")
LOCAL_LITELLM_URL = "http://127.0.0.1:4000/v1"

STAGES_VALIDOS = {
    "primeiro_contato",
    "qualificado",
    "duvida_valores",
    "objecao_preco",
    "horario_oferecido",
    "agendado",
    "frio",
}

STAGES_VALIDOS_TURISMO = {
    "novo_lead",
    "em_atendimento",
    "cotacao",
    "cotacao_enviada",
    "negociacao",
    "em_negociacao",
    "fechou",
    "fechou_vendido",
    "pos_viagem",
}

OBJECTION_VALIDAS = {
    "inseguranca_preco",
    "horario_incompativel",
    "duvida_convenio",
    "falta_resposta",
    "nenhuma",
}

SYSTEM_PROMPT = """Você é o Copiloto Preditivo de Vendas e Decisor Clínico JEV da Clínica de Psiquiatria do Dr. Matheus Dore.
Seu objetivo é analisar as mensagens recentes trocadas entre o paciente e a equipe/IA no WhatsApp e calcular métricas de conversão e orientação prática em tempo real para a secretária Beatriz.

CONTEXTO DA CLÍNICA:
- Médico: Dr. Matheus Dore (Médico Psiquiatra, especialista em saúde mental, ansiedade, depressão, TDAH, insônia, burnout).
- Atendimento: Particular presencial em Natal/RN e telemedicina.
- Valor da Consulta: R$ 300,00 (com retorno presencial incluso em até 30 dias).
- Não atende convênios diretamente, mas emite recibo com CRM e laudo para reembolso integral ou parcial no plano de saúde do paciente.
- Atendente / Secretária humana: Beatriz.

TAREFA:
Analise o diálogo recente e devolva ESTRITAMENTE UM OBJETO JSON VÁLIDO com os 5 campos abaixo:
1. "conversion_probability": Número inteiro de 0 a 100 representando a probabilidade atual de fechar a consulta.
   - 0 a 39: Desinteresse, recusa expressa, sem resposta prolongada ou objeção forte.
   - 40 a 69: Em qualificação, tirando dúvidas de valores/horários, interessado mas ainda não confirmou.
   - 70 a 100: Pediu horários, aceitou os valores, escolheu data ou consulta agendada/confirmada.
2. "negotiation_stage": Uma das strings exatas:
   - "primeiro_contato" (iniciou conversa, saudação ou sem detalhamento)
   - "qualificado" (contou queixa/sintomas ou demonstrou interesse clínico)
   - "duvida_valores" (perguntou preço, plano ou formas de pagamento)
   - "objecao_preco" (achou caro, hesitou no valor de R$ 300)
   - "horario_oferecido" (secretária enviou horários disponíveis na agenda)
   - "agendado" (data/horário combinados ou confirmados)
   - "frio" (parou de responder após proposta)
3. "current_objection": Uma das strings exatas:
   - "inseguranca_preco"
   - "horario_incompativel"
   - "duvida_convenio"
   - "falta_resposta"
   - "nenhuma"
4. "copilot_guidance": Orientação tática e direta em 1 ou 2 frases curtas dizendo o que a Beatriz deve fazer agora para conduzir o paciente ao fechamento ou acolhimento.
5. "suggested_reply": Mensagem pronta, empática, humanizada e persuasiva para ser enviada no WhatsApp da clínica com 1 clique (NUNCA diga 'Sou a Beatriz'; as mensagens devem ser em nome da equipe do Dr. Matheus Dore: ex: 'Olá! Sou da equipe do Dr. Matheus Dore, como podemos ajudar?').

IMPORTANTE: Responda APENAS o JSON válido, sem texto antes ou depois, sem crases markdown."""

SYSTEM_PROMPT_TURISMO = """Você é o Copiloto Preditivo e Decisor Comercial JEV da agência de viagens ESVC Turismo.
Seu objetivo é analisar as mensagens recentes trocadas entre o cliente/viajante e a equipe no WhatsApp e calcular métricas de conversão e orientação prática em tempo real para os consultores de viagens da agência.

CONTEXTO DA AGÊNCIA:
- Empresa: ESVC Turismo (Agência de Viagens, Pacotes Nacionais e Internacionais, Passagens Aéreas, Hospedagens, Resorts e Cruzeiros).
- Foco: Fechamento de pacotes, reservas de passagens e atendimento consultivo humanizado.
- Formas de pagamento: Pix, cartão em até 10x ou 12x, boleto parcelado.
- PROIBIÇÃO ABSOLUTA: NUNCA use termos médicos/clínicos como "Dr. Matheus", "consulta", "receita", "paciente", "clínica", "sintomas", "convênio", "agendou", "compareceu", "triagem". Trate a pessoa como "viajante" ou "cliente".

TAREFA:
Analise o diálogo recente e devolva ESTRITAMENTE UM OBJETO JSON VÁLIDO com os 5 campos abaixo:
1. "conversion_probability": Número inteiro de 0 a 100 representando a probabilidade atual de fechar a viagem.
   - 0 a 39: Desinteresse, recusa expressa, sem resposta prolongada ou desistência.
   - 40 a 69: Em qualificação, tirando dúvidas sobre destino, hotel, passagens ou datas.
   - 70 a 89: Pediu cotação formal, negociando datas/valores ou escolhendo voo/hotel.
   - 90 a 100: Confirmou compra, enviou comprovante Pix, disse que pode fechar pacote ou pagamento realizado.
2. "negotiation_stage": Uma das strings exatas:
   - "novo_lead" (iniciou conversa, saudação sem detalhamento)
   - "em_atendimento" (tirando dúvidas sobre destinos, passeios, hotéis ou períodos)
   - "cotacao" (consultor enviou orçamento, valores de pacotes ou opções de voo)
   - "negociacao" (negociando desconto, parcelamento, formas de pagamento ou ajustes de data)
   - "fechou" (compra confirmada, pagamento via Pix/cartão realizado, pacote fechado)
   - "pos_viagem" (após a realização da viagem, feedback ou recompra)
3. "current_objection": Uma das strings exatas:
   - "inseguranca_preco" (achou o pacote/passagem caro ou pediu mais desconto)
   - "horario_incompativel" (datas de voo ou período de viagem não encaixam)
   - "duvida_convenio" (dúvida sobre formas de pagamento, parcelamento ou taxas)
   - "falta_resposta" (cliente parou de responder após cotação)
   - "nenhuma" (sem objeções ativas)
4. "copilot_guidance": Orientação tática e direta em 1 ou 2 frases curtas dizendo o que o consultor da ESVC Turismo deve fazer agora para conduzir o viajante ao fechamento (ex: 'Cliente confirmou pagamento de R$ 1.200 via Pix para Gramado. Dica: Enviar o recibo de confirmação e solicitar os nomes completos e CPF dos passageiros para emissão dos bilhetes.').
5. "suggested_reply": Mensagem pronta, cordial e persuasiva em nome da equipe da ESVC Turismo para enviar no WhatsApp com 1 clique.

IMPORTANTE: Responda APENAS o JSON válido, sem texto antes ou depois, sem crases markdown."""


def _heuristic_copilot_analysis_turismo(lead_name: str, conversa_text: str) -> dict[str, Any]:
    """Heurística especializada para ESVC Turismo impedindo resquícios médicos."""
    text_norm = unicodedata.normalize("NFKD", conversa_text).encode("ASCII", "ignore").decode("utf-8").lower()

    # 1. Fechamento confirmado bidirecional (cliente ou atendente)
    if any(k in text_norm for k in [
        # Cliente
        "pode fechar", "fechado", "confirmado", "ja enviei", "comprovante", "pagamento de r$",
        "pagamento realizado", "vou pagar no pix", "vou fazer o pagamento", "pix enviado",
        "fechar o pacote", "fechou", "fechado ta pode fechar", "fiz o pix", "tá confirmado",
        # Atendente
        "recebi o pagamento", "valor confirmado", "está pago", "esta pago",
        "pagamento confirmado", "pix confirmado", "confirmamos seu pagamento",
        "reserva confirmada", "pacote confirmado", "pix recebido"
    ]):
        dest = "sua viagem"
        for d in ["gramado", "maceio", "natal", "orlando", "paris", "fortaleza", "salvador", "porto de galinhas", "maragogi", "cancun", "buenos aires", "rio de janeiro"]:
            if d in text_norm:
                dest = d.title()
                break

        # Tenta extrair valor citado
        val_match = re.search(r"r\$\s*(\d+(?:[.,]\d+)?)", text_norm)
        val_str = f"de R$ {val_match.group(1)} " if val_match else ""

        return {
            "conversion_probability": 98,
            "negotiation_stage": "fechou",
            "current_objection": "nenhuma",
            "copilot_guidance": f"Cliente confirmou pagamento {val_str}via Pix para {dest}. Dica: Enviar o recibo de confirmação e solicitar os nomes completos e CPF dos passageiros para emissão dos bilhetes.",
            "suggested_reply": f"Perfeito, {lead_name}! Seu pacote para {dest} está confirmado com sucesso! Para emitirmos os vouchers e bilhetes, pode nos enviar o nome completo e CPF dos passageiros por favor?",
        }

    # 2. Negociação de valores / parcelamento / desconto
    if any(k in text_norm for k in ["parcela", "desconto", "divide em", "cartao", "pix tem desconto", "forma de pagamento", "qual sera a forma"]):
        return {
            "conversion_probability": 80,
            "negotiation_stage": "negociacao",
            "current_objection": "nenhuma",
            "copilot_guidance": "Cliente alinhando forma de pagamento. Apresente as opções de Pix com desconto ou parcelamento no cartão.",
            "suggested_reply": f"Olá, {lead_name}! Trabalhamos com Pix à vista com desconto especial ou parcelamos em até 10x sem juros no cartão. Como prefere finalizar?",
        }

    # 3. Cotação enviada / análise de orçamento
    if any(k in text_norm for k in ["orcamento", "cotacao", "valor do pacote", "quanto fica", "quanto custa", "preco da passagem", "preco"]):
        return {
            "conversion_probability": 65,
            "negotiation_stage": "cotacao",
            "current_objection": "nenhuma",
            "copilot_guidance": "Cliente em fase de cotação. Destaque os benefícios inclusos (bagagem, transfer, café da manhã) e pergunte sobre as datas preferidas.",
            "suggested_reply": f"Oi, {lead_name}! Temos opções incríveis para o seu destino com excelentes condições de voo e hotel. Tem alguma data específica em mente para os próximos meses?",
        }

    # 4. Em atendimento / Dúvidas sobre destinos e hotéis
    if any(k in text_norm for k in ["resort", "hotel", "praia", "passeio", "bagagem", "voo", "voos", "crianca", "quantas noites", "dias", "viagem"]):
        return {
            "conversion_probability": 60,
            "negotiation_stage": "em_atendimento",
            "current_objection": "nenhuma",
            "copilot_guidance": "Entendendo o perfil da viagem. Identifique quantos passageiros irão e a categoria de hospedagem desejada.",
            "suggested_reply": f"Olá, {lead_name}! Para montarmos a melhor opção, quantos adultos e crianças irão viajar com você?",
        }

    # 5. Padrão inicial Turismo
    return {
        "conversion_probability": 50,
        "negotiation_stage": "novo_lead",
        "current_objection": "nenhuma",
        "copilot_guidance": "Novo contato de turismo. Acolha o cliente e descubra o destino e o período que ele planeja viajar.",
        "suggested_reply": f"Olá, {lead_name}! Tudo bem? Aqui é da equipe da ESVC Turismo. Qual destino você tem interesse em conhecer ou planeja viajar nos próximos meses?",
    }


def _heuristic_copilot_analysis(lead_name: str, conversa_text: str) -> dict[str, Any]:
    """Análise heurística contextual rica executada caso a chamada LLM falhe ou demore.
    Impede que o JEV congele em 50% / 'primeiro_contato'.
    """
    text_norm = unicodedata.normalize("NFKD", conversa_text).encode("ASCII", "ignore").decode("utf-8").lower()

    # 1. Agendamento confirmado / PIX
    if any(k in text_norm for k in ["agendad", "confirmad", "marcad", "pode confirmar", "fechado entao", "comprovante", "pagamento realizado", "vou querer esse horario"]):
        return {
            "conversion_probability": 95,
            "negotiation_stage": "agendado",
            "current_objection": "nenhuma",
            "copilot_guidance": "Consulta pronta para confirmação! Registre na agenda e passe as instruções do consultório.",
            "suggested_reply": f"Perfeito, {lead_name}! Sua consulta com o Dr. Matheus Dore está confirmada. Te esperamos no horário combinado!",
        }

    # 2. Negociação de horários / datas
    if any(k in text_norm for k in ["horario", "horarios", "quinta", "sexta", "segunda", "terca", "quarta", "manha", "tarde", "as 10h", "as 14h", "vaga", "tem data", "para amanha"]):
        return {
            "conversion_probability": 80,
            "negotiation_stage": "horario_oferecido",
            "current_objection": "nenhuma",
            "copilot_guidance": "Paciente analisando a agenda. Confirme a preferência de turno (manhã ou tarde) para travar a vaga.",
            "suggested_reply": f"Temos essas opções abertas com o Dr. Matheus, {lead_name}. Qual delas encaixa melhor na sua rotina?",
        }

    # 3. Objeção de Preço
    if any(k in text_norm for k in ["caro", "desconto", "parcela", "apertado", "vou pensar", "muito alto"]):
        return {
            "conversion_probability": 40,
            "negotiation_stage": "objecao_preco",
            "current_objection": "inseguranca_preco",
            "copilot_guidance": "Hesitação no valor. Reforce que o retorno de 30 dias está incluso sem custo adicional e mencione o reembolso.",
            "suggested_reply": "Entendo perfeitamente! Vale lembrar que a consulta de R$ 300 já inclui o retorno completo em até 30 dias e emitimos recibo para reembolso no convênio.",
        }

    # 4. Dúvida de Valores / Convênio
    if any(k in text_norm for k in ["quanto custa", "qual o valor", "preco", "custa quanto", "convenio", "plano", "unimed", "bradesco", "cassi", "sulamerica", "reembolso", "particular"]):
        return {
            "conversion_probability": 60,
            "negotiation_stage": "duvida_valores",
            "current_objection": "duvida_convenio",
            "copilot_guidance": "Paciente tirando dúvidas de valores. Apresente o valor de R$ 300 com retorno incluso e o formato de reembolso.",
            "suggested_reply": f"Olá, {lead_name}! O atendimento do Dr. Matheus Dore é particular por R$ 300, com retorno presencial incluso em 30 dias e recibo detalhado para solicitar reembolso ao seu plano.",
        }

    # 5. Sintomas clínicos relatados
    if any(k in text_norm for k in ["ansiedade", "insonia", "dormir", "panico", "depress", "triste", "burnout", "tdah", "receita", "remedio", "crise", "angustia", "sertralina", "rivotril", "zolpidem"]):
        return {
            "conversion_probability": 70,
            "negotiation_stage": "qualificado",
            "current_objection": "nenhuma",
            "copilot_guidance": "Sintomas importantes relatados. Acolha com sensibilidade e ofereça vaga prioritária com o Dr. Matheus.",
            "suggested_reply": f"Sinto muito que esteja passando por isso, {lead_name}. O Dr. Matheus é especialista nesses quadros e pode te acolher com muito cuidado. Gostaria de verificar um horário para esta semana?",
        }

    # 6. Padrão inicial
    return {
        "conversion_probability": 50,
        "negotiation_stage": "primeiro_contato",
        "current_objection": "nenhuma",
        "copilot_guidance": "Início do atendimento. Apresente a clínica com acolhimento e entenda a principal queixa do paciente.",
        "suggested_reply": f"Olá, {lead_name}! Sou da equipe do Dr. Matheus Dore, como podemos ajudar?",
    }


async def _call_llm_json(
    prompt: str,
    lead_name: str = "Paciente",
    conversa_text: str = "",
    is_tourism: bool = False,
) -> dict[str, Any]:
    """Chama a LLM no 9Router / LiteLLM ou degrada com segurança para heurística contextual."""
    endpoints_to_try = []

    # 1. 9Router com Hermes-fallbacks (mais confiável)
    if NINEROUTER_API_KEY:
        endpoints_to_try.append({
            "url": f"{NINEROUTER_BASE_URL}/chat/completions",
            "model": "Hermes-fallbacks",
            "headers": {
                "Authorization": f"Bearer {NINEROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
        })
        endpoints_to_try.append({
            "url": f"{NINEROUTER_BASE_URL}/chat/completions",
            "model": "google/gemini-2.5-flash",
            "headers": {
                "Authorization": f"Bearer {NINEROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
        })
        endpoints_to_try.append({
            "url": f"{NINEROUTER_BASE_URL}/chat/completions",
            "model": "openai/gpt-4o-mini",
            "headers": {
                "Authorization": f"Bearer {NINEROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
        })

    # 2. Local LiteLLM na porta 4000
    endpoints_to_try.append({
        "url": f"{LOCAL_LITELLM_URL}/chat/completions",
        "model": "gemini-3.5-flash",
        "headers": {
            "Authorization": "Bearer sk-1234",
            "Content-Type": "application/json",
        },
    })

    chosen_system_prompt = SYSTEM_PROMPT_TURISMO if is_tourism else SYSTEM_PROMPT
    last_error = None
    for target in endpoints_to_try:
        try:
            payload = {
                "model": target["model"],
                "messages": [
                    {"role": "system", "content": chosen_system_prompt},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.1,
                "max_tokens": 400,
                "stream": False,
            }
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.post(target["url"], json=payload, headers=target["headers"])
                if r.status_code == 200:
                    data = r.json()
                    content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
                    if content:
                        cleaned = re.sub(r"^```(?:json)?\s*", "", content, flags=re.IGNORECASE)
                        cleaned = re.sub(r"\s*```$", "", cleaned).strip()
                        first = cleaned.find("{")
                        last = cleaned.rfind("}")
                        if first >= 0 and last > first:
                            cleaned = cleaned[first:last + 1]
                        parsed = json.loads(cleaned)
                        if isinstance(parsed, dict) and "conversion_probability" in parsed:
                            return parsed
                else:
                    last_error = f"HTTP {r.status_code}: {r.text[:120]}"
        except Exception as exc:
            last_error = str(exc)
            logger.debug("[JEV_COPILOT] Tentativa com %s falhou: %s", target["model"], exc)

    logger.info("[JEV_COPILOT] LLM fallback acionado (%s). Aplicando heurística contextual (turismo=%s).", last_error, is_tourism)
    if is_tourism:
        return _heuristic_copilot_analysis_turismo(lead_name, conversa_text)
    return _heuristic_copilot_analysis(lead_name, conversa_text)


_KANBAN_STAGES_CACHE: dict[str, Any] = {}

# Aliases legados -> slugs oficiais do funil dinamico (kanban_stages)
_TOURISM_STAGE_ALIASES = {
    "novo_contato": "novo_lead",
    "cotacao": "cotacao_enviada",
    "em_negociacao": "negociacao",
    "fechou": "vendido",
    "fechou_vendido": "vendido",
    "contratou": "vendido",
    "ganho": "vendido",
    "convertido": "vendido",
    "pos_viagem": "pos_venda",
}


def _load_kanban_stages(sb: Any, tenant_id: str) -> list[dict[str, Any]]:
    """Le as etapas oficiais do funil (kanban_stages) do tenant, cache de 60s.
    Retorna [] quando o tenant nao tem funil dinamico (fallback estatico)."""
    import time as _time

    tid = str(tenant_id)
    cached = _KANBAN_STAGES_CACHE.get(tid)
    if cached and (_time.time() - cached[0] < 60):
        return cached[1]
    rows: list[dict[str, Any]] = []
    try:
        res = (
            sb.table("kanban_stages")
            .select("slug, title, position, ai_keywords, ai_prompt_hint, trigger_keywords, semantic_description")
            .eq("tenant_id", tid)
            .order("position")
            .execute()
        )
        rows = res.data or []
        for _r in rows:
            _tk = _r.get("trigger_keywords") or _r.get("ai_keywords") or []
            _sd = _r.get("semantic_description") or _r.get("ai_prompt_hint") or ""
            _r["keywords"] = _tk
            _r["hint"] = _sd
    except Exception as exc:
        logger.warning(f"[JEV] kanban_stages indisponivel p/ tenant {tid}: {exc}")
    _KANBAN_STAGES_CACHE[tid] = (_time.time(), rows)
    return rows


async def evaluate_lead_copilot(
    lead_id: str,
    tenant_id: str = "1111",
    history_msgs: list[dict[str, Any]] | None = None,
    sb_client: Any = None,
) -> dict[str, Any]:
    """Avalia o lead via JEV Copilot, persiste em leads e retorna os dados analíticos."""
    sb = get_sb(sb_client)
    if not sb:
        logger.error("[JEV_COPILOT] Supabase não inicializado.")
        return {}

    # Detecta se o tenant é Turismo
    is_tourism = (
        str(tenant_id) == "44444444-4444-4444-4444-444444444444"
        or "turismo" in str(tenant_id).lower()
    )
    if not is_tourism and tenant_id:
        try:
            t_row = sb.table("tenants").select("specialty, name").eq("id", tenant_id).limit(1).execute()
            if t_row.data:
                sp = (t_row.data[0].get("specialty") or "").lower()
                nm = (t_row.data[0].get("name") or "").lower()
                if "turismo" in sp or "turismo" in nm or "esvc" in nm:
                    is_tourism = True
        except Exception:
            pass

    # Funil dinamico (kanban_stages): apenas para turismo e apenas se o
    # tenant tiver etapas cadastradas. Clinica e demais tenants seguem no
    # comportamento estatico de sempre.
    dyn_stages: list[dict[str, Any]] = []
    dyn_slugs: set[str] = set()
    if is_tourism:
        dyn_stages = _load_kanban_stages(sb, tenant_id)
        dyn_slugs = {str(s.get("slug") or "") for s in dyn_stages if s.get("slug")}

    # Se não passou histórico, busca as mensagens recentes do Supabase
    if history_msgs is None:
        try:
            res_msgs = (
                sb.table("messages")
                .select("sender, content, created_at")
                .eq("lead_id", lead_id)
                .order("created_at", desc=True)
                .limit(10)
                .execute()
            )
            raw = res_msgs.data or []
            history_msgs = list(reversed(raw))
        except Exception as err:
            logger.error("[JEV_COPILOT] Falha ao consultar mensagens do lead %s: %s", lead_id, err)
            history_msgs = []

    # Recupera nome e contexto do lead
    lead_name = "Cliente" if is_tourism else "Paciente"
    trip_dest_existing = None
    current_lead_stage = ""
    try:
        lead_row = sb.table("leads").select("name, phone, stage").eq("id", lead_id).limit(1).execute()
        if lead_row.data:
            lead_name = lead_row.data[0].get("name") or ("Cliente" if is_tourism else "Paciente")
            current_lead_stage = (lead_row.data[0].get("stage") or "").lower()
    except Exception:
        pass

    # Constrói o texto do diálogo recente
    conversa_lines = []
    for m in history_msgs:
        sender_raw = (m.get("sender") or "").lower()
        if is_tourism:
            role = "Cliente/Viajante" if sender_raw == "patient" else "Consultor ESVC Turismo"
        else:
            role = "Paciente" if sender_raw == "patient" else "Beatriz / Clínica"
        content_txt = (m.get("content") or "").strip()
        if content_txt:
            conversa_lines.append(f"{role}: {content_txt}")

    conversa_text = "\n".join(conversa_lines) if conversa_lines else ("Cliente iniciou contato." if is_tourism else "Paciente acabou de entrar em contato.")
    if is_tourism:
        prompt = f"VIAJANTE/CLIENTE: {lead_name} (ID: {lead_id})\n\nÚLTIMAS MENSAGENS TROCADAS:\n{conversa_text}\n\nGere o JSON analítico do Copiloto JEV de Turismo:"
    else:
        prompt = f"PACIENTE: {lead_name} (ID: {lead_id})\n\nÚLTIMAS MENSAGENS TROCADAS:\n{conversa_text}\n\nGere o JSON analítico do Copiloto JEV:"

    if dyn_stages:
        _stage_lines = []
        for _s in dyn_stages:
            _kw = ", ".join(_s.get("keywords") or _s.get("ai_keywords") or [])
            _stage_lines.append(
                f'- "{_s.get("slug")}" ({_s.get("title")}): {_s.get("hint") or _s.get("ai_prompt_hint") or ""} [sinais: {_kw}]'
            )
        prompt += (
            "\n\nETAPAS OFICIAIS DESTE FUNIL (tabela kanban_stages — use EXATAMENTE "
            "um destes slugs no campo negotiation_stage, substituindo qualquer lista anterior):\n"
            + "\n".join(_stage_lines)
        )

    result = await _call_llm_json(prompt, lead_name=lead_name, conversa_text=conversa_text, is_tourism=is_tourism)

    # Sanitização e normalização estrita dos tipos
    try:
        prob = int(result.get("conversion_probability", 50))
        prob = max(0, min(100, prob))
    except (ValueError, TypeError):
        prob = 50

    stage = str(result.get("negotiation_stage", "novo_lead" if is_tourism else "primeiro_contato")).lower().strip()

    if is_tourism:
        # Blindagem: NUNCA permitir fases médicas
        if dyn_slugs:
            if stage in {"agendado", "agendou", "consulta_agendada", "consulta_realizada", "compareceu", "triagem"}:
                stage = "em_atendimento"
            # Funil dinâmico: normaliza aliases legados p/ o slug oficial
            stage = _TOURISM_STAGE_ALIASES.get(stage, stage)
            if stage not in dyn_slugs:
                stage = "novo_lead"
        elif stage in {"agendado", "agendou", "consulta_agendada", "consulta_realizada", "compareceu", "triagem", "contratou", "fechou_vendido"}:
            stage = "fechou"
        elif stage not in STAGES_VALIDOS_TURISMO:
            stage = "novo_lead"
    else:
        if stage not in STAGES_VALIDOS:
            stage = "primeiro_contato"

    objection = str(result.get("current_objection", "nenhuma")).lower().strip()
    if objection not in OBJECTION_VALIDAS:
        objection = "nenhuma"

    guidance = str(result.get("copilot_guidance") or "").strip()
    if not guidance:
        if is_tourism:
            guidance = "Acolha o viajante e apresente as melhores opções de pacotes e passagens da ESVC Turismo."
        else:
            guidance = "Acolha o paciente e informe sobre os horários da semana do Dr. Matheus."

    suggested_reply = str(result.get("suggested_reply") or "").strip()
    if not suggested_reply:
        if is_tourism:
            suggested_reply = f"Olá, {lead_name}! Tudo bem? Como a equipe da ESVC Turismo pode ajudar com sua viagem hoje?"
        else:
            suggested_reply = f"Olá, {lead_name}! Como o Dr. Matheus pode te ajudar hoje?"

    eval_time = datetime.now(timezone.utc).isoformat()

    # Blindagem Anti-Regressão para Turismo e Clínico
    if is_tourism:
        if dyn_slugs:
            STAGE_RANKS = {str(s.get("slug")): int(s.get("position") or 1) for s in dyn_stages}
            STAGE_RANKS["perdido"] = 0  # perda e saida lateral: nao trava nem segura progressao
            _cur_norm = _TOURISM_STAGE_ALIASES.get(current_lead_stage, current_lead_stage)
            c_rank = STAGE_RANKS.get(_cur_norm, 1)
            t_rank = STAGE_RANKS.get(stage, 1)
            if stage != "perdido":
                if c_rank >= 5 and t_rank < 5:
                    stage = _cur_norm
                    prob = max(prob, 95)
                elif c_rank == 4 and t_rank < 4:
                    stage = _cur_norm
                    prob = max(prob, 75)
        else:
            STAGE_RANKS = {"novo_lead": 1, "em_atendimento": 2, "cotacao": 3, "cotacao_enviada": 3, "negociacao": 4, "em_negociacao": 4, "fechou": 5, "fechou_vendido": 5, "pos_viagem": 6}
            c_rank = STAGE_RANKS.get(current_lead_stage, 1)
            t_rank = STAGE_RANKS.get(stage, 1)
            if c_rank >= 5 and t_rank < 5:
                stage = current_lead_stage
                prob = max(prob, 95)
            elif c_rank == 4 and t_rank < 4:
                stage = current_lead_stage
                prob = max(prob, 75)

    update_payload: dict[str, Any] = {
        "conversion_probability": prob,
        "negotiation_stage": stage,
        "current_objection": objection,
        "copilot_guidance": guidance,
        "suggested_reply": suggested_reply,
        "last_copilot_eval_at": eval_time,
    }

    # Se fechou pacote no turismo, sincroniza stage e lead_trips
    _sold_slugs = ("vendido",) if dyn_slugs else ("fechou", "fechou_vendido")
    if is_tourism and stage in _sold_slugs:
        update_payload["stage"] = "vendido" if dyn_slugs else "fechou"

        # Extração de destino: vence o destino mencionado por ÚLTIMO na
        # conversa (recompra/nova viagem citada depois da anterior).
        dest_detected = trip_dest_existing
        _conv_low = conversa_text.lower()
        _best_idx = -1
        for d in ["Gramado", "Maceió", "Maceio", "Natal", "Orlando", "Paris", "Fortaleza", "Salvador", "Porto de Galinhas", "Maragogi", "Cancun", "Buenos Aires", "Rio de Janeiro"]:
            _idx = _conv_low.rfind(d.lower())
            if _idx > _best_idx:
                _best_idx = _idx
                dest_detected = d
        if not dest_detected:
            dest_detected = "Gramado"
        update_payload["trip_destination"] = dest_detected

        # Armar ou atualizar lead_trips
        try:
            dep_date = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
            m_pt = re.search(r"(\d{1,2})\s+de\s+(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)", conversa_text.lower())
            if m_pt:
                dia = int(m_pt.group(1))
                meses = {"janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3, "abril": 4, "maio": 5, "junho": 6, "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12}
                mes = meses.get(m_pt.group(2), 11)
                dep_date = f"2026-{mes:02d}-{dia:02d}"
            try:
                ret_date = (datetime.strptime(dep_date, "%Y-%m-%d") + timedelta(days=7)).strftime("%Y-%m-%d")
            except Exception:
                ret_date = dep_date

            trip_data = {
                "tenant_id": tenant_id,
                "lead_id": lead_id,
                "destination": dest_detected,
                "departure_date": dep_date,
                "return_date": ret_date,
                "pre_trip_sent": False,
                "post_trip_sent": False,
            }
            # Multi-viagens: NUNCA sobrescreve viagem ativa anterior. Se ja
            # existe viagem ativa (pos-viagem pendente) para o MESMO destino,
            # apenas completa campos vazios dela; senao, cria registro novo
            # (recompra = nova viagem, com as proprias reguas no worker).
            existing_trips = sb.table("lead_trips").select("id, destination, departure_date, return_date, post_trip_sent").eq("tenant_id", tenant_id).eq("lead_id", lead_id).execute()
            active_same = None
            for _t in (existing_trips.data or []):
                if not _t.get("post_trip_sent") and str(_t.get("destination") or "").strip().lower() == dest_detected.strip().lower():
                    active_same = _t
                    break
            if active_same:
                _patch = {}
                if not active_same.get("departure_date"):
                    _patch["departure_date"] = dep_date
                if not active_same.get("return_date"):
                    _patch["return_date"] = ret_date
                if _patch:
                    sb.table("lead_trips").update(_patch).eq("id", active_same["id"]).execute()
            else:
                sb.table("lead_trips").insert(trip_data).execute()
            logger.info(f"[JEV TURISMO] lead_trips sincronizado: lead {lead_id} ({dest_detected}, ida={dep_date})")
        except Exception as t_err:
            logger.warning(f"[JEV TURISMO] Erro ao sincronizar lead_trips: {t_err}")

    # Ganchos do funil dinamico: transicoes que armam automacoes de bastidor
    if is_tourism and dyn_slugs:
        _cur_norm_h = _TOURISM_STAGE_ALIASES.get(current_lead_stage, current_lead_stage)
        if stage == "perdido" and _cur_norm_h != "perdido":
            update_payload["perdido_at"] = eval_time
            update_payload["lost_followup_sent"] = False
        if stage == "lead_real" and _cur_norm_h != "lead_real":
            try:
                sb.table("lead_reactivation_schedules").upsert({
                    "tenant_id": str(tenant_id),
                    "lead_id": lead_id,
                    "armed_at": eval_time,
                    "next_due_at": (datetime.now(timezone.utc) + timedelta(days=4)).isoformat(),
                    "step_index": 0,
                    "is_active": True,
                }, on_conflict="lead_id").execute()
                logger.info(f"[JEV] Cadencia de reativacao armada p/ lead {lead_id} (D+4)")
            except Exception as _arm_err:
                logger.warning(f"[JEV] Falha ao armar reativacao do lead {lead_id}: {_arm_err}")

    try:
        sb.table("leads").update(update_payload).eq("id", lead_id).execute()
        logger.info(f"[JEV UPDATE] Lead {lead_id} -> {prob}% | {stage} (turismo={is_tourism})")
    except Exception as upd_err:
        logger.error("[JEV_COPILOT] Falha ao atualizar lead %s no Supabase: %s", lead_id, upd_err)

    return {
        "lead_id": lead_id,
        "conversion_probability": prob,
        "negotiation_stage": stage,
        "current_objection": objection,
        "copilot_guidance": guidance,
        "suggested_reply": suggested_reply,
        "last_copilot_eval_at": eval_time,
    }
