import { PipelineStage, StageColumnInfo } from './types';

export const PIPELINE_STAGES: StageColumnInfo[] = [
  {
    id: 'iniciou_conversa',
    title: '1. Novo Contato',
    subtitle: 'Iniciou conversa — aguardando triagem',
    badgeBg: 'bg-sky-950/60',
    badgeText: 'text-sky-400 border-sky-800/60',
    borderHover: 'hover:border-sky-500/40',
  },
  {
    id: 'em_atendimento',
    title: '2. Em Atendimento',
    subtitle: 'Conversando / Qualificação',
    badgeBg: 'bg-emerald-950/60',
    badgeText: 'text-emerald-400 border-emerald-800/60',
    borderHover: 'hover:border-emerald-500/40',
  },
  {
    // Coluna KILL-SWITCH (msg 5608): arrastar card pra cá → stage='falar_pessoalmente'
    // + handoff_state='humano_assumiu' AUTOMATICAMENTE. IA silenciada.
    // Operador/a secretoira usa essa coluna pra desativar IA em números
    // pessoais e casos delicados (drags do KanbanBoard).
    id: 'falar_pessoalmente',
    title: '3. Falar Pessoalmente',
    subtitle: '🚨 Kill-switch — IA pausada, humano assumiu',
    badgeBg: 'bg-amber-950/60',
    badgeText: 'text-amber-400 border-amber-800/60',
    borderHover: 'hover:border-amber-500/40',
  },
  {
    id: 'consulta_agendada',
    title: '4. Agendou',
    subtitle: 'Consulta marcada / Slot confirmado',
    badgeBg: 'bg-teal-950/60',
    badgeText: 'text-teal-300 border-teal-800/60',
    borderHover: 'hover:border-teal-500/40',
  },
  {
    id: 'consulta_realizada',
    title: '5. Compareceu',
    subtitle: 'Consulta realizada',
    badgeBg: 'bg-indigo-950/60',
    badgeText: 'text-indigo-300 border-indigo-800/60',
    borderHover: 'hover:border-indigo-500/40',
  },
  {
    id: 'contratou',
    title: '6. Fechou / Contratou',
    subtitle: 'Fechou serviço / pagou',
    badgeBg: 'bg-emerald-900/40',
    badgeText: 'text-emerald-300 border-emerald-700/60',
    borderHover: 'hover:border-emerald-400/50',
  },
  {
    id: 'paciente_recorrente',
    title: '7. Cliente Recorrente',
    subtitle: 'Retorno / nova consulta agendada',
    badgeBg: 'bg-cyan-950/60',
    badgeText: 'text-cyan-300 border-cyan-800/60',
    borderHover: 'hover:border-cyan-500/40',
  },
  {
    id: 'cancelou',
    title: '8. Cancelou / Desistiu',
    subtitle: 'Desistência ou cancelamento',
    badgeBg: 'bg-slate-900',
    badgeText: 'text-slate-400 border-slate-700/60',
    borderHover: 'hover:border-slate-600/40',
  },
];

