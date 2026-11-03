#!/usr/bin/env python3
"""Sanitizacao dos dados da clinica Dr. Matheus Dore (tenant 1111).

Sprint E (03/11/2026) — Copiloto FDE ativo em segundo plano + saneamento.

O que faz (SEM tocar na estrutura do CRM, no codigo do pipeline nem nas
automacoes de envio):

  (a) BACKUP: despeja em .jsonl (chmod 600) o estado ANTERIOR de cada lead
      alterado (id, nome, telefone, etapa, sintomas, timestamps).
  (b) SINTOMAS FANTASMAS: remove os sintomas gravados por modelos antigos
      que NAO tem ancora textual na fala do paciente. A regra e a MESMA do
      pipeline (webhook_server._sintoma_ancorado) e e conferida em runtime.
  (c) NOMES POLUIDOS: normaliza nomes ficticios/empresarios/handle/placeholder
      para "Paciente (a confirmar)". Nome pessoal que o paciente nunca digitou
      NAO e destruido aqui — continua no banco e aparece como "a confirmar"
      na camada de exibicao (relatorio 12h/18h).
  (d) ETAPAS FALSAS: rebaixa para "em_atendimento" as etapas que afirmam
      consulta realizada sem NENHUM registro na agenda (appointments).

Uso:
  sudo -n env PYTHONPATH=/home/claudeuser/.local/lib/python3.12/site-packages \
    /usr/bin/python3 sanitizacao_clinica_1111.py --dry-run
  sudo -n env PYTHONPATH=/home/claudeuser/.local/lib/python3.12/site-packages \
    /usr/bin/python3 sanitizacao_clinica_1111.py --apply
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone

sys.path.insert(0, "/root/apps/crm-hermes")
from telegram_notify import _supabase_client, CLINICA_TENANT_ID  # noqa: E402

TENANT_ID = CLINICA_TENANT_ID
NOME_PADRAO = "Paciente (a confirmar)"
BACKUP_DIR = "/root/work-backups/crm-hermes"
PIPELINE = "/root/apps/crm-hermes/webhook_server.py"

# --------------------------------------------------------------------------
# Regra de ancora (identica a webhook_server._sintoma_ancorado)
# --------------------------------------------------------------------------
STOPWORDS_SINTOMA = {
    "uso", "de", "do", "da", "des", "dificuldade", "alteracao", "alteração",
    "mudanca", "mudança", "transtorno", "sintoma", "sintomas", "relata", "relata.",
    "paciente", "com", "sem", "possui", "apresenta", "sofre",
}

ETAPAS_CONVERTIDAS = (
    "consulta_realizada", "compareceu_atendido", "compareceu",
    "realizada", "finalizado",
)

# Abaixo disso (poucas falas do paciente) o prontuario NAO e apagado inteiro:
# o registro fica protegido e aparece no relatorio como "nao verificavel".
MIN_MSG_PARA_LIMPEZA = 5


def _sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", (texto or ""))
        if unicodedata.category(c) != "Mn"
    )


def _sintoma_ancorado(sintoma: str, texto_norm: str) -> bool:
    """True se o sintoma tem palavra significativa presente na fala do paciente."""
    norm = _sem_acento((sintoma or "").lower())
    tokens = [t for t in re.findall(r"[a-z0-9]{4,}", norm) if t not in STOPWORDS_SINTOMA]
    if not tokens:
        return bool(norm.strip()) and norm.strip() in texto_norm
    return any(t in texto_norm for t in tokens)


def _conferir_regra_do_pipeline() -> str:
    """Garante que este script usa EXATAMENTE a mesma regra do webhook_server.

    Se alguem mexer em webhook_server._STOPWORDS_SINTOMA, aqui quebra loud.
    """
    try:
        with open(PIPELINE, encoding="utf-8") as fh:
            src = fh.read()
    except OSError as exc:
        return f"nao foi possivel ler {PIPELINE}: {exc}"
    m = re.search(r"_STOPWORDS_SINTOMA\s*=\s*\{(.*?)\}", src, re.S)
    if not m:
        return "nao encontrei _STOPWORDS_SINTOMA no webhook_server.py"
    try:
        pipeline_set = set(ast.literal_eval("{" + m.group(1) + "}"))
    except Exception as exc:  # pragma: no cover
        return f"nao consegui ler os stopwords do pipeline: {exc}"
    if pipeline_set != STOPWORDS_SINTOMA:
        return (
            "DIVERGENCIA: webhook_server._STOPWORDS_SINTOMA != este script "
            f"({sorted(pipeline_set ^ STOPWORDS_SINTOMA)})"
        )
    return "ok"


# --------------------------------------------------------------------------
# Deteccao de nome poluido
# --------------------------------------------------------------------------
NOMES_LIXO = {
    "voce", "vc", "eu", "ok", "oi", "ola", "teste", "teste audio",
    "paciente teste audio", "md", "mentalme", "mental me", "dvinte",
    "disponivel", "indisponivel", "urgente", "atendente", "atendimento",
    "suporte", "recepcao", "secretaria", "clinica", "navegantes",
    "trait d'union", "trait d union", "lead", "novo", "paciente", "contato",
}

# tokens que denunciam empresa/negocio (nao e nome de paciente)
MARCAS_EMPRESA = {
    "clinica", "clin", "ateli", "atelie", "atelier", "cozinha", "artes",
    "estetica", "estetic", "studio", "salão", "salao", "restaurante",
    "bar", "pet", "advocad", "construtora", "imobiliaria", "imobiliario",
    "oficina", "distribuidora", "farmacia", "supermercado", "academia",
    "escola", "colegio", "universidade", "prefeitura", "sindicato",
    "igreja", "capela", "hospital", "laboratorio", "radio", "musica",
    "eventos", "evento", "blog", "informativo", "shopping", "loja",
    "terapia", "psicolog", "psiquiatr", "fisioter", "nutricionista",
    "dentista", "medico", "medica", "enfermagem", "psicologia",
    "nutricao", "pilates", "medicina", "ortopedia", "ginecologia",
    "dermatologia", "fisioterapia", "fonseca", "marechal", "odontologia",
}


def _tokens_nome(nome: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]{2,}", _sem_acento((nome or "").lower()))]


def _classificar_nome(nome: str) -> tuple[bool, str]:
    """(nome poluido?, motivo). Regra conservadora: so renomeia o que
    comprovadamente NAO e nome de paciente."""
    bruto = (nome or "").strip()
    if not bruto:
        return True, "nome vazio"
    alnum = re.sub(r"[^a-z0-9]", "", _sem_acento(bruto).lower())
    if not alnum:
        return True, "nome sem caracteres util (ex.: '.')"
    if len(alnum) < 3:
        return True, "nome curto demais para identificar paciente"
    if "@" in bruto or "http" in bruto.lower() or ".com" in bruto.lower():
        return True, "handle/URL (Instagram ou site)"
    if re.match(r"^contato\s*\d+$", bruto, re.IGNORECASE):
        return True, "placeholder do pipeline (Contato NNNN)"
    norm = _sem_acento(bruto).lower().strip()
    if norm in NOMES_LIXO:
        return True, "nome inodo/lixo conhecido"
    toks = _tokens_nome(bruto)
    if any(t in MARCAS_EMPRESA for t in toks):
        return True, "nome de empresa/negocio (nao e paciente)"
    if len(toks) == 1 and len(toks[0]) >= 12:
        return True, "handle sem espaco (login/IG)"
    if len(toks) == 1 and bruto.isupper() and len(alnum) >= 3:
        return True, "sigla/CAIXA ALTA sem espaco"
    return False, ""


def _nome_ancorado(nome: str, texto_norm: str) -> bool:
    """True se o nome do lead aparece na fala do paciente."""
    toks = [t for t in _tokens_nome(nome) if len(t) >= 3 and t not in NOMES_LIXO]
    if not toks:
        return False
    return any(t in texto_norm for t in toks)


def _tel_formatado(phone: str) -> str:
    d = re.sub(r"\D", "", str(phone or ""))
    if len(d) == 13 and d.startswith("55"):
        d = d[2:]
    if len(d) == 11:
        return f"({d[:2]}) {d[2:7]}-{d[7:]}"
    if len(d) == 10:
        return f"({d[:2]}) {d[2:6]}-{d[6:]}"
    return str(phone or "")


# --------------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="aplica (padrao: dry-run)")
    ap.add_argument("--dry-run", action="store_true", help="somente leitura (padrao)")
    ap.add_argument("--tenant", default=TENANT_ID)
    args = ap.parse_args()
    tid = args.tenant
    aplicar = args.apply

    print("=" * 74)
    print("SANITIZACAO CLINICA — tenant", tid, "| modo:", "APPLY" if aplicar else "DRY-RUN")
    print("=" * 74)

    conferida = _conferir_regra_do_pipeline()
    print(f"[regra de ancora] conferencia com o pipeline: {conferida}")
    if conferida != "ok":
        print("ABORTADO: regra de ancora divergente do webhook_server.py")
        return 2

    sb = _supabase_client()

    # ---- estado das travas (leitura) -------------------------------------
    try:
        ac = sb.table("automation_control").select("enabled,updated_at").eq("id", 1).execute().data
    except Exception as exc:
        ac = []
        print("[aviso] automation_control:", exc)
    print("[travas] automation_control.enabled =", (ac or [{}])[0].get("enabled"))

    # ---- leads -----------------------------------------------------------
    leads = (
        sb.table("leads")
        .select("id,name,phone,stage,symptoms,created_at,updated_at")
        .eq("tenant_id", tid)
        .limit(5000)
        .execute()
        .data or []
    )
    print(f"[leads] {len(leads)} no tenant")

    # ---- mensagens (falas do paciente) -----------------------------------
    msgs = (
        sb.table("messages")
        .select("lead_id,sender,content")
        .eq("tenant_id", tid)
        .limit(20000)
        .execute()
        .data or []
    )
    fala: dict[str, list[str]] = {}
    qualquer: dict[str, list[str]] = {}
    for m in msgs:
        lid = m.get("lead_id") or ""
        c = m.get("content") or ""
        qualquer.setdefault(lid, []).append(c)
        if m.get("sender") == "patient":
            fala.setdefault(lid, []).append(c)
    print(f"[mensagens] {len(msgs)} no tenant | {len(fala)} leads com fala do paciente")

    # ---- agenda (para provar que nao existe consulta registrada) ---------
    try:
        ag = (
            sb.table("appointments")
            .select("id,lead_id,start_time,status")
            .eq("tenant_id", tid)
            .limit(2000)
            .execute()
            .data or []
        )
    except Exception as exc:
        ag = []
        print("[aviso] appointments:", exc)
    leads_com_agenda = {a.get("lead_id") for a in ag if a.get("lead_id")}
    print(f"[agenda] {len(ag)} consultas registradas no tenant")

    # ---- plano de alteracoes --------------------------------------------
    plano: list[dict] = []
    protegidos: list[dict] = []
    n_sint_remov = 0
    n_leads_sint = 0
    n_nomes = 0
    n_etapas = 0
    nomes_inalterados_sem_ancora = 0

    for l in leads:
        lid = l["id"]
        mudancas: dict = {}

        # (b) sintomas sem ancora na fala do paciente
        syms = l.get("symptoms")
        if isinstance(syms, str):
            try:
                syms = json.loads(syms)
            except Exception:
                syms = []
        if isinstance(syms, list) and syms:
            falas = fala.get(lid, [])
            texto = " ".join(falas).lower()
            if texto:
                tn = _sem_acento(texto)
                mantidos = [s for s in syms if _sintoma_ancorado(str(s), tn)]
                removidos = [str(s) for s in syms if not _sintoma_ancorado(str(s), tn)]
                # PROTEÇÃO: conversa muito curta + TODOS os sintomas cairiam ->
                # não apaga o prontuário inteiro com base em 3 mensagens.
                if removidos and len(removidos) == len(syms) and len(falas) < MIN_MSG_PARA_LIMPEZA:
                    protegidos.append({"nome": l.get("name"), "telefone": l.get("phone"),
                                        "sintomas": syms, "msgs_paciente": len(falas)})
                elif removidos:
                    mudancas["symptoms"] = {
                        "antes": syms,
                        "depois": mantidos,
                        "removidos": removidos,
                    }
                    n_sint_remov += len(removidos)
                    n_leads_sint += 1

        # (c) nome poluido (so para leads que conversaram no WhatsApp)
        if qualquer.get(lid):
            poluido, motivo = _classificar_nome(l.get("name") or "")
            if poluido:
                mudancas["name"] = {
                    "antes": l.get("name"),
                    "depois": NOME_PADRAO,
                    "motivo": motivo,
                }
                n_nomes += 1
            else:
                tn = _sem_acento(" ".join(fala.get(lid, [])).lower())
                if not _nome_ancorado(l.get("name") or "", tn):
                    nomes_inalterados_sem_ancora += 1

        # (d) etapa de consulta realizada sem registro na agenda
        if str(l.get("stage") or "") in ETAPAS_CONVERTIDAS and lid not in leads_com_agenda:
            mudancas["stage"] = {
                "antes": l.get("stage"),
                "depois": "em_atendimento",
                "motivo": "etapa afirmava consulta realizada sem registro na agenda",
            }
            n_etapas += 1

        if mudancas:
            plano.append({
                "id": lid,
                "nome": l.get("name"),
                "telefone": l.get("phone"),
                "telefone_formatado": _tel_formatado(l.get("phone") or ""),
                "stage": l.get("stage"),
                "created_at": l.get("created_at"),
                "updated_at": l.get("updated_at"),
                "mudancas": mudancas,
            })

    print("-" * 74)
    print(f"[plano] leads alterados: {len(plano)}")
    print(f"  (b) sintomas removidos: {n_sint_remov} em {n_leads_sint} leads")
    print(f"  (c) nomes normalizados: {n_nomes}")
    print(f"  (d) etapas rebaixadas: {n_etapas}")
    print(f"  (c2) nome pessoal SEM ancora na conversa (mantido no banco, "
          f"exibido como 'a confirmar'): {nomes_inalterados_sem_ancora}")
    if protegidos:
        print(f"  (b2) PROTEGIDOS (conversa curta, prontuario nao apagado): {len(protegidos)}")
        for pr in protegidos:
            print(f"      - {pr['nome']} | {pr['telefone']} | {pr['msgs_paciente']} msg(s) | "
                  f"sintomas preservados: {pr['sintomas']}")

    for item in plano[:12]:
        print("  *", item["nome"], "|", item["telefone_formatado"])
        for k, v in item["mudancas"].items():
            if k == "symptoms":
                print(f"      sintomas: -{len(v['removidos'])} -> {v['removidos'][:4]}")
            else:
                print(f"      {k}: {v['antes']!r} -> {v['depois']!r} ({v['motivo']})")

    if not aplicar:
        print("-" * 74)
        print("DRY-RUN: nada foi gravado. Rode com --apply para executar.")
        return 0

    # ---- (a) backup .jsonl antes de gravar ------------------------------
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(BACKUP_DIR, f"sanitizacao_1111_{stamp}.jsonl")
    with open(backup_path, "w", encoding="utf-8") as fh:
        for item in plano:
            fh.write(json.dumps({
                "backup_em": _now_iso(),
                "tenant_id": tid,
                **item,
            }, ensure_ascii=False) + "\n")
    os.chmod(backup_path, 0o600)
    print(f"[backup] {backup_path} ({len(plano)} linhas, chmod 600)")

    # ---- aplicacao -------------------------------------------------------
    ok = 0
    falhas: list[str] = []
    for item in plano:
        payload: dict = {}
        mc = item["mudancas"]
        if "symptoms" in mc:
            payload["symptoms"] = mc["symptoms"]["depois"]
        if "name" in mc:
            payload["name"] = mc["name"]["depois"]
        if "stage" in mc:
            payload["stage"] = mc["stage"]["depois"]
        payload["updated_at"] = _now_iso()
        try:
            sb.table("leads").update(payload).eq("id", item["id"]).eq("tenant_id", tid).execute()
            ok += 1
        except Exception as exc:
            falhas.append(f"{item['id']} ({item['nome']}): {exc}")
    print(f"[apply] {ok}/{len(plano)} leads atualizados")
    for f in falhas[:10]:
        print("   FALHA:", f)

    # ---- conferencia pos (releitura DO BANCO) ----------------------------
    print("-" * 74)
    print("[conferencia] releitura apos a limpeza (banco de novo):")
    leads_after = (
        sb.table("leads")
        .select("id,name,stage,symptoms")
        .eq("tenant_id", tid)
        .limit(5000)
        .execute()
        .data or []
    )
    restantes = 0
    leads_restantes = 0
    nomes_padrao = 0
    etapas_rebaixadas = 0
    for l in leads_after:
        if str(l.get("name") or "") == NOME_PADRAO:
            nomes_padrao += 1
        if str(l.get("stage") or "") == "em_atendimento" and str(l.get("stage") or "") in ETAPAS_CONVERTIDAS:
            etapas_rebaixadas += 1
        syms = l.get("symptoms")
        if isinstance(syms, str):
            try:
                syms = json.loads(syms)
            except Exception:
                syms = []
        if isinstance(syms, list) and syms:
            texto = " ".join(fala.get(l["id"], [])).lower()
            if texto:
                tn = _sem_acento(texto)
                sobra = [s for s in syms if not _sintoma_ancorado(str(s), tn)]
                if sobra:
                    leads_restantes += 1
                    restantes += len(sobra)
    etapas_rebaixadas = sum(
        1 for it in plano if "stage" in it["mudancas"]
    )
    print(f"   sintomas sem ancora restantes: {restantes} em {leads_restantes} lead(s) "
          f"(o esperado sao so os PROTEGIDOS por conversa curta)")
    print(f"   nomes '{NOME_PADRAO}': {nomes_padrao} | etapas rebaixadas no plano: {etapas_rebaixadas}")
    print(f"   backup: {backup_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
