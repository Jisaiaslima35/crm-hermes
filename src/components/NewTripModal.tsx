import React, { useState, useEffect } from 'react';
import {
  X,
  Plane,
  Calendar,
  MapPin,
  CheckCircle,
  Clock,
  Plus,
  Trash2,
  CalendarDays,
} from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { LeadTrip } from '../types';

interface NewTripModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  leadId: string;
  leadName: string;
  onTripCreated?: () => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const NewTripModal: React.FC<NewTripModalProps> = ({
  isOpen,
  onClose,
  tenantId,
  leadId,
  leadName,
  onTripCreated,
  onToast,
}) => {
  const [destination, setDestination] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [existingTrips, setExistingTrips] = useState<LeadTrip[]>([]);

  useEffect(() => {
    if (!isOpen || !leadId) return;

    const fetchTrips = async () => {
      setLoadingTrips(true);
      try {
        const { data, error } = await supabase
          .from('lead_trips')
          .select('*')
          .eq('lead_id', leadId)
          .order('departure_date', { ascending: true });

        if (!error && data) {
          setExistingTrips(data);
        }
      } catch (err) {
        console.error('Erro ao buscar viagens do lead:', err);
      } finally {
        setLoadingTrips(false);
      }
    };

    fetchTrips();
    // Reset form
    setDestination('');
    setDepartureDate('');
    setReturnDate('');
  }, [isOpen, leadId]);

  if (!isOpen) return null;

  const handleSaveTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination.trim() || !departureDate || !returnDate) {
      onToast?.('Preencha o destino, data de ida e data de volta.', 'error');
      return;
    }

    if (new Date(returnDate) < new Date(departureDate)) {
      onToast?.('A data de volta não pode ser anterior à data de ida.', 'error');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('lead_trips')
        .insert({
          tenant_id: tenantId,
          lead_id: leadId,
          destination: destination.trim(),
          departure_date: departureDate,
          return_date: returnDate,
          pre_trip_sent: false,
          post_trip_sent: false,
        })
        .select()
        .single();

      if (error) throw error;

      onToast?.(`Viagem para "${destination}" registrada com sucesso!`, 'success');
      if (data) {
        setExistingTrips((prev) => [...prev, data]);
      }
      setDestination('');
      setDepartureDate('');
      setReturnDate('');
      onTripCreated?.();
    } catch (err: any) {
      console.error('Erro ao salvar viagem:', err);
      onToast?.(err.message || 'Falha ao registrar viagem', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in-50">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-850/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center text-teal-400">
              <Plane className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Registrar Nova Viagem · Pacote Fechado
              </h2>
              <p className="text-xs text-slate-400">
                Viajante: <span className="text-teal-300 font-semibold">{leadName}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Form */}
          <form onSubmit={handleSaveTrip} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-teal-400" />
                <span>Destino da Viagem / Pacote:</span>
              </label>
              <input
                type="text"
                required
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Ex: Maceió - Salinas de Maragogi / Gramado / Paris"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500 transition-colors"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-teal-400" />
                  <span>Data de Ida (Embarque):</span>
                </label>
                <input
                  type="date"
                  required
                  value={departureDate}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-teal-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <CalendarDays className="w-3.5 h-3.5 text-purple-400" />
                  <span>Data de Volta (Retorno):</span>
                </label>
                <input
                  type="date"
                  required
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-purple-500 transition-colors"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Salvando Viagem...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>Adicionar Viagem ao Histórico</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Histórico de Viagens deste Lead */}
          <div className="pt-4 border-t border-slate-800">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center justify-between">
              <span>Viagens Registradas ({existingTrips.length})</span>
              <span className="text-[10px] text-teal-400 font-normal">Armadas para réguas de D-2 e D+2</span>
            </h4>

            {loadingTrips ? (
              <p className="text-xs text-slate-500">Carregando viagens...</p>
            ) : existingTrips.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800 text-center">
                <p className="text-xs text-slate-500">Nenhuma viagem registrada ainda para este viajante.</p>
                <p className="text-[10px] text-slate-600 mt-1">Preencha o formulário acima para agendar os avisos.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {existingTrips.map((trip) => (
                  <div
                    key={trip.id}
                    className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white flex items-center gap-1.5 truncate">
                        <MapPin className="w-3 h-3 text-teal-400 shrink-0" />
                        <span>{trip.destination}</span>
                      </p>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
                        <span>Ida: <strong className="text-slate-300">{trip.departure_date}</strong></span>
                        <span>•</span>
                        <span>Volta: <strong className="text-slate-300">{trip.return_date}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          trip.pre_trip_sent
                            ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                            : 'bg-slate-900 text-slate-400 border-slate-800'
                        }`}
                        title={trip.pre_trip_sent ? 'Lembrete de ida já enviado' : 'Lembrete de ida pendente'}
                      >
                        {trip.pre_trip_sent ? 'Pré: Enviado' : 'Pré: Agendado'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          trip.post_trip_sent
                            ? 'bg-purple-950/60 text-purple-300 border-purple-800/60'
                            : 'bg-slate-900 text-slate-400 border-slate-800'
                        }`}
                        title={trip.post_trip_sent ? 'Pós-viagem já enviado' : 'Pós-viagem pendente'}
                      >
                        {trip.post_trip_sent ? 'Pós: Enviado' : 'Pós: Agendado'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-850/80 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-colors cursor-pointer"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
};
