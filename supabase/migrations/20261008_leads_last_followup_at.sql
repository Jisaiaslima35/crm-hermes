-- ============================================================================
-- 2026-10-08 — Adiciona leads.last_followup_at para controle de cadência de resgate
-- ============================================================================
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.leads.last_followup_at IS
  'Timestamp do último disparo de follow-up enviado ao lead pelo worker.';
