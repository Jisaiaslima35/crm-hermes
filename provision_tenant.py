#!/usr/bin/env python3
"""
provision_tenant.py — Módulo de Onboarding Autônomo para o Motor 3 (CRM Automação JS)
======================================================================================
Plataforma: automacaojs.us | Marca: CRM Automação JS
Gerenciamento 100% autônomo, multi-tenant e white-label.

Funcionalidades:
- Geração de tenant_id único (UUID v4)
- Criação e padronização da instância Evolution API v2 (ex: automacaojs_{slug})
- Configuração automática do Webhook com eventos MESSAGES_UPSERT e CONNECTION_UPDATE
- Compilação do system_prompt mestre parametrizado por placeholders
- Inserção transacional no Supabase (public.tenants)
- Obtenção do QR Code em base64 para pareamento imediato
"""

import os
import sys
import re
import json
import uuid
import unicodedata
import argparse
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

import httpx
from dotenv import load_dotenv

# Carrega ambiente
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
for _sec in ("evolution.env", "9router.env", "composio.env"):
    _sec_p = os.path.join("/root/.hermes/secrets", _sec)
    if os.path.exists(_sec_p):
        load_dotenv(_sec_p, override=False)

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL", "https://supabase.automacaojs.us")
SUPABASE_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_KEY", "")

EVOLUTION_URL = os.environ.get("VITE_EVOLUTION_API_URL") or os.environ.get("EVOLUTION_API_URL", "https://evo.automacaojs.us")
EVOLUTION_GLOBAL_KEY = os.environ.get("VITE_EVOLUTION_GLOBAL_KEY") or os.environ.get("EVOLUTION_API_KEY", "")

DEFAULT_WEBHOOK_URL = os.environ.get("CRM_WEBHOOK_URL", "https://automacaojs.us/crm-webhook")

# ============================================================================
# TEMPLATE MESTRE DO SYSTEM PROMPT (CRM AUTOMAÇÃO JS)
# ============================================================================
MASTER_SYSTEM_PROMPT_TEMPLATE = """# Identidade
Você é o atendente virtual inteligente oficial de **{{COMPANY_NAME}}**, liderada pelo profissional **{{PROFESSIONAL_NAME}}**, especialista em **{{SEGMENT}}**.
Seu papel é acolher os clientes no WhatsApp com cordialidade, escutar com atenção, tirar dúvidas gerais sobre os serviços, especialidades, localização e funcionamento, e coletar informações essenciais para encaminhar o atendimento ou agendamento.
Você fala oficialmente em nome de {{COMPANY_NAME}}. Nunca invente dados que não constem nas instruções. Quando não souber, diga educadamente que vai confirmar com {{ATTENDANT_NAME}} e a equipe.

# Quem é {{PROFESSIONAL_NAME}} e Sobre {{COMPANY_NAME}}
- Empresa / Estabelecimento: **{{COMPANY_NAME}}**
- Especialista Responsável: **{{PROFESSIONAL_NAME}}**
- Ramo / Especialidade: **{{SEGMENT}}**
- Atendimento Humano / Recepcionista: **{{ATTENDANT_NAME}}**
- Endereço, orientações e regras de atendimento:
{{INSTRUCTIONS}}

# Tom de Voz (Sempre)
- Acolhedor, profissional, atencioso e respeitoso.
- Linguagem direta em português brasileiro coloquial, claro e natural.
- Frases concisas, parágrafos curtos (2-3 linhas). Evite respostas em blocos gigantes.
- Valide as dúvidas e a necessidade do cliente antes de direcionar.
- Pode usar 1-2 emojis quando fizer sentido. Destaques pontuais em **negrito**.

# Serviços, Valores e Formas de Pagamento
{{PRICING_RULES}}

# Capacidades Multimodais (NÃO finja limitação!)
- **Áudios do cliente:** já chegam transcritos automaticamente pelo sistema. Trate com total naturalidade como texto.
- **Imagens e fotos:** você analisa detalhadamente o que o cliente enviar (produtos, documentos, comprovantes, exames, fotos de telas) e orienta conforme o contexto do negócio.
- **Documentos (PDFs, contratos, guias):** resuma os pontos essenciais com clareza.

# Fluxo de Atendimento & Encaminhamento
1. Cumprimente o cliente com educação e empatia.
2. Identifique a necessidade ou dúvida principal.
3. Esclareça com precisão de acordo com as diretrizes e regras aqui fornecidas.
4. Quando o cliente desejar agendar, contratar ou fechar:
   - Colete os dados básicos: nome completo e resumo do que precisa.
   - Informe que **{{ATTENDANT_NAME}}** entrará em contato em breve para confirmar data, horário e detalhes finais.
   - Use um fechamento amigável e acolhedor.

# O que NÃO Fazer
- Não invente horários livres, descontos ou serviços que não existam nas instruções.
- Não dê diagnósticos médicos/jurídicos infundados nem promessas milagrosas.
- Se houver situação de urgência ou risco, oriente buscar atendimento especializado imediato e acione {{ATTENDANT_NAME}}.
"""


