import { supabase } from './supabaseClient';

// ============================================================================
// appointmentsService — CRUD de agendamentos do Módulo da Agenda (Fase 4, msg 5613)
//
// Schema: public.appointments (ver migration 20261007_agenda_module.sql)
//   - tenant_id (FK tenants, NOT NULL)        — multi-tenant isolado
//   - lead_id  (FK leads, NULLABLE)           — agendamento pode existir sem lead
//   - start_time / end_time (timestamptz)     — janela do agendamento
//   - status: 'agendado'|'confirmado'|'compareceu'|'cancelou'|'faltou'
//   - title, specialty, notes
//   - google_event_id (NULLABLE)              — preenchido pelo Plan B
//   - source: 'manual'|'whatsapp'|'google_calendar'
//
// REGRA DE OURO #1 (msg 5601): TODA query que ler/escrever DEVE filtrar
// por tenant_id. Não há RLS no projeto — a app é responsável pelo filtro.
// ============================================================================

export type AppointmentStatus =
  | 'agendado'
  | 'confirmado'
  | 'compareceu'
  | 'cancelou'
  | 'faltou';

export type AppointmentSource = 'manual' | 'whatsapp' | 'google_calendar';

export interface DbAppointment {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  start_time: string; // ISO timestamptz
  end_time: string;
  status: AppointmentStatus;
  title: string;
  specialty: string | null;
  notes: string | null;
  google_event_id: string | null;
  source: AppointmentSource;
  created_at: string;
  updated_at: string;
}

// ----------------------------------------------------------------------------
// DTO que o AgendaView consome (já com start/end em Date + displayName do lead)
// ----------------------------------------------------------------------------
export interface Appointment {
  id: string;
  tenantId: string;
  leadId: string | null;
  leadName: string | null;
  start: Date;
  end: Date;
  status: AppointmentStatus;
  title: string;
  specialty: string | null;
  notes: string | null;
  googleEventId: string | null;
  source: AppointmentSource;
}

export interface CreateAppointmentInput {
  tenantId: string;
  leadId: string | null;
  start: Date;
  end: Date;
  status?: AppointmentStatus;
  title: string;
  specialty?: string | null;
  notes?: string | null;
  source?: AppointmentSource;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  compareceu: 'Compareceu',
  cancelou: 'Cancelou',
  faltou: 'Faltou',
};

// Cores por status (usado no eventPropGetter do react-big-calendar).
// Mantém paridade com a paleta slate/sky/emerald/violet/amber do CRM-Hermes.
export const APPOINTMENT_STATUS_COLORS: Record<
  AppointmentStatus,
  { bg: string; border: string; text: string }
> = {
  agendado: { bg: '#0ea5e9', border: '#0284c7', text: '#ffffff' }, // sky
  confirmado: { bg: '#10b981', border: '#059669', text: '#ffffff' }, // emerald
  compareceu: { bg: '#8b5cf6', border: '#7c3aed', text: '#ffffff' }, // violet
  cancelou: { bg: '#475569', border: '#334155', text: '#cbd5e1' }, // slate
  faltou: { bg: '#f59e0b', border: '#d97706', text: '#1f2937' }, // amber
};

// ----------------------------------------------------------------------------
// READ — listar appointments do tenant no range [from, to)
// ----------------------------------------------------------------------------
export async function listAppointments(
  tenantId: string,
  range?: { from: Date; to: Date }
): Promise<Appointment[]> {
  let q = supabase
    .from('appointments')
    .select('*, leads:lead_id(name)')
    .eq('tenant_id', tenantId)
    .order('start_time', { ascending: true });

  if (range) {
    // AND no PostgREST: end_time > from E start_time < to (overlap de janela)
    q = q.lt('start_time', range.to.toISOString()).gt('end_time', range.from.toISOString());
  }

  const { data, error } = await q;
  if (error) throw new Error(`listAppointments: ${error.message}`);

  type Row = DbAppointment & { leads?: { name: string } | null };
  return ((data ?? []) as Row[]).map((r) => dbToAppointment(r));
}

