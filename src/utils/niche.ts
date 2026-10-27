// Nicho do tenant — fonte unica para rotulos, filtros e branding.
// business_niche (coluna tenants) manda; sem ela, cai para a heuristica legada
// (specialty/nome) para nao quebrar tenants antigos.
export type Niche = 'clinica' | 'turismo' | 'comercial';

export function nicheOf(t: {
  businessNiche?: string | null;
  specialty?: string | null;
  name?: string | null;
} | null | undefined): Niche {
  const n = (t?.businessNiche || '').toLowerCase();
  if (n === 'clinica' || n === 'turismo' || n === 'comercial') return n as Niche;
  const s = (t?.specialty || '').toLowerCase();
  const name = (t?.name || '').toLowerCase();
  if (s.includes('turismo') || name.includes('esvc')) return 'turismo';
  return 'clinica';
}

export function brandColorOf(t: { primaryColor?: string | null } | null | undefined): string {
  return t?.primaryColor || '#0ea5e9';
}
