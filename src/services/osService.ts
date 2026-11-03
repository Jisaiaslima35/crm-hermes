// ============================================================================
// ORDEM DE SERVIÇO (sprint dedetização — 02/11/2026)
// Cliente HTTP dos endpoints /api/v1/ordem-servico do backend CRM-Hermes.
// ============================================================================

const crmWebhookBase =
  (import.meta.env.VITE_CRM_WEBHOOK_URL as string | undefined) ||
  'https://crm-webhook.automacaojs.us';

export interface OsRascunho {
  numero: string;
  emissao: string;
  tenant_id?: string;
  empresa: string;
  empresa_cnpj?: string;
  empresa_telefone?: string;
  responsavel_tecnico?: string;
  registro_tecnico?: string;
  lead_id?: string;
  cliente_nome: string;
  cliente_telefone: string;
  cliente_documento?: string;
  cliente_tipo?: string;
  endereco?: string;
  complemento?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  local_servico?: string;
  tipo_imovel?: string;
  tipo_praga?: string;
  area?: string;
  data_inicio?: string | null;
  data_fim?: string | null;
  produto?: string;
  principio_ativo?: string;
  dose?: string;
  metodo?: string;
  epi?: string;
  checklist?: Record<string, boolean>;
  observacoes?: string;
  garantia_dias?: number;
  garantia_pragas?: string[];
  garantia_observacoes?: string;
  valor_contrato?: string;
  forma_pagamento?: string;
  [k: string]: any;
}

export interface OsPrevia {
  ok: boolean;
  os: OsRascunho;
  html: string;
  whatsapp: string;
  pendencias: string[];
}

export interface OsEmitida {
  ok: boolean;
  os?: OsRascunho;
  os_id?: string;
  numero?: string;
  status?: string;
  html?: string;
  whatsapp?: string;
  pendencias?: string[];
  enviada?: { ok?: boolean; reason?: string } | null;
  erro?: string;
}

async function _json(res: Response): Promise<any> {
  const raw = await res.text();
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const detail =
      body?.detail || body?.message || body?.error || raw?.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(String(detail));
  }
  return body ?? {};
}

/** Rascunho já preenchido com o que o CRM sabe do lead (cliente, data, número). */
export async function fetchOsPrevia(leadId: string): Promise<OsPrevia> {
  const res = await fetch(
    `${crmWebhookBase}/api/v1/ordem-servico/previa?lead_id=${encodeURIComponent(leadId)}`
  );
  return (await _json(res)) as OsPrevia;
}

/** Emite a OS: grava no banco, devolve o HTML e (opcionalmente) envia no WhatsApp. */
export async function emitirOs(params: {
  leadId: string;
  dados: Partial<OsRascunho>;
  enviar?: boolean;
  texto?: string;
  numero?: string;
}): Promise<OsEmitida> {
  const res = await fetch(`${crmWebhookBase}/api/v1/ordem-servico`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lead_id: params.leadId,
      dados: params.dados || {},
      enviar: !!params.enviar,
      texto: params.texto,
      numero: params.numero,
    }),
  });
  return (await _json(res)) as OsEmitida;
}

/** Lista as OS emitidas do tenant (mais recentes primeiro). */
export async function listarOs(tenantId: string, limit = 20): Promise<any[]> {
  const res = await fetch(
    `${crmWebhookBase}/api/v1/ordem-servico?tenant_id=${encodeURIComponent(tenantId)}&limit=${limit}`
  );
  const body = await _json(res);
  return body?.ordens_servico || body?.ordens || body?.os || [];
}

/** HTML A4 imprimível de uma OS já emitida. */
export async function fetchOsHtml(osId: string): Promise<string> {
  const res = await fetch(`${crmWebhookBase}/api/v1/ordem-servico/html/${encodeURIComponent(osId)}`);
  const body = await _json(res);
  return String(body?.html || '');
}
