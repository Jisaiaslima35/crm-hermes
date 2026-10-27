-- Migration: adiciona coluna last_campaign_at na tabela leads para blindagem anti-duplicação em campanhas
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_campaign_at TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN leads.last_campaign_at IS 'Data/hora do último envio de campanha/reativação em massa';
