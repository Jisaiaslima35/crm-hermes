"""Copiloto FDE — métricas operacionais fidedignas do tenant.

03/11/2026 — sprint "Copiloto FDE ativo em segundo plano" (tenant 1111,
Clínica Psiquiátrica Dr. Matheus Doré).

REGRA DE OURO DA VERACIDADE (vale para todo o módulo):
  * consulta só existe se houver linha em `appointments` — NUNCA deriva do
    Kanban (`leads.stage`), que é campo de funil, não de agenda;
  * mídia só conta como "auditada" quando a análise de visão trouxe conteúdo
    concreto — a resposta genérica do bot ("Olá! Recebi a imagem que você
    enviou…") NÃO é conteúdo de exame nem comprovante;
  * lead sem nome ancorado na conversa do próprio paciente aparece como
    "Paciente (a confirmar)" + telefone formatado;
  * contatos internos/testes (blindagem) não entram em nenhuma métrica.

O módulo é puro: recebe o cliente Supabase e o tenant, não mexe em estado.
"""

from __future__ import annotations

import os
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Optional
from zoneinfo import ZoneInfo

BRASILIA = ZoneInfo("America/Fortaleza")

NOME_PADRAO = "Paciente (a confirmar)"

# ---------------------------------------------------------------------------
# Classificadores de mídia
# ---------------------------------------------------------------------------
PREFIXO_IMAGEM = "[Imagem enviada pelo contato]: "

# Respostas automáticas do bot que NÃO descrevem a imagem (vêm truncadas).
_RE_BOILERPLATE_IMAGEM = re.compile(
    r"agrade[çc]o por (compartilhar|enviar)|"
    r"recebi (a |sua |o )?imagem|"
    r"analisando (o|a) (que voc[êe] me envi|documento|imagem|foto|o que)|"
    r"sua imagem foi recebida|enviei uma imagem|vamos analisar juntos|"
    r"pelo que (consigo|pude) identificar",
    re.IGNORECASE,
)

# Conteúdo CONCRETO reconhecido na análise de visão. Exige construção
# descritiva ("a imagem mostra uma receita", "identifiquei que se trata de…",
# "é um comprovante de Pix") — NÃO conta a frase genérica "recebi a imagem do
# seu exame", que é o opener automático do bot sem descrição nenhuma.
_RE_CONTEUDO_IMAGEM = re.compile(
    r"mostra (uma|um|a|o)|"
    r"identifiquei (que|uma|um|o|a)|"
    r"é (um|uma) \*{0,2}(laudo|receita|comprovante|documento|recibo|exame|resultado|caixa|pessoa)|"
    r"trata-se de|"
    r"imagem (é|mostra) ",
    re.IGNORECASE,
)

_RE_COMPROVANTE_PIX = re.compile(
    r"\bpix\b|boleto|comprovante de pagamento|pagamento|transfer[êe]ncia|"
    r"qr ?code|pagamento realizado|nota fiscal",
    re.IGNORECASE,
)

_RE_EXAME = re.compile(
    r"laudo|exame|resultado de exame|receita|atestado|guia|diagn[óo]stico|"
    r"resson[âa]ncia|hemograma|psicometria|eletroencefalograma|ultrassom|"
    r"radiografia|raio ?x",
    re.IGNORECASE,
)

_RE_AUDIO_INAUDIVEL = re.compile(r"\[AUDIO[_ ]INAUDIVEL\]|\[ÁUDIO INAUDÍVEL\]", re.IGNORECASE)

# ---------------------------------------------------------------------------
# Agenda real — status que a EQUIPE marca (nunca o Copiloto)
# ---------------------------------------------------------------------------
STATUS_AGENDA_CONFIRMADA = {
    "confirmado", "confirmada", "compareceu", "realizado", "realizada",
    "atendido", "atendida", "completed", "done", "concluido", "concluida",
}

