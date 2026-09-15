-- ============================================================================
-- 2026-09-15 — Interruptor Mestre de Plantão IA (Feature Flag)
-- ============================================================================
-- Adiciona coluna `ai_auto_reply_enabled` na tabela `tenants` para que a
-- recepcionista possa desligar globalmente as respostas automáticas de IA
-- (noturno, madrugada, fim de semana, férias). Quando `false`:
--   * a mensagem inbound é persistida normalmente em `messages`
--   * o lead é atualizado normalmente (last_interaction, etc.)
--   * MAS nenhum `_dispatch_ai` é chamado, nenhuma resposta sai pra Evolution
--
-- DEFAULT true preserva o comportamento atual de TODOS os tenants existentes.
-- Idempotente: re-rodável sem erro.
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS ai_auto_reply_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenants.ai_auto_reply_enabled IS
  'Plantão IA: false = mensagens inbound são gravadas mas IA não responde (recepcionista assumiu turno). true = IA responde normalmente.';

-- ============================================================================
-- Seed explícito para tenants existentes — DEFAULT true na ADD COLUMN já
-- cobre os existentes, mas deixamos um UPDATE explícito para registro histórico
-- e para forçar a reescrita caso a coluna já exista sem default (rollback).
-- ============================================================================

UPDATE public.tenants
   SET ai_auto_reply_enabled = true
 WHERE ai_auto_reply_enabled IS NULL;

-- ============================================================================
-- RLS / GRANT — anon key + service_role já tinham acesso via policies existentes
-- da tabela tenants; nada muda. Apenas documentando.
-- ============================================================================
