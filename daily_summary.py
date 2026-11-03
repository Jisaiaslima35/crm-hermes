#!/usr/bin/env python3
"""daily_summary.py — Relatório executivo (12h/18h) da Clínica Dr. Matheus Dore.

Sprint D (Isaías, Telegram 5999, 03/11/2026) — "agente FDE copiloto em segundo
plano": o relatório é 100% VERÍDICO, derivado da leitura das conversas.

Fontes (somente leitura, tenant isolado 1111):
  - messages.content  → texto do WhatsApp, TRANSCRITO do áudio ou CONTEÚDO DA
                         IMAGEM extraído pela visão. Tudo já entra transcrito/
                         extraído na ingestion (webhook_server._extract_message).
  - appointments      → agenda real (status confirmado/compareceu = fechamento
                         explícito da equipe, nunca inferido pelo agente).
  - leads             → nome canônico do paciente (a IA às vezes troca o nome;
                         quem manda é o CRM).

Regras inegociáveis:
  - "Na dúvida, não qualifica": nada de inferir consulta/dado que não está
    explícito. Áudio inaudível vira [AUDIO_INAUDIVEL] e NÃO vira agendamento.
  - Privacidade: nome do paciente + resumo. NUNCA CPF/RG/telefone/endereço/
    dados bancários. Todo texto livre passa pelo redator antes de virar relatório.
  - Isolamento total: só o tenant da clínica. Nada de escrita no CRM aqui.

Uso:
  python3 daily_summary.py --shift manha      # 00:00–12:00 (BRT)
  python3 daily_summary.py --shift tarde      # 12:00–agora (BRT)
  python3 daily_summary.py --shift manha --dry-run
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from telegram_notify import (
    CLINICA_TENANT_ID,
    _parse_env,
    _supabase_client,
    send_telegram,
)
from fde_metrics import (
    classificar_audio as _fde_classificar_audio,
    classificar_imagem as _fde_classificar_imagem,
    formatar_telefone,
    resposta_generica_imagem,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("daily_summary")

BRT = ZoneInfo("America/Fortaleza")
CRM_ENV = "/root/apps/crm-hermes/.env"

TAG_AUDIO_INAUDIVEL = "[AUDIO_INAUDIVEL]"
TAG_IMAGEM_RECEBIDA = "[IMAGEM_RECEBIDA]"
TAG_CONTEUDO_IMAGEM = "[CONTEÚDO DA IMAGEM:"
TAG_CONTEUDO_DOCUMENTO = "[CONTEÚDO DO DOCUMENTO:"

# Resposta automática genérica do bot (pipeline anterior): NÃO descreve a imagem,
# então não pode ser apresentada como "conteúdo do exame".
# 03/11/2026 (sprint Copiloto FDE): fonte única de verdade = fde_metrics
# .resposta_generica_imagem (cobre "Recebi a imagem que você enviou", etc.).
_RE_BOILERPLATE_IMAGEM = re.compile(
    r"agrade[çc]o por compartilhar|analisando o que voc[êe] me envi|"
    r"sua imagem foi recebida|recebi sua imagem|enviei uma imagem",
    re.IGNORECASE,
)

# --------------------------------------------------------------------------
# Privacidade: redator de PII (LGPD) — aplicado a TODO texto livre do relatório
# --------------------------------------------------------------------------
_RE_CPF = re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b")
_RE_CPF_SO = re.compile(r"\b\d{11}\b")
_RE_RG = re.compile(r"\b\d{7,9}\b(?=\s*(?:-\s*)?(?:SSP|RG))", re.IGNORECASE)
_RE_FONE = re.compile(r"(?:\+?55\s*)?(?:\(\d{2}\)|\d{2})[\s.-]?9?\d{4}[\s.-]?\d{4}\b")
_RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_RE_CEP = re.compile(r"\b\d{5}-\d{3}\b")
_RE_ADDR = re.compile(
    r"\b(?:rua|avenida|av\.|travessa|av\.?|rua\.?|alameda|praça|praca|rodovia|rod\.)\s+[^,;\n]{3,60}",
    re.IGNORECASE,
)
_RE_CAMPO_CPF = re.compile(r"(CPF|C\.?P\.?F\.?|CNS|RG)\s*[:\-]?\s*[^\s,;\n]{0,20}", re.IGNORECASE)
_RE_CAMPO_END = re.compile(
    r"(endereço|endereco|logradouro|cep)\s*[:\-]?\s*[^\n]{0,80}", re.IGNORECASE
)
_RE_CAMPO_FONE = re.compile(
    r"(telefone|celular|whatsapp|contato|fone)\s*[:\-]?\s*[^\n]{0,30}", re.IGNORECASE
)
_PLACEHOLDERS = {
    "[pininchatmessage]",
    "[documentmessage]",
    "[imagem enviada pelo contato]",
    ".",
    "..",
    "...",
}


def redigir(texto: str) -> str:
    """Remove PII de um texto livre. Devolve string segura para o Telegram."""
    if not texto:
        return ""
    t = texto
    t = _RE_CAMPO_CPF.sub(lambda m: f"{m.group(1)}: [REMOVIDO]", t)
    t = _RE_CAMPO_END.sub(lambda m: f"{m.group(1)}: [REMOVIDO]", t)
    t = _RE_CAMPO_FONE.sub(lambda m: f"{m.group(1)}: [REMOVIDO]", t)
    t = _RE_CPF.sub("[CPF removido]", t)
    t = _RE_CPF_SO.sub("[CPF removido]", t)
    t = _RE_RG.sub("[RG removido]", t)
    t = _RE_EMAIL.sub("[email removido]", t)
    t = _RE_CEP.sub("[CEP removido]", t)
    t = _RE_ADDR.sub("[endereço removido]", t)
    t = _RE_FONE.sub("[telefone removido]", t)
    t = re.sub(r"\s{2,}", " ", t)
    return t.strip()


_NOMES_ARTIFACT = (
    "disponivel", "disponível", "atendimento", "consulta", "paciente", "lead",
    "sem nome", "desconhecido", "nao informado", "não informado", "sala de espera",
    "nenhum", "novo contato", "teste",
)
_RE_SOMENTE_NUMEROS = re.compile(r"[\d\s+\-()]+")


def _nome_confiavel(nome: str) -> tuple[str, bool]:
    """(nome exibido, é confiável?).

    O CRM da clínica tem l.leads.name poluído por material gerado por IA
    (ex.: "DISPONÍVEL", "Contato 2476", frases inteiras). Exibir isso como
    nome de paciente contaminaria o relatório — a regra é: na dúvida, não
    qualifica. 03/11/2026: rótulo único "Paciente (a confirmar)".
    """
    bruto = (nome or "").strip()
    if not bruto or _RE_SOMENTE_NUMEROS.fullmatch(bruto):
        return "Paciente (a confirmar)", False
    if re.match(r"^(contato|paciente|lead)\s*\d+", bruto, re.IGNORECASE):
        return "Paciente (a confirmar)", False
    if len(bruto.split()) > 5:
        return "Paciente (a confirmar)", False
    if bruto.lower().strip(" .!-") in _NOMES_ARTIFACT:
        return "Paciente (a confirmar)", False
    return bruto, True


def _sem_acento(txt: str) -> str:
    import unicodedata

    return "".join(
        c for c in unicodedata.normalize("NFKD", txt or "") if not unicodedata.combining(c)
    ).lower()


def _nome_ancorado(nome: str, conversa: str) -> bool:
    """O nome do paciente aparece na própria conversa?

    03/11/2026 (sprint Copiloto FDE): nome que a IA inventou no cadastro
    (ex.: "Ateliê da Arte", "MD", "MentalMe") NÃO pode virar identidade no
    relatório. Se o nome não estiver ancorado no texto do paciente, exibir
    "Paciente (a confirmar)" + telefone formatado.
    """
    alvo = _sem_acento((nome or "").strip())
    if not alvo:
        return False
    texto = _sem_acento(conversa or "")
    if not texto:
        return False
    if alvo in texto:
        return True
    partes = [p for p in re.split(r"\s+", alvo) if len(p) >= 3]
    if len(partes) >= 2 and partes[0] in texto and partes[-1] in texto:
        return True
    return False


def _sufixo_tel(telefone: str) -> str:
    """Desambiguador sem PII completo: "final 7329".

    03/11/2026 (sprint Copiloto FDE): o relatório vai pro Telegram (app de
    terceiro) — LGPD do Sprint D proíbe telefone completo. Mantemos só o
    final para a equipe saber qual contato é qual. O telefone inteiro fica
    no CRM e na API autenticada.
    """
    d = re.sub(r"\D", "", telefone or "")
    if len(d) < 4:
        return ""
    return f" · final {d[-4:]}"


def _sem_nome(descricao: str, nome: str) -> str:
    """Remove o nome do paciente (CRM) do texto extraído do documento."""
    if not descricao:
        return ""
    if nome and nome.lower() not in ("paciente (a confirmar)", "paciente (sem contato vinculado)"):
        try:
            descricao = re.sub(re.escape(nome), "[paciente]", descricao, flags=re.IGNORECASE)
        except Exception:
            pass
    # nome já mascarado pelo pipeline legado ("[REMOVIDO] da Silva Freire")
    # → descarta o resto do fragmento de nome
    descricao = re.sub(
        r"\[REMOVIDO\][^,.;:\n]{0,40}", "[nome removido]", descricao, flags=re.IGNORECASE
    )
    return descricao


def _resumir(texto: str, limite: int = 130) -> str:
    """Resumo curto e neutro de uma mensagem (1 linha)."""
    t = re.sub(r"\s+", " ", (texto or "").strip())
    if not t:
        return ""
    t = re.sub(r"\[(pininchatmessage|documentmessage)\]", "", t).strip()
    if len(t) > limite:
        t = t[:limite].rstrip() + "…"
    return t


def _ts(dt: datetime) -> str:
    """Timestamp UTC ISO-8601 (Z) — formato aceito pelo PostgREST."""
    return dt.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")


def _janela(shift: str) -> tuple[datetime, datetime]:
    """Janela do turno em BRT (aware)."""
    now = datetime.now(BRT)
    hoje = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if shift == "manha":
        return hoje, hoje + timedelta(hours=12)
    if shift == "tarde":
        return hoje + timedelta(hours=12), now
    return hoje, now


# --------------------------------------------------------------------------
# Consultas (somente leitura)
# --------------------------------------------------------------------------
def _buscar_mensagens(sb, inicio: datetime, fim: datetime) -> list[dict]:
    try:
        res = (
            sb.table("messages")
            .select("id,lead_id,sender,sender_name,content,media_type,created_at")
            .eq("tenant_id", CLINICA_TENANT_ID)
            .gte("created_at", _ts(inicio))
            .lte("created_at", _ts(fim))
            .order("created_at")
            .limit(2000)
            .execute()
        )
        return res.data or []
    except Exception as exc:
        logger.error("daily_summary: falha ao ler messages (%s)", exc)
        return []


def _buscar_leads(sb, lead_ids: list[str]) -> dict[str, dict]:
    if not lead_ids:
        return {}
    out: dict[str, dict] = {}
    for i in range(0, len(lead_ids), 50):
        bloco = lead_ids[i:i + 50]
        try:
            res = (
                sb.table("leads")
                .select("id,name,phone,stage")
                .eq("tenant_id", CLINICA_TENANT_ID)
                .in_("id", bloco)
                .execute()
            )
            for row in res.data or []:
                out[row.get("id")] = row
        except Exception as exc:
            logger.warning("daily_summary: falha ao ler leads (%s)", exc)
    return out


def _buscar_agendamentos(sb, inicio: datetime, fim: datetime) -> list[dict]:
    """Agendamentos tocados na janela (updated_at OU start_time dentro da janela)."""
    try:
        res = (
            sb.table("appointments")
            .select("id,lead_id,start_time,end_time,status,title,specialty,source,notes,created_at,updated_at")
            .eq("tenant_id", CLINICA_TENANT_ID)
            .or_(
                f"updated_at.gte.{_ts(inicio)},updated_at.lte.{_ts(fim)},"
                f"start_time.gte.{_ts(inicio)},start_time.lte.{_ts(fim)}"
            )
            .limit(500)
            .execute()
        )
        return res.data or []
    except Exception as exc:
        logger.error("daily_summary: falha ao ler appointments (%s)", exc)
        return []


def _conversas_leads(sb, lead_ids: list[str], dias: int = 30) -> dict[str, str]:
    """Texto concatenado das conversas (checa se o nome do cadastro tem âncora).

    03/11/2026 (sprint Copiloto FDE): nome sem âncora textual = identidade
    inventada pela IA — no relatório vira "Paciente (a confirmar)" + telefone.
    """
    out: dict[str, str] = {}
    if not lead_ids:
        return out
    desde = datetime.now(BRT) - timedelta(days=dias)
    for i in range(0, min(len(lead_ids), 400), 200):
        bloco = lead_ids[i:i + 200]
        try:
            res = (
                sb.table("messages")
                .select("lead_id,content")
                .eq("tenant_id", CLINICA_TENANT_ID)
                .gte("created_at", _ts(desde))
                .in_("lead_id", bloco)
                .limit(3000)
                .execute()
            )
            for row in res.data or []:
                lid = row.get("lead_id")
                txt = (row.get("content") or "").strip()
                if lid and txt:
                    out[lid] = (out.get(lid, "") + " " + txt)[:8000]
        except Exception as exc:
            logger.warning("daily_summary: falha ao montar conversas (%s)", exc)
    return out


def _historico_ultimo(sb, lead_ids: list[str], dias: int = 3) -> dict[str, dict]:
    """Última mensagem por lead (janela maior) — base das pendências."""
    if not lead_ids:
        return {}
    desde = datetime.now(BRT) - timedelta(days=dias)
    out: dict[str, dict] = {}
    try:
        res = (
            sb.table("messages")
            .select("lead_id,sender,content,media_type,created_at")
            .eq("tenant_id", CLINICA_TENANT_ID)
            .gte("created_at", _ts(desde))
            .in_("lead_id", lead_ids[:200])
            .order("created_at")
            .limit(3000)
            .execute()
        )
        for row in res.data or []:
            lid = row.get("lead_id")
            if lid:
                out[lid] = row
    except Exception as exc:
        logger.warning("daily_summary: falha no histórico (%s)", exc)
    return out


_RE_CONFIRMACAO = re.compile(
    r"\b(confirmo|confirmado|confirmada|fechado|fechada|combinado|combinada|agendado|agendada|"
    r"ficou (?:para|no dia)|marquei|anotado|pode vir|pode vir)\b",
    re.IGNORECASE,
)


# --------------------------------------------------------------------------
# Montagem do relatório
# --------------------------------------------------------------------------
def montar_relatorio(sb, shift: str) -> str:
    inicio, fim = _janela(shift)
    msgs = _buscar_mensagens(sb, inicio, fim)
    if not msgs:
        return (
            f"📋 RELATÓRIO {shift.upper()} — Clínica Dr. Matheus Dore\n"
            f"Janela: {inicio.strftime('%d/%m %H:%M')}–{fim.strftime('%d/%m %H:%M')} (BRT)\n\n"
            "Sem mensagens no período. Nada a reportar."
        )

    lead_ids = sorted({m["lead_id"] for m in msgs if m.get("lead_id")})
    leads = _buscar_leads(sb, lead_ids)

    nomes_confiaveis = {"total": 0, "suspeitos": 0}
    conversas = _conversas_leads(sb, lead_ids, dias=30)

    def nome(lid: str | None) -> str:
        """Nome EXIBIDO com âncora textual (03/11/2026 sprint Copiloto FDE).

        Regra: nome do CRM só vale se (a) não for artefato de IA e (b) aparecer
        na conversa do próprio paciente. Sem âncora → "Paciente (a confirmar)".
        """
        if not lid:
            return "Paciente (sem contato vinculado)"
        lead = leads.get(lid) or {}
        bruto = (lead.get("name") or "").strip()
        sufixo = _sufixo_tel(lead.get("phone") or "")
        if not bruto:
            return "Paciente (a confirmar)" + sufixo
        nomes_confiaveis["total"] += 1
        exibido, ok = _nome_confiavel(bruto)
        if not ok:
            nomes_confiaveis["suspeitos"] += 1
            return "Paciente (a confirmar)" + sufixo
        # âncora: só exige se TEMOS conversa do lead (falha de query não pune)
        if lid in conversas and not _nome_ancorado(bruto, conversas.get(lid, "")):
            nomes_confiaveis["suspeitos"] += 1
            return "Paciente (a confirmar)" + sufixo
        return exibido

    # ---------- 1) CONTATOS ATENDIDOS ----------
    por_lead: dict[str, list[dict]] = {}
    for m in msgs:
        if m.get("sender") == "patient":
            por_lead.setdefault(m.get("lead_id") or "", []).append(m)

    contatos: list[str] = []
    audios_transcritos = 0
    audios_inaudiveis = 0
    imagens_sem_conteudo = 0
    for m in msgs:
        if m.get("sender") != "patient":
            continue
        mt = (m.get("media_type") or "text").lower()
        conteudo = m.get("content") or ""
        if mt == "audio":
            if TAG_AUDIO_INAUDIVEL in conteudo:
                audios_inaudiveis += 1
            else:
                audios_transcritos += 1
        if mt == "image" and TAG_CONTEUDO_IMAGEM not in conteudo and TAG_IMAGEM_RECEBIDA not in conteudo:
            imagens_sem_conteudo += 1

    for lid, lista in sorted(
        por_lead.items(),
        key=lambda kv: max(x.get("created_at") or "" for x in kv[1]),
        reverse=True,
    ):
        canais = []
        if any((x.get("media_type") or "") == "audio" for x in lista):
            canais.append("áudio")
        if any((x.get("media_type") or "") == "image" for x in lista):
            canais.append("imagem")
        if any((x.get("media_type") or "") == "document" for x in lista):
            canais.append("documento")
        if any((x.get("media_type") or "text") == "text" for x in lista):
            canais.append("texto")
        ultima = lista[-1]
        resumo = _resumir(ultima.get("content"))
        if resumo and resumo.startswith("["):
            # mensagem processada (áudio transcrito / imagem): mostra o conteúdo real
            resumo = re.sub(r"^\[[^\]]{0,40}:\s*", "", resumo) if ":" in resumo[:60] else resumo
        linhas = [f"• {nome(lid)} — {len(lista)} mensagem(ns) via {', '.join(canais) or 'texto'}"]
        if resumo:
            linhas.append(f"   Última msg (paciente): {redigir(resumo)}")
        contatos.append("\n".join(linhas))

    # ---------- 2) AGENDAMENTOS EFETIVADOS (fechados por humano) ----------
    appts = _buscar_agendamentos(sb, inicio, fim)
    efetivados = [
        a for a in appts
        if (a.get("status") or "").lower() in ("confirmado", "compareceu")
    ]
    aguardam = [
        a for a in appts
        if (a.get("status") or "").lower() == "agendado"
    ]

    # evidência textual de fechamento (a equipe fecha por WhatsApp)
    conf_por_lead: dict[str, bool] = {}
    for m in msgs:
        if (m.get("sender") or "") != "human":
            continue
        if _RE_CONFIRMACAO.search(m.get("content") or ""):
            lid = m.get("lead_id") or ""
            conf_por_lead[lid] = True

    linhas_appt: list[str] = []
    for a in sorted(efetivados, key=lambda x: x.get("start_time") or ""):
        lid = a.get("lead_id")
        st = (a.get("status") or "").lower()
        quando = ""
        try:
            quando = datetime.fromisoformat(str(a.get("start_time"))).astimezone(BRT).strftime("%d/%m %H:%M")
        except Exception:
            quando = str(a.get("start_time") or "")[:16]
        titulo = (a.get("title") or "Consulta").strip()
        if lid and conf_por_lead.get(lid):
            ev = "confirmação na conversa: SIM"
        else:
            ev = "status confirmado no sistema"
        linhas_appt.append(
            f"• {nome(lid)} — {quando} — {titulo} — status: {st} ({ev})"
        )
    for a in sorted(aguardam, key=lambda x: x.get("start_time") or ""):
        lid = a.get("lead_id")
        try:
            quando = datetime.fromisoformat(str(a.get("start_time"))).astimezone(BRT).strftime("%d/%m %H:%M")
        except Exception:
            quando = str(a.get("start_time") or "")[:16]
        linhas_appt.append(
            f"• {nome(lid)} — {quando} — {(a.get('title') or 'Consulta')} — status: agendado "
            f"(AINDA NÃO confirmado pela equipe — não vale como efetivado)"
        )

    # ---------- 3) PENDÊNCIAS — PACIENTES SEM RETORNO ----------
    ultimo_por_lead = _historico_ultimo(sb, lead_ids, dias=3)
    pendencias: list[str] = []
    for lid, last in ultimo_por_lead.items():
        if (last.get("sender") or "") == "patient":
            continue
        # a última mensagem é da clínica (equipe/IA) e o paciente não respondeu
        ts = last.get("created_at")
        try:
            dt = datetime.fromisoformat(str(ts)).astimezone(BRT)
            horas = (datetime.now(BRT) - dt).total_seconds() / 3600.0
            quando = dt.strftime("%d/%m %H:%M")
        except Exception:
            horas, quando = -1, ""
        resumo = _resumir(last.get("content"), 110)
        pendencias.append(
            f"• {nome(lid)} — última mensagem da clínica {quando} "
            f"(há {horas:.0f}h) — sem retorno do paciente"
            + (f"\n   Enviado: {redigir(resumo)}" if resumo and not resumo.startswith("[") else "")
        )
    pendencias.sort(key=lambda x: x.split("—")[0])

    # ---------- 4) COMPROVANTES / EXAMES VIA IMAGEM ----------
    docs: list[str] = []
    for m in msgs:
        if (m.get("sender") or "") != "patient":
            continue
        mt = (m.get("media_type") or "").lower()
        if mt not in ("image", "document"):
            continue
        conteudo = (m.get("content") or "").strip()
        if TAG_CONTEUDO_IMAGEM in conteudo or TAG_CONTEUDO_DOCUMENTO in conteudo:
            desc = re.sub(r"^\[[^\]]{0,40}:\s*", "", conteudo)
            desc = desc.rstrip("]").strip()
            nome_pac = nome(m.get("lead_id"))
            docs.append(f"• {nome_pac} — {redigir(_sem_nome(desc, nome_pac))}")
        elif TAG_IMAGEM_RECEBIDA in conteudo:
            docs.append(f"• {nome(m.get('lead_id'))} — imagem recebida, sem conteúdo legível (não contabilizada como exame)")
        else:
            # pipeline antigo: "[Imagem enviada pelo contato]: ..." — registra o que havia
            desc = conteudo.replace("[Imagem enviada pelo contato]:", "").strip()
            nome_pac = nome(m.get("lead_id"))
            desc_curto = _resumir(desc, 110)
            if not desc_curto:
                docs.append(f"• {nome_pac} — imagem recebida (sem conteúdo extraído)")
            elif resposta_generica_imagem(desc):
                # resposta automática do bot: não descreve a imagem — não fingir conteúdo
                docs.append(
                    f"• {nome_pac} — imagem recebida (sem conteúdo extraído: "
                    "a resposta automática do bot não descreve a imagem)"
                )
            else:
                docs.append(
                    f"• {nome_pac} — imagem recebida (descrição do pipeline anterior): "
                    f"{redigir(_sem_nome(desc_curto, nome_pac))}"
                )

    # ---------- 4b) COPILOTO FDE — TRABALHO REAL (mídia auditada) ----------
    # 03/11/2026 (sprint Copiloto FDE): o relatório mostra o que o Copiloto
    # realmente fez — contatos que chegaram, quem foi atendido pela equipe,
    # quem ficou sem retorno, e a mídia auditada (áudio transcrito, imagem com
    # análise de verdade, documento com texto). Nada de inferir agenda a partir
    # de leads.stage: agenda real = appointments com status da equipe.
    fde = {
        "equipe": 0, "imagens_analise": 0, "imagens_genericas": 0,
        "pix": 0, "exames": 0, "docs_texto": 0, "docs_recebidos": 0,
    }
    equipe_leads: set[str] = set()
    for m in msgs:
        snd = (m.get("sender") or "")
        lid = m.get("lead_id") or ""
        if snd == "human" and lid:
            equipe_leads.add(lid)
        if snd != "patient":
            continue
        mt = (m.get("media_type") or "").lower()
        conteudo = (m.get("content") or "").strip()
        if mt == "image":
            desc = ""
            if TAG_CONTEUDO_IMAGEM in conteudo:
                desc = re.sub(r"^\[[^\]]{0,40}:\s*", "", conteudo).rstrip("]").strip()
            else:
                cls = _fde_classificar_imagem(conteudo)
                if cls.get("tem_analise"):
                    desc = conteudo
            if desc:
                fde["imagens_analise"] += 1
                cat = _fde_classificar_imagem(desc).get("categoria")
                if cat == "comprovante_pix":
                    fde["pix"] += 1
                elif cat == "exame_receita":
                    fde["exames"] += 1
            else:
                fde["imagens_genericas"] += 1
        elif mt == "document":
            fde["docs_recebidos"] += 1
            if TAG_CONTEUDO_DOCUMENTO in conteudo and len(conteudo) > 80:
                fde["docs_texto"] += 1
    fde["equipe"] = len(equipe_leads)

    # ---------- Montagem ----------
    titulo = "MANHÃ (00h–12h)" if shift == "manha" else ("TARDE (12h–18h)" if shift == "tarde" else "DIA")
    L: list[str] = []
    L.append(f"📋 RELATÓRIO {titulo} — Clínica Dr. Matheus Dore")
    L.append(f"Janela: {inicio.strftime('%d/%m %H:%M')}–{fim.strftime('%d/%m %H:%M')} (BRT)")
    L.append("Fonte: CRM-Hermes (conversas + agenda). Sem inferência.")
    L.append("")

    L.append(f"👥 CONTATOS QUE CHEGARAM — escreveram no período ({len(por_lead)})")
    L.extend(contatos or ["• Nenhum contato do paciente no período."])
    L.append("")

    L.append(f"✅ AGENDAMENTOS EFETIVADOS ({len(efetivados)} confirmados/compareceu)")
    L.extend(linhas_appt or ["• Nenhum agendamento fechado pela equipe no período."])
    L.append("")

    L.append(f"⏳ PENDÊNCIAS — PACIENTES SEM RETORNO ({len(pendencias)})")
    L.extend(pendencias or ["• Nenhuma pendência de retorno."])
    L.append("")

    L.append(f"🖼️ COMPROVANTES OU EXAMES RECEBIDOS VIA IMAGEM ({len(docs)})")
    L.extend(docs or ["• Nenhuma imagem/documento recebido no período."])
    L.append("")

    L.append(
        f"🔎 Leitura das mídias: {audios_transcritos} áudio(s) transcrito(s) · "
        f"{audios_inaudiveis} áudio(s) inaudível(is) — SEM conteúdo, não entra em agenda · "
        f"{imagens_sem_conteudo} imagem(ns) sem extração estruturada"
    )
    L.append(f"Total de mensagens lidas: {len(msgs)}")

    L.append("")
    L.append("🤖 COPILOTO FDE — TRABALHO REAL (janela do relatório)")
    L.append(
        f"• Contatos que chegaram: {len(por_lead)} · "
        f"atendidos pela equipe: {fde['equipe']} · "
        f"conversas sem retorno: {len(pendencias)}"
    )
    L.append(
        f"• Mídia auditada: {audios_transcritos} áudio(s) transcrito(s) · "
        f"{fde['imagens_analise']} imagem(ns) com análise real "
        f"({fde['pix']} comprovante(s) de Pix, {fde['exames']} exame/receita) · "
        f"{fde['imagens_genericas']} imagem(ns) sem conteúdo aproveitável · "
        f"{fde['docs_texto']}/{fde['docs_recebidos']} documento(s) com texto extraído"
    )
    L.append(
        "• Agenda real: só a tabela de consultations com status confirmado pela "
        f"equipe ({len(efetivados)}). Estágio do Kanban não vira agendamento."
    )
    L.append(
        "• Envio automático ao paciente: DESLIGADO (Copiloto só escuta, audita e "
        "reporta — não responde o paciente)."
    )
    if nomes_confiaveis["suspeitos"]:
        L.append(
            f"⚠️ Cadastro: {nomes_confiaveis['suspeitos']} contato(s) com nome ausente, "
            "irregular ou sem âncora na conversa (exibidos como 'Paciente (a confirmar)'). "
            "Corrigir no CRM."
        )
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser(description="Relatório 12h/18h da clínica (verídico)")
    ap.add_argument("--shift", choices=["manha", "tarde", "dia"], default="manha")
    ap.add_argument("--dry-run", action="store_true", help="imprime sem enviar ao Telegram")
    args = ap.parse_args()

    try:
        sb = _supabase_client()
    except Exception as exc:
        logger.error("daily_summary: sem cliente Supabase (%s)", exc)
        return 1

    try:
        texto = montar_relatorio(sb, args.shift)
    except Exception as exc:
        logger.error("daily_summary: falha ao montar relatório (%s)", exc)
        return 1

    if args.dry_run:
        print(texto)
        return 0

    ids = send_telegram(texto)
    logger.info("daily_summary: relatório enviado (%d parte(s))", len(ids))
    return 0 if ids else 1


if __name__ == "__main__":
    sys.exit(main())
