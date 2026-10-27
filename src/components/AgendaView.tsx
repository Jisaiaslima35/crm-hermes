import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, dateFnsLocalizer, View, Views } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import {
  Calendar as CalIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  X,
  Stethoscope,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  User,
} from 'lucide-react';
import {
  Appointment,
  AppointmentStatus,
  APPOINTMENT_STATUS_COLORS,
  APPOINTMENT_STATUS_LABELS,
  createAppointment,
  deleteAppointment,
  listAppointments,
  subscribeAppointments,
  updateAppointment,
} from '../services/appointmentsService';
import type { Lead, Tenant } from '../types';

// ----------------------------------------------------------------------------
// Localizer PT-BR (react-big-calendar + date-fns)
// ----------------------------------------------------------------------------
const locales = { 'pt-BR': ptBR };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { locale: ptBR, weekStartsOn: 1 }),
  getDay,
  locales,
});

interface AgendaViewProps {
  activeTenant: Tenant;
  leads: Lead[];
  showToast: (msg: string, kind?: 'success' | 'warning' | 'info' | 'error') => void;
}

// ----------------------------------------------------------------------------
// CSS override (react-big-calendar vem com tema claro; aqui forçamos dark pra
// casar com o resto do CRM-Hermes bg-slate-950).
// ----------------------------------------------------------------------------
const darkCalendarCss = `
.rbc-calendar { color: #cbd5e1; background: transparent; font-family: inherit; }
.rbc-toolbar { padding: 0 0 0.75rem 0; gap: 0.5rem; flex-wrap: wrap; }
.rbc-toolbar button {
  color: #cbd5e1; background: #1e293b; border: 1px solid #334155;
  padding: 0.4rem 0.8rem; font-size: 0.75rem; font-weight: 600;
  border-radius: 0.5rem; transition: all 120ms;
}
.rbc-toolbar button:hover, .rbc-toolbar button:focus { background: #334155; color: #fff; }
.rbc-toolbar button.rbc-active { background: #0ea5e9; color: #fff; border-color: #0284c7; box-shadow: 0 0 0 2px rgba(14,165,233,0.3); }
.rbc-toolbar-label { color: #f1f5f9; font-weight: 700; font-size: 0.95rem; text-transform: capitalize; }
.rbc-month-view, .rbc-time-view, .rbc-agenda-view { border: 1px solid #334155; border-radius: 0.75rem; background: #0f172a; }
.rbc-header { background: #1e293b; color: #cbd5e1; border-color: #334155; padding: 0.5rem; font-weight: 600; font-size: 0.7rem; text-transform: uppercase; }
.rbc-day-bg { background: #0f172a; border-color: #1e293b; }
.rbc-day-bg + .rbc-day-bg { border-left-color: #1e293b; }
.rbc-off-range-bg { background: #020617; }
.rbc-today { background: rgba(14,165,233,0.08); }
.rbc-off-range { color: #475569; }
.rbc-date-cell { color: #94a3b8; padding: 0.3rem 0.5rem; font-size: 0.75rem; text-align: right; }
.rbc-date-cell.rbc-now { color: #38bdf8; font-weight: 700; }
.rbc-time-header, .rbc-time-content, .rbc-time-gutter, .rbc-day-slot, .rbc-timeslot-group, .rbc-time-slot { border-color: #1e293b !important; }
.rbc-time-gutter .rbc-timeslot-group, .rbc-time-gutter .rbc-time-slot { color: #64748b; }
.rbc-current-time-indicator { background: #ef4444; height: 2px; }
.rbc-event { background: transparent; border: none; padding: 0; }
.rbc-event:focus { outline: 2px solid #38bdf8; outline-offset: 1px; }
.rbc-month-row { overflow: visible; }
.rbc-show-more { color: #38bdf8; font-size: 0.7rem; font-weight: 600; background: transparent; }
.rbc-agenda-view table.rbc-agenda-table { border: none; color: #cbd5e1; }
.rbc-agenda-view table.rbc-agenda-table thead > tr > th { border-bottom: 1px solid #334155; color: #94a3b8; }
.rbc-agenda-view table.rbc-agenda-table tbody > tr > td { border-color: #1e293b; padding: 0.5rem 0.75rem; }
`;

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------
export const AgendaView: React.FC<AgendaViewProps> = ({ activeTenant, leads, showToast }) => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [view, setView] = useState<View>(Views.WEEK);
  const [date, setDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);

  // Modais
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [creatingSlot, setCreatingSlot] = useState<{ start: Date; end: Date } | null>(null);

  // 1. Carrega appointments do tenant ativo
  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const range = computeViewRange(date, view);
      const list = await listAppointments(activeTenant.id, range);
      setAppointments(list);
    } catch (err) {
      showToast(`Erro ao carregar agenda: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [activeTenant.id, date, view, showToast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 2. Realtime
  useEffect(() => {
    const unsub = subscribeAppointments(activeTenant.id, (appt, ev) => {
      if (ev === 'DELETE') {
        setAppointments((prev) => prev.filter((a) => a.id !== appt.id));
        return;
      }
      setAppointments((prev) => {
        const idx = prev.findIndex((a) => a.id === appt.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = appt;
          return copy;
        }
        return [...prev, appt];
      });
    });
    return unsub;
  }, [activeTenant.id]);

  // 3. Mapeia pra eventos do react-big-calendar
  const events = useMemo(
    () =>
      appointments.map((a) => ({
        ...a,
        start: a.start,
        end: a.end,
        title: formatEventTitle(a),
      })),
    [appointments]
  );

  // 4. Cor por status
  const eventPropGetter = useCallback((event: { status?: AppointmentStatus }) => {
    const status: AppointmentStatus = event.status ?? 'agendado';
    const c = APPOINTMENT_STATUS_COLORS[status];
    return {
      style: {
        backgroundColor: c.bg,
        border: `1px solid ${c.border}`,
        borderLeft: `4px solid ${c.border}`,
        color: c.text,
        borderRadius: 6,
        padding: '2px 6px',
        fontSize: '0.7rem',
        fontWeight: 600,
        lineHeight: 1.15,
      },
    };
  }, []);

  // 5. Handlers
  const handleSelectEvent = useCallback((event: { id: string }) => {
    const found = appointments.find((a) => a.id === event.id);
    if (found) setSelectedAppt(found);
  }, [appointments]);

  const handleSelectSlot = useCallback(({ start, end }: { start: Date; end: Date }) => {
    setCreatingSlot({ start, end });
  }, []);

  const handleStatusChange = useCallback(
    async (appt: Appointment, next: AppointmentStatus) => {
      try {
        await updateAppointment(appt.id, activeTenant.id, { status: next });
        setAppointments((prev) =>
          prev.map((a) => (a.id === appt.id ? { ...a, status: next } : a))
        );
        setSelectedAppt((s) => (s && s.id === appt.id ? { ...s, status: next } : s));
        showToast(`Status atualizado para "${APPOINTMENT_STATUS_LABELS[next]}"`, 'success');
      } catch (err) {
        showToast(`Falha ao atualizar: ${(err as Error).message}`, 'error');
      }
    },
    [activeTenant.id, showToast]
  );

  const handleDelete = useCallback(
    async (appt: Appointment) => {
      if (!window.confirm(`Excluir agendamento "${appt.title}"? Esta ação não pode ser desfeita.`)) {
        return;
      }
      try {
        await deleteAppointment(appt.id, activeTenant.id);
        setAppointments((prev) => prev.filter((a) => a.id !== appt.id));
        setSelectedAppt(null);
        showToast('Agendamento excluído.', 'success');
      } catch (err) {
        showToast(`Falha ao excluir: ${(err as Error).message}`, 'error');
      }
    },
    [activeTenant.id, showToast]
  );

  const handleCreate = useCallback(
    async (input: {
      leadId: string | null;
      title: string;
      specialty: string | null;
      start: Date;
      end: Date;
      notes: string | null;
    }) => {
      try {
        const appt = await createAppointment({
          tenantId: activeTenant.id,
          leadId: input.leadId,
          title: input.title,
          specialty: input.specialty,
          start: input.start,
          end: input.end,
          notes: input.notes,
          source: 'manual',
        });
        setAppointments((prev) => [...prev, appt]);
        setCreatingSlot(null);
        showToast(`Agendamento "${appt.title}" criado!`, 'success');
      } catch (err) {
        showToast(`Falha ao criar: ${(err as Error).message}`, 'error');
      }
    },
    [activeTenant.id, showToast]
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950">
      <style>{darkCalendarCss}</style>

      {/* HEADER */}
      <header className="px-5 py-3 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center">
            <CalIcon className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">Agenda Integrada</h1>
            <p className="text-[11px] text-slate-400">
              {activeTenant.name} · {appointments.length} agendamento{appointments.length === 1 ? '' : 's'} no período
              {loading && ' · carregando…'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <LegendChip status="agendado" />
          <LegendChip status="confirmado" />
          <LegendChip status="compareceu" />
          <LegendChip status="cancelou" />
          <LegendChip status="faltou" />
        </div>

        <button
          onClick={() => {
            const now = new Date();
            const start = new Date(now);
            start.setMinutes(0, 0, 0);
            const end = new Date(start.getTime() + 50 * 60_000);
            setCreatingSlot({ start, end });
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg shadow-sm transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Novo agendamento
        </button>
      </header>

      {/* CALENDAR */}
      <div className="flex-1 p-4 overflow-auto">
        <div style={{ height: 'calc(100vh - 200px)', minHeight: 520 }}>
          <Calendar
            localizer={localizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            views={[Views.WEEK, Views.MONTH, Views.AGENDA, Views.DAY]}
            defaultView={Views.WEEK}
            culture="pt-BR"
            messages={{
              week: 'Semana',
              day: 'Dia',
              month: 'Mês',
              agenda: 'Lista',
              today: 'Hoje',
              previous: 'Anterior',
              next: 'Próximo',
              noEventsInRange: 'Nenhum agendamento neste período.',
              showMore: (n: number) => `+${n} mais`,
            }}
            eventPropGetter={eventPropGetter as any}
            onSelectEvent={handleSelectEvent as any}
            onSelectSlot={handleSelectSlot}
            selectable
            popup
            min={new Date(2026, 0, 1, 6, 0)} // 06:00
            max={new Date(2026, 0, 1, 22, 0)} // 22:00
            step={30}
            timeslots={2}
            components={{
              toolbar: (props) => <CustomToolbar {...props} />,
            }}
          />
        </div>
      </div>

      {/* MODAL: detalhes */}
      {selectedAppt && (
        <AppointmentDetailsModal
          appt={selectedAppt}
          onClose={() => setSelectedAppt(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
        />
      )}

      {/* MODAL: novo */}
      {creatingSlot && (
        <NewAppointmentModal
          start={creatingSlot.start}
          leads={leads.filter((l) => l.tenantId === activeTenant.id)}
          onSave={handleCreate}
          onClose={() => setCreatingSlot(null)}
        />
      )}
    </div>
  );
};

// ============================================================================
// Sub-componentes
// ============================================================================

function formatEventTitle(a: Appointment): string {
  const hh = (d: Date) => d.toTimeString().slice(0, 5);
  const head = `${hh(a.start)}–${hh(a.end)} ${a.title}`;
  if (a.specialty) return `${head} · ${a.specialty}`;
  return head;
}

function LegendChip({ status }: { status: AppointmentStatus }) {
  const c = APPOINTMENT_STATUS_COLORS[status];
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-md border"
      style={{ background: c.bg, borderColor: c.border, color: c.text }}
    >
      {APPOINTMENT_STATUS_LABELS[status]}
    </span>
  );
}

function computeViewRange(date: Date, view: View): { from: Date; to: Date } {
  if (view === Views.MONTH) {
    const from = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const to = new Date(date.getFullYear(), date.getMonth() + 2, 0, 23, 59, 59);
    return { from, to };
  }
  if (view === Views.WEEK) {
    const monday = startOfWeek(date, { locale: ptBR, weekStartsOn: 1 });
    const from = new Date(monday);
    from.setDate(from.getDate() - 7);
    const to = new Date(monday);
    to.setDate(to.getDate() + 14);
    return { from, to };
  }
  if (view === Views.DAY) {
    const from = new Date(date);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from, to };
  }
  // agenda
  const from = new Date(date);
  from.setMonth(from.getMonth() - 1);
  const to = new Date(date);
  to.setMonth(to.getMonth() + 2);
  return { from, to };
}

// Toolbar customizada: botões mais bonitos com setas
function CustomToolbar(props: { label: string; onNavigate: (a: 'PREV' | 'NEXT' | 'TODAY') => void; onView: (v: View) => void; view: View }) {
  const { label, onNavigate, onView, view } = props;
  const views: { key: View; label: string }[] = [
    { key: Views.DAY, label: 'Dia' },
    { key: Views.WEEK, label: 'Semana' },
    { key: Views.MONTH, label: 'Mês' },
    { key: Views.AGENDA, label: 'Lista' },
  ];
  return (
    <div className="rbc-toolbar" role="toolbar" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          onClick={() => onNavigate('PREV')}
          className="rbc-active:bg-slate-700"
          aria-label="Anterior"
        >
          <ChevronLeft className="w-3.5 h-3.5 inline" />
        </button>
        <button type="button" onClick={() => onNavigate('TODAY')}>Hoje</button>
        <button type="button" onClick={() => onNavigate('NEXT')} aria-label="Próximo">
          <ChevronRight className="w-3.5 h-3.5 inline" />
        </button>
      </div>
      <span className="rbc-toolbar-label">{label}</span>
      <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            className={view === v.key ? 'rbc-active' : ''}
            onClick={() => onView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// MODAL — Detalhes do agendamento
// ----------------------------------------------------------------------------
const STATUS_ICON: Record<AppointmentStatus, React.ReactNode> = {
  agendado: <Clock className="w-3.5 h-3.5" />,
  confirmado: <CheckCircle2 className="w-3.5 h-3.5" />,
  compareceu: <Stethoscope className="w-3.5 h-3.5" />,
  cancelou: <XCircle className="w-3.5 h-3.5" />,
  faltou: <AlertTriangle className="w-3.5 h-3.5" />,
};

function AppointmentDetailsModal({
  appt,
  onClose,
  onStatusChange,
  onDelete,
}: {
  appt: Appointment;
  onClose: () => void;
  onStatusChange: (a: Appointment, s: AppointmentStatus) => void;
  onDelete: (a: Appointment) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        <header
          className="px-5 py-3 flex items-center justify-between"
          style={{
            background: APPOINTMENT_STATUS_COLORS[appt.status].bg,
            color: APPOINTMENT_STATUS_COLORS[appt.status].text,
          }}
        >
          <div className="flex items-center gap-2">
            {STATUS_ICON[appt.status]}
            <span className="font-bold text-sm uppercase tracking-wider">
              {APPOINTMENT_STATUS_LABELS[appt.status]}
            </span>
          </div>
          <button onClick={onClose} className="opacity-80 hover:opacity-100 transition-opacity">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold text-white">{appt.title}</h2>
            {appt.specialty && (
              <p className="text-xs text-sky-400 mt-0.5">{appt.specialty}</p>
            )}
          </div>

          <div className="space-y-2 text-xs">
            <Row label="Data e hora" value={`${formatDate(appt.start)} · ${formatTime(appt.start)} – ${formatTime(appt.end)}`} />
            <Row label="Duração" value={`${Math.round((appt.end.getTime() - appt.start.getTime()) / 60_000)} min`} />
            {appt.leadName && (
              <Row label="Paciente" value={appt.leadName} icon={<User className="w-3 h-3" />} />
            )}
            <Row label="Origem" value={appt.source} />
            {appt.googleEventId && (
              <Row label="Google Event" value={appt.googleEventId} />
            )}
            {appt.notes && (
              <div className="pt-2 border-t border-slate-800">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Observações</p>
                <p className="text-xs text-slate-300 whitespace-pre-wrap">{appt.notes}</p>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-800">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Alterar status</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map((s) => {
                const active = s === appt.status;
                const c = APPOINTMENT_STATUS_COLORS[s];
                return (
                  <button
                    key={s}
                    onClick={() => onStatusChange(appt, s)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                      active ? 'ring-2 ring-offset-2 ring-offset-slate-900' : 'opacity-80 hover:opacity-100'
                    }`}
                    style={{
                      background: c.bg,
                      borderColor: c.border,
                      color: c.text,
                      ...(active ? { boxShadow: `0 0 0 2px ${c.bg}` } : {}),
                    }}
                  >
                    {STATUS_ICON[s]}
                    {APPOINTMENT_STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-between">
            <button
              onClick={() => onDelete(appt)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 border border-rose-500/30 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Excluir
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-300 hover:text-white border border-slate-700 rounded-lg transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold w-24 shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-xs text-slate-200 flex-1 break-words flex items-center gap-1">
        {icon}
        {value}
      </span>
    </div>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}
function formatTime(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ----------------------------------------------------------------------------
// MODAL — Novo agendamento (clique em slot vazio)
// ----------------------------------------------------------------------------
function NewAppointmentModal({
  start,
  leads,
  onSave,
  onClose,
}: {
  start: Date;
  leads: Lead[];
  onSave: (input: {
    leadId: string | null;
    title: string;
    specialty: string | null;
    start: Date;
    end: Date;
    notes: string | null;
  }) => void;
  onClose: () => void;
}) {
  const [leadId, setLeadId] = useState<string>('');
  const [title, setTitle] = useState<string>('Consulta');
  const [specialty, setSpecialty] = useState<string>('Psiquiatria');
  const [startStr, setStartStr] = useState<string>(toLocalIso(start));
  const [duration, setDuration] = useState<number>(50);
  const [notes, setNotes] = useState<string>('');

  const startDate = useMemo(() => parseLocalIso(startStr), [startStr]);
  const endDate = useMemo(() => new Date(startDate.getTime() + duration * 60_000), [startDate, duration]);

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      leadId: leadId || null,
      title: title.trim(),
      specialty: specialty.trim() || null,
      start: startDate,
      end: endDate,
      notes: notes.trim() || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
      >
        <header className="px-5 py-3 bg-sky-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            <h2 className="font-bold text-sm">Novo agendamento</h2>
          </div>
          <button type="button" onClick={onClose} className="opacity-80 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 space-y-3">
          <Field label="Paciente / lead (opcional)">
            <select
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="">— sem lead (avulso) —</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} · {l.phone}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Título">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
              />
            </Field>
            <Field label="Especialidade">
              <input
                type="text"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                placeholder="Psiquiatria, Terapia…"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Início">
              <input
                type="datetime-local"
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
                required
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
              />
            </Field>
            <Field label="Duração (min)">
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                <option value={15}>15</option>
                <option value={30}>30</option>
                <option value={45}>45</option>
                <option value={50}>50 (padrão)</option>
                <option value={60}>60</option>
                <option value={90}>90</option>
              </select>
            </Field>
          </div>

          <Field label="Observações (opcional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 focus:border-sky-500 focus:outline-none resize-none"
            />
          </Field>
        </div>

        <footer className="px-5 py-3 border-t border-slate-800 bg-slate-900/60 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-300 hover:text-white border border-slate-700 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Agendar
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// Helpers de conversão local <-> ISO
function toLocalIso(d: Date): string {
  // Formato: YYYY-MM-DDTHH:mm (datetime-local)
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function parseLocalIso(s: string): Date {
  // s = "2026-10-09T14:00"
  const [date, time] = s.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, 0, 0);
}
