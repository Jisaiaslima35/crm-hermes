# WhatsApp Media Pipeline — Arquitetura CRM-Hermes

> Estabilização feita em **01/10/2026** após Isaías reportar 3 falhas críticas no
> print do teste real (instância `mercado-automacao-js`, tenant 3333):
> system_prompt contaminado com clínica, áudio sem transcrição Whisper, e imagem
> sem leitura visual.

---

## 1. Visão geral do pipeline

```
WhatsApp Evolution API v2.3.7
        │
        ▼
webhook_server.py (FastAPI :3010, PM2 = crm-webhook)
        │
        ├─► Texto curto      → JEV (Typesafe AI) → acolhimento_abertura → 9Router
        ├─► Áudio (ogg/opus) → Whisper Local 100% (faster-whisper base int8)
        └─► Imagem (jpg/png) → Gemini via 9Router → fallback MiniMax API oficial
                                            │
                                            ▼
                              Resposta IA via 9Router (chat completion)
                                            │
                                            ▼
                          Evolution /message/sendText → WhatsApp
```

Tudo é **multi-tenant** (Supabase PostgREST `tenants` resolve `evolution_instance` → `tenant_id` → `system_prompt` próprio).

---

## 2. Fix #1 — Status HTTP 201 Created da Evolution v2.3.7

### Sintoma

Os logs do pm2 mostravam:
```
[Evolution] getBase64FromMediaMessage status=201 body=...
```
e logo em seguida o pipeline caía pro placeholder `[Áudio enviado pelo paciente]`.
**Whisper nunca era chamado. Vision nunca era chamado.** IA respondia só com o
texto cru do placeholder.

### Causa raiz

Evolution API v2.3.7 retorna **`HTTP/1.1 201 Created`** no endpoint
`POST /chat/getBase64FromMediaMessage/{instance}` — **não** 200 OK como nas
versões anteriores. O código só aceitava `200`, então o base64 era descartado
silenciosamente.

### Fix aplicado (2 arquivos)

**`media_handler.py`** (linha 103) — função `get_media_base64_from_evolution`:
```python
# FIX 01/10: Evolution API v2.3.7 retorna 201 Created nesse endpoint
# (não 200 OK). Aceitar qualquer 2xx pra não quebrar o pipeline de
# mídia. Bug afetou áudio+imagem em prod — Whisper/Vision nunca
# recebiam o base64, IA só via placeholder.
if 200 <= resp.status_code < 300:
    res_data = resp.json()
    b64 = res_data.get("base64")
    ...
```

**`webhook_server.py`** (linha 2924) — função de validação do `fetchInstances`:
mesma troca de `==` por `< 300` para tolerância 2xx.

### Por que aceitar 2xx inteiro?

A semântica REST do endpoint é "recurso criado/atendido" — 201 Created é tão
válido quanto 200 OK nesse caso. Hardcodar 200 é frágil contra version bumps da
Evolution.

---

## 3. Fix #2 — STT 100% local via faster-whisper

### Sintoma

Os dois áudios do teste caíam em placeholder. Mesmo problema de #1 (base64 não
chegava), mas também havia problema arquitetural: o pipeline antigo tentava
9Router/Gemini pra STT e dava **HTTP 429** quando múltiplos tenants batiam em
paralelo.

### Decisão arquitetural

STT roda 100% **local** com `faster-whisper` (`base` int8, PT-BR, VAD filter).
Cache do modelo em `/root/.cache/huggingface/hub/`. Custo de CPU é desprezível
comparado a ter 429 em horário de pico.

### Pipeline

```python
# media_handler.py: process_audio_message(b64_audio)
1. base64.b64decode → raw bytes (oga/opus do WhatsApp)
2. ffmpeg -i raw.oga -ar 16000 -ac 1 -f wav out.wav
3. WhisperModel.transcribe(out.wav, language="pt", beam_size=1, vad_filter=True)
4. return " ".join(seg.text for seg in segments)
```

Tempo típico: ~1.7s pra áudio de 8s. Sem rate limit, sem fallback externo.

### Configuração

```python
_whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
```

Singleton global + asyncio.Lock para evitar carregamento concorrente.

---

## 4. Fix #3 — Visão computacional via 9Router + fallback MiniMax

### Pipeline

```python
# media_handler.py: process_image_message(b64_image, mimetype, system_instruction)
1. Monta payload multimodal OpenAI-compat:
   messages = [
     {"role": "system", "content": system_instruction},
     {"role": "user", "content": [
       {"type": "text", "text": user_prompt},
       {"type": "image_url", "image_url": {"url": "data:{mimetype};base64,{b64}"}}
     ]}
   ]
2. Try 1: Gemini via 9Router (modelo gemini-2.5-flash) → 200 OK em ~4s
3. Try 2 (fallback): MiniMax API oficial (https://api.minimax.io/anthropic/v1/messages)
   com Anthropic Messages API (system_instruction → text block,
   image_url → source.base64.media_type).
```

### Por que MiniMax como fallback

- O modelo `nvidia/minimaxai/minimax-m3` roteado via 9Router está **EOL desde
  09/09/2026** (HTTP 410 Gone confirmado via curl).
