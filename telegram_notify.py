#!/usr/bin/env python3
"""Ponte CRM Hermes -> Telegram usando o bot EXISTENTE 'Clinica Dory (Matheus)'.

Rota real (auditada 2026-10-31):
  CRM (webhook_server._record_atrito / cron do sistema)
  -> este modulo
  -> Telegram Bot API (api.telegram.org) com o token do perfil dr-matheus-dore
  -> DM do Isaias (TELEGRAM_HOME_CHANNEL do .env do perfil = chat de teste)

NAO usa o gateway do Hermes Agent: o agente Dory tem ferramentas desativadas e
cron_mode=deny (nao consulta o CRM, nao cria jobs) e nao existe comando CLI de
envio. Os alertas clinicos de 26-27/10 tambem chegaram por Bot API direta (nao
ha registro deles no state.db do gateway) - este modulo segue o mesmo caminho.

Regras:
- Token e chat_id sao lidos em runtime do .env do perfil; NUNCA impressos,
  logados ou commitados. Este arquivo nao contem segredos.
- Escopo literal: so o tenant da Clinica Dr. Matheus Dore (o bot e dela).
  Outros tenants sao ignorados silenciosamente.
- Privacidade: nome do paciente + resumo, NUNCA CPF/telefone/endereco.
- Envio e best-effort: falha de rede nunca derruba o webhook nem o cron.
"""

import json
import logging
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta

logger = logging.getLogger("telegram_notify")

PROFILE_ENV = "/root/.hermes/profiles/dr-matheus-dore/.env"
CRM_ENV = "/root/apps/crm-hermes/.env"
CLINICA_TENANT_ID = "11111111-1111-1111-1111-111111111111"
CRM_URL = "https://crm.automacaojs.us"
MAX_CHARS = 3900


def _parse_env(path):
    out = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                out[key.strip()] = val.strip().strip('"').strip("'")
    except FileNotFoundError:
        logger.warning("env nao encontrado: %s", path)
    return out


def _bot_config():
    env = _parse_env(PROFILE_ENV)
    return env.get("TELEGRAM_BOT_TOKEN", ""), env.get("TELEGRAM_HOME_CHANNEL", "")


def _chunks(text, limit=MAX_CHARS):
    if len(text) <= limit:
        return [text]
    parts, buf = [], ""
    for line in text.split("\n"):
        if len(buf) + len(line) + 1 > limit and buf:
            parts.append(buf)
            buf = ""
        buf = f"{buf}\n{line}" if buf else line
    if buf:
        parts.append(buf)
    return parts


def send_telegram(text, chat_id=None):
    """Envia texto ao DM de teste via Bot API. Retorna lista de message_ids."""
    token, home = _bot_config()
    target = chat_id or home
    if not token or not target:
        logger.warning("telegram: token ou chat de destino ausente, envio abortado")
        return []
    ids = []
    for part in _chunks(text):
        body = json.dumps(
            {"chat_id": target, "text": part, "disable_web_page_preview": True}
        ).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if payload.get("ok"):
                ids.append(payload["result"]["message_id"])
            else:
                logger.warning("telegram: Bot API respondeu ok=false")
        except Exception as exc:
            logger.warning("telegram: falha de envio (%s)", type(exc).__name__)
            return ids
    return ids


def _safe_name(lead):
    name = (lead or {}).get("name") or ""
    # Nome que e so digitos/simbolos provavelmente e telefone: nao vazar.
    if not name or re.fullmatch(r"[\d\s+\-()]+", name):
        return "Paciente (nome nao informado)"
    return name


def format_atrito_alert(lead, classification):
    reason = (classification or {}).get("reason", "atrito")
    snippet = ((classification or {}).get("snippet") or "")[:300]
    lines = [
        "🚨 ALERTA DE ATRITO - Clinica Dr. Matheus Dore",
        f"Paciente: {_safe_name(lead)}",
        f"Motivo: {reason}",
    ]
    if snippet:
        lines.append(f"Trecho: {snippet}")
    lines += [
        "Acao: IA pausada, card em Risco Juridico, aguardando humano.",
        f"CRM: {CRM_URL}",
    ]
    return "\n".join(lines)


def send_atrito_alert(tenant_id, lead, classification):
    """Alerta imediato de atrito critico. So clinica; best-effort; retorna bool."""
    if tenant_id != CLINICA_TENANT_ID:
        return False
    if (classification or {}).get("severity") != "critica":
        return False
    try:
        ids = send_telegram(format_atrito_alert(lead, classification))
        logger.info("telegram: alerta de atrito enviado (%d parte(s))", len(ids))
        return bool(ids)
    except Exception as exc:
        logger.warning("telegram: alerta de atrito falhou (%s)", type(exc).__name__)
        return False


def _supabase_client():
    from supabase import create_client

    env = _parse_env(CRM_ENV)
    url = env.get("VITE_SUPABASE_URL", "")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("credenciais Supabase ausentes no .env do CRM")
    return create_client(url, key)


def _count(sb, table, filters):
    try:
        q = sb.table(table).select("id", count="exact").limit(1)
        for col, val in filters:
            q = q.eq(col, val)
        res = q.execute()
        if res.count is not None:
            return res.count
        return len(res.data or [])
    except Exception:
        return 0