function dbToAppointment(row: DbAppointment & { leads?: { name: string } | null }): Appointment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    leadId: row.lead_id,
    leadName: row.leads?.name ?? null,
    start: new Date(row.start_time),
    end: new Date(row.end_time),
    status: row.status,
    title: row.title,
    specialty: row.specialty,
    notes: row.notes,
    googleEventId: row.google_event_id,
    source: row.source,
  };
}

// ----------------------------------------------------------------------------
// CREATE
// ----------------------------------------------------------------------------
export async function createAppointment(input: CreateAppointmentInput): Promise<Appointment> {
  const payload = {
    tenant_id: input.tenantId,
    lead_id: input.leadId,
    start_time: input.start.toISOString(),
    end_time: input.end.toISOString(),
    status: input.status ?? 'agendado',
    title: input.title,
    specialty: input.specialty ?? null,
    notes: input.notes ?? null,
    source: input.source ?? 'manual',
  };
  const { data, error } = await supabase
    .from('appointments')
    .insert(payload)
    .select('*, leads:lead_id(name)')
    .single();
  if (error) throw new Error(`createAppointment: ${error.message}`);
  return dbToAppointment(data as DbAppointment & { leads?: { name: string } | null });
}

// ----------------------------------------------------------------------------
// UPDATE — status, notes, etc.
// ----------------------------------------------------------------------------
export async function updateAppointment(
  appointmentId: string,
  tenantId: string,
  patch: Partial<Pick<Appointment, 'status' | 'notes' | 'title' | 'specialty'>>
): Promise<void> {
  // Whitelist de campos atualizáveis (evita injeção de tenant_id, etc).
  const db: Record<string, unknown> = {};
  if (patch.status !== undefined) db.status = patch.status;
  if (patch.notes !== undefined) db.notes = patch.notes;
  if (patch.title !== undefined) db.title = patch.title;
  if (patch.specialty !== undefined) db.specialty = patch.specialty;
  if (Object.keys(db).length === 0) return;

  const { error } = await supabase
    .from('appointments')
    .update(db)
    .eq('id', appointmentId)
    .eq('tenant_id', tenantId); // trava multi-tenant
  if (error) throw new Error(`updateAppointment: ${error.message}`);
}

// ----------------------------------------------------------------------------
// DELETE
// ----------------------------------------------------------------------------
export async function deleteAppointment(appointmentId: string, tenantId: string): Promise<void> {
  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', appointmentId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`deleteAppointment: ${error.message}`);
}

// ----------------------------------------------------------------------------
// REALTIME — assinatura da tabela appointments filtrada por tenant
// ----------------------------------------------------------------------------
export type AppointmentChangeHandler = (
  appt: Appointment,
  event: 'INSERT' | 'UPDATE' | 'DELETE'
) => void;

export function subscribeAppointments(
  tenantId: string,
  onChange: AppointmentChangeHandler
): () => void {
  const channel = supabase
    .channel(`live-appointments:${tenantId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'appointments',
        filter: `tenant_id=eq.${tenantId}`,
      },
      async (payload) => {
        if (payload.eventType === 'DELETE') {
          // DELETE payload vem só com .old (id); chamamos onChange com objeto
          // mínimo pra view remover pelo id.
          const old = payload.old as { id: string };
          onChange(
            {
              id: old.id,
              tenantId,
              leadId: null,
              leadName: null,
              start: new Date(),
              end: new Date(),
              status: 'agendado',
              title: '',
              specialty: null,
              notes: null,
              googleEventId: null,
              source: 'manual',
            },
            'DELETE'
          );
          return;
        }
        // INSERT/UPDATE: payload.new já tem a linha nova; falta o lead name
        // que vem via JOIN. Recarregamos com select() pra ter o nome fresco.
        const newRow = payload.new as DbAppointment;
        const { data } = await supabase
          .from('appointments')
          .select('*, leads:lead_id(name)')
          .eq('id', newRow.id)
          .single();
        if (data) {
          onChange(
            dbToAppointment(data as DbAppointment & { leads?: { name: string } | null }),
            payload.eventType as 'INSERT' | 'UPDATE'
          );
        }
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
