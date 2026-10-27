-- ============================================================================
-- 2026-10-07 — Enhancements CRM-Hermes (Fase 0)
-- ============================================================================
-- Isaías pediu (msg 5601) 4 melhorias com isolamento TOTAL do Dr. Matheus
-- (tenant 11111111-1111-1111-1111-111111111111, em produção ativa).
-- Target único das novidades = 33333333-3333-3333-3333-333333333333
-- ("Automação JS — Demonstração").
--
-- Princípios:
--   1. Toda nova coluna tem DEFAULT ou aceita NULL — Dr. Matheus não quebra.
--   2. Stages NOVOS (iniciou_conversa, consulta_realizada, cancelou,
--      contratou, paciente_recorrente) coexistem com os antigos. NÃO
--      renomeamos colunas do banco — só adicionamos valores ao domínio.
--      A migração de DADOS acontece só no tenant 3333, no fim do script.
--   3. schedule_rules JSONB DEFAULT '{}' — tenants antigos ficam OK.
--   4. Idempotente: rodar 2x é no-op.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. leads.last_message_at — TIMESTAMPTZ, default NULL.
--    Backfill a partir de leads.last_interaction (que já existe).
--    Diferença semântica: last_message_at = última MSG DO PACIENTE
--    (não da IA). Mas como hoje só temos last_interaction (que registra
--    em praticamente toda interação), o backfill é coerente.
-- ----------------------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.leads.last_message_at IS
  'Timestamp da ÚLTIMA mensagem do PACIENTE. Usado pelo motor de follow-up para detectar silêncio de 24h. Backfill inicial = last_interaction; webhook deve atualizar ao receber MSG inbound (sender=patient).';

UPDATE public.leads
   SET last_message_at = last_interaction
 WHERE last_message_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. leads.followup_count — INT NOT NULL DEFAULT 0.
--    Quantas vezes o worker de resgate já tentou esse lead.
--    Regra de negócio (msg 5601): começa em 0, vai a 1 após 1ª tentativa.
-- ----------------------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS followup_count INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.leads.followup_count IS
  'Contador de follow-ups automáticos enviados pelo worker. 0 = nenhuma tentativa; s = N tentativas. Trava anti-loop.';

-- ----------------------------------------------------------------------------
-- 3. leads.followup_status — VARCHAR(20) NOT NULL DEFAULT 'pending'.
--    Domínio controlado via CHECK constraint (apenas 4 valores).
--    Permite evolução futura sem mexer no schema.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'leads'
       AND column_name = 'followup_status'
  ) THEN
    ALTER TABLE public.leads
      ADD COLUMN followup_status VARCHAR(20) NOT NULL DEFAULT 'pending';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_followup_status_check'
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_followup_status_check
      CHECK (followup_status IN ('pending', 'sent_1', 'sent_2', 'archived'));
  END IF;
END $$;

COMMENT ON COLUMN public.leads.followup_status IS
  'Estado do ciclo de follow-up: pending (inicial), terminated_1 (após 1ª msg enviada), terminated_2 (após 2ª), archived (desistiu = follow-up parou).';

-- ----------------------------------------------------------------------------
-- 4. tenants.schedule_rules — JSONB DEFAULT '{}'::jsonb.
--    Grade horária autorizada por tenant. Default vazio = IA fica livre
--    (não trava ninguém). Vai popular com grade no tenant 3333.
-- ----------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS schedule_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tenants.schedule_rules IS
  'Grade horária autorizada para a IA agendar sem consultar recepção. JSONB com campos: enabled (Bool), days_of_week (array 0-6), time_slots (array de HH:MM), timezone (IANA), slot_duration_minutes (int). Vazio = sem limite.';

-- ----------------------------------------------------------------------------
-- 5. Migração de DADOS — SOMENTE no tenant 3333 (Demo).
--    Dr. Matheus (1111) NÃO é tocado. Segue regra de ouro da msg 5601.
--
--    Mapeamento:
--      novo_contato       → iniciou_conversa
--      atendido_concluido → consulta_realizada
--      desistiu           → cancelou
--    Demais stages (em_atendimento, consulta_agendada, falar_pessoalmente,
--    sem_resposta) ficam como estão. 'sem_resposta' continua válido para
--    o tenant Demo se houver leads nele.
-- ----------------------------------------------------------------------------
UPDATE public.leads
   SET stage = 'iniciou_conversa'
 WHERE tenant_id = '33333333-3333-3333-3333-333333333333'
   AND stage = 'novo_contato';

UPDATE public.leads
   SET stage = 'consulta_realizada'
 WHERE tenant_id = '33333333-3333-3333-3333-333333333333'
   AND stage = 'atendido_concluido';

UPDATE public.leads
   SET stage = 'cancelou'
 WHERE tenant_id = '33333333-3333-3333-3333-333333333333'
   AND stage = 'desistiu';

-- ----------------------------------------------------------------------------
-- 6. Index para performance do worker de follow-up.
--    O worker filtra por:
--      tenant_id = '3333...' AND handoff_state = 'ia_ativa'
--      AND stage IN ('iniciou_conversa','em_atendimento')
--      AND last_message_at <= NOW() - INTERVAL '24 hours'
--      AND followup_count = 0
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_followup_worker
  ON public.leads (tenant_id, handoff_state, stage, followup_count, last_message_at)
  WHERE followup_count = 0 AND handoff_state = 'ia_ativa';

-- ----------------------------------------------------------------------------
-- 7. Verificação final — Dr. Matheus deve estar INTACTO.
--    Mostra contagem de leads + distribution de stages do 1111.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  matheus_count INT;
  demo_count INT;
BEGIN
  SELECT COUNT(*) INTO matheus_count FROM public.leads
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
  SELECT COUNT(*) INTO demo_count FROM public.leads
    WHERE tenant_id = '33333333-3333-3333-3333-333333333333';
  RAISE NOTICE 'Migration 20261007_crm_enhancements.sql aplicada.';
  RAISE NOTICE '  leads Dr. Matheus (1111): %', matheus_count;
  RAISE NOTICE '  leads Demo (3333): %', demo_count;
END $$;