import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Rocket,
  ShieldCheck,
  Clock,
  Users,
  Upload,
  Send,
  Pause,
  Play,
  Square,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
  Sparkles,
  Smartphone,
  Check,
  X,
  Calendar,
  AlertCircle,
  RotateCcw,
  Sliders,
  Filter,
  QrCode,
  Plus,
} from 'lucide-react';
import { Tenant, Lead } from '../types';
import * as XLSX from 'xlsx';
import {
  supabase,
  sendWhatsApp,
  sendMessage,
  createLead,
  fetchAllEvolutionInstances,
  requestPairingQrCode,
  getInstanceStatus,
  EvolutionInstanceInfo,
} from '../services/supabaseService';

export interface CampaignContact {
  id?: string;
  name: string;
  phone: string;
  cleanPhone: string;
  stage?: string;
  lastInteraction?: string;
  daysInactive?: number;
  source: 'crm' | 'csv';
  valid: boolean;
  selected: boolean;
  status: 'pending' | 'sending' | 'success' | 'failed' | 'skipped';
  error?: string;
}

interface CampanhasReativacaoViewProps {
  activeTenant: Tenant;
  onToast?: (message: string, type: 'success' | 'warning' | 'info' | 'error') => void;
}

type InactivityFilter = 'all_base' | '15d' | '30d' | '60_90d' | 'all_inactives';
type AntiBanMode = 'seguro' | 'moderado' | 'turbo_teste';

