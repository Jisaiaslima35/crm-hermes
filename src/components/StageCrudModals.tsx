import React, { useEffect, useState } from 'react';
import { X, Save, Trash2, AlertTriangle } from 'lucide-react';
import { updateKanbanStage, deleteKanbanStage } from '../services/supabaseService';

export interface DynStageRow {
  id: string;
  slug: string;
  title: string;
  description?: string;
  keywords?: string[];
  colorAccent?: string;
  isProtected?: boolean;
}

interface StageEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  stage: DynStageRow | null;
  onSaved: () => void;
  onToast?: (msg: string, type: 'success' | 'warning' | 'info' | 'error') => void;
}

const COLOR_PRESETS = ['#38bdf8', '#34d399', '#22d3ee', '#fbbf24', '#2dd4bf', '#fb7185', '#c084fc', '#818cf8', '#94a3b8', '#f97316'];

export const StageEditModal: React.FC<StageEditModalProps> = ({
  isOpen,
  onClose,
  stage,
  onSaved,
  onToast,
}) => {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [color, setColor] = useState('#38bdf8');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && stage) {
      setTitle(stage.title);
      setDesc(stage.description || '');
      setKeywordsText((stage.keywords || []).join(', '));
      setColor(stage.colorAccent || '#38bdf8');
    }
  }, [isOpen, stage]);

  if (!isOpen || !stage) return null;

  const handleSave = async () => {
    if (!title.trim()) {
      onToast?.('O nome da etapa é obrigatório.', 'error');
      return;
    }
    setSaving(true);
    const keywords = keywordsText
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    const ok = await updateKanbanStage(stage.id, {
      title: title.trim(),
      semantic_description: desc.trim(),
      trigger_keywords: keywords,
      color_accent: color,
    });
    setSaving(false);
    if (ok) {
      onToast?.(`Etapa "${title.trim()}" atualizada. O JEV passa a usar os novos dados em até 60s (cache).`, 'success');
      onSaved();
      onClose();
    } else {
      onToast?.('Falha ao atualizar a etapa.', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">✏️ Editar etapa — {stage.slug}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">Nome da coluna</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
            Descrição semântica (o que o JEV entende desta etapa)
          </label>
          <textarea
            rows={2}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="w-full p-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
            placeholder="Ex: Valores e proposta comercial entregues"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
            Palavras-chave do bot (separadas por vírgula)
          </label>
          <input
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setKeywordsText((v) => (v.trim() ? `${v.replace(/,\s*$/, '')}, ` : v));
              }
            }}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
            placeholder="Ex: orçamento, preço, valor"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {keywordsText
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean)
              .map((k) => (
                <span key={k} className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/40 text-[10px] font-bold">
                  {k}
                </span>
              ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">Cor de destaque</label>
          <div className="flex items-center gap-2 flex-wrap">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 cursor-pointer ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer bg-transparent"
              title="Cor personalizada"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-xs font-bold text-white cursor-pointer flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" /> Salvar
          </button>
        </div>
      </div>
    </div>
  );
};

interface StageDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  stage: DynStageRow | null;
  onDeleted: () => void;
  onToast?: (msg: string, type: 'success' | 'warning' | 'info' | 'error') => void;
}

export const StageDeleteModal: React.FC<StageDeleteModalProps> = ({
  isOpen,
  onClose,
  stage,
  onDeleted,
  onToast,
}) => {
  const [deleting, setDeleting] = useState(false);
  if (!isOpen || !stage) return null;

  const handleDelete = async () => {
    setDeleting(true);
    const res = await deleteKanbanStage(stage.id);
    setDeleting(false);
    if (res) {
      onToast?.(
        `Etapa "${stage.title}" excluída. ${res.moved_leads || 0} lead(s) realocado(s) para "${res.moved_to}".`,
        'success'
      );
      onDeleted();
      onClose();
    } else {
      onToast?.('Falha ao excluir a etapa (etapas protegidas não podem ser excluídas).', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-white">Excluir etapa "{stage.title}"?</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Todos os leads ativos nesta coluna serão movidos automaticamente para a etapa inicial
              (Novo Lead) antes da exclusão. As automações vinculadas a esta etapa deixam de existir.
              Esta ação não pode ser desfeita.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 cursor-pointer"
          >
            Manter etapa
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={handleDelete}
            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-xs font-bold text-white cursor-pointer flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" /> Excluir etapa
          </button>
        </div>
      </div>
    </div>
  );
};
