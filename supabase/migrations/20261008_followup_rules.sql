-- ============================================================================
-- 2026-10-08 — Followup Rules JSONB (Fase 2)
-- ============================================================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS followup_rules JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tenants.followup_rules IS
  'Configuração de follow-up / resgate automático: enabled (bool), silence_hours (int: 2, 6, 12, 24, 48). Vazio = default 24h ativo.';
