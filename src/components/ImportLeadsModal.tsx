import React, { useState } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertTriangle,
  Users,
  ArrowRight,
  Database,
  FileText,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../services/supabaseClient';

interface ImportLeadsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  tenantName?: string;
  onImportComplete?: () => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

interface ParsedContact {
  name: string;
  rawPhone: string;
  cleanPhone: string;
  valid: boolean;
  destination?: string;
}

export const ImportLeadsModal: React.FC<ImportLeadsModalProps> = ({
  isOpen,
  onClose,
  tenantId,
  tenantName,
  onImportComplete,
  onToast,
}) => {
  const [fileName, setFileName] = useState('');
  const [parsedContacts, setParsedContacts] = useState<ParsedContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<{
    total: number;
    inserted: number;
    skipped: number;
  } | null>(null);

  if (!isOpen) return null;

  // Sanitização rigorosa DDI 55 + DDD + Número
  const sanitizePhone = (raw: string): { clean: string; valid: boolean } => {
    if (!raw) return { clean: '', valid: false };
    let digits = String(raw).replace(/\D/g, '');

    // Remove 0 inicial se houver (ex: 084999998888 -> 84999998888)
    if (digits.startsWith('0')) {
      digits = digits.slice(1);
    }

    // Se tem 10 ou 11 dígitos, anexa DDI 55
    if (digits.length === 10 || digits.length === 11) {
      digits = `55${digits}`;
    }

    // Válido se tem 12 ou 13 dígitos e inicia com 55
    const valid = digits.length >= 12 && digits.length <= 13 && digits.startsWith('55');
    return { clean: digits, valid };
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setLoading(true);
    setImportSummary(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];

      const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (!rawRows || rawRows.length === 0) {
        onToast?.('A planilha está vazia.', 'error');
        setLoading(false);
        return;
      }

      // Procura linha de cabeçalho
      let headerRowIdx = 0;
      let nameColIdx = -1;
      let phoneColIdx = -1;
      let destColIdx = -1;

      for (let r = 0; r < Math.min(5, rawRows.length); r++) {
        const row = rawRows[r] || [];
        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').toLowerCase().trim();
          if (['nome', 'name', 'cliente', 'contato', 'viajante', 'passageiro'].some((k) => val.includes(k))) {
            nameColIdx = c;
            headerRowIdx = r;
          }
          if (['telefone', 'phone', 'celular', 'whatsapp', 'tel', 'numero'].some((k) => val.includes(k))) {
            phoneColIdx = c;
            headerRowIdx = r;
          }
          if (['destino', 'destination', 'viagem', 'cidade', 'local'].some((k) => val.includes(k))) {
            destColIdx = c;
          }
        }
        if (nameColIdx !== -1 && phoneColIdx !== -1) break;
      }

      // Se não encontrou cabeçalho explícito, assume Col 0 = Nome, Col 1 = Telefone
      if (nameColIdx === -1) nameColIdx = 0;
      if (phoneColIdx === -1) phoneColIdx = 1;

      const contacts: ParsedContact[] = [];
      const startIdx = headerRowIdx >= 0 ? headerRowIdx + 1 : 0;

      for (let i = startIdx; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;

        const rawName = String(row[nameColIdx] || '').trim();
        const rawPhone = String(row[phoneColIdx] || '').trim();
        const rawDest = destColIdx !== -1 ? String(row[destColIdx] || '').trim() : '';

        if (!rawName && !rawPhone) continue;

        const { clean, valid } = sanitizePhone(rawPhone);

        contacts.push({
          name: rawName || `Contato ${clean || i}`,
          rawPhone,
          cleanPhone: clean,
          valid,
          destination: rawDest,
        });
      }

      setParsedContacts(contacts);
      const validTotal = contacts.filter((c) => c.valid).length;
      onToast?.(
        `Planilha processada: ${contacts.length} registros (${validTotal} telefones válidos com DDI 55).`,
        'success'
      );
    } catch (err: any) {
      console.error('Erro ao ler planilha:', err);
      onToast?.(`Falha ao ler arquivo: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteImport = async () => {
    const validContacts = parsedContacts.filter((c) => c.valid);
    if (validContacts.length === 0) {
      onToast?.('Nenhum contato com telefone válido para importar.', 'error');
      return;
    }

    setImporting(true);
    let inserted = 0;
    let skipped = 0;

    try {
      // 1. Busca telefones já existentes no tenant para deduplicar
      const { data: existingLeads } = await supabase
        .from('leads')
        .select('phone')
        .eq('tenant_id', tenantId);

      const existingPhones = new Set((existingLeads || []).map((l: any) => l.phone));

      const rowsToInsert = [];
      const nowIso = new Date().toISOString();

      for (const contact of validContacts) {
        if (existingPhones.has(contact.cleanPhone)) {
          skipped++;
          continue;
        }

        existingPhones.add(contact.cleanPhone);
        inserted++;

        rowsToInsert.push({
          tenant_id: tenantId,
          phone: contact.cleanPhone,
          name: contact.name,
          stage: 'novo_lead', // 1. Novo Lead
          ai_active: false, // Bot em OFF
          handoff_state: 'ia_ativa',
          priority: 'normal',
          clinical_summary: contact.destination
            ? `Interesse de Viagem: ${contact.destination}`
            : 'Lead importado via Lista / Planilha',
          created_at: nowIso,
          last_interaction: nowIso,
          followup_count: 0,
          followup_status: 'pending',
          opt_out_reactivation: false,
        });
      }

      if (rowsToInsert.length > 0) {
        // Insere em lotes de 100
        const batchSize = 100;
        for (let b = 0; b < rowsToInsert.length; b += batchSize) {
          const slice = rowsToInsert.slice(b, b + batchSize);
          const { error: insErr } = await supabase.from('leads').insert(slice);
          if (insErr) {
            console.error('Erro no lote de inserção:', insErr);
            throw insErr;
          }
        }
      }

      setImportSummary({
        total: validContacts.length,
        inserted,
        skipped,
      });

      onToast?.(
        `Importação concluída! ${inserted} novos leads inseridos em "1. Novo Lead" (${skipped} duplicados ignorados).`,
        'success'
      );
      onImportComplete?.();
    } catch (err: any) {
      console.error('Erro na importação em lote:', err);
      onToast?.(`Erro ao salvar leads: ${err.message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const validCount = parsedContacts.filter((c) => c.valid).length;
  const invalidCount = parsedContacts.length - validCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in-50">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-850/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Importação em Lote de Contatos (Excel / CSV)
              </h2>
              <p className="text-xs text-slate-400">
                Tenant Destino: <span className="text-sky-300 font-semibold">{tenantName || 'ESVC Turismo'}</span> · Coluna "1. Novo Lead"
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
          {/* Upload Area */}
          <div className="p-6 border-2 border-dashed border-slate-700 hover:border-sky-500/60 rounded-2xl bg-slate-850/50 text-center transition-colors">
            <input
              type="file"
              id="file-import-input"
              accept=".xlsx,.xls,.csv,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            <label htmlFor="file-import-input" className="cursor-pointer block">
              <Upload className="w-10 h-10 text-sky-400 mx-auto mb-3" />
              <p className="text-sm font-bold text-white mb-1">
                {fileName ? `Arquivo: ${fileName}` : 'Clique para selecionar a Planilha Excel (.xlsx, .xls) ou CSV'}
              </p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Mapeamento automático de colunas: <strong>Nome</strong>, <strong>Telefone/WhatsApp</strong> e <strong>Destino</strong> (opcional).
              </p>
              <span className="inline-block mt-3 px-3 py-1 rounded-lg bg-sky-500/20 text-sky-300 text-xs font-semibold border border-sky-500/30">
                Sanitização automática com DDI 55
              </span>
            </label>
          </div>

          {loading && (
            <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center">
              <div className="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mb-2" />
              <span>Processando arquivo e sanitizando telefones...</span>
            </div>
          )}

          {/* Results Summary */}
          {parsedContacts.length > 0 && !loading && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Total de Linhas</span>
                  <span className="text-base font-extrabold text-white">{parsedContacts.length}</span>
                </div>
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50">
                  <span className="text-[10px] uppercase font-bold text-emerald-400 block">Telefones Válidos (55)</span>
                  <span className="text-base font-extrabold text-emerald-300">{validCount}</span>
                </div>
                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50">
                  <span className="text-[10px] uppercase font-bold text-rose-400 block">Inválidos / Incompletos</span>
                  <span className="text-base font-extrabold text-rose-300">{invalidCount}</span>
                </div>
              </div>

              {/* Sample Preview */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Prévia dos Contatos Sanitizados (primeiros 5):
                </h4>
                <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/80 text-[11px] text-slate-400">
                        <th className="p-2.5">Nome</th>
                        <th className="p-2.5">Telefone Original</th>
                        <th className="p-2.5">Sanitizado E.164</th>
                        <th className="p-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {parsedContacts.slice(0, 5).map((c, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/40">
                          <td className="p-2.5 font-medium text-white">{c.name}</td>
                          <td className="p-2.5 text-slate-400 font-mono">{c.rawPhone}</td>
                          <td className="p-2.5 text-sky-300 font-mono font-semibold">
                            {c.cleanPhone || '-'}
                          </td>
                          <td className="p-2.5">
                            {c.valid ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400 text-[10px] font-bold">
                                <CheckCircle className="w-3 h-3" /> Válido
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-rose-400 text-[10px] font-bold">
                                <AlertTriangle className="w-3 h-3" /> Inválido
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Import result feedback */}
          {importSummary && (
            <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-700/50 flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold text-emerald-200">Importação Realizada com Sucesso!</p>
                <p className="text-emerald-300/90 mt-1">
                  <strong>{importSummary.inserted}</strong> leads cadastrados na etapa <strong>1. Novo Lead</strong> do tenant ESVC Turismo.
                  {importSummary.skipped > 0 && ` ${importSummary.skipped} já existiam na base e foram desconsiderados.`}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-850/80 flex items-center justify-between">
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-sky-400" />
            <span>Inserção direta no Supabase com deduplicação por telefone</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={importing}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Fechar
            </button>
            {parsedContacts.length > 0 && (
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={importing || validCount === 0}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {importing ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Importando Leads...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>Confirmar Importação ({validCount} Leads)</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
