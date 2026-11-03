// ============================================================================
// PROPOSTA COMERCIAL B2B EM PDF (sprint 03/11/2026)
// Cliente HTTP dos endpoints /api/v1/proposta-b2b do backend CRM-Hermes.
// A geração do PDF é SERVER-SIDE (Playwright + Chrome): o navegador do
// operador nunca precisa ter plugin de impressão.
// ============================================================================

const crmWebhookBase =
  (import.meta.env.VITE_CRM_WEBHOOK_URL as string | undefined) ||
  'https://crm-webhook.automacaojs.us';

export interface PropostaItem {
  descricao: string;
  quantidade: number | string;
  unidade?: string;
  valor_unitario: number;
  total?: number;
}

export interface PropostaCliente {
  nome?: string;
  empresa?: string;
  telefone?: string;
  cidade?: string;
  bairro?: string;
}

export interface PropostaCondicoes {
  validade_dias?: number;
  pagamento?: string;
  entrega?: string;
  garantia?: string;
  observacoes?: string;
}

export interface PropostaPrevia {
  ok: boolean;
  template: string;
  proposta: any;
  html: string;
  whatsapp: string;
  pendencias: string[];
  catalogo: PropostaItem[];
}

export interface PropostaGerada {
  ok: boolean;
  proposta_id?: string;
  numero?: string;
  template?: string;
  filename?: string;
  pdf_base64?: string;
  pdf_size?: number;
  html?: string;
  whatsapp?: string;
  proposta?: any;
  pendencias?: string[];
}

export interface PropostaEnvio {
  ok: boolean;
  enviada?: { ok?: boolean; status?: number; body?: any; reason?: string };
  erro?: string;
  proposta_id?: string;
  numero?: string;
  instance?: string;
  telefone?: string;
  modo?: string;
  whatsapp?: string;
  proposta?: any;
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
      body?.detail || body?.message || body?.error || raw?.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(String(detail));
  }
  return body ?? {};
}

/** Rascunho da proposta preenchido com os dados REAIS do lead. */
export async function fetchPropostaPrevia(
  leadId: string,
  template?: string
): Promise<PropostaPrevia> {
  const q = new URLSearchParams({ lead_id: leadId });
  if (template) q.set('template', template);
  const res = await fetch(`${crmWebhookBase}/api/v1/proposta-b2b/previa?${q.toString()}`);
  return (await _json(res)) as PropostaPrevia;
}

/** Gera o PDF no servidor (base64) e grava o registro da proposta. */
export async function gerarPropostaPdf(params: {
  leadId: string;
  template?: string;
  itens?: PropostaItem[];
  cliente?: PropostaCliente;
  condicoes?: PropostaCondicoes;
}): Promise<PropostaGerada> {
  const res = await fetch(`${crmWebhookBase}/api/v1/proposta-b2b/gerar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lead_id: params.leadId,
      template: params.template,
      itens: params.itens,
      cliente: params.cliente,
      condicoes: params.condicoes,
    }),
  });
  return (await _json(res)) as PropostaGerada;
}

/**
 * Envia no WhatsApp da instância do tenant:
 *  - modo 'texto' -> sendText (proposta em texto puro)
 *  - modo 'pdf'   -> sendMedia com application/pdf (base64)
 */
export async function enviarProposta(params: {
  leadId: string;
  modo: 'texto' | 'pdf';
  template?: string;
  itens?: PropostaItem[];
  cliente?: PropostaCliente;
  condicoes?: PropostaCondicoes;
  telefone?: string;
  instance?: string;
  texto?: string;
}): Promise<PropostaEnvio> {
  const res = await fetch(`${crmWebhookBase}/api/v1/proposta-b2b/enviar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lead_id: params.leadId,
      modo: params.modo,
      template: params.template,
      itens: params.itens,
      cliente: params.cliente,
      condicoes: params.condicoes,
      telefone: params.telefone,
      instance: params.instance,
      texto: params.texto,
    }),
  });
  return (await _json(res)) as PropostaEnvio;
}

/** Data URL do PDF (para preview em <iframe>). */
export function pdfDataUrl(base64: string): string {
  return `data:application/pdf;base64,${base64}`;
}

/** Baixa o PDF gerado no disco do operador. */
export function baixarPdf(base64: string, filename: string): void {
  const a = document.createElement('a');
  a.href = pdfDataUrl(base64);
  a.download = filename || 'proposta.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