export const CampanhasReativacaoView: React.FC<CampanhasReativacaoViewProps> = ({
  activeTenant,
  onToast,
}) => {
  const isTourism =
    activeTenant.specialty?.toLowerCase().includes('turismo') ||
    activeTenant.name.toLowerCase().includes('esvc') ||
    activeTenant.id === '44444444-4444-4444-4444-444444444444';

  const defaultTourismTemplate =
    'Olá, {{nome}}! Tudo bem? Aqui é da equipe da ESVC Turismo. Estamos selecionando ofertas especiais de viagens e passagens para a próxima temporada. Você tem planos de viajar nos próximos meses?';

  const defaultClinicTemplate =
    'Olá, {{nome}}! Tudo bem? Aqui é da equipe do {{doutor}} na {{clinica}}.\n\nIdentificamos que já faz um tempinho desde a sua última consulta. Como você tem passado? Gostaria de verificar os horários disponíveis para o seu retorno nesta semana?';

  // 1. Estados da Audiência
  const [audienceTab, setAudienceTab] = useState<'crm' | 'csv' | 'avulso'>('crm');
  const [inactivityFilter, setInactivityFilter] = useState<InactivityFilter>('all_base');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [crmContacts, setCrmContacts] = useState<CampaignContact[]>([]);
  const [csvContacts, setCsvContacts] = useState<CampaignContact[]>([]);
  const [loadingCrm, setLoadingCrm] = useState<boolean>(false);
  const [syncingContacts, setSyncingContacts] = useState<boolean>(false);
  const [csvFileName, setCsvFileName] = useState<string>('');

  // Estados do Envio Avulso
  const [avulsoPhone, setAvulsoPhone] = useState<string>('');
  const [avulsoName, setAvulsoName] = useState<string>('');
  const [sendingAvulso, setSendingAvulso] = useState<boolean>(false);

  // 2. Configurações de Envio & Anti-Ban
  const [evolutionInstances, setEvolutionInstances] = useState<EvolutionInstanceInfo[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>(
    activeTenant.whatsappInstance.sessionName || ''
  );
  const [antiBanMode, setAntiBanMode] = useState<AntiBanMode>('seguro');
  const [bypassTimeLock, setBypassTimeLock] = useState<boolean>(false);
  const [batchLimit, setBatchLimit] = useState<number>(20); // Limite de Envios por Lote (Ex: 10, 20, 50, 0=todos)
  const [antiDuplication30d, setAntiDuplication30d] = useState<boolean>(true); // Blindagem anti-duplicação nos últimos 30 dias

  // 3. Mensagem e Preview
  const [messageTemplate, setMessageTemplate] = useState<string>(
    isTourism ? defaultTourismTemplate : defaultClinicTemplate
  );

  useEffect(() => {
    setMessageTemplate(isTourism ? defaultTourismTemplate : defaultClinicTemplate);
  }, [isTourism, defaultTourismTemplate, defaultClinicTemplate]);

  // 4. Motor de Execução
  const [campaignStatus, setCampaignStatus] = useState<
    'idle' | 'running' | 'paused' | 'stopped' | 'completed'
  >('idle');
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [countdown, setCountdown] = useState<number>(0);
  const [executionLogs, setExecutionLogs] = useState<
    Array<{
      id: string;
      time: string;
      name: string;
      phone: string;
      status: 'success' | 'failed';
      message?: string;
    }>
  >([]);

  // Referências para controle do loop sem problemas de re-render
  const abortControllerRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const isRunningRef = useRef<boolean>(false);

  // Estados do Modal de Pareamento do Chip Secundário de Campanhas
  const [showQrModal, setShowQrModal] = useState<boolean>(false);
  const defaultCampaignInstanceName = useMemo(() => {
    const primary = (activeTenant.whatsappInstance.sessionName || '').toLowerCase();
    if (primary.includes('matheus')) {
      return 'cardio_matheus_campanhas';
    }
    const clean = primary.replace(/[-_](prod|test|teste|demo|01|02).*$/, '') || 'campanhas';
    return `${clean}_campanhas`;
  }, [activeTenant]);

  const [qrTargetInstance, setQrTargetInstance] = useState<string>(defaultCampaignInstanceName);
  const [qrStatus, setQrStatus] = useState<{
    kind: 'idle' | 'loading' | 'waiting' | 'connected' | 'error';
    base64?: string;
    pairingCode?: string;
    message?: string;
  }>({ kind: 'idle' });
  const qrPollRef = useRef<number | null>(null);

  // Função para carregar e filtrar ESTRITAMENTE as instâncias da Evolution pertencentes ao tenant
  const loadTenantInstances = useCallback(async () => {
    try {
      const list = await fetchAllEvolutionInstances();
      const primaryName = (activeTenant.whatsappInstance.sessionName || '').toLowerCase().trim();
      const isDrMatheus =
        activeTenant.name.toLowerCase().includes('matheus') ||
        activeTenant.doctorName.toLowerCase().includes('matheus') ||
        primaryName.includes('matheus');

      // Blindagem estrita multi-tenant: bloqueia qualquer instância de outros clientes
      const filtered = list.filter((inst) => {
        const n = inst.name.toLowerCase().trim();

        // 1. É a instância primária oficial do tenant
        if (primaryName && n === primaryName) return true;

        // 2. Se for a Clínica Dr. Matheus Dore:
        if (isDrMatheus) {
          // Bloqueia categoricamente mercadinhos, formiga, mendes, etc.
          if (
            n.includes('mercado') ||
            n.includes('formiga') ||
            n.includes('mendes') ||
            n.includes('demo')
          ) {
            return false;
          }
          // Aceita instâncias da clínica
          if (n.includes('cardio_matheus') || n.includes('matheus')) {
            return true;
          }
          return false;
        }

        // 3. Para outros tenants (ex: Demo): prefixo da oficial
        if (primaryName) {
          const basePrefix = primaryName.replace(/[-_](prod|test|teste|demo|01|02).*$/, '');
          if (basePrefix.length >= 3 && n.startsWith(basePrefix)) {
            return true;
          }
        }
        return false;
      });

      // Garante que a instância primária oficial esteja na lista
      if (primaryName && !filtered.some((i) => i.name.toLowerCase() === primaryName)) {
        filtered.unshift({
          name: activeTenant.whatsappInstance.sessionName,
          connectionStatus: activeTenant.whatsappInstance.status || 'open',
          number: activeTenant.whatsappInstance.phoneNumber || '',
        });
      }

      // Se a instância secundária de campanha ainda não existe na Evolution,
      // insere como opção secundária dedicada
      if (!filtered.some((i) => i.name.toLowerCase() === defaultCampaignInstanceName.toLowerCase())) {
        filtered.push({
          name: defaultCampaignInstanceName,
          connectionStatus: 'disconnected',
        });
      }

      setEvolutionInstances(filtered);
      if (!selectedInstance || !filtered.some((i) => i.name === selectedInstance)) {
        setSelectedInstance(filtered[0]?.name || activeTenant.whatsappInstance.sessionName);
      }
    } catch (err) {
      console.warn('Erro ao listar instâncias Evolution:', err);
    }
  }, [activeTenant, defaultCampaignInstanceName, selectedInstance]);

  // Carrega instâncias filtradas ao montar ou quando o tenant mudar
  useEffect(() => {
    loadTenantInstances();
  }, [loadTenantInstances]);

  // Sincroniza instância se o activeTenant mudar
  useEffect(() => {
    if (activeTenant.whatsappInstance.sessionName) {
      setSelectedInstance(activeTenant.whatsappInstance.sessionName);
    }
    setQrTargetInstance(defaultCampaignInstanceName);
  }, [activeTenant.whatsappInstance.sessionName, defaultCampaignInstanceName]);

  // Parar polling do QR Code
  const stopQrPolling = () => {
    if (qrPollRef.current !== null) {
      window.clearInterval(qrPollRef.current);
      qrPollRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopQrPolling();
  }, []);

  // Iniciar geração do QR Code para o chip de campanha
  const handleStartPairing = async (targetName: string) => {
    stopQrPolling();
    const instName = targetName.trim() || defaultCampaignInstanceName;
    setQrStatus({ kind: 'loading' });

    try {
      const webhookUrl = `https://crm-webhook.automacaojs.us/webhook/evolution/${encodeURIComponent(
        instName
      )}`;
      const result = await requestPairingQrCode(instName, webhookUrl, false);

      // Se já estava conectada
      if (result.already_connected || result.state === 'open') {
        setQrStatus({ kind: 'connected' });
        setSelectedInstance(instName);
        await loadTenantInstances();
        onToast?.(`Instância "${instName}" já está conectada e pronta para disparo!`, 'success');
        return;
      }

      const base64 = result.base64;
      if (!base64) {
        setQrStatus({
          kind: 'error',
          message:
            'A Evolution API não retornou o QR Code. A instância pode estar inicializando. Tente novamente em alguns segundos.',
        });
        return;
      }

      const src = base64.startsWith('data:image') ? base64 : `data:image/png;base64,${base64}`;
      setQrStatus({ kind: 'waiting', base64: src, pairingCode: result.pairingCode });

      // Inicia polling a cada 2.5s para detectar conexão pelo celular
      qrPollRef.current = window.setInterval(async () => {
        try {
          const st = await getInstanceStatus(instName);
          const state = (st as { state?: string } | null)?.state || 'unknown';
          if (state === 'open') {
            stopQrPolling();
            setQrStatus({ kind: 'connected' });
            setSelectedInstance(instName);
            await loadTenantInstances();
            onToast?.(`🎉 Chip de campanha "${instName}" conectado com sucesso!`, 'success');
            setTimeout(() => {
              setShowQrModal(false);
            }, 2000);
          }
        } catch (e) {
          console.warn('Erro ao verificar status do QR:', e);
        }
      }, 2500);
    } catch (err) {
      setQrStatus({ kind: 'error', message: String(err) });
    }
  };

  // Função para sanitizar e padronizar telefone para E.164 (Brasil)
  const sanitizePhone = (rawPhone: string): { clean: string; valid: boolean } => {
    if (!rawPhone) return { clean: '', valid: false };
    let digits = rawPhone.replace(/\D/g, '');

    // Se começa com 0, remove
    if (digits.startsWith('0')) {
      digits = digits.slice(1);
    }

    // Se tem 10 ou 11 dígitos (ex: 84999998888 ou 8499998888), adiciona DDI 55
    if (digits.length === 10 || digits.length === 11) {
      digits = `55${digits}`;
    }

    // Válido se tem 12 ou 13 dígitos e começa com 55
    const valid = digits.length >= 12 && digits.length <= 13 && digits.startsWith('55');
    return { clean: digits, valid };
  };

  // 1.1 Consulta Leads no Supabase
  const loadCrmInactives = async (filter: InactivityFilter) => {
    setLoadingCrm(true);
    try {
      const now = new Date();
      // Busca leads até 5000 registros para garantir que toda a base seja carregada
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('tenant_id', activeTenant.id)
        .not('stage', 'in', '("desistiu","cancelou","opt_out")')
        .order('created_at', { ascending: false })
        .limit(10000);

      if (error) {
        console.error('Erro ao buscar leads:', error);
        onToast?.('Falha ao carregar leads do CRM', 'error');
        return;
      }

      const rows = data || [];
      const filtered: CampaignContact[] = [];

      for (const row of rows) {
        // Blindagem Anti-Duplicação: se já recebeu campanha nos últimos 30 dias e a flag estiver ligada
        if (antiDuplication30d && row.last_campaign_at) {
          const lastCampDate = new Date(row.last_campaign_at);
          const campDiffMs = now.getTime() - lastCampDate.getTime();
          const campDiffDays = Math.floor(campDiffMs / (1000 * 60 * 60 * 24));
          if (campDiffDays < 30) {
            continue; // Blindado! Já recebeu campanha nos últimos 30 dias.
          }
        }

        const lastDate = row.last_interaction ? new Date(row.last_interaction) : new Date(row.created_at);
        const diffMs = now.getTime() - lastDate.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        let matches = false;
        if (filter === 'all_base') matches = true;
        else if (filter === '15d' && diffDays >= 15) matches = true;
        else if (filter === '30d' && diffDays >= 30) matches = true;
        else if (filter === '60_90d' && diffDays >= 60 && diffDays <= 90) matches = true;
        else if (filter === 'all_inactives' && diffDays >= 7) matches = true;

        if (matches) {
          const { clean, valid } = sanitizePhone(row.phone);
          filtered.push({
            id: row.id,
            name: row.name || (isTourism ? 'Viajante' : 'Paciente'),
            phone: row.phone,
            cleanPhone: clean,
            stage: row.stage || 'novo_lead',
            lastInteraction: row.last_interaction,
            daysInactive: diffDays,
            source: 'crm',
            valid,
            selected: valid,
            status: 'pending',
          });
        }
      }

      setCrmContacts(filtered);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingCrm(false);
    }
  };

  // Função para sincronizar todos os contatos e conversas da Evolution API com deduplicação
  const handleSyncWhatsAppContacts = async () => {
    setSyncingContacts(true);
    try {
      const crmWebhookBase =
        (import.meta.env.VITE_CRM_WEBHOOK_URL as string | undefined) ||
        'https://crm-webhook.automacaojs.us';

      let resp: Response;
      try {
        resp = await fetch(`${crmWebhookBase}/api/campaigns/sync-whatsapp-contacts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant_id: activeTenant.id }),
        });
      } catch {
        resp = await fetch('/api/campaigns/sync-whatsapp-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenant_id: activeTenant.id }),
        });
      }

      if (resp.ok) {
        const result = await resp.json();
        onToast?.(
          `Base sincronizada: ${result.total_synced || 0} contatos únicos disponíveis (+${result.new_added || 0} novos adicionados).`,
          'success'
        );
        await loadCrmInactives(inactivityFilter);
      } else {
        const errText = await resp.text();
        onToast?.(`Erro na sincronização: ${errText.slice(0, 100)}`, 'error');
      }
    } catch (err) {
      console.error('[SyncWhatsApp] Erro:', err);
      onToast?.(`Falha ao sincronizar: ${(err as Error).message}`, 'error');
    } finally {
      setSyncingContacts(false);
    }
  };

  // Carrega ao montar ou mudar o filtro / blindagem
  useEffect(() => {
    loadCrmInactives(inactivityFilter);
  }, [inactivityFilter, antiDuplication30d, activeTenant.id]);

  // 1.2 Parser de CSV
  // 1.2 Parser de Planilhas (Excel .xlsx / .xls ou CSV)
  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

      if (!rawRows || rawRows.length === 0) {
        onToast?.('A planilha selecionada está vazia.', 'error');
        return;
      }

      // Procura cabeçalho
      let headerRowIdx = 0;
      let nameIdx = -1;
      let phoneIdx = -1;

      for (let r = 0; r < Math.min(5, rawRows.length); r++) {
        const row = rawRows[r] || [];
        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').toLowerCase().trim();
          if (['nome', 'name', 'paciente', 'cliente', 'contato', 'viajante', 'passageiro'].some((k) => val.includes(k))) {
            nameIdx = c;
            headerRowIdx = r;
          }
          if (['telefone', 'phone', 'celular', 'whatsapp', 'tel', 'numero'].some((k) => val.includes(k))) {
            phoneIdx = c;
            headerRowIdx = r;
          }
        }
        if (nameIdx !== -1 && phoneIdx !== -1) break;
      }

      if (nameIdx === -1) nameIdx = 0;
      if (phoneIdx === -1) phoneIdx = 1;

      const parsed: CampaignContact[] = [];
      const startIdx = headerRowIdx >= 0 ? headerRowIdx + 1 : 0;

      for (let i = startIdx; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;

        const rawName = String(row[nameIdx] || '').trim();
        const rawPhone = String(row[phoneIdx] || '').trim();
        if (!rawName && !rawPhone) continue;

        const { clean, valid } = sanitizePhone(rawPhone);

        parsed.push({
          name: rawName || `Contato ${i}`,
          phone: rawPhone,
          cleanPhone: clean,
          stage: 'novo_lead',
          source: 'csv',
          valid,
          selected: valid,
          status: 'pending',
        });
      }

      setCsvContacts(parsed);
      const validCount = parsed.filter((c) => c.valid).length;
      onToast?.(
        `Planilha carregada: ${parsed.length} linhas (${validCount} contatos válidos com DDI 55).`,
        'success'
      );
    } catch (err) {
      console.error('Erro ao processar planilha:', err);
      onToast?.('Erro ao processar arquivo Excel / CSV', 'error');
    }
  };

  // Filtragem de contatos CRM por etapa do Kanban
  const filteredCrmContacts = useMemo(() => {
    if (stageFilter === 'all') return crmContacts;
    return crmContacts.filter((c) => {
      const s = (c.stage || '').toLowerCase();
      if (stageFilter === 'novo_lead') return s === 'novo_lead' || s === 'iniciou_conversa';
      if (stageFilter === 'em_atendimento') return s === 'em_atendimento';
      if (stageFilter === 'cotacao_enviada') return s === 'cotacao_enviada';
      if (stageFilter === 'falar_pessoalmente') return s === 'falar_pessoalmente' || s === 'em_negociacao';
      if (stageFilter === 'contratou') return s === 'contratou' || s === 'fechou' || s === 'consulta_realizada';
      if (stageFilter === 'paciente_recorrente') return s === 'paciente_recorrente' || s === 'pos_viagem';
      return s === stageFilter;
    });
  }, [crmContacts, stageFilter]);

  // Lista de contatos atualmente ativa (CRM ou CSV)
  const activeContactsList = audienceTab === 'crm' ? filteredCrmContacts : csvContacts;
  const setActiveContactsList = (updater: (prev: CampaignContact[]) => CampaignContact[]) => {
    if (audienceTab === 'crm') {
      setCrmContacts(updater);
    } else {
      setCsvContacts(updater);
    }
  };

  // Selecionar / Desmarcar Todos
  const toggleSelectAll = (select: boolean) => {
    setActiveContactsList((prev) =>
      prev.map((c) => (c.valid ? { ...c, selected: select } : c))
    );
  };

  // Selecionar individual
  const toggleSelectOne = (index: number) => {
    setActiveContactsList((prev) =>
      prev.map((c, i) => (i === index ? { ...c, selected: !c.selected } : c))
    );
  };

  // Contatos que estão marcados para disparo
  const selectedContacts = useMemo(
    () => activeContactsList.filter((c) => c.selected && c.valid),
    [activeContactsList]
  );

  // Lote efetivo respeitando o Limite de Envios por Lote (se batchLimit > 0, limita aos N primeiros)
  const batchTargetContacts = useMemo(() => {
    if (batchLimit > 0 && selectedContacts.length > batchLimit) {
      return selectedContacts.slice(0, batchLimit);
    }
    return selectedContacts;
  }, [selectedContacts, batchLimit]);

  // Validação de Horário Comercial (08:30 às 19:30)
  const isCommercialHours = useMemo(() => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentMins = hours * 60 + minutes;
    const startMins = 8 * 60 + 30; // 08:30
    const endMins = 19 * 60 + 30; // 19:30
    return currentMins >= startMins && currentMins <= endMins;
  }, []);

  // Substituição de variáveis no texto da mensagem
  const renderMessageText = (template: string, contactName: string): string => {
    return template
      .replace(/{{nome}}/gi, contactName || (isTourism ? 'Viajante' : 'Paciente'))
      .replace(/{{doutor}}/gi, activeTenant.doctorName || (isTourism ? 'Consultor de Viagens' : 'Dr. Responsável'))
      .replace(/{{clinica}}/gi, activeTenant.name || (isTourism ? 'ESVC Turismo' : 'Clínica'))
      .replace(/{{agencia}}/gi, activeTenant.name || 'ESVC Turismo')
      .replace(/{{destino}}/gi, 'seu próximo destino');
  };

  // Disparo Avulso / Individual de Teste Imediato
  const handleSendAvulso = async () => {
    if (!avulsoPhone.trim()) {
      onToast?.('Informe o número de telefone WhatsApp com DDD.', 'warning');
      return;
    }
    const { clean, valid } = sanitizePhone(avulsoPhone);
    if (!valid) {
      onToast?.('Telefone inválido. Utilize formato: (DD) 9XXXX-XXXX com DDI 55.', 'error');
      return;
    }
    if (!selectedInstance) {
      onToast?.('Selecione uma instância do WhatsApp para envio.', 'warning');
      return;
    }

    setSendingAvulso(true);
    const destName = avulsoName.trim() || (isTourism ? 'Viajante' : 'Cliente Teste');
    const personalizedText = renderMessageText(messageTemplate, destName);

    try {
      const sendRes = await sendWhatsApp(selectedInstance, clean, personalizedText);
      if (sendRes.ok) {
        onToast?.(`🚀 Mensagem avulsa enviada com sucesso para ${clean}!`, 'success');
        setExecutionLogs((prev) => [
          {
            id: `avulso-${Date.now()}`,
            time: new Date().toLocaleTimeString(),
            name: `${destName} (Avulso)`,
            phone: clean,
            status: 'success',
          },
          ...prev,
        ]);
      } else {
        const errMsg = sendRes.error || 'Erro no envio da Evolution API';
        onToast?.(`Falha no envio avulso: ${errMsg}`, 'error');
        setExecutionLogs((prev) => [
          {
            id: `avulso-${Date.now()}`,
            time: new Date().toLocaleTimeString(),
            name: `${destName} (Avulso)`,
            phone: clean,
            status: 'failed',
            message: errMsg,
          },
          ...prev,
        ]);
      }
    } catch (err) {
      onToast?.(`Erro no disparo avulso: ${String(err)}`, 'error');
    } finally {
      setSendingAvulso(false);
    }
  };

  // Preview com o primeiro contato selecionado ou exemplo
  const sampleName = batchTargetContacts[0]?.name || selectedContacts[0]?.name || (isTourism ? 'Mariana Silva' : 'Maria Silva');
  const previewText = renderMessageText(messageTemplate, sampleName);

  // Delays anti-ban com jitter
  const getNextDelaySeconds = (): number => {
    if (antiBanMode === 'turbo_teste') {
      return Math.floor(Math.random() * (10 - 5 + 1)) + 5; // 5s a 10s
    }
    if (antiBanMode === 'moderado') {
      return Math.floor(Math.random() * (45 - 25 + 1)) + 25; // 25s a 45s
    }
    // Seguro (45s a 75s)
    return Math.floor(Math.random() * (75 - 45 + 1)) + 45;
  };

  // Helper de sleep que respeita pausa e cancelamento
  const sleepWithCountdown = async (seconds: number): Promise<boolean> => {
    let remaining = seconds;
    while (remaining > 0) {
      if (abortControllerRef.current) return false;
      while (isPausedRef.current) {
        if (abortControllerRef.current) return false;
        await new Promise((r) => setTimeout(r, 500));
      }
      setCountdown(remaining);
      await new Promise((r) => setTimeout(r, 1000));
      remaining -= 1;
    }
    setCountdown(0);
    return true;
  };

  // 4. Execução da Campanha
  const handleStartCampaign = async () => {
    if (batchTargetContacts.length === 0) {
      onToast?.('Selecione pelo menos um contato válido para iniciar.', 'warning');
      return;
    }

    if (!selectedInstance) {
      onToast?.('Selecione uma instância do WhatsApp para envio.', 'warning');
      return;
    }

    if (!isCommercialHours && !bypassTimeLock) {
      onToast?.(
        'Trava Anti-Ban Ativa: Disparos são bloqueados fora do horário comercial (08:30 - 19:30). Ative o override se for teste.',
        'error'
      );
      return;
    }

    // Confirmação
    const isBatchLimited = batchLimit > 0 && selectedContacts.length > batchLimit;
    const confirmText = isBatchLimited
      ? `Deseja iniciar o disparo do lote seguro de ${batchTargetContacts.length} contatos (de ${selectedContacts.length} selecionados) usando a instância "${selectedInstance}" no modo ${antiBanMode.toUpperCase()}?`
      : `Deseja iniciar o disparo para ${batchTargetContacts.length} contatos usando a instância "${selectedInstance}" no modo ${antiBanMode.toUpperCase()}?`;
    if (!window.confirm(confirmText)) return;

    abortControllerRef.current = false;
    isPausedRef.current = false;
    isRunningRef.current = true;
    setCampaignStatus('running');
    onToast?.(`🚀 Lote de Reativação iniciado (${batchTargetContacts.length} contatos)!`, 'success');

    // Executa contatos do lote selecionado
    for (let i = 0; i < batchTargetContacts.length; i++) {
      if (abortControllerRef.current) break;

      while (isPausedRef.current) {
        if (abortControllerRef.current) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      if (abortControllerRef.current) break;

      setCurrentIndex(i + 1);
      const contact = batchTargetContacts[i];

      // Atualiza status do contato para sending
      setActiveContactsList((prev) =>
        prev.map((c) =>
          c.cleanPhone === contact.cleanPhone ? { ...c, status: 'sending' } : c
        )
      );

      const personalizedText = renderMessageText(messageTemplate, contact.name);

      try {
        // Envio via Evolution API
        const sendRes = await sendWhatsApp(selectedInstance, contact.cleanPhone, personalizedText);

        if (sendRes.ok) {
          const nowIso = new Date().toISOString();
          // Se for lead existente, insere a mensagem e atualiza last_interaction e last_campaign_at
          if (contact.id) {
            await sendMessage(
              contact.id,
              activeTenant.id,
              personalizedText,
              'ai',
              activeTenant.aiEngine.personaName
            );
            // Blindagem anti-duplicação: grava data do último envio de campanha
            await supabase
              .from('leads')
              .update({
                last_campaign_at: nowIso,
                last_interaction: nowIso,
              })
              .eq('id', contact.id);
          } else {
            // Se veio do CSV, cria o lead no CRM para persistir histórico e grava last_campaign_at
            try {
              const created = await createLead({
                tenantId: activeTenant.id,
                name: contact.name,
                phone: contact.cleanPhone,
                mainComplaint: 'Reativação via Campanha CSV',
              });
              if (created?.id) {
                await sendMessage(
                  created.id,
                  activeTenant.id,
                  personalizedText,
                  'ai',
                  activeTenant.aiEngine.personaName
                );
                await supabase
                  .from('leads')
                  .update({
                    last_campaign_at: nowIso,
                    last_interaction: nowIso,
                  })
                  .eq('id', created.id);
              }
            } catch (leadErr) {
              console.warn('Falha ao registrar novo lead do CSV no banco:', leadErr);
            }
          }

          // Atualiza status para success
          setActiveContactsList((prev) =>
            prev.map((c) =>
              c.cleanPhone === contact.cleanPhone ? { ...c, status: 'success' } : c
            )
          );

          setExecutionLogs((prev) => [
            {
              id: `${Date.now()}-${i}`,
              time: new Date().toLocaleTimeString(),
              name: contact.name,
              phone: contact.cleanPhone,
              status: 'success',
            },
            ...prev,
          ]);
        } else {
          // Falha no envio
          const errMsg = sendRes.error || 'Erro no envio da Evolution API';
          setActiveContactsList((prev) =>
            prev.map((c) =>
              c.cleanPhone === contact.cleanPhone ? { ...c, status: 'failed', error: errMsg } : c
            )
          );

          setExecutionLogs((prev) => [
            {
              id: `${Date.now()}-${i}`,
              time: new Date().toLocaleTimeString(),
              name: contact.name,
              phone: contact.cleanPhone,
              status: 'failed',
              message: errMsg,
            },
            ...prev,
          ]);
        }
      } catch (err) {
        const errMsg = String(err);
        setActiveContactsList((prev) =>
          prev.map((c) =>
            c.cleanPhone === contact.cleanPhone ? { ...c, status: 'failed', error: errMsg } : c
          )
        );
        setExecutionLogs((prev) => [
          {
            id: `${Date.now()}-${i}`,
            time: new Date().toLocaleTimeString(),
            name: contact.name,
            phone: contact.cleanPhone,
            status: 'failed',
            message: errMsg,
          },
          ...prev,
        ]);
      }

      // Se não for o último contato, aguarda o delay anti-ban
      if (i < selectedContacts.length - 1 && !abortControllerRef.current) {
        const delay = getNextDelaySeconds();
        const finishedDelay = await sleepWithCountdown(delay);
        if (!finishedDelay) break;
      }
    }

    isRunningRef.current = false;
    setCountdown(0);

    if (abortControllerRef.current) {
      setCampaignStatus('stopped');
      onToast?.('Campanha cancelada pelo usuário.', 'info');
    } else {
      setCampaignStatus('completed');
      onToast?.('🎉 Campanha finalizada com sucesso!', 'success');
      // Recarrega contatos inativos para refletir a blindagem anti-duplicação de 30 dias
      loadCrmInactives(inactivityFilter);
    }
  };

  const handlePauseCampaign = () => {
    isPausedRef.current = true;
    setCampaignStatus('paused');
    onToast?.('Campanha pausada.', 'info');
  };

  const handleResumeCampaign = () => {
    isPausedRef.current = false;
    setCampaignStatus('running');
    onToast?.('Campanha retomada.', 'info');
  };

  const handleStopCampaign = () => {
    if (window.confirm('Tem certeza que deseja cancelar a campanha em andamento?')) {
      abortControllerRef.current = true;
      isPausedRef.current = false;
      setCampaignStatus('stopped');
      setCountdown(0);
    }
  };

  // Métricas do painel
  const totalCount = selectedContacts.length;
  const sentCount = activeContactsList.filter((c) => c.status === 'success').length;
  const failedCount = activeContactsList.filter((c) => c.status === 'failed').length;
  const progressPercent = totalCount > 0 ? Math.round((currentIndex / totalCount) * 100) : 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-y-auto p-4 sm:p-6 space-y-6">
      {/* 1. Header com Branding Anti-Ban */}
      <div className="pb-4 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-600 to-amber-600 flex items-center justify-center shadow-lg shadow-rose-950/40 shrink-0">
            <Rocket className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-white tracking-tight">
                Campanhas & Reativação de Base Fria
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/40">
                PROSPECTOR ENGINE
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Reengajamento em massa com controle anti-ban, delays inteligentes com jitter e respeito à janela comercial.
            </p>
          </div>
        </div>

        {/* Status de Horário Comercial */}
        <div className="flex items-center gap-2">
          <div
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
              isCommercialHours
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-950/50 border-amber-500/40 text-amber-300'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>
              {isCommercialHours
                ? 'Horário Comercial Ativo (08:30 - 19:30)'
                : 'Fora do Horário Seguro (08:30 - 19:30)'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Grid de Configuração & Audiência */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Lado Esquerdo: Audiência & Filtros (7 colunas) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Aba de Seleção de Origem */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Users className="w-4 h-4 text-sky-400" />
                1. Audiência & Segmentação
              </span>

              <div className="flex items-center gap-2">
                {/* Botão de Sincronização da Base */}
                <button
                  type="button"
                  disabled={syncingContacts}
                  onClick={handleSyncWhatsAppContacts}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Buscar e deduplicar todas as conversas do WhatsApp da clínica"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingContacts ? 'animate-spin' : ''}`} />
                  {syncingContacts ? 'Sincronizando...' : '🔄 Sincronizar Contatos do WhatsApp'}
                </button>

                {/* Botões de Alternância */}
                <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setAudienceTab('crm')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      audienceTab === 'crm'
                        ? 'bg-sky-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Base CRM
                  </button>
                  <button
                    type="button"
                    onClick={() => setAudienceTab('csv')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      audienceTab === 'csv'
                        ? 'bg-sky-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Planilha CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setAudienceTab('avulso')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      audienceTab === 'avulso'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    ⚡ Envio Avulso
                  </button>
                </div>
              </div>
            </div>

            {/* Conteúdo Aba CRM */}
            {audienceTab === 'crm' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-400 mr-1 flex items-center gap-1">
                    <Filter className="w-3.5 h-3.5" /> Filtro Rápido:
                  </span>
                  <button
                    type="button"
                    onClick={() => setInactivityFilter('all_base')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                      inactivityFilter === 'all_base'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    Toda a Base (Geral)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInactivityFilter('15d')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      inactivityFilter === '15d'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    +15 dias sem contato
                  </button>
                  <button
                    type="button"
                    onClick={() => setInactivityFilter('30d')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      inactivityFilter === '30d'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    +30 dias sem contato
                  </button>
                  <button
                    type="button"
                    onClick={() => setInactivityFilter('60_90d')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      inactivityFilter === '60_90d'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    60 a 90 dias
                  </button>
                  <button
                    type="button"
                    onClick={() => setInactivityFilter('all_inactives')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      inactivityFilter === 'all_inactives'
                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    Todos Inativos (&gt;7d)
                  </button>
                </div>

                {/* Filtro por Etapa do Kanban */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
                  <span className="text-xs text-slate-400 mr-1 flex items-center gap-1">
                    <Sliders className="w-3.5 h-3.5 text-sky-400" /> Filtrar por Etapa do Kanban:
                  </span>
                  <select
                    value={stageFilter}
                    onChange={(e) => setStageFilter(e.target.value)}
                    className="bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-sky-500 cursor-pointer"
                  >
                    <option value="all">Todas as Etapas ({crmContacts.length})</option>
                    {isTourism ? (
                      <>
                        <option value="novo_lead">1. Novo Lead</option>
                        <option value="em_atendimento">2. Em Atendimento</option>
                        <option value="cotacao_enviada">3. Cotação Enviada</option>
                        <option value="falar_pessoalmente">4. Em Negociação</option>
                        <option value="contratou">5. Fechou / Vendido</option>
                        <option value="paciente_recorrente">6. Pós-Viagem & Fidelização</option>
                      </>
                    ) : (
                      <>
                        <option value="iniciou_conversa">1. Novo Contato</option>
                        <option value="em_atendimento">2. Em Atendimento (IA)</option>
                        <option value="falar_pessoalmente">3. Falar Pessoalmente</option>
                        <option value="consulta_agendada">4. Agendou</option>
                        <option value="consulta_realizada">5. Compareceu</option>
                        <option value="contratou">6. Fechou / Tratamento</option>
                        <option value="paciente_recorrente">7. Paciente Recorrente</option>
                      </>
                    )}
                  </select>
                  {stageFilter !== 'all' && (
                    <span className="text-[11px] text-sky-400 font-semibold">
                      Filtrado: {filteredCrmContacts.length} {isTourism ? 'viajantes' : 'pacientes'}
                    </span>
                  )}
                </div>

                {/* Blindagem Anti-Duplicação 30 dias */}
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                  <label htmlFor="anti-dup-toggle" className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      id="anti-dup-toggle"
                      checked={antiDuplication30d}
                      onChange={(e) => setAntiDuplication30d(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-0 cursor-pointer"
                    />
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-xs font-bold text-white">Blindagem Anti-Duplicação (30 dias)</span>
                    </div>
                  </label>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-extrabold uppercase border ${
                    antiDuplication30d
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    {antiDuplication30d ? 'Ativa: Sem Repetição' : 'Desativada'}
                  </span>
                </div>
              </div>
            )}

            {/* Conteúdo Aba CSV */}
            {audienceTab === 'csv' && (
              <div className="space-y-3">
                <label className="border-2 border-dashed border-slate-700 hover:border-sky-500/60 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition-colors bg-slate-950/60">
                  <Upload className="w-8 h-8 text-sky-400 mb-2" />
                  <span className="text-xs font-bold text-white">
                    {csvFileName ? `Arquivo: ${csvFileName}` : 'Clique para selecionar planilha Excel (.xlsx, .xls) ou CSV'}
                  </span>
                  <span className="text-[10px] text-slate-400 mt-1">
                    Colunas esperadas: <strong>nome, telefone</strong> (Excel, vírgula ou ponto-e-vírgula). Sanitização com DDI 55 automática.
                  </span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.txt"
                    onChange={handleCsvUpload}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {/* Conteúdo Aba Envio Avulso (Disparo de Teste) */}
            {audienceTab === 'avulso' && (
              <div className="space-y-4 p-4 rounded-xl bg-slate-950/80 border border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <Send className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Disparo Avulso Imediato (Envio de Teste)</h4>
                    <p className="text-[11px] text-slate-400">
                      Envie a mensagem configurada abaixo para um contato individual imediatamente, sem aguardar fila nem travas de horário.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Telefone WhatsApp com DDD *
                    </label>
                    <input
                      type="text"
                      value={avulsoPhone}
                      onChange={(e) => setAvulsoPhone(e.target.value)}
                      placeholder="Ex: 5584999887766 ou (84) 99988-7766"
                      className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-3 py-2 focus:ring-1 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Nome do Destinatário (para tag &#123;&#123;nome&#125;&#125;)
                    </label>
                    <input
                      type="text"
                      value={avulsoName}
                      onChange={(e) => setAvulsoName(e.target.value)}
                      placeholder={isTourism ? "Ex: Mariana Viajante" : "Ex: Mariana Paciente"}
                      className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-xl px-3 py-2 focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-t border-slate-800/60">
                  <span className="text-[11px] text-slate-400">
                    Instância WhatsApp selecionada: <strong className="text-emerald-400">{selectedInstance || 'Nenhuma'}</strong>
                  </span>
                  <button
                    type="button"
                    disabled={sendingAvulso || !avulsoPhone.trim()}
                    onClick={handleSendAvulso}
                    className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-950/40 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Rocket className={`w-3.5 h-3.5 ${sendingAvulso ? 'animate-spin' : ''}`} />
                    <span>{sendingAvulso ? 'Disparando...' : '🚀 Disparar Teste Agora'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Barra de Ações da Lista */}
            {audienceTab !== 'avulso' && (
              <div className="flex items-center justify-between text-xs pt-2 text-slate-400 border-t border-slate-800/80">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(true)}
                    className="text-sky-400 hover:underline font-semibold cursor-pointer"
                  >
                    Marcar Todos
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(false)}
                    className="text-slate-400 hover:underline cursor-pointer"
                  >
                    Desmarcar
                  </button>
                </div>

                <span className="font-bold text-slate-200">
                  {selectedContacts.length} de {activeContactsList.length} contatos selecionados
                </span>
              </div>
            )}

            {/* Tabela de Contatos */}
            {audienceTab !== 'avulso' && (
              <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 divide-y divide-slate-850">
                {loadingCrm ? (
                  <div className="p-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                    Carregando contatos inativos do Supabase...
                  </div>
                ) : activeContactsList.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <h4 className="text-xs font-bold text-white">
                      {isTourism
                        ? 'Nenhum viajante inativo encontrado para este filtro na sua agência.'
                        : 'Nenhum paciente inativo encontrado para este período na sua clínica.'}
                    </h4>
                    <p className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed">
                      {audienceTab === 'crm' ? (
                        <>
                          {isTourism
                            ? 'Todos os contatos da sua agência interagiram recentemente ou já receberam campanhas nos últimos 30 dias (Blindagem Anti-Duplicação ativa).'
                            : 'Todos os pacientes da sua clínica interagiram recentemente ou já receberam campanhas nos últimos 30 dias (Blindagem Anti-Duplicação ativa). Sua base está aquecida!'}
                        </>
                      ) : (
                        'Nenhum contato válido encontrado no arquivo CSV importado.'
                      )}
                    </p>
                  </div>
                ) : (
                  activeContactsList.map((contact, idx) => (
                    <div
                      key={`${contact.phone}-${idx}`}
                      className={`px-3 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-900/60 transition-colors ${
                        contact.status === 'success'
                          ? 'bg-emerald-950/20'
                          : contact.status === 'failed'
                          ? 'bg-rose-950/20'
                          : ''
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={contact.selected}
                          disabled={!contact.valid || campaignStatus === 'running'}
                          onChange={() => toggleSelectOne(idx)}
                          className="rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-0 cursor-pointer disabled:opacity-40"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white truncate max-w-[140px] sm:max-w-[200px]">
                              {contact.name}
                            </span>
                            {!contact.valid && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-950 text-rose-400 border border-rose-800 font-bold">
                                Inválido
                              </span>
                            )}
                            {contact.daysInactive !== undefined && (
                              <span className="text-[10px] text-slate-400">
                                ({contact.daysInactive}d sem msg)
                              </span>
                            )}
                          </div>
                          <span className="text-slate-400 font-mono text-[11px]">
                            {contact.cleanPhone || contact.phone}
                          </span>
                        </div>
                      </div>

                      {/* Status Badge */}
                      <div className="shrink-0">
                        {contact.status === 'pending' && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                            Pendente
                          </span>
                        )}
                        {contact.status === 'sending' && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800 flex items-center gap-1 font-bold animate-pulse">
                            <Send className="w-2.5 h-2.5 animate-spin" /> Enviando
                          </span>
                        )}
                        {contact.status === 'success' && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-400" /> Enviado
                          </span>
                        )}
                        {contact.status === 'failed' && (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 font-bold flex items-center gap-1 cursor-help"
                            title={contact.error}
                          >
                            <X className="w-3 h-3 text-rose-400" /> Erro
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Bloco de Mensagem & Variáveis */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                2. Mensagem da Campanha & Personalização
              </span>

              {/* Inserir variáveis rápidas */}
              <div className="flex items-center gap-1 text-[11px]">
                {isTourism ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setMessageTemplate((t) => `${t} {{nome}}`)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 font-mono transition-colors cursor-pointer"
                      title="Insere o primeiro nome do viajante"
                    >
                      + &#123;&#123;nome&#125;&#125;
                    </button>
                    <button
                      type="button"
                      onClick={() => setMessageTemplate((t) => `${t} {{agencia}}`)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 font-mono transition-colors cursor-pointer"
                      title="Insere o nome da agência (ESVC Turismo)"
                    >
                      + &#123;&#123;agencia&#125;&#125;
                    </button>
                    <button
                      type="button"
                      onClick={() => setMessageTemplate((t) => `${t} {{destino}}`)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-mono transition-colors cursor-pointer"
                      title="Insere o destino do viajante"
                    >
                      + &#123;&#123;destino&#125;&#125;
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setMessageTemplate((t) => `${t} {{nome}}`)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 font-mono transition-colors cursor-pointer"
                      title="Insere o primeiro nome do contato"
                    >
                      + &#123;&#123;nome&#125;&#125;
                    </button>
                    <button
                      type="button"
                      onClick={() => setMessageTemplate((t) => `${t} {{doutor}}`)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 font-mono transition-colors cursor-pointer"
                    >
                      + &#123;&#123;doutor&#125;&#125;
                    </button>
                    <button
                      type="button"
                      onClick={() => setMessageTemplate((t) => `${t} {{clinica}}`)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 font-mono transition-colors cursor-pointer"
                    >
                      + &#123;&#123;clinica&#125;&#125;
                    </button>
                  </>
                )}
              </div>
            </div>

            <textarea
              rows={5}
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              disabled={campaignStatus === 'running'}
              placeholder="Digite o texto de abordagem... Use {{nome}} para personalizar."
              className="w-full bg-slate-950 border border-slate-800 text-slate-100 rounded-xl p-3 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-sky-500 font-sans"
            />

            {/* Presets Rápidos de Mensagem */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] text-slate-500 font-medium">Modelos prontos:</span>
              {isTourism ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setMessageTemplate(
                        'Olá, {{nome}}! Tudo bem? Aqui é da equipe da ESVC Turismo. Estamos selecionando ofertas especiais de viagens e passagens para a próxima temporada. Você tem planos de viajar nos próximos meses?'
                      )
                    }
                    className="text-[10px] px-2 py-1 rounded bg-slate-800/80 text-emerald-300 hover:text-white hover:bg-slate-750 transition-colors cursor-pointer"
                  >
                    ✈️ Pacotes em Promoção
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setMessageTemplate(
                        'Oi {{nome}}! Pensando nas próximas férias em família? A ESVC Turismo preparou pacotes exclusivos com resorts all-inclusive e condições facilitadas. Quer dar uma olhada nas opções para o seu destino preferido?'
                      )
                    }
                    className="text-[10px] px-2 py-1 rounded bg-slate-800/80 text-sky-300 hover:text-white hover:bg-slate-750 transition-colors cursor-pointer"
                  >
                    🏖️ Férias em Família
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setMessageTemplate(
                        'Olá, {{nome}}! Aqui é da ESVC Turismo. Está precisando de cotação para passagens aéreas, hotéis ou pacotes completos? Me diga as datas e o destino que preparo uma proposta personalizada para você!'
                      )
                    }
                    className="text-[10px] px-2 py-1 rounded bg-slate-800/80 text-amber-300 hover:text-white hover:bg-slate-750 transition-colors cursor-pointer"
                  >
                    🌍 Cotação Rápida
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setMessageTemplate(
                        'Olá, {{nome}}! Tudo bem? Aqui é da equipe do {{doutor}} na {{clinica}}.\n\nIdentificamos que já faz um tempinho desde a sua última consulta. Como você tem passado? Gostaria de verificar os horários disponíveis para o seu retorno nesta semana?'
                      )
                    }
                    className="text-[10px] px-2 py-1 rounded bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-750 transition-colors cursor-pointer"
                  >
                    🏥 Retorno Clínico
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setMessageTemplate(
                        'Oi {{nome}}! Passando para te avisar que o {{doutor}} abriu novos horários na grade desta semana na {{clinica}}. Se ainda tiver interesse em agendar seu atendimento, posso te reservar uma vaga prioritária. 😊'
                      )
                    }
                    className="text-[10px] px-2 py-1 rounded bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-750 transition-colors cursor-pointer"
                  >
                    📅 Novos Horários
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setMessageTemplate(
                        'Olá {{nome}}! Passando para checar como estão seus cuidados com a saúde. Se precisar de uma nova receita, acompanhamento ou avaliação com o {{doutor}}, estamos à total disposição aqui na {{clinica}}! 🩺'
                      )
                    }
                    className="text-[10px] px-2 py-1 rounded bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-750 transition-colors cursor-pointer"
                  >
                    💊 Receitas & Cuidado
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Lado Direito: Anti-Ban, Preview & Controle de Execução (5 colunas) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Configuração Anti-Ban */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2 pb-2 border-b border-slate-800">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              3. Parâmetros Anti-Ban (Prospector)
            </span>

            {/* Seletor de Instância Evolution com Blindagem Multi-tenant */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">
                  {isTourism
                    ? 'Instância WhatsApp (Exclusiva da Agência)'
                    : 'Instância WhatsApp (Exclusiva da Clínica)'}
                </label>
                <span className="text-[10px] text-emerald-400 font-medium">
                  {isTourism ? 'ESVC Turismo' : (activeTenant.name.includes('Matheus') ? 'Clínica Dr. Matheus' : activeTenant.name)}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full">
                <select
                  value={selectedInstance}
                  disabled={campaignStatus === 'running'}
                  onChange={(e) => setSelectedInstance(e.target.value)}
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-800 text-white text-xs rounded-xl p-2.5 focus:ring-1 focus:ring-sky-500 focus:outline-none cursor-pointer truncate"
                >
                  {evolutionInstances.map((inst) => {
                    const isPrimary =
                      inst.name.toLowerCase() ===
                      (activeTenant.whatsappInstance.sessionName || '').toLowerCase();
                    const isOnline =
                      inst.connectionStatus === 'open' || inst.connectionStatus === 'connected';

                    return (
                      <option key={inst.name} value={inst.name}>
                        {isPrimary ? '⭐ [Principal] ' : '🚀 [Disparo] '}
                        {inst.name} ({isOnline ? '🟢 Conectada' : '⚪ Não conectada'})
                        {inst.number ? ` — ${inst.number}` : ''}
                      </option>
                    );
                  })}
                </select>

                <button
                  type="button"
                  id="btn-conectar-chip-disparo"
                  disabled={campaignStatus === 'running'}
                  onClick={() => {
                    setShowQrModal(true);
                    setQrTargetInstance(defaultCampaignInstanceName);
                    setQrStatus({ kind: 'idle' });
                  }}
                  className="px-3.5 py-2.5 bg-gradient-to-r from-sky-600 via-indigo-600 to-violet-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-sky-950/40 shrink-0 transition-all cursor-pointer border border-sky-400/30 whitespace-nowrap"
                  title="Conectar novo chip secundário de WhatsApp exclusivo para campanhas do tenant"
                >
                  <Plus className="w-4 h-4 text-sky-200" />
                  <span>+ Conectar Chip de Disparo</span>
                </button>
              </div>
            </div>

            {/* Modo Anti-Ban (Delays com Jitter) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Intervalo Anti-Ban (Delay com Jitter)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={campaignStatus === 'running'}
                  onClick={() => setAntiBanMode('seguro')}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    antiBanMode === 'seguro'
                      ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-300 shadow'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="text-xs font-bold">🛡️ Modo Seguro</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">45s a 75s (Recomendado)</div>
                </button>

                <button
                  type="button"
                  disabled={campaignStatus === 'running'}
                  onClick={() => setAntiBanMode('moderado')}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    antiBanMode === 'moderado'
                      ? 'bg-amber-950/40 border-amber-500/60 text-amber-300 shadow'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="text-xs font-bold">⚡ Moderado</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">25s a 45s</div>
                </button>
              </div>
            </div>

            {/* Limite de Envios por Lote (Hoje) */}
            <div className="space-y-2 p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-amber-400" />
                  <span>Limite de Envios por Lote</span>
                </label>
                <span className="text-[10px] font-bold text-amber-300">
                  {batchLimit > 0 ? `${batchLimit} contatos máx.` : 'Todos selecionados'}
                </span>
              </div>

              <div className="flex items-center gap-2 pt-0.5">
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={batchLimit || ''}
                  onChange={(e) => setBatchLimit(Math.max(0, parseInt(e.target.value) || 0))}
                  disabled={campaignStatus === 'running'}
                  className="w-20 bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-2.5 py-1.5 focus:ring-1 focus:ring-amber-500 font-mono"
                  placeholder="Todos"
                />

                <div className="flex items-center gap-1">
                  {[10, 20, 50].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setBatchLimit(num)}
                      disabled={campaignStatus === 'running'}
                      className={`px-2 py-1 rounded text-[11px] font-bold border transition-colors cursor-pointer ${
                        batchLimit === num
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setBatchLimit(0)}
                    disabled={campaignStatus === 'running'}
                    className={`px-2 py-1 rounded text-[11px] font-bold border transition-colors cursor-pointer ${
                      batchLimit === 0
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    Todos
                  </button>
                </div>
              </div>

              <p className="text-[10px] text-slate-400">
                {batchLimit > 0 && selectedContacts.length > batchLimit
                  ? `Processa apenas os primeiros ${batchLimit} de ${selectedContacts.length} contatos. Os ${selectedContacts.length - batchLimit} restantes ficam blindados para os próximos dias.`
                  : `Todos os ${selectedContacts.length} contatos válidos serão processados neste lote.`}
              </p>
            </div>

            {/* Override Horário Comercial */}
            {!isCommercialHours && (
              <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-600/40 text-amber-300 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Trava Anti-Ban Noturna Ativa</span>
                </div>
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  Disparos fora das 08:30 às 19:30 têm risco elevado de bloqueio no WhatsApp por denúncia.
                </p>
                <label className="flex items-center gap-2 font-medium cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={bypassTimeLock}
                    onChange={(e) => setBypassTimeLock(e.target.checked)}
                    className="rounded border-amber-700 text-amber-600 bg-slate-900 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-[11px]">Ignorar trava de horário (Modo Teste do Operador)</span>
                </label>
              </div>
            )}
          </div>

          {/* Preview WhatsApp em Tempo Real */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-sky-400" />
              Preview WhatsApp (Tempo Real)
            </span>

            {/* Balão WhatsApp */}
            <div className="p-4 rounded-xl bg-[#0b141a] border border-[#222e35] shadow-inner">
              <div className="flex justify-end">
                <div className="max-w-[88%] bg-[#005c4b] text-[#e9edef] rounded-lg rounded-tr-none px-3 py-2 text-xs shadow-md space-y-1 relative">
                  <p className="whitespace-pre-line leading-relaxed font-sans text-xs">
                    {previewText}
                  </p>
                  <div className="flex items-center justify-end gap-1 text-[10px] text-[#8696a0]">
                    <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="text-[#53bdeb]">✓✓</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Motor de Execução & Fila */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4 shadow-lg">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="flex items-center gap-2">
                <Rocket className="w-4 h-4 text-rose-400" />
                4. Motor de Disparo
              </span>
              <span className="text-[10px] font-bold text-slate-400">
                {campaignStatus === 'idle' && 'Aguardando Início'}
                {campaignStatus === 'running' && 'Em Andamento'}
                {campaignStatus === 'paused' && 'Pausado'}
                {campaignStatus === 'completed' && 'Concluído'}
                {campaignStatus === 'stopped' && 'Cancelado'}
              </span>
            </span>

            {/* Painel de Métricas */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">Alvo do Lote</div>
                <div className="text-lg font-black text-white">{totalCount}</div>
                {batchLimit > 0 && selectedContacts.length > batchLimit && (
                  <div className="text-[9px] text-amber-400 font-bold">de {selectedContacts.length} na fila</div>
                )}
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-emerald-400">Enviados</div>
                <div className="text-lg font-black text-emerald-400">{sentCount}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-rose-400">Falhas</div>
                <div className="text-lg font-black text-rose-400">{failedCount}</div>
              </div>
            </div>

            {/* Barra de Progresso */}
            {campaignStatus !== 'idle' && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-bold text-slate-300">
                  <span>
                    Progresso: {currentIndex} / {totalCount}
                  </span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 via-rose-500 to-emerald-500 transition-all duration-300 rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {countdown > 0 && campaignStatus === 'running' && (
                  <div className="text-center text-xs text-amber-300 font-semibold animate-pulse flex items-center justify-center gap-1.5 pt-1">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Próximo envio em {countdown}s (Anti-Ban Jitter)...</span>
                  </div>
                )}
              </div>
            )}

            {/* Botões de Ação */}
            <div className="flex items-center gap-2">
              {campaignStatus === 'idle' || campaignStatus === 'completed' || campaignStatus === 'stopped' ? (
                <button
                  type="button"
                  onClick={handleStartCampaign}
                  disabled={totalCount === 0}
                  className="w-full py-3 bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white text-xs font-extrabold rounded-xl shadow-lg shadow-rose-950/40 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Rocket className="w-4 h-4" />
                  <span>🚀 Iniciar Lote de Reativação ({totalCount} contatos)</span>
                </button>
              ) : (
                <>
                  {campaignStatus === 'running' ? (
                    <button
                      type="button"
                      onClick={handlePauseCampaign}
                      className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Pause className="w-4 h-4" />
                      <span>Pausar</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResumeCampaign}
                      className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Play className="w-4 h-4" />
                      <span>Retomar</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleStopCampaign}
                    className="px-4 py-3 bg-rose-900/60 hover:bg-rose-800 text-rose-200 border border-rose-700/60 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Square className="w-4 h-4" />
                    <span>Cancelar</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 5. Painel de Log em Tempo Real */}
      {executionLogs.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-400" />
            Histórico de Disparos da Sessão
          </span>
          <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 divide-y divide-slate-850 font-mono text-[11px]">
            {executionLogs.map((log) => (
              <div key={log.id} className="p-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-500 shrink-0">{log.time}</span>
                  <span className="text-white font-sans font-semibold truncate">{log.name}</span>
                  <span className="text-slate-400 shrink-0">({log.phone})</span>
                </div>
                <div className="shrink-0 font-sans">
                  {log.status === 'success' ? (
                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" /> Enviado
                    </span>
                  ) : (
                    <span className="text-rose-400 font-bold flex items-center gap-1" title={log.message}>
                      <X className="w-3 h-3" /> {log.message || 'Falha'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. Modal de Pareamento de Chip Secundário (QR Code) */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 relative">
            {/* Header Modal */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-950/40 shrink-0">
                  <QrCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white tracking-tight">
                    Parear Chip Secundário de Campanhas
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Conecte um número exclusivo para proteger o WhatsApp principal da clínica contra bloqueios.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  stopQrPolling();
                  setShowQrModal(false);
                }}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Input Nome da Instância */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Nome da Instância de Disparo:</span>
                <span className="text-[10px] text-emerald-400 font-mono">Exclusivo do Tenant</span>
              </label>
              <input
                type="text"
                value={qrTargetInstance}
                disabled={qrStatus.kind === 'loading' || qrStatus.kind === 'waiting'}
                onChange={(e) => setQrTargetInstance(e.target.value)}
                placeholder="ex: cardio_matheus_campanhas"
                className="w-full bg-slate-950 border border-slate-800 text-white text-xs rounded-xl p-2.5 font-mono focus:ring-1 focus:ring-sky-500 focus:outline-none"
              />
            </div>

            {/* Estados de Pareamento */}
            {qrStatus.kind === 'idle' && (
              <div className="p-6 text-center space-y-4 bg-slate-950/60 rounded-xl border border-slate-800">
                <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center mx-auto">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-white">Pronto para gerar o QR Code</h4>
                  <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                    Ao clicar no botão abaixo, a Evolution API criará a sessão dedicada e exibirá o código para leitura com o celular secundário.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleStartPairing(qrTargetInstance)}
                  className="px-5 py-2.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-sky-950/50 inline-flex items-center gap-2 cursor-pointer transition-all"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Gerar QR Code de Conexão</span>
                </button>
              </div>
            )}

            {qrStatus.kind === 'loading' && (
              <div className="p-10 text-center space-y-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <RefreshCw className="w-8 h-8 text-sky-400 animate-spin mx-auto" />
                <h4 className="text-xs font-bold text-white">Provisionando instância na Evolution...</h4>
                <p className="text-[11px] text-slate-400">
                  Configurando webhooks e gerando novo QR Code de pareamento.
                </p>
              </div>
            )}

            {qrStatus.kind === 'waiting' && qrStatus.base64 && (
              <div className="space-y-4">
                <div className="p-4 bg-white rounded-2xl shadow-xl w-60 h-60 mx-auto flex items-center justify-center border-4 border-sky-500/30">
                  <img
                    src={qrStatus.base64}
                    alt="QR Code WhatsApp"
                    className="w-full h-full object-contain"
                  />
                </div>

                <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 text-xs space-y-2 text-slate-300">
                  <div className="font-bold text-white flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    <span>Como conectar no celular:</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 pl-1">
                    <li>Abra o WhatsApp no celular do chip de campanha</li>
                    <li>Vá em <strong>Configurações</strong> &gt; <strong>Aparelhos Conectados</strong></li>
                    <li>Toque em <strong>Conectar um Aparelho</strong> e aponte para este QR Code</li>
                  </ol>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                  <span className="flex items-center gap-1.5 text-sky-400 animate-pulse font-medium">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Verificando conexão automaticamente...
                  </span>
                  <button
                    type="button"
                    onClick={() => handleStartPairing(qrTargetInstance)}
                    className="text-slate-400 hover:text-white underline cursor-pointer"
                  >
                    Recarregar QR Code
                  </button>
                </div>
              </div>
            )}

            {qrStatus.kind === 'connected' && (
              <div className="p-8 text-center space-y-3 bg-emerald-950/20 rounded-xl border border-emerald-500/30">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-extrabold text-emerald-300">
                  Chip de Campanha Pareado com Sucesso! 🟢
                </h4>
                <p className="text-[11px] text-emerald-200/80 max-w-sm mx-auto">
                  A instância "{qrTargetInstance}" está conectada e foi selecionada automaticamente para os disparos anti-ban.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    stopQrPolling();
                    setShowQrModal(false);
                  }}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer mt-2"
                >
                  Concluir e Voltar
                </button>
              </div>
            )}

            {qrStatus.kind === 'error' && (
              <div className="p-6 text-center space-y-3 bg-rose-950/30 rounded-xl border border-rose-500/40 text-rose-300">
                <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
                <h4 className="text-xs font-bold text-white">Falha ao gerar QR Code</h4>
                <p className="text-[11px] text-rose-200/90 max-w-sm mx-auto leading-relaxed">
                  {qrStatus.message || 'Verifique se a Evolution API está acessível.'}
                </p>
                <button
                  type="button"
                  onClick={() => handleStartPairing(qrTargetInstance)}
                  className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Tentar Novamente
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