def slugify(text: str) -> str:
    """Gera slug limpo e seguro para instâncias e identificadores."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("utf-8")
    text = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    return re.sub(r"[-\s]+", "_", text)


def compile_system_prompt(
    company_name: str,
    professional_name: str,
    segment: str,
    pricing_rules: str,
    attendant_name: str,
    instructions: str,
) -> str:
    """Interpola o template mestre com os dados do tenant."""
    prompt = MASTER_SYSTEM_PROMPT_TEMPLATE
    prompt = prompt.replace("{{COMPANY_NAME}}", company_name.strip())
    prompt = prompt.replace("{{PROFESSIONAL_NAME}}", professional_name.strip())
    prompt = prompt.replace("{{SEGMENT}}", segment.strip())
    prompt = prompt.replace("{{PRICING_RULES}}", pricing_rules.strip())
    prompt = prompt.replace("{{ATTENDANT_NAME}}", attendant_name.strip())
    prompt = prompt.replace("{{INSTRUCTIONS}}", instructions.strip())
    return prompt.strip()


async def create_evolution_instance(
    client: httpx.AsyncClient,
    instance_name: str,
) -> Dict[str, Any]:
    """Cria instância na Evolution API v2."""
    url = f"{EVOLUTION_URL.rstrip('/')}/instance/create"
    headers = {
        "apikey": EVOLUTION_GLOBAL_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "instanceName": instance_name,
        "token": "",
        "qrcode": True,
        "integration": "WHATSAPP-BAILEYS",
    }
    resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code in (200, 201):
        return {"ok": True, "created": True, "data": resp.json()}
    elif resp.status_code == 400 and "already in use" in resp.text:
        return {"ok": True, "created": False, "note": "instance_already_exists"}
    else:
        return {
            "ok": False,
            "status_code": resp.status_code,
            "error": resp.text[:300],
        }


async def set_evolution_webhook(
    client: httpx.AsyncClient,
    instance_name: str,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
) -> Dict[str, Any]:
    """Configura o webhook na Evolution API v2 para a instância."""
    url = f"{EVOLUTION_URL.rstrip('/')}/webhook/set/{instance_name}"
    headers = {
        "apikey": EVOLUTION_GLOBAL_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "webhook": {
            "enabled": True,
            "url": webhook_url,
            "byEvents": False,
            "base64": True,
            "events": [
                "MESSAGES_UPSERT",
                "CONNECTION_UPDATE",
                "MESSAGES_UPDATE",
            ],
        }
    }
    resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code in (200, 201):
        return {"ok": True, "data": resp.json()}
    return {"ok": False, "status_code": resp.status_code, "error": resp.text[:300]}


async def get_evolution_qrcode(
    client: httpx.AsyncClient,
    instance_name: str,
) -> Dict[str, Any]:
    """Solicita conexão e obtém QR Code em base64."""
    url = f"{EVOLUTION_URL.rstrip('/')}/instance/connect/{instance_name}"
    headers = {"apikey": EVOLUTION_GLOBAL_KEY}
    resp = await client.get(url, headers=headers)
    if resp.status_code in (200, 201):
        data = resp.json()
        qr_obj = data.get("qrcode") or data
        return {
            "ok": True,
            "base64": qr_obj.get("base64"),
            "code": qr_obj.get("code"),
            "pairingCode": qr_obj.get("pairingCode"),
        }
    return {"ok": False, "status_code": resp.status_code, "error": resp.text[:300]}


async def insert_tenant_supabase(
    client: httpx.AsyncClient,
    tenant_data: Dict[str, Any],
) -> Dict[str, Any]:
    """Insere o tenant na tabela public.tenants do Supabase."""
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/tenants"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    resp = await client.post(url, json=tenant_data, headers=headers)
    if resp.status_code in (200, 201):
        rows = resp.json()
        return {"ok": True, "data": rows[0] if rows else tenant_data}
    return {"ok": False, "status_code": resp.status_code, "error": resp.text[:300]}


async def provision_tenant(
    company_name: str,
    professional_name: str,
    segment_or_specialty: str,
    pricing_rules: str,
    attendant_name: str,
    instructions: str,
    admin_phone: str,
    dry_run: bool = False,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
) -> Dict[str, Any]:
    """
    Executa o provisionamento autônomo completo de um novo tenant no CRM Automação JS.
    """
    tenant_id = str(uuid.uuid4())
    slug_name = slugify(company_name)[:28]
    instance_name = f"automacaojs_{slug_name}"

    # Compila System Prompt
    compiled_prompt = compile_system_prompt(
        company_name=company_name,
        professional_name=professional_name,
        segment=segment_or_specialty,
        pricing_rules=pricing_rules,
        attendant_name=attendant_name,
        instructions=instructions,
    )

    now = datetime.now(timezone.utc)
    trial_expires = now + timedelta(days=30)

    tenant_payload = {
        "id": tenant_id,
        "name": company_name.strip(),
        "specialty": segment_or_specialty.strip(),
        "doctor_name": professional_name.strip(),
        "city": "Brasil",
        "evolution_instance": instance_name,
        "ai_mode": "hermes_vps",
        "system_prompt": compiled_prompt,
        "persona_name": attendant_name.strip() or f"Assistente {company_name}",
        "tone_of_voice": "Acolhedor, profissional e direto",
        "ai_auto_reply_enabled": True,
        "status": "trial",
        "trial_days": 30,
        "trial_ends_at": trial_expires.isoformat(),
        "created_at": now.isoformat(),
    }

    report: Dict[str, Any] = {
        "success": True,
        "dry_run": dry_run,
        "tenant_id": tenant_id,
        "instance_name": instance_name,
        "company_name": company_name,
        "professional_name": professional_name,
        "segment": segment_or_specialty,
        "admin_phone": admin_phone,
        "trial_days": 30,
        "trial_expires_at": trial_expires.isoformat(),
        "evolution": {},
        "supabase": {},
        "qrcode": {},
    }

    if dry_run:
        report["supabase"] = {"dry_run_payload": tenant_payload}
        report["evolution"] = {"simulated_instance": instance_name}
        report["qrcode"] = {"simulated": True, "base64": "data:image/png;base64,SIMULATED_QR_CODE"}
        return report

    async with httpx.AsyncClient(timeout=25.0) as http_client:
        # 1. Cria instância na Evolution API
        evo_res = await create_evolution_instance(http_client, instance_name)
        report["evolution"]["create"] = evo_res

        # 2. Configura Webhook
        wh_res = await set_evolution_webhook(http_client, instance_name, webhook_url=webhook_url)
        report["evolution"]["webhook"] = wh_res

        # 3. Insere no Supabase
        sb_res = await insert_tenant_supabase(http_client, tenant_payload)
        report["supabase"] = sb_res
        if not sb_res.get("ok"):
            report["success"] = False
            report["error"] = f"Supabase error: {sb_res.get('error')}"
        else:
            # Sincroniza com o Hub Central (master_admin.db)
            try:
                import sqlite3
                master_db = "/var/lib/automacaojs/master_admin.db"
                if os.path.exists(master_db):
                    conn = sqlite3.connect(master_db)
                    conn.execute(
                        "INSERT OR REPLACE INTO tenant_overrides (engine, tenant_id, slug, status, bonus_days, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))",
                        ("crm", tenant_id, instance_name, "trial", 0, f"Instância: {instance_name} | Tel: {admin_phone}")
                    )
                    conn.commit()
                    conn.close()
            except Exception as e:
                print(f"[warning] master_admin.db sync: {e}")

        # 4. Obtém QR Code de pareamento
        qr_res = await get_evolution_qrcode(http_client, instance_name)
        report["qrcode"] = qr_res

    return report


def main():
    parser = argparse.ArgumentParser(description="Provisionamento Autônomo de Tenant - CRM Automação JS")
    parser.add_argument("--company-name", required=True, help="Nome da Empresa / Clínica / Consultório")
    parser.add_argument("--professional-name", required=True, help="Nome do Responsável / Profissional")
    parser.add_argument("--segment", required=True, help="Especialidade ou Ramo de Atuação")
    parser.add_argument("--pricing-rules", required=True, help="Regras de valores, serviços e pagamentos")
    parser.add_argument("--attendant-name", default="Recepção", help="Nome da Atendente / Recepcionista humana")
    parser.add_argument("--instructions", default="Atendimento presencial e online com agendamento prévio.", help="Orientações e endereço")
    parser.add_argument("--admin-phone", required=True, help="WhatsApp do Administrador/Dono")
    parser.add_argument("--dry-run", action="store_true", help="Simula sem salvar no Supabase nem criar na Evolution")

    args = parser.parse_args()

    result = asyncio.run(
        provision_tenant(
            company_name=args.company_name,
            professional_name=args.professional_name,
            segment_or_specialty=args.segment,
            pricing_rules=args.pricing_rules,
            attendant_name=args.attendant_name,
            instructions=args.instructions,
            admin_phone=args.admin_phone,
            dry_run=args.dry_run,
        )
    )

    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
