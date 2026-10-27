// ============================================================================
// liveStore.ts — singleton em memória que alimenta o front com dados do
// Supabase (realtime + REST). Substitui o antigo fallback de localStorage.
//
// Mutators são chamados pelos handlers REST/realtime; subscribers são
// notificados a cada mudança pra que o App.tsx re-renderize as views
// (Kanban, ChatInbox, LeadsListView) SEM precisar trocar o contrato sync
// dos componentes legados.
// ============================================================================

import type { Tenant, Lead, LeadMessage, InternalNote } from '../types';

type Listener = () => void;

const state: {
  tenants: Tenant[];
  leads: Lead[]; // messages[] e internalNotes[] vêm denormalizados no Lead
  lastInteractionByLead: Record<string, string>;
} = {
  tenants: [],
  leads: [],
  lastInteractionByLead: {},
};

const tenantListeners = new Set<Listener>();
const leadListeners = new Set<Listener>();

function notify(set: Set<Listener>) {
  set.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error('[liveStore] listener error', e);
    }
  });
}

// ============================================================================
// Tenants
// ============================================================================

export function setTenants(list: Tenant[]): void {
  state.tenants = [...list];
  notify(tenantListeners);
}

export function upsertTenant(t: Tenant): void {
  const i = state.tenants.findIndex((x) => x.id === t.id);
  if (i >= 0) state.tenants[i] = t;
  else state.tenants.push(t);
  notify(tenantListeners);
}

export function subscribeTenants(fn: Listener): () => void {
  tenantListeners.add(fn);
  return () => tenantListeners.delete(fn);
}

// ============================================================================
// Leads
// ============================================================================

export function setLeads(list: Lead[]): void {
  // Stale-while-revalidate: preserva histórico de mensagens em memória
  const existingMap = new Map(state.leads.map((l) => [l.id, l]));
  state.leads = list.map((newItem) => {
    const prev = existingMap.get(newItem.id);
    if (!prev) return newItem;
    const msgs = (newItem.messages && newItem.messages.length > 0) ? newItem.messages : prev.messages;
    const notes = (newItem.internalNotes && newItem.internalNotes.length > 0) ? newItem.internalNotes : prev.internalNotes;
    return { ...prev, ...newItem, messages: msgs, internalNotes: notes };
  });
  notify(leadListeners);
}

export function upsertLead(l: Lead): void {
  const i = state.leads.findIndex((x) => x.id === l.id);
  if (i >= 0) {
    const existing = state.leads[i];
    // NUNCA limpa mensagens se 'l' vier vazio (upsert de lead via realtime)
    const msgs = (l.messages && l.messages.length > 0) ? l.messages : existing.messages;
    const notes = (l.internalNotes && l.internalNotes.length > 0) ? l.internalNotes : existing.internalNotes;
    state.leads[i] = { ...existing, ...l, messages: msgs, internalNotes: notes };
  } else {
    state.leads.unshift(l);
  }
  notify(leadListeners);
}

export function updateLead(id: string, patch: Partial<Lead>): Lead | null {
  const i = state.leads.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const merged: Lead = { ...state.leads[i], ...patch };
  state.leads[i] = merged;
  notify(leadListeners);
  return merged;
}

export function removeLead(id: string): void {
  state.leads = state.leads.filter((l) => l.id !== id);
  notify(leadListeners);
}

export function getLeadById(id: string): Lead | undefined {
  return state.leads.find((l) => l.id === id);
}

export function appendMessageToLead(leadId: string, msg: LeadMessage): Lead | null {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return null;
  // Evita duplicidade de mensagens pelo ID
  if (lead.messages.some((m) => m.id === msg.id)) {
    return lead;
  }
  const next: Lead = {
    ...lead,
    messages: [...lead.messages, msg],
    lastInteractionAt: msg.timestamp || lead.lastInteractionAt,
  };
  return updateLead(leadId, {
    messages: next.messages,
    lastInteractionAt: next.lastInteractionAt,
  });
}

export function appendNoteToLead(
  leadId: string,
  note: InternalNote
): Lead | null {
  const lead = state.leads.find((l) => l.id === leadId);
  if (!lead) return null;
  return updateLead(leadId, {
    internalNotes: [note, ...lead.internalNotes],
  });
}

export function subscribeLeads(fn: Listener): () => void {
  leadListeners.add(fn);
  return () => leadListeners.delete(fn);
}

// ============================================================================
// Snapshots pra debug
// ============================================================================

export function snapshot() {
  return {
    tenants: state.tenants.slice(),
    leads: state.leads.slice(),
  };
}

export function reset(): void {
  state.tenants = [];
  state.leads = [];
  state.lastInteractionByLead = {};
  notify(tenantListeners);
  notify(leadListeners);
}
