# PIPELINE CRM AUTOMAÇÃO JS STANDARD — ARQUITETURA & ONBOARDING (MOTOR 3)

**Data de Homologação:** 02/10/2026  
**Marca Oficial:** CRM Automação JS  
**Plataforma Central:** `automacaojs.us`  
**Porta PM2 (Webhook / API):** 3010 (`crm-webhook`)  
**Porta PM2 (Frontend Web):** 3007 (`crm-hermes`)  
**Repositório Base:** `/root/apps/crm-hermes`

---

## 1. Arquitetura de Serviços & Conexões

- **Backend / Webhook Engine:** FastAPI rodando em `0.0.0.0:3010`.
- **Frontend Dashboard:** React/Vite servido via Node/serve na porta `3007` (`https://crm.automacaojs.us`).
- **Webhook Ingress:** `https://crm-webhook.automacaojs.us/webhook/evolution` ou `https://automacaojs.us/crm-webhook`.
- **Banco de Dados:** Supabase Self-Hosted (`https://supabase.automacaojs.us`).
- **WhatsApp Bridge:** Evolution API v2 (`https://evo.automacaojs.us`).
- **LLM Gateway:** 9Router Local na porta `20128` (`http://127.0.0.1:20128/v1`) com 54 modelos ativos e roteador inteligente `Hermes-fallbacks`.
- **STT (Áudio):** faster-whisper local (100% offline, áudios convertidos para WAV mono 16kHz e arquivos temporários apagados imediatamente).
- **Visão Computacional:** Gemini multimodal via 9Router (porta 20128).

---

## 2. Estrutura do Schema no Supabase

### 2.1 Tabela `public.tenants`
- `id` (UUID): Chave primária do tenant
- `name` (text): Nome da Empresa / Consultório / Estabelecimento
- `specialty` (text): Segmento ou Ramo de Atuação
- `doctor_name` (text): Responsável Técnico / Profissional
- `city` (text): Cidade / Região
- `crm_cro` (text): Registro de classe (opcional)
- `evolution_instance` (text): Nome da instância WhatsApp na Evolution API (ex: `automacaojs_{slug}`)
- `ai_mode` (text): Modo do motor de IA (`hermes_vps`, `byok`)
- `system_prompt` (text): Prompt mestre compilado e parametrizado
- `persona_name` (text): Nome da persona / recepcionista virtual
- `tone_of_voice` (text): Diretrizes de tom de voz da IA
- `ai_auto_reply_enabled` (boolean): Flag mestre para ligar/desligar respostas automáticas da IA
- `created_at` (timestamptz): Data de provisionamento

### 2.2 Relacionamento Foreign Keys
- `public.leads.tenant_id` → `public.tenants.id` (ON DELETE CASCADE)
- `public.messages.tenant_id` → `public.tenants.id` (ON DELETE CASCADE)
- `public.messages.lead_id` → `public.leads.id` (ON DELETE CASCADE)

---

## 3. Provisionamento Autônomo de Tenants (`provision_tenant.py`)

O módulo `/root/apps/crm-hermes/provision_tenant.py` gerencia o ciclo self-service completo:
1. Geração de `tenant_id` (UUID v4) e `instance_name` padronizado sob o prefixo `automacaojs_{slug}`.
2. Criação automática da instância via Evolution API (`POST /instance/create`).
3. Registro do Webhook na Evolution com eventos `MESSAGES_UPSERT`, `CONNECTION_UPDATE` e `MESSAGES_UPDATE`.
4. Compilação do prompt mestre preenchendo as variáveis:
   - `{{COMPANY_NAME}}`, `{{PROFESSIONAL_NAME}}`, `{{SEGMENT}}`, `{{PRICING_RULES}}`, `{{ATTENDANT_NAME}}`, `{{INSTRUCTIONS}}`.
5. Persistência na tabela `public.tenants` no Supabase com 30 dias de trial calculados.
6. Consulta da Evolution API (`GET /instance/connect/{instance}`) para entrega do QR Code base64.

### 3.1 Execução via Linha de Comando (CLI)
```bash
python3 /root/apps/crm-hermes/provision_tenant.py \
  --company-name "Clínica Vida & Saúde" \
  --professional-name "Dra. Juliana Mendes" \
  --segment "Dermatologia & Estética" \
  --pricing-rules "Consulta: R$ 280. Pix ou Cartão 3x." \
  --attendant-name "Carla" \
  --instructions "Av. Paulista 1000, seg a sex das 8h às 18h." \
  --admin-phone "84996327329"
```

### 3.2 Execução via API REST
- **Endpoint:** `POST http://127.0.0.1:3010/api/tenants/provision`
- **Body JSON:**
```json
{
  "company_name": "Clínica Vida & Saúde",
  "professional_name": "Dra. Juliana Mendes",
  "segment_or_specialty": "Dermatologia & Estética",
  "pricing_rules": "Consulta: R$ 280. Pix ou Cartão 3x.",
  "attendant_name": "Carla",
  "instructions": "Av. Paulista 1000, seg a sex das 8h às 18h.",
  "admin_phone": "84996327329",
  "dry_run": false
}
```

---

## 4. Blindagens de Segurança & Multi-Tenant Aplicadas

1. **Resolução Dinâmica com Cache TTL (60 segundos):**
   - O mapeamento `evolution_instance` → `tenant_id` utiliza cache com TTL de 60s, permitindo que novos clientes entrem no ar instantaneamente sem reiniciar serviços.
2. **Rejeição Segura de Instâncias Desconhecidas:**
   - Removido o fallback estático legado (`cardio_matheus_prod_01`). Mensagens sem identificação de instância válida são imediatamente descartadas com aviso em log.
3. **Resiliência Evolution API v2:**
   - Respostas de conexão, status e download de mídia tratam códigos HTTP `200` e `201` como sucesso.
4. **Isolamento de Contexto:**
   - Transcrição de áudio via Whisper local com limpeza imediata de arquivos temporários.
   - Chamadas de visão e inferência isoladas por tenant via 9Router local.
