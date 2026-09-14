import { PipelineStage, StageColumnInfo } from './types';

export const PIPELINE_STAGES: StageColumnInfo[] = [
  {
    id: 'novo_contato',
    title: '1. Novo Contato',
    subtitle: 'Aguardando triagem inicial',
    badgeBg: 'bg-sky-950/60',
    badgeText: 'text-sky-400 border-sky-800/60',
    borderHover: 'hover:border-sky-500/40',
  },
  {
    id: 'em_atendimento',
    title: '2. Em Atendimento',
    subtitle: 'Persona IA conduzindo no WhatsApp',
    badgeBg: 'bg-emerald-950/60',
    badgeText: 'text-emerald-400 border-emerald-800/60',
    borderHover: 'hover:border-emerald-500/40',
  },
  {
    id: 'consulta_agendada',
    title: '3. Consulta Agendada',
    subtitle: 'Interesse, data e turno confirmados',
    badgeBg: 'bg-teal-950/60',
    badgeText: 'text-teal-300 border-teal-800/60',
    borderHover: 'hover:border-teal-500/40',
  },
  {
    id: 'falar_pessoalmente',
    title: '4. Falar Pessoalmente',
    subtitle: 'Caso complexo ou pedido médico',
    badgeBg: 'bg-amber-950/60',
    badgeText: 'text-amber-400 border-amber-800/60',
    borderHover: 'hover:border-amber-500/40',
  },
  {
    id: 'sem_resposta',
    title: '5. Sem Resposta / Recontato',
    subtitle: 'Lead parou de responder',
    badgeBg: 'bg-rose-950/60',
    badgeText: 'text-rose-400 border-rose-800/60',
    borderHover: 'hover:border-rose-500/40',
  },
  {
    id: 'desistiu',
    title: '6. Desistiu / Arquivado',
    subtitle: 'Desinteresse ou desqualificado',
    badgeBg: 'bg-slate-900',
    badgeText: 'text-slate-400 border-slate-700/60',
    borderHover: 'hover:border-slate-600/40',
  },
  {
    id: 'atendido_concluido',
    title: '7. Atendidos / Concluídos',
    subtitle: 'Consulta realizada e ciclo finalizado',
    badgeBg: 'bg-emerald-900/40',
    badgeText: 'text-emerald-300 border-emerald-700/60',
    borderHover: 'hover:border-emerald-400/50',
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