# Contatos internos/testes (mesma regra da blindagem do webhook_server).
_PADRAOES_INTERNAS = (
    "matheus dore", "clinica zen", "clinica zem", "casa zen",
    "beatriz", "paciente teste", "teste",
)


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def janela_utc(dias: int) -> tuple[str, str]:
    """Janela [inicio, fim) em UTC no formato aceito pelo PostgREST.

    Mesma convenção da RPC de métricas: dias úteis incluindo hoje, BRT.
    """
    dias = max(1, min(90, int(dias or 7)))
    agora = datetime.now(BRASILIA)
    hoje = agora.date()
    inicio = datetime.combine(hoje - timedelta(days=dias - 1), datetime.min.time(), tzinfo=BRASILIA)
    fim = datetime.combine(hoje + timedelta(days=1), datetime.min.time(), tzinfo=BRASILIA)
    return (
        inicio.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        fim.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _normalizar_phone(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")


def _phone_variants(phone: str) -> set[str]:
    digits = _normalizar_phone(phone)
    if not digits:
        return set()
    out = {digits}
    if digits.startswith("55"):
        out.add(digits[2:])
    else:
        out.add("55" + digits)
    return out


def formatar_telefone(phone: str) -> str:
    """(84) 99632-7329 — fallback honesto quando o nome não é confiável."""
    d = _normalizar_phone(phone)
    if len(d) == 13 and d.startswith("55"):
        d = d[2:]
    if len(d) == 11:
        return f"({d[:2]}) {d[2:7]}-{d[7:]}"
    if len(d) == 10:
        return f"({d[:2]}) {d[2:6]}-{d[6:]}"
    return phone or ""


def classificar_imagem(content: str) -> dict[str, Any]:
    """Diz se a resposta da visão trouxe conteúdo real e o que ela descreve.

    Retorna {"tem_analise": bool, "categoria": str, "motivo": str}.
    """
    c = (content or "").strip()
    if c.startswith(PREFIXO_IMAGEM):
        c = c[len(PREFIXO_IMAGEM):].strip()
    if len(c) < 60:
        return {"tem_analise": False, "categoria": "sem_conteudo", "motivo": "sem descricao"}
    tem_concreto = bool(_RE_CONTEUDO_IMAGEM.search(c))
    if len(c) >= 200:
        cat = "outro"
        if _RE_COMPROVANTE_PIX.search(c):
            cat = "comprovante_pix"
        elif _RE_EXAME.search(c):
            cat = "exame_receita"
        return {
            "tem_analise": True,
            "analise_completa": True,
            "categoria": cat,
            "motivo": "analise completa",
        }
    if tem_concreto:
        cat = "outro"
        if _RE_COMPROVANTE_PIX.search(c):
            cat = "comprovante_pix"
        elif _RE_EXAME.search(c):
            cat = "exame_receita"
        return {
            "tem_analise": True,
            "analise_completa": False,
            "categoria": cat,
            "motivo": "conteudo nomeado",
        }
    return {
        "tem_analise": False,
        "analise_completa": False,
        "categoria": "sem_conteudo",
        "motivo": "resposta generica",
    }


def resposta_generica_imagem(content: str) -> bool:
    """True quando o bot respondeu de forma genérica (NÃO descreveu a imagem).

    Cobre os openers Automaticos do bot ("Olá! Recebi a imagem que você
    enviou…", "Olá! Agradeço por compartilhar a imagem…"), que vêm truncados
    e não carregam informação de exame/comprovante.
    """
    c = (content or "").strip()
    if c.startswith(PREFIXO_IMAGEM):
        c = c[len(PREFIXO_IMAGEM):].strip()
    if len(c) < 60:
        return True
    if len(c) >= 200:
        return False
    return not _RE_CONTEUDO_IMAGEM.search(c)


def classificar_audio(content: str) -> dict[str, Any]:
    """Áudio transcrito x inaudível (nunca chutar palavra)."""
    c = (content or "").strip()
    if not c:
        return {"transcrito": False, "inaudivel": True}
    if _RE_AUDIO_INAUDIVEL.search(c):
        return {"transcrito": False, "inaudivel": True}
    return {"transcrito": len(c) >= 12, "inaudivel": False}


# ---------------------------------------------------------------------------
# Blindagem (contatos internos/testes não contam em nada)
# ---------------------------------------------------------------------------
def _carregar_ignorados(sb: Any, tenant_id: str) -> list[dict[str, Any]]:
    try:
        filtros = ["1111", "11111111-1111-1111-1111-111111111111"]
        if str(tenant_id) not in filtros:
            filtros = [str(tenant_id)]
        res = (
            sb.table("tenant_ignored_contacts")
            .select("name,phone,reason")
            .in_("tenant_id", filtros)
            .execute()
        )
        return res.data or []
    except Exception:
        return []


def _montar_ignorados(ignorados: Iterable[dict[str, Any]]) -> tuple[list[str], set[str]]:
    nomes: list[str] = []
    telefones: set[str] = set()
    for item in ignorados or []:
        nome = str(item.get("name") or "").strip().lower()
        if nome:
            nomes.append(nome)
        fone = str(item.get("phone") or "").strip()
        if fone:
            telefones |= _phone_variants(fone)
    return nomes, telefones


def _eh_ignorado(
    lead: dict[str, Any],
    nomes_ignorados: list[str],
    telefones_ignorados: set[str],
) -> bool:
    nome = str(lead.get("name") or "").strip().lower()
    if nome and any(p in nome for p in _PADRAOES_INTERNAS):
        return True
    if nome and any(n and (n == nome or (len(n) >= 2 and n in nome) or (len(nome) >= 2 and nome in n)) for n in nomes_ignorados):
        return True
    fone = _normalizar_phone(str(lead.get("phone") or ""))
    if fone:
        variantes = _phone_variants(fone)
        if variantes & telefones_ignorados:
            return True
    return False


# ---------------------------------------------------------------------------
# Busca de mensagens / leads
# ---------------------------------------------------------------------------
def _buscar_mensagens(sb: Any, tenant_id: str, inicio: str, fim: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        lote = (
            sb.table("messages")
            .select("lead_id,sender,media_type,content,created_at")
            .eq("tenant_id", tenant_id)
            .gte("created_at", inicio)
            .lt("created_at", fim)
            .order("created_at")
            .range(offset, offset + 999)
            .execute()
            .data
            or []
        )
        if not lote:
            break
        out.extend(lote)
        offset += len(lote)
        if len(lote) < 1000:
            break
    return out


def _buscar_leads(sb: Any, tenant_id: str, lead_ids: set[str]) -> dict[str, dict[str, Any]]:
    if not lead_ids:
        return {}
    out: dict[str, dict[str, Any]] = {}
    ids = list(lead_ids)
    for i in range(0, len(ids), 200):
        bloco = ids[i: i + 200]
        try:
            res = (
                sb.table("leads")
                .select("id,name,phone,stage,telefone_formatado")
                .eq("tenant_id", tenant_id)
                .in_("id", bloco)
                .execute()
            )
            for row in res.data or []:
                out[str(row.get("id"))] = dict(row or {})
        except Exception:
            continue
    return out


def _agenda_real(sb: Any, tenant_id: str, dias: int) -> dict[str, Any]:
    """Agenda VERDADEIRA: só o que existe em `appointments`."""
    inicio, fim = janela_utc(dias)
    try:
        res = (
            sb.table("appointments")
            .select("id,status,start_time,lead_id")
            .eq("tenant_id", tenant_id)
            .execute()
        )
        rows = res.data or []
    except Exception:
        rows = []
    dentro = []
    for a in rows:
        st = str(a.get("start_time") or "")
        if not st or (inicio <= st < fim):
            dentro.append(a)
    confirmadas = [
        a for a in dentro
        if str(a.get("status") or "").strip().lower() in STATUS_AGENDA_CONFIRMADA
    ]
    return {
        "consultas_registradas": len(dentro),
        "confirmadas_por_equipe": len(confirmadas),
        "nao_confirmadas": len(dentro) - len(confirmadas),
        "fonte": "appointments (status marcado por humano)",
        "derivado_do_kanban": False,
    }


# ---------------------------------------------------------------------------
# Bloco operacional do Copiloto FDE
# ---------------------------------------------------------------------------
def bloco_operacao(
    sb: Any,
    tenant_id: str,
    dias: int = 7,
    filtro_interno: Optional[Callable[[dict[str, Any]], bool]] = None,
) -> dict[str, Any]:
    """Métricas de trabalho REAL do Copiloto FDE na janela.

    Contatos que chegaram, atendimento humano x conversa sem retorno, mídia
    recebida e auditada, e a agenda real (0 se não existe appointment).
    """
    inicio, fim = janela_utc(dias)
    mensagens = _buscar_mensagens(sb, tenant_id, inicio, fim)
    lead_ids = {str(m.get("lead_id")) for m in mensagens if m.get("lead_id")}
    leads = _buscar_leads(sb, tenant_id, lead_ids)

    nomes_ign, fones_ign = _montar_ignorados(_carregar_ignorados(sb, tenant_id))

    def _ignorado(lead_id: str) -> bool:
        lead = leads.get(str(lead_id)) or {}
        if _eh_ignorado(lead, nomes_ign, fones_ign):
            return True
        if filtro_interno is not None:
            try:
                return bool(filtro_interno(lead))
            except Exception:
                return False
        return False

    por_lead: dict[str, list[dict[str, Any]]] = defaultdict(list)
    por_sender: dict[str, int] = defaultdict(int)
    ignorados_n = 0
    for m in mensagens:
        lid = str(m.get("lead_id") or "")
        if lid and _ignorado(lid):
            ignorados_n += 1
            continue
        por_lead[lid].append(m)
        por_sender[str(m.get("sender") or "?")] += 1

    falaram = atendidos = sem_retorno = 0
    sem_retorno_leads: list[str] = []
    for lid, msgs in por_lead.items():
        if not any(str(m.get("sender")) == "patient" for m in msgs):
            continue
        falaram += 1
        ultimo = sorted(msgs, key=lambda m: str(m.get("created_at") or ""))[-1]
        ultimo_sender = str(ultimo.get("sender") or "")
        if ultimo_sender == "human":
            atendidos += 1
        elif ultimo_sender == "patient":
            sem_retorno += 1
            sem_retorno_leads.append(lid)

    # --- mídia do paciente -------------------------------------------------
    audios = imagens = documentos = 0
    audios_transcritos = audios_inaudiveis = 0
    img_com_analise = img_analise_completa = img_com_concreto = img_sem_conteudo = 0
    img_pix = img_exame = 0
    doc_com_texto = 0
    for m in mensagens:
        lid = str(m.get("lead_id") or "")
        if lid and _ignorado(lid):
            continue
        if str(m.get("sender")) != "patient":
            continue
        mt = str(m.get("media_type") or "text")
        if mt == "audio":
            audios += 1
            info = classificar_audio(m.get("content") or "")
            if info["transcrito"]:
                audios_transcritos += 1
            if info["inaudivel"]:
                audios_inaudiveis += 1
        elif mt == "image":
            imagens += 1
            info = classificar_imagem(m.get("content") or "")
            if info["tem_analise"]:
                img_com_analise += 1
                if info.get("analise_completa"):
                    img_analise_completa += 1
                if info["categoria"] == "comprovante_pix":
                    img_pix += 1
                    img_com_concreto += 1
                elif info["categoria"] == "exame_receita":
                    img_exame += 1
                    img_com_concreto += 1
            else:
                img_sem_conteudo += 1
        elif mt == "document":
            documentos += 1
            c = (m.get("content") or "").strip()
            if c and c.lower() != "[documentmessage]" and len(c) > 20:
                doc_com_texto += 1

    # --- respostas automáticas (envio ao paciente) -------------------------
    autos = [m for m in mensagens if str(m.get("sender")) == "ai"]
    autos.sort(key=lambda m: str(m.get("created_at") or ""))
    ultimo_auto = autos[-1].get("created_at") if autos else None

    return {
        "janela_dias": dias,
        "gerado_em": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "contatos": {
            "falaram": falaram,
            "atendidos_pela_equipe": atendidos,
            "sem_retorno": sem_retorno,
            "ignorados_blindagem": ignorados_n,
        },
        "mensagens": {
            "paciente": por_sender.get("patient", 0),
            "equipe": por_sender.get("human", 0),
            "automaticas_ao_paciente": por_sender.get("ai", 0),
        },
        "midia": {
            "audios": {
                "recebidos": audios,
                "transcritos": audios_transcritos,
                "inaudiveis": audios_inaudiveis,
            },
            "imagens": {
                "recebidas": imagens,
                "com_analise_real": img_com_analise,
                "analises_completas": img_analise_completa,
                "com_conteudo_nomeado": img_com_concreto,
                "sem_conteudo_util": img_sem_conteudo,
                "comprovantes_pix": img_pix,
                "exames_receitas": img_exame,
            },
            "documentos": {
                "recebidos": documentos,
                "com_texto_extraido": doc_com_texto,
            },
        },
        "agenda_real": _agenda_real(sb, tenant_id, dias),
        "envio_automatico": {
            "respostas_no_periodo": len(autos),
            "ultima_em": ultimo_auto,
        },
    }


# ---------------------------------------------------------------------------
# Status do Copiloto FDE (prova de que ele roda e de que o envio está travado)
# ---------------------------------------------------------------------------
CAMINHO_RELATORIO = "/var/log/crm-telegram-reports.log"


def _crontab_da_clinica() -> list[str]:
    """Linhas do crontab (root) que agendam o relatório executivo 12h/18h."""
    linhas: list[str] = []
    try:
        import subprocess

        proc = subprocess.run(
            ["crontab", "-l"], capture_output=True, text=True, timeout=5
        )
        for linha in (proc.stdout or "").splitlines():
            if "daily_summary" in linha or "run_daily_summary" in linha:
                linhas.append(linha.strip())
    except Exception:
        pass
    return linhas


def _ultima_execucao_relatorio() -> dict[str, Any]:
    try:
        st = os.stat(CAMINHO_RELATORIO)
        return {
            "log": CAMINHO_RELATORIO,
            "ultima_execucao": datetime.fromtimestamp(st.st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tamanho_bytes": st.st_size,
        }
    except Exception:
        return {"log": CAMINHO_RELATORIO, "ultima_execucao": None, "tamanho_bytes": 0}


def _respostas_automaticas_24h(sb: Any, tenant_id: str, desde_customizado: str | None = None) -> dict[str, Any]:
    desde = desde_customizado or (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        res = (
            sb.table("messages")
            .select("created_at,content")
            .eq("tenant_id", tenant_id)
            .eq("sender", "ai")
            .gte("created_at", desde)
            .order("created_at")
            .execute()
        )
        linhas = res.data or []
    except Exception:
        linhas = []
    ultima = linhas[-1].get("created_at") if linhas else None
    return {"quantidade_24h": len(linhas), "ultima_em": ultima, "desde": desde}


def status_copiloto(sb: Any, tenant_id: str, cfg: dict[str, Any]) -> dict[str, Any]:
    """Estado do Copiloto FDE: analítico ATIVO + envio ao paciente TRAVADO.

    O `plantão IA OFF` (ai_auto_reply_enabled=false) só impede a resposta
    automática no WhatsApp — o minerador silencioso, a extração clínica, a
    auditoria de visão (comprovantes) e o Copiloto preditivo continuam.
    """
    ai_auto = bool(cfg.get("ai_auto_reply_enabled", True))
    plantao_off = not ai_auto
    schedule_rules = cfg.get("schedule_rules") or {}
    followup_rules = cfg.get("followup_rules") or {}

    automacoes_on: Optional[bool] = None
    automacoes_em: Optional[str] = None
    try:
        res = sb.table("automation_control").select("enabled,updated_at").limit(1).execute()
        row = (res.data or [{}])[0]
        automacoes_on = bool(row.get("enabled"))
        automacoes_em = row.get("updated_at")
    except Exception:
        pass

    cron = _crontab_da_clinica()
    relatorio = _ultima_execucao_relatorio()
    autos24 = _respostas_automaticas_24h(sb, tenant_id)
    # 03/11/2026: prova do TRAVAMENTO — nenhuma resposta automática DEPOIS de
    # o interruptor global ser desligado (automation_control.updated_at).
    autos_pos_bloqueio = {"quantidade_24h": 0, "ultima_em": None, "desde": None}
    if automacoes_em and automacoes_on is False:
        try:
            dt = datetime.fromisoformat(str(automacoes_em).replace("Z", "+00:00"))
            marca = dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            autos_pos_bloqueio = _respostas_automaticas_24h(sb, tenant_id, marca)
        except Exception:
            pass

    return {
        "tenant_id": tenant_id,
        "tenant_nome": cfg.get("name") or "",
        "envio_ao_paciente": {
            "bloqueado": plantao_off,
            "ai_auto_reply_enabled": ai_auto,
            "motivo": (
                "plantão IA OFF: a IA não responde no WhatsApp; "
                "o Copiloto segue minerando e auditando em segundo plano"
                if plantao_off
                else "plantão IA ON: a IA pode responder automaticamente"
            ),
            "respostas_automaticas_24h": autos24["quantidade_24h"],
            "ultima_resposta_automatica": autos24["ultima_em"],
            "respostas_automaticas_apos_bloqueio": autos_pos_bloqueio["quantidade_24h"],
            "bloqueio_em": automacoes_em,
            "trava_holding": (
                "nenhuma resposta automática registrada depois do bloqueio"
                if autos_pos_bloqueio["quantidade_24h"] == 0
                else f"ATENÇÃO: {autos_pos_bloqueio['quantidade_24h']} resposta(s) automática(s) após o bloqueio"
            ),
        },
        "copiloto_analitico": {
            "ativo": True,
            "minerador_silencioso": True,
            "minerador_regra": "dispara quando plantão_off (IA não responde) ou quando o operador humano assumiu",
            "extracao_clinica_sintomas": True,
            "auditoria_visao_comprovantes": True,
            "copiloto_predictivo_jev": True,
            "relatorio_executivo_12h_18h": bool(cron),
            "cron": cron,
            "ultima_execucao_relatorio": relatorio["ultima_execucao"],
            "log_relatorio": relatorio["log"],
        },
        "automacoes_globais": {
            "enabled": automacoes_on,
            "updated_at": automacoes_em,
            "observacao": "automation_control.enabled=false trava as automações temporais do Kanban (D+0/D-1/D+3/D+28/D+60)",
        },
        "agenda_automatica": {
            "schedule_rules_enabled": bool(schedule_rules.get("enabled")),
            "confirmacao_automatica": bool(schedule_rules.get("confirmacao_automatica")),
            "copiloto_cria_appointment": bool(schedule_rules.get("copiloto_cria_appointment")),
            "followup_rules_enabled": bool(followup_rules.get("enabled")),
            "observacao": "somente a equipe fecha consulta: appointments.status='confirmado' é humano",
        },
        "gerado_em": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