export const TURISMO_PIPELINE_STAGES: StageColumnInfo[] = [
  {
    id: 'novo_lead',
    title: '1. Novo Lead',
    subtitle: 'Entrada de interessados e importados da base',
    badgeBg: 'bg-sky-950/60',
    badgeText: 'text-sky-400 border-sky-800/60',
    borderHover: 'hover:border-sky-500/40',
  },
  {
    id: 'em_atendimento',
    title: '2. Em Atendimento',
    subtitle: 'Triagem de destino, datas e orçamento',
    badgeBg: 'bg-emerald-950/60',
    badgeText: 'text-emerald-400 border-emerald-800/60',
    borderHover: 'hover:border-emerald-500/40',
  },
  {
    id: 'cotacao_enviada',
    title: '3. Cotação Enviada',
    subtitle: 'Proposta entregue, aguardando resposta',
    badgeBg: 'bg-amber-950/60',
    badgeText: 'text-amber-400 border-amber-800/60',
    borderHover: 'hover:border-amber-500/40',
    hasAutomationGear: true,
    automationStageKey: 'cotacao',
  },
  {
    id: 'em_negociacao',
    title: '4. Em Negociação',
    subtitle: 'Ajustes de voos, hotéis e valores',
    badgeBg: 'bg-blue-950/60',
    badgeText: 'text-blue-400 border-blue-800/60',
    borderHover: 'hover:border-blue-500/40',
  },
  {
    id: 'fechou_vendido',
    title: '5. Fechou / Vendido',
    subtitle: 'Pacote fechado — armar viagens',
    badgeBg: 'bg-teal-950/60',
    badgeText: 'text-teal-300 border-teal-800/60',
    borderHover: 'hover:border-teal-500/40',
    hasAutomationGear: true,
    automationStageKey: 'viagem',
  },
  {
    id: 'pos_viagem',
    title: '6. Pós-Viagem & Fidelização',
    subtitle: 'Avaliação de retorno e recompra',
    badgeBg: 'bg-purple-950/60',
    badgeText: 'text-purple-300 border-purple-800/60',
    borderHover: 'hover:border-purple-500/40',
  },
];

export const QUICK_TEMPLATES = [
  {
    id: 'confirm_appointment',
    label: '📅 Confirmar Agendamento',
    text: 'Olá! Confirmamos sua consulta para os próximos dias em nossa clínica. Para agilizar seu check-in, por favor envie uma foto da carteirinha do convênio e de um documento com foto.',
  },
  {
    id: 'exam_prep',
    label: '📋 Preparo de Exames',
    text: 'Lembramos que para a realização do seu exame cardiológico/odontológico é recomendado: jejum leve de 2 horas e vestir roupas confortáveis. Qualquer dúvida estamos à disposição!',
  },
  {
    id: 'silence_followup',
    label: '⏰ Radar de Silêncio (Resgate)',
    text: 'Olá, tudo bem? Percebemos que não conseguimos concluir seu agendamento. Ainda tem interesse nos horários que reservamos para você? Restam apenas 2 vagas nesta semana.',
  },
  {
    id: 'pix_payment',
    label: '💳 Chave Pix / Pagamento Particular',
    text: 'Segue a chave Pix para confirmação da reserva da consulta particular: financeiro@clinicadeskcomm.med.br. Por favor, envie o comprovante por aqui assim que efetuar.',
  },
  {
    id: 'human_intervention',
    label: '👨‍⚕️ Intervenção Médica',
    text: 'Olá! Analisei os sintomas informados ao nosso assistente virtual e preparei um horário prioritário para avaliarmos seu caso presencialmente. Você pode comparecer hoje?',
  },
];

export const TURISMO_QUICK_TEMPLATES = [
  {
    id: 'confirm_booking',
    label: '✈️ Confirmar Reserva',
    text: 'Olá! Confirmamos sua reserva de viagem pela ESVC Turismo. Para agilizarmos a emissão dos vouchers e bilhetes, por favor envie uma foto do RG/CNH de todos os viajantes.',
  },
  {
    id: 'passenger_docs',
    label: '📄 Dados dos Passageiros',
    text: 'Para prosseguirmos com a emissão do seu pacote, precisamos dos seguintes dados de cada passageiro: Nome Completo (como no documento), CPF e Data de Nascimento.',
  },
  {
    id: 'pix_payment_turismo',
    label: '💳 Chave Pix da Agência',
    text: 'Segue a nossa chave Pix oficial para confirmação do seu pacote de viagem: pix@esvcturismo.com.br (ESVC Turismo). Assim que efetuar, por gentileza nos envie o comprovante por aqui!',
  },
  {
    id: 'travel_tips',
    label: '🎒 Dicas de Bagagem & Embarque',
    text: 'Dica importante para o seu embarque: chegue ao aeroporto com 2h de antecedência para voos nacionais. Sua franquia inclui mala de bordo de até 10kg + item pessoal. Boa viagem!',
  },
];

export const BYOK_PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (DeepSeek / Llama)',
    models: ['deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct'],
  },
];