def build_shift_report(sb, tenant_id):
    """Relatorio executivo do turno (clinica). Sem CPF/telefone/endereco."""
    now = datetime.now().astimezone()
    today = now.date()
    tomorrow = today + timedelta(days=1)
    week_ago = now - timedelta(days=7)
    day_start = datetime.combine(today, datetime.min.time()).astimezone()
    tomorrow_end = datetime.combine(tomorrow, datetime.max.time()).astimezone()

    appts = []
    try:
        res = (
            sb.table("appointments")
            .select("id,lead_id,start_time,status")
            .eq("tenant_id", tenant_id)
            .eq("status", "agendado")
            .gte("start_time", week_ago.isoformat())
            .lte("start_time", tomorrow_end.isoformat())
            .execute()
        )
        appts = res.data or []
    except Exception as exc:
        logger.warning("telegram: falha ao ler appointments (%s)", type(exc).__name__)

    names = {}
    lead_ids = sorted({a.get("lead_id") for a in appts if a.get("lead_id")})
    if lead_ids:
        try:
            res = (
                sb.table("leads")
                .select("id,name")
                .in_("id", lead_ids)
                .execute()
            )
            names = {r["id"]: (r.get("name") or "Paciente") for r in (res.data or [])}
        except Exception:
            names = {}

    def _fmt(a):
        st = datetime.fromisoformat(a["start_time"].replace("Z", "+00:00")).astimezone()
        return f"• {st.strftime('%H:%M')} - {names.get(a.get('lead_id'), 'Paciente')}"

    hoje, amanha, faltosos = [], [], []
    for a in appts:
        st = datetime.fromisoformat(a["start_time"].replace("Z", "+00:00")).astimezone()
        if st.date() == today and st >= now - timedelta(minutes=30):
            hoje.append(a)
        elif st.date() == tomorrow:
            amanha.append(a)
        elif st < day_start:
            faltosos.append(a)
    hoje.sort(key=lambda a: a["start_time"])
    amanha.sort(key=lambda a: a["start_time"])
    faltosos.sort(key=lambda a: a["start_time"])

    def _lista(items, limite=10):
        out = [_fmt(a) for a in items[:limite]]
        if len(items) > limite:
            out.append(f"  ... e mais {len(items) - limite}")
        return out or ["  (nenhum)"]

    panorama = [
        ("Em atendimento", ["em_atendimento"]),
        ("Agendados", ["agendados_d1", "consulta_agendada"]),
        ("Falar pessoalmente", ["falar_pessoalmente"]),
        ("Compareceu", ["compareceu_atendido", "consulta_realizada"]),
        ("Risco juridico", ["risco_juridico"]),
    ]
    pano_lines = []
    for label, keys in panorama:
        total = sum(_count(sb, "leads", [("tenant_id", tenant_id), ("stage", k)]) for k in keys)
        pano_lines.append(f"• {label}: {total}")

    header = (
        "📋 Relatorio executivo - Clinica Dr. Matheus Dore\n"
        f"🕐 {now.strftime('%H:%M')} de {now.strftime('%d/%m/%Y')}"
    )
    sections = [
        f"\n📅 Agendados hoje ({len(hoje)}):",
        *_lista(hoje),
        f"\n⏰ Agendados amanha ({len(amanha)}):",
        *_lista(amanha),
        f"\n⚠️ Faltosos (agendamento passado, sem presenca, 7d) ({len(faltosos)}):",
        *_lista(faltosos),
        "\n📊 Panorama do Kanban:",
        *pano_lines,
        f"\nCRM: {CRM_URL}",
    ]
    return "\n".join([header, *sections])


def send_shift_report(sb=None, tenant_id=CLINICA_TENANT_ID):
    if tenant_id != CLINICA_TENANT_ID:
        return False
    client = sb or _supabase_client()
    text = build_shift_report(client, tenant_id)
    ids = send_telegram(text)
    logger.info("telegram: relatorio enviado (%d parte(s))", len(ids))
    return bool(ids)


def main(argv):
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "test":
        ids = send_telegram(
            "✅ TESTE - ponte CRM -> Telegram ativa.\n"
            "Bot 'Clinica Dory (Matheus)', chat de teste do Isaias.\n"
            "Alertas de atrito critico e relatorios 12h/18h chegam por aqui."
        )
        print("test: message_ids =", ids)
        return 0 if ids else 1
    if cmd == "atrito-test":
        ok = send_atrito_alert(
            CLINICA_TENANT_ID,
            {"name": "Paciente Teste"},
            {"severity": "critica", "reason": "ofensa_verbal", "snippet": "[TESTE] mensagem simulada, sem lead real"},
        )
        print("atrito-test: enviado =", ok)
        return 0 if ok else 1
    if cmd == "report":
        dry = "--dry-run" in argv
        text = build_shift_report(_supabase_client(), CLINICA_TENANT_ID)
        if dry:
            print(text)
            return 0
        ids = send_telegram(text)
        print("report: message_ids =", ids)
        return 0 if ids else 1
    print("uso: telegram_notify.py {test|atrito-test|report [--dry-run]}")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
