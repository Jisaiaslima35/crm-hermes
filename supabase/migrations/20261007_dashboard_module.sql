-- =============================================================================
-- CRM-Hermes — Módulo Dashboard Geral + Ouvidoria (Fase 5, msg 5615+5616)
-- =============================================================================
-- Isaías (msg 5615+5616, 07/10/2026) autorizou o ÚLTIMO módulo:
--   1. Tabela financial_entries (entradas financeiras: particular, convênio,
--      previdenciário INSS, laudo pericial)
--   2. Tabela customer_complaints (Ouvidoria / Radar de Incidentes)
--   3. Gatilho no webhook para detectar atrito (palavras-chave) e criar
--      complaint automaticamente + kill-switch se severidade = 'critica'
--
-- REGRA DE OURO #1 (msg 5601): TODA query que ler/escrever DEVE filtrar
-- por tenant_id. Não há RLS no projeto — a app é responsável pelo filtro.
-- Dr. Matheus (1111) JAMAIS tocado. Tenant alvo = 3333 (Demo).
-- =============================================================================

-- =============================================================================
-- A. financial_entries
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.financial_entries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  client_name varchar(255) NOT NULL,
  amount numeric(10,2) NOT NULL DEFAULT 0.00,
  category varchar(50) NOT NULL,
  service_type varchar(100),
  payment_method varchar(30),
  status varchar(20) NOT NULL DEFAULT 'pago',
  due_date date,
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT financial_entries_category_check CHECK (
    category IN ('clinica_particular', 'convenio', 'previdenciario_inss', 'laudo_pericial')
  ),
  CONSTRAINT financial_entries_payment_method_check CHECK (
    payment_method IS NULL OR payment_method IN (
      'pix', 'cartao_credito', 'cartao_debito', 'dinheiro', 'convenio', 'transferencia'
    )
  ),
  CONSTRAINT financial_entries_status_check CHECK (
    status IN ('pago', 'pendente', 'atrasado', 'cancelado')
  ),
  CONSTRAINT financial_entries_amount_nonneg CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_financial_tenant_paid
  ON public.financial_entries(tenant_id, paid_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_financial_tenant_status
  ON public.financial_entries(tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_financial_tenant_due
  ON public.financial_entries(tenant_id, due_date)
  WHERE status IN ('pendente', 'atrasado');
CREATE INDEX IF NOT EXISTS idx_financial_lead
  ON public.financial_entries(lead_id)
  WHERE lead_id IS NOT NULL;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.financial_entries_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_financial_entries_updated_at ON public.financial_entries;
CREATE TRIGGER trg_financial_entries_updated_at
  BEFORE UPDATE ON public.financial_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.financial_entries_set_updated_at();

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'financial_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.financial_entries;
  END IF;
END $$;

-- =============================================================================
-- B. customer_complaints (Ouvidoria)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.customer_complaints (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  client_name varchar(255) NOT NULL,
  reason varchar(100) NOT NULL,
  severity varchar(20) NOT NULL DEFAULT 'media',
  snippet text,
  status varchar(20) NOT NULL DEFAULT 'pendente',
  source varchar(20) NOT NULL DEFAULT 'whatsapp',
  resolved_at timestamptz,
  resolved_by varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_complaints_reason_check CHECK (
    reason IN ('demora_atendimento', 'preco_alto', 'ofensa_verbal',
               'insatisfacao_geral', 'cancelamento', 'outro')
  ),
  CONSTRAINT customer_complaints_severity_check CHECK (
    severity IN ('baixa', 'media', 'critica')
  ),
  CONSTRAINT customer_complaints_status_check CHECK (
    status IN ('pendente', 'em_analise', 'resolvido', 'descartado')
  ),
  CONSTRAINT customer_complaints_source_check CHECK (
    source IN ('whatsapp', 'manual', 'radar_silencio')
  )
);

CREATE INDEX IF NOT EXISTS idx_complaints_tenant_status
  ON public.customer_complaints(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_tenant_severity
  ON public.customer_complaints(tenant_id, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_lead
  ON public.customer_complaints(lead_id)
  WHERE lead_id IS NOT NULL;

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'customer_complaints'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_complaints;
  END IF;
END $$;

-- =============================================================================
-- C. Demo data — SÓ tenant 3333 (REGRA DE OURO #1)
-- =============================================================================

-- 5 entradas financeiras demo (mix de categoria/status)
INSERT INTO public.financial_entries (
  tenant_id, lead_id, client_name, amount, category, service_type,
  payment_method, status, due_date, paid_at, notes
)
VALUES
  -- 1. Consulta particular paga (Isaías Lima)
  (
    '33333333-3333-3333-3333-333333333333',
    (SELECT id FROM leads WHERE name='Isaías' AND tenant_id='33333333-3333-3333-3333-333333333333' LIMIT 1),
    'Isaías Lima', 350.00, 'clinica_particular', 'Consulta Psiquiátrica',
    'pix', 'pago', CURRENT_DATE - 7, now() - INTERVAL '7 days',
    'Primeira consulta — particular'
  ),
  -- 2. Convênio Unimed pendente
  (
    '33333333-3333-3333-3333-333333333333',
    NULL,
    'Maria Silva', 280.00, 'convenio', 'Sessão Terapia',
    'convenio', 'pendente', CURRENT_DATE + 15, NULL,
    'Convênio Unimed — aguardando repasse'
  ),
  -- 3. Laudo pericial INSS atrasado
  (
    '33333333-3333-3333-3333-333333333333',
    NULL,
    'João Santos', 1200.00, 'laudo_pericial', 'Laudo Pericial INSS',
    'transferencia', 'atrasado', CURRENT_DATE - 20, NULL,
    'Laudo entregue em 15/09, pagamento atrasado'
  ),
  -- 4. Consulta previdenciária (avaliação para benefício)
  (
    '33333333-3333-3333-3333-333333333333',
    (SELECT id FROM leads WHERE name='Israel' AND tenant_id='33333333-3333-3333-3333-333333333333' LIMIT 1),
    'Israel Bezerra', 450.00, 'previdenciario_inss', 'Avaliação Pericial BPC',
    'pix', 'pago', CURRENT_DATE - 3, now() - INTERVAL '3 days',
    'Avaliação para BPC/LOAS — laudo favorável'
  ),
  -- 5. Particular cartão crédito
  (
    '33333333-3333-3333-3333-333333333333',
    NULL,
    'Carla Mendes', 320.00, 'clinica_particular', 'Retorno Psiquiátrico',
    'cartao_credito', 'pago', CURRENT_DATE - 1, now() - INTERVAL '1 day',
    'Retorno 30 dias — parcelado em 3x sem juros'
  )
ON CONFLICT DO NOTHING;

-- 2 reclamações demo
INSERT INTO public.customer_complaints (
  tenant_id, lead_id, client_name, reason, severity, snippet, status, source
)
VALUES
  -- 1. Demora no atendimento (média)
  (
    '33333333-3333-3333-3333-333333333333',
    (SELECT id FROM leads WHERE name='Maria Silva' AND tenant_id='33333333-3333-3333-3333-333333333333' LIMIT 1),
    'Maria Silva', 'demora_atendimento', 'media',
    'Vocês demoram muito pra responder... já faz 3 dias que tô esperando e ninguém me dá um posicionamento. Isso é uma falta de respeito com quem tá precisando de ajuda.',
    'pendente', 'whatsapp'
  ),
  -- 2. Preço alto (baixa)
  (
    '33333333-3333-3333-3333-333333333333',
    NULL,
    'João Santos', 'preco_alto', 'baixa',
    'Achei o valor da consulta muito alto. Tô precisando de retorno mas R$ 350 tá pesado pra mim agora.',
    'resolvido', 'whatsapp'
  )
ON CONFLICT DO NOTHING;

-- =============================================================================
-- D. Validação final
-- =============================================================================
DO $$
DECLARE
  fin_total INT;
  fin_demo INT;
  fin_matheus INT;
  comp_total INT;
  comp_demo INT;
  comp_matheus INT;
BEGIN
  SELECT COUNT(*) INTO fin_total FROM public.financial_entries;
  SELECT COUNT(*) INTO fin_demo FROM public.financial_entries WHERE tenant_id = '33333333-3333-3333-3333-333333333333';
  SELECT COUNT(*) INTO fin_matheus FROM public.financial_entries WHERE tenant_id = '11111111-1111-1111-1111-111111111111';

  SELECT COUNT(*) INTO comp_total FROM public.customer_complaints;
  SELECT COUNT(*) INTO comp_demo FROM public.customer_complaints WHERE tenant_id = '33333333-3333-3333-3333-333333333333';
  SELECT COUNT(*) INTO comp_matheus FROM public.customer_complaints WHERE tenant_id = '11111111-1111-1111-1111-111111111111';

  RAISE NOTICE 'Migration 20261007_dashboard_module.sql aplicada.';
  RAISE NOTICE '  financial_entries: total=% (Demo 3333: %, Dr. Matheus 1111: %)', fin_total, fin_demo, fin_matheus;
  RAISE NOTICE '  customer_complaints: total=% (Demo 3333: %, Dr. Matheus 1111: %)', comp_total, comp_demo, comp_matheus;

  IF fin_matheus > 0 THEN
    RAISE EXCEPTION 'VIOLATION: financial_entries vazou para tenant 1111! count=%', fin_matheus;
  END IF;
  IF comp_matheus > 0 THEN
    RAISE EXCEPTION 'VIOLATION: customer_complaints vazou para tenant 1111! count=%', comp_matheus;
  END IF;
END $$;