- O plano token-plan MiniMax tem API oficial funcional — então contingência bate
  direto na API MiniMax com `x-api-key` header + `anthropic-version: 2023-06-01`.
- Validação isolada confirmou: tokens 531/338, resposta útil em ~2s.

### Variáveis de ambiente

```bash
NINEROUTER_BASE_URL=http://127.0.0.1:20128/v1
NINEROUTER_API_KEY=sk-...
NINEROUTER_VISION_MODEL=gemini/gemini-2.5-flash
MINIMAX_API_KEY=...
MINIMAX_API_URL=https://api.minimax.io/anthropic
MINIMAX_VISION_MODEL=MiniMax-M3
```

---

## 5. Fix #4 — Isolamento de system_prompt por tenant

### Sintoma (bug crítico cross-tenant)

Tenant **33333333-...** ("Automação JS — Demonstração", instância
`mercado-automacao-js`) respondia com linguagem clínica ("dor no peito
irradiando, desmaio, sangramento intenso"). Isaías achou que o tenant estava
contaminado.

### Causa raiz

```python
# webhook_server.py: _build_system_prompt() — fallback (linha 645)
custom = (tenant_cfg.get("system_prompt") or "").strip()
if custom:
    return f"{custom}{dynamic_ctx}"

# Template padrão (multi-clínica) — TEM regras de emergência médica.
return (
    f"Você é a assistente clínica oficial de WhatsApp da {name} "
    ...
    f"2. Se houver sinais de emergência (dor no peito irradiando, desmaio, "
    f"sangramento intenso), alerte imediatamente para procurar pronto-socorro..."
)
```

O tenant 3333 tinha `system_prompt=""` no PostgREST → caía no template padrão
que foi feito para clínica cardiológica. O nome `name="Clínica"` +
`specialty="Saúde"` (defaults) só reforçava a persona errada.

### Fix aplicado

```sql
-- PATCH /rest/v1/tenants?id=eq.33333333-3333-3333-3333-333333333333
UPDATE tenants
SET persona_name = 'Assistente Isaías Teste',
    system_prompt = '# Identidade\nVocê é a assistente virtual da AUTOMACAOJS (Tecnologia) — uma DEMO comercial do CRM-Hermes. NÃO É CLÍNICA MÉDICA. NÃO mencione dor no peito, desmaio, sangramento, emergências médicas, cardiologia, psiquiatria nem nada clínico. Sua especialidade é TECH/SaaS.\n\n# Tom\nAmigável, curta, direta, em PT-BR coloquial.\n\n# Comportamento\n1. Cumprimente e pergunte como pode ajudar.\n2. Se o paciente mandar áudio, já vem transcrito (Whisper). Se mandar imagem, vem o conteúdo lido pela visão.\n3. Se for pergunta comercial (preço, planos, demo ao vivo), explique que esse é um tenant de demonstração e ofereça falar com Isaías pelo WhatsApp (84) 99632-7329.\n4. Nunca invente preços, horários ou dados médicos.\n5. Termine perguntando se pode ajudar em algo mais.'
WHERE id = '33333333-3333-3333-3333-333333333333';
```

### Garantia arquitetural pra evitar recorrência

**Regra operacional**: todo tenant novo DEVE ter `system_prompt` próprio não-vazio.
Caso o template padrão seja acionado, ele é específico por segmento
(multi-clínica) — não serve para tenant de tecnologia/varejo.

**Sugestão de hardening futuro** (não aplicado):
- Adicionar fallback `if not custom: raise RuntimeError("tenant sem system_prompt")`
  em `_build_system_prompt` para falhar rápido em produção.
- Migration que force `system_prompt NOT NULL` com default razoável por segmento.

---

## 6. Status pós-fix (validado em teste real 01/10)

| Canal | Pipeline | Status |
|---|---|---|
| Texto | direto via 9Router | ✅ |
| Áudio | Whisper local → 9Router | ✅ transcrito "como é o nome dessa clean..." |
| Imagem | Gemini 9Router → MiniMax fallback | ✅ "identifica uma garrafa de Coca-Cola..." |
| System prompt | PostgREST `tenants.system_prompt` | ✅ corrigido tenant 3333 |
| Cache | `_TENANT_CFG_CACHE` 60s TTL + `pm2 reload` | ✅ aplicado |

---

## 7. Pendências

- **JEV_API_KEY ausente**: classificação de intenção cai em fallback silencioso
  `acolhimento_abertura`. Sem impacto funcional mas perde detalhamento.
- **Fan-out Mendes HTTP 404**: webhook tenta repassar para `wacrm.automacaojs.us`
  que não conhece a instância `mercado-automacao-js`. Cosmético, polui logs.
- **Hardening do template padrão**: se um tenant esquecer de cadastrar
  `system_prompt`, ele cai no template clínico por default. Considerar fail-fast
  ou template específico por `specialty`.

---

## 8. Arquivos tocados

- `media_handler.py` — Whisper local + Vision Gemini 9Router + fallback MiniMax
- `webhook_server.py` — `_get_media_config()` aceita 2xx (linha 2924)
- `webhook_server.py` — `_build_system_prompt()` template clínico (linha 645)
- PostgREST `tenants[33333333-...]` — `system_prompt` corrigido para persona TECH
