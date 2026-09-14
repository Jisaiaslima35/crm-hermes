import {
  Tenant,
  Lead,
  PipelineStage,
  HandoffState,
  LeadMessage,
  InternalNote,
  AiEngineConfig,
} from '../types';

const STORAGE_KEY_TENANTS = 'deskcomm_tenants_v1';
const STORAGE_KEY_LEADS = 'deskcomm_leads_v1';

const INITIAL_TENANTS: Tenant[] = [
  {
    id: 'tenant-cardio-matheus',
    name: 'Clínica Cardiológica Dr. Matheus',
    tagline: 'Cardiologia Clínica, Exames & Arritmias',
    specialty: 'Cardiologia',
    doctorName: 'Dr. Matheus Silva (CRM 128452-SP)',
    phone: '+55 (11) 98765-4321',
    city: 'São Paulo, SP - Jardins',
    logoColor: 'emerald',
    aiEngine: {
      mode: 'hermes_vps',
      hermesEndpoint: 'https://vps-hermes.clinicamatheus.med.br/api/v1',
      hermesToken: 'hms_live_89f72b109e9aa4c1722e0',
      byokProvider: 'anthropic',
      byokModel: 'claude-3-5-sonnet-20241022',
      byokKey: 'sk-ant-api03-xxxx...xxxx',
      personaName: 'Dr. Matheus AI (Hermes OS)',
      doctorSpecialty: 'Cardiologia',
      tone: 'acolhedor',
      systemPrompt:
        'Você é o Dr. Matheus Silva (ou sua inteligência clínica oficial de WhatsApp). Faça triagem empática de pacientes cardíacos, identifique queixas de dor no peito, palpitações, cansaço ou hipertensão. Se houver sinais de emergência (dor irradiando para braço esquerdo, desmaio), alerte imediatamente para procurar pronto-socorro. Para casos eletivos, colete convênio, informe horários de consulta e exames (Ecg, Holter, Mapa, Eco) e ofereça agendamento.',
      silenceThresholdHours: 4,
      autoFollowup: true,
    },
    whatsappInstance: {
      sessionName: 'cardio_matheus_prod_01',
      phoneNumber: '+55 11 98765-4321',
      status: 'connected',
      batteryLevel: 94,
      webhookUrl: 'https://vps-hermes.clinicamatheus.med.br/webhook/evolution/cardio_matheus_prod_01',
      lastSync: 'Há 2 minutos',
    },
    metrics: {
      totalLeads: 48,
      scheduledThisMonth: 34,
      conversionRate: 70.8,
      avgResponseTimeSeconds: 4,
      aiAutonomousRate: 86.4,
    },
    createdAt: '2025-01-10T08:00:00Z',
  },
  {
    id: 'tenant-odontovida',
    name: 'Consultório Odontológico OdontoVida',
    tagline: 'Implantodontia, Ortodontia e Estética Dental',
    specialty: 'Odontologia',
    doctorName: 'Dra. Camila Nogueira (CRO 98412-SP)',
    phone: '+55 (11) 97123-8899',
    city: 'Campinas, SP - Cambuí',
    logoColor: 'blue',
    aiEngine: {
      mode: 'byok',
      hermesEndpoint: 'https://vps-hermes.odontovida.com.br/api/v1',
      hermesToken: 'hms_live_odonto_3391ba',
      byokProvider: 'openai',
      byokModel: 'gpt-4o-mini',
      byokKey: 'sk-proj-7YxZ984...abcd',
      personaName: 'OdontoVida Assistente AI',
      doctorSpecialty: 'Odontologia & Implantes',
      tone: 'clinico',
      systemPrompt:
        'Você é a assistente clínica inteligente da OdontoVida sob supervisão da Dra. Camila Nogueira. Realize a recepção de pacientes, pergunte se buscam avaliação para implantes, alinhadores invisíveis, clareamento ou emergência de dor de dente. Seja objetiva, cordial e priorize agendamento na agenda da Dra. Camila.',
      silenceThresholdHours: 6,
      autoFollowup: true,
    },
    whatsappInstance: {
      sessionName: 'odontovida_evolution_master',
      phoneNumber: '+55 11 97123-8899',
      status: 'connected',
      batteryLevel: 88,
      webhookUrl: 'https://api.odontovida.com.br/webhook/evolution/odontovida_master',
      lastSync: 'Há 5 minutos',
    },
    metrics: {
      totalLeads: 39,
      scheduledThisMonth: 27,
      conversionRate: 69.2,
      avgResponseTimeSeconds: 6,
      aiAutonomousRate: 81.0,
    },
    createdAt: '2025-02-01T10:00:00Z',
  },
];

const INITIAL_LEADS: Lead[] = [
  // === TENANT 1: Dr. Matheus (Cardiologia) ===
  {
    id: 'lead-c1',
    tenantId: 'tenant-cardio-matheus',
    name: 'Carlos Eduardo Mendes',
    phone: '5511984210982',
    formattedPhone: '+55 (11) 98421-0982',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    cpf: '342.891.048-22',
    birthDate: '1976-05-14',
    insuranceType: 'convenio',
    insuranceName: 'Bradesco Saúde Top Nacional',
    priority: 'urgente',
    stage: 'falar_pessoalmente',
    handoffState: 'humano_assumiu',
    humanOperatorName: 'Enf. Juliana (Plantão)',
    mainComplaint: 'Sensação de aperto no peito e palpitações súbitas em repouso há 3 dias.',
    detectedSymptoms: ['Aperto precordial', 'Palpitação / Taquicardia', 'Sudorese fria leve', 'Histórico familiar'],
    preliminaryAssessment: 'Alerta vermelho para síndrome coronariana ou taquiarritmia paroxística. IA pausada após paciente relatar piora dos sintomas.',
    appointmentTimeSlot: 'Encaixe de Urgência Hoje às 16:30',
    silenceHours: 0.5,
    lastInteractionAt: 'Há 12 min',
    createdAt: '2026-09-14T05:30:00Z',
    internalNotes: [
      {
        id: 'note-1',
        author: 'Dra. Mariana (Triagem)',
        role: 'Médica Plantonista',
        content: 'Paciente orientado a manter repouso até chegar ao consultório. Eletrocardiograma já preparado na sala 2.',
        createdAt: '14/09 09:15',
      },
    ],
    messages: [
      {
        id: 'm1',
        sender: 'patient',
        senderName: 'Carlos Eduardo',
        content: 'Olá doutor, estou sentindo um aperto estranho no peito desde ontem à noite e meu coração começou a disparar.',
        timestamp: '09:02',
        status: 'read',
      },
      {
        id: 'm2',
        sender: 'ai',
        senderName: 'Dr. Matheus AI (Hermes OS)',
        content: 'Olá, Carlos! Sou o Dr. Matheus Silva aqui pelo WhatsApp. Entendo sua preocupação com o coração. Me diga: essa dor se espalha para o braço esquerdo, mandíbula ou costas? Você sente falta de ar ou tontura no momento?',
        timestamp: '09:03',
        status: 'read',
      },
      {
        id: 'm3',
        sender: 'patient',
        senderName: 'Carlos Eduardo',
        content: 'Não chega a irradiar pro braço, mas quando respiro fundo incomoda e fiquei suando frio hoje cedo. Meu pai teve infarto com 52 anos.',
        timestamp: '09:06',
        status: 'read',
      },
      {
        id: 'm4',
        sender: 'ai',
        senderName: 'Dr. Matheus AI (Hermes OS)',
        content: 'Carlos, pelo histórico de aperto e sudorese com histórico familiar, precisamos avaliar isso presencialmente com máxima prioridade. Estou acionando nossa enfermeira-chefe imediatamente.',
        timestamp: '09:07',
        status: 'read',
      },
      {
        id: 'm5',
        sender: 'human',
        senderName: 'Enf. Juliana (Plantão)',
        content: 'Carlos, aqui é a enfermeira Juliana. Assumi seu atendimento. Conseguimos um encaixe de emergência hoje às 16h30 com o Dr. Matheus na unidade Jardins. Você consegue comparecer?',
        timestamp: '09:12',
        status: 'read',
      },
    ],
  },
  {
    id: 'lead-c2',
    tenantId: 'tenant-cardio-matheus',
    name: 'Beatriz Vasconcelos',
    phone: '5511991234455',
    formattedPhone: '+55 (11) 99123-4455',
    avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    cpf: '219.004.998-11',
    birthDate: '1989-11-20',
    insuranceType: 'convenio',
    insuranceName: 'SulAmérica Especial',
    priority: 'normal',
    stage: 'consulta_agendada',
    handoffState: 'ia_ativa',
    mainComplaint: 'Check-up anual para retorno às atividades físicas e ecocardiograma.',
    detectedSymptoms: ['Check-up preventivo', 'Praticante de corrida', 'Assintomática'],
    preliminaryAssessment: 'Eletivo: Consulta Cardiológica + Ecocardiograma Transtorácico e Teste Ergométrico agendados.',
    appointmentTimeSlot: 'Quinta-feira, 18/09 às 10:00 (Dr. Matheus)',
    silenceHours: 1.2,
    lastInteractionAt: 'Há 1 hora',
    createdAt: '2026-09-13T14:00:00Z',
    internalNotes: [
      {
        id: 'note-2',
        author: 'Receção Hermes',
        role: 'Sistema AI',
        content: 'Guia de autorização SulAmérica solicitada ao paciente e recebida com sucesso.',
        createdAt: '13/09 15:40',
      },
    ],
    messages: [
      {
        id: 'm10',
        sender: 'patient',
        senderName: 'Beatriz Vasconcelos',
        content: 'Oi! Gostaria de marcar uma consulta com o Dr. Matheus para fazer check-up do coração, vou voltar a treinar pra meia maratona.',
        timestamp: '14:20',
        status: 'read',
      },
      {
        id: 'm11',
        sender: 'ai',
        senderName: 'Dr. Matheus AI (Hermes OS)',
        content: 'Olá Beatriz! Parabéns pela iniciativa, avaliação cardiológica é fundamental antes de treinos intensos. Você pretende realizar a consulta particular ou por convênio de saúde?',
        timestamp: '14:21',
        status: 'read',
      },
      {
        id: 'm12',
        sender: 'patient',
        senderName: 'Beatriz Vasconcelos',
        content: 'Tenho SulAmérica Especial, vocês aceitam?',
        timestamp: '14:25',
        status: 'read',
      },
      {
        id: 'm13',
        sender: 'ai',
        senderName: 'Dr. Matheus AI (Hermes OS)',
        content: 'Aceitamos sim, Beatriz! O plano SulAmérica Especial cobre tanto a consulta quanto os exames no nosso consultório. Temos horários disponíveis nesta quinta-feira (18/09) às 10:00 ou na sexta às 15:30. Qual fica melhor para você?',
        timestamp: '14:26',
        status: 'read',
      },
      {
        id: 'm14',
        sender: 'patient',
        senderName: 'Beatriz Vasconcelos',
        content: 'Quinta às 10h fica perfeito pra mim!',
        timestamp: '14:32',
        status: 'read',
      },
      {
        id: 'm15',
        sender: 'ai',
        senderName: 'Dr. Matheus AI (Hermes OS)',
        content: 'Perfeito, Beatriz! Consulta confirmada para Quinta-feira (18/09) às 10h com o Dr. Matheus na Rua Haddock Lobo, 1307 - Jardins. Enviamos as instruções de preparo para o ecocardiograma por aqui.',
        timestamp: '14:33',
        status: 'read',
      },
    ],
  },
  {
    id: 'lead-c3',
    tenantId: 'tenant-cardio-matheus',
    name: 'Roberto Antunes Castro',
    phone: '5511977712233',
    formattedPhone: '+55 (11) 97771-2233',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    cpf: '118.445.928-30',
    birthDate: '1965-02-10',
    insuranceType: 'particular',
    priority: 'alta',
    stage: 'em_atendimento',
    handoffState: 'ia_ativa',
    mainComplaint: 'Pressão arterial oscilando entre 16x10 e 17x11 mesmo com medicação Losartana.',
    detectedSymptoms: ['Hipertensão resistente', 'Cefaleia na nuca', 'Uso contínuo de anti-hipertensivo'],
    preliminaryAssessment: 'Investigação de hipertensão não controlada / ajuste posológico ou MAPA 24h.',
    appointmentTimeSlot: 'Aguardando escolha de turno (Manhã/Tarde)',
    silenceHours: 0.3,
    lastInteractionAt: 'Há 18 min',
    createdAt: '2026-09-14T08:10:00Z',
    internalNotes: [],
    messages: [
      {
        id: 'm20',
        sender: 'patient',
        senderName: 'Roberto Antunes',
        content: 'Bom dia. Minha pressão está dando 16 por 10 faz 3 dias seguidos, sinto a nuca pesada. Quero ver se o Dr. Matheus atende particular.',
        timestamp: '08:45',
        status: 'read',
      },
      {
        id: 'm21',
        sender: 'ai',
        senderName: 'Dr. Matheus AI (Hermes OS)',
        content: 'Bom dia, Roberto. Valores acima de 14x9 com sintomas como peso na nuca exigem ajuste e acompanhamento atento. Atendemos particular sim, com emissão de nota para reembolso integral do seu plano.',
        timestamp: '08:46',
        status: 'read',
      },
      {
        id: 'm22',
        sender: 'patient',
        senderName: 'Roberto Antunes',
        content: 'Qual o valor e quando ele tem vaga esta semana?',
        timestamp: '08:50',
        status: 'read',
      },
      {
        id: 'm23',
        sender: 'ai',
        senderName: 'Dr. Matheus AI (Hermes OS)',
        content: 'A consulta cardiológica completa com eletrocardiograma e retorno incluso fica em R$ 550. Temos disponibilidade para amanhã, terça-feira, às 11h15 ou às 16h00. Algum desses horários te atende?',
        timestamp: '08:51',
        status: 'read',
      },
    ],
  },
  {
    id: 'lead-c4',
    tenantId: 'tenant-cardio-matheus',
    name: 'Helena Siqueira Maia',
    phone: '5511966554433',
    formattedPhone: '+55 (11) 96655-4433',
    avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    insuranceType: 'convenio',
    insuranceName: 'Amil One',
    priority: 'normal',
    stage: 'novo_contato',
    handoffState: 'ia_ativa',
    mainComplaint: 'Novo contato via anúncio Instagram: Exame de Holter e Mapa 24 horas.',
    detectedSymptoms: ['Exame cardiológico', 'Holter de 24h solicitado por outro médico'],
    silenceHours: 0.1,
    lastInteractionAt: 'Há 5 min',
    createdAt: '2026-09-14T09:30:00Z',
    internalNotes: [],
    messages: [
      {
        id: 'm30',
        sender: 'patient',
        senderName: 'Helena Siqueira',
        content: 'Olá! Vi o post de vocês sobre colocação de Holter 24 horas sem fila. Vocês têm para esta semana?',
        timestamp: '09:30',
        status: 'read',
      },
      {
        id: 'm31',
        sender: 'ai',
        senderName: 'Dr. Matheus AI (Hermes OS)',
        content: 'Olá Helena! Sim, temos aparelhos de Holter digital de última geração com laudo ágil pelo Dr. Matheus. Você tem o pedido médico em mãos? Pode me informar também se fará pelo convênio ou particular?',
        timestamp: '09:31',
        status: 'sent',
      },
    ],
  },
  {
    id: 'lead-c5',
    tenantId: 'tenant-cardio-matheus',
    name: 'Marcio Fontes Jr.',
    phone: '5511955443322',
    formattedPhone: '+55 (11) 95544-3322',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    insuranceType: 'convenio',
    insuranceName: 'Porto Seguro Saúde',
    priority: 'normal',
    stage: 'sem_resposta',
    handoffState: 'ia_ativa',
    mainComplaint: 'Interesse em teste ergométrico para academia.',
    detectedSymptoms: ['Atestado para academia', 'Assintomático'],
    silenceHours: 18.5,
    lastInteractionAt: 'Ontem às 15:20',
    createdAt: '2026-09-13T12:00:00Z',
    internalNotes: [
      {
        id: 'note-5',
        author: 'Radar Deskcomm',
        role: 'Automação Hermes',
        content: 'Lead em silêncio há mais de 18 horas após envio dos horários de sábado.',
        createdAt: '14/09 09:00',
      },
    ],
    messages: [
      {
        id: 'm40',
        sender: 'patient',
        senderName: 'Marcio Fontes Jr.',
        content: 'Boa tarde, o Dr. Matheus atende aos sábados de manhã para teste ergométrico?',
        timestamp: '15:15',
        status: 'read',
      },
      {
        id: 'm41',
        sender: 'ai',
        senderName: 'Dr. Matheus AI (Hermes OS)',
        content: 'Boa tarde, Marcio! Atendemos aos sábados sim, das 08h às 13h. Temos disponibilidade no próximo sábado (20/09) às 09:30 ou 11:00. Gostaria de reservar uma dessas vagas?',
        timestamp: '15:16',
        status: 'read',
      },
    ],
  },
  {
    id: 'lead-c6',
    tenantId: 'tenant-cardio-matheus',
    name: 'Regina Célia Prado',
    phone: '5511944332211',
    formattedPhone: '+55 (11) 94433-2211',
    avatarUrl: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=150&auto=format&fit=crop&q=80',
    insuranceType: 'convenio',
    insuranceName: 'Notredame Intermédica',
    priority: 'normal',
    stage: 'desistiu',
    handoffState: 'ia_ativa',
    mainComplaint: 'Buscava atendimento pelo plano GNDI não credenciado.',
    detectedSymptoms: ['Desejo de consulta GNDI', 'Não aceitou reembolso'],
    silenceHours: 42,
    lastInteractionAt: '12/09 às 11:00',
    createdAt: '2026-09-12T10:00:00Z',
    internalNotes: [],
    messages: [
      {
        id: 'm50',
        sender: 'patient',
        senderName: 'Regina Célia',
        content: 'Vocês atendem GNDI Notredame Smart?',
        timestamp: '10:45',
        status: 'read',
      },
      {
        id: 'm51',
        sender: 'ai',
        senderName: 'Dr. Matheus AI (Hermes OS)',
        content: 'Olá Regina! No momento não atendemos o convênio NotreDame Intermédica de forma direta, porém emitimos relatório e recibo médico completo para solicitar o reembolso junto à sua operadora. Deseja conhecer os valores particulares?',
        timestamp: '10:46',
        status: 'read',
      },
      {
        id: 'm52',
        sender: 'patient',
        senderName: 'Regina Célia',
        content: 'Não, obrigada, só posso passar por plano mesmo.',
        timestamp: '11:00',
        status: 'read',
      },
    ],
  },

  // === TENANT 2: OdontoVida (Odontologia) ===
  {
    id: 'lead-o1',
    tenantId: 'tenant-odontovida',
    name: 'Juliana Paes Cavalcanti',
    phone: '5519988223344',
    formattedPhone: '+55 (19) 98822-3344',
    avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    cpf: '402.193.882-90',
    birthDate: '1992-08-19',
    insuranceType: 'particular',
    priority: 'alta',
    stage: 'em_atendimento',
    handoffState: 'ia_ativa',
    mainComplaint: 'Interesse em Implante Dental guiado e Alinhador Transparente.',
    detectedSymptoms: ['Ausência do elemento 24', 'Desalinhamento ântero-inferior', 'Busca estética'],
    preliminaryAssessment: 'Avaliação para implante unitário cone morse + escaneamento intraoral iTero.',
    silenceHours: 0.2,
    lastInteractionAt: 'Há 10 min',
    createdAt: '2026-09-14T09:00:00Z',
    internalNotes: [
      {
        id: 'note-o1',
        author: 'Dra. Camila Nogueira',
        role: 'Responsável Técnica',
        content: 'Paciente muito motivada com estética para casamento em dezembro. Priorizar demonstração do mock-up 3D.',
        createdAt: '14/09 09:20',
      },
    ],
    messages: [
      {
        id: 'om1',
        sender: 'patient',
        senderName: 'Juliana Paes',
        content: 'Olá! Gostaria de saber como funciona a avaliação para implante e alinhadores invisíveis com a Dra. Camila.',
        timestamp: '09:10',
        status: 'read',
      },
      {
        id: 'om2',
        sender: 'ai',
        senderName: 'OdontoVida Assistente AI',
        content: 'Olá Juliana! Seja muito bem-vinda à OdontoVida. A Dra. Camila realiza o diagnóstico com escaneamento digital 3D sem moldagens desconfortáveis. Qual dente você precisa repor com o implante?',
        timestamp: '09:11',
        status: 'read',
      },
      {
        id: 'om3',
        sender: 'patient',
        senderName: 'Juliana Paes',
        content: 'É um pré-molar superior que precisei extrair ano passado. Quero colocar o implante logo porque vou casar no final do ano.',
        timestamp: '09:15',
        status: 'read',
      },
      {
        id: 'om4',
        sender: 'ai',
        senderName: 'OdontoVida Assistente AI',
        content: 'Perfeito, Juliana! Com a cirurgia guiada conseguimos excelente previsibilidade e cicatrização acelerada, tempo hábil para o seu casamento! Temos horário com a Dra. Camila nesta quarta às 14h ou sexta às 10h. Qual prefere?',
        timestamp: '09:16',
        status: 'read',
      },
    ],
  },
  {
    id: 'lead-o2',
    tenantId: 'tenant-odontovida',
    name: 'Felipe Santana Ramos',
    phone: '5519971112233',
    formattedPhone: '+55 (19) 97111-2233',
    avatarUrl: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&auto=format&fit=crop&q=80',
    cpf: '319.444.891-05',
    insuranceType: 'convenio',
    insuranceName: 'MetLife Odonto',
    priority: 'urgente',
    stage: 'falar_pessoalmente',
    handoffState: 'humano_assumiu',
    humanOperatorName: 'Lucas (Atendimento OdontoVida)',
    mainComplaint: 'Dor de dente pulsátil insuportável no molar inferior após restauração quebrar.',
    detectedSymptoms: ['Dor aguda contínua', 'Inchaço na gengiva', 'Pulpite aguda suspeita'],
    preliminaryAssessment: 'Urgência endodôntica. Avaliação imediata para abertura coronária e alívio da dor.',
    appointmentTimeSlot: 'Encaixe de Emergência Hoje 14:00',
    silenceHours: 0.1,
    lastInteractionAt: 'Há 4 min',
    createdAt: '2026-09-14T09:20:00Z',
    internalNotes: [
      {
        id: 'note-o2',
        author: 'Lucas (Atendimento)',
        role: 'Recepcionista',
        content: 'Avisei a Dra. Camila para encaixe no intervalo das 14h. Paciente já a caminho.',
        createdAt: '14/09 09:24',
      },
    ],
    messages: [
      {
        id: 'om10',
        sender: 'patient',
        senderName: 'Felipe Santana',
        content: 'Socorro, estou com uma dor de dente horrível que começou de madrugada, não consigo nem encostar a comida.',
        timestamp: '09:20',
        status: 'read',
      },
      {
        id: 'om11',
        sender: 'ai',
        senderName: 'OdontoVida Assistente AI',
        content: 'Olá Felipe! Entendemos a urgência da dor aguda. Nossos dentistas estão preparados para casos de dor imediata. Por favor, me confirme seu nome e se há inchaço no rosto.',
        timestamp: '09:21',
        status: 'read',
      },
      {
        id: 'om12',
        sender: 'patient',
        senderName: 'Felipe Santana',
        content: 'Meu nome é Felipe, a gengiva tá bem inchada e tá pulsando. Preciso falar com alguém agora por favor!',
        timestamp: '09:22',
        status: 'read',
      },
      {
        id: 'om13',
        sender: 'human',
        senderName: 'Lucas (Atendimento OdontoVida)',
        content: 'Oi Felipe, sou o Lucas da OdontoVida. Assumi seu atendimento para te socorrer. Venha direto para a clínica na Av. Coronel Silva Teles, 980 - Cambuí. Te encaixamos às 14h com a Dra. Camila!',
        timestamp: '09:24',
        status: 'read',
      },
    ],
  },
  {
    id: 'lead-o3',
    tenantId: 'tenant-odontovida',
    name: 'Ana Paula Peixoto',
    phone: '5519965554444',
    formattedPhone: '+55 (19) 96555-4444',
    avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    insuranceType: 'particular',
    priority: 'normal',
    stage: 'consulta_agendada',
    handoffState: 'ia_ativa',
    mainComplaint: 'Clareamento Dental a laser e profilaxia.',
    detectedSymptoms: ['Clareamento cosmético', 'Remoção de tártaro'],
    appointmentTimeSlot: 'Sexta-feira, 19/09 às 16:30',
    silenceHours: 2.0,
    lastInteractionAt: 'Há 2 horas',
    createdAt: '2026-09-13T16:00:00Z',
    internalNotes: [],
    messages: [
      {
        id: 'om20',
        sender: 'patient',
        senderName: 'Ana Paula Peixoto',
        content: 'Boa tarde! Qual o valor da sessão de clareamento a laser?',
        timestamp: '16:05',
        status: 'read',
      },
      {
        id: 'om21',
        sender: 'ai',
        senderName: 'OdontoVida Assistente AI',
        content: 'Boa tarde Ana Paula! O protocolo de clareamento a laser associado ao caseiro supervisionado garante o branco ideal sem sensibilidade. Temos avaliação e agendamento para sexta-feira às 16h30.',
        timestamp: '16:06',
        status: 'read',
      },
      {
        id: 'om22',
        sender: 'patient',
        senderName: 'Ana Paula Peixoto',
        content: 'Pode reservar essa sexta às 16h30 pra mim por favor!',
        timestamp: '16:15',
        status: 'read',
      },
      {
        id: 'om23',
        sender: 'ai',
        senderName: 'OdontoVida Assistente AI',
        content: 'Reservado com sucesso, Ana Paula! Enviamos a confirmação em seu e-mail e nos vemos na sexta-feira.',
        timestamp: '16:16',
        status: 'read',
      },
    ],
  },
  {
    id: 'lead-o4',
    tenantId: 'tenant-odontovida',
    name: 'Guilherme Toledo',
    phone: '5519954443322',
    formattedPhone: '+55 (19) 95444-3322',
    avatarUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80',
    insuranceType: 'convenio',
    insuranceName: 'Amil Dental',
    priority: 'normal',
    stage: 'sem_resposta',
    handoffState: 'ia_ativa',
    mainComplaint: 'Dúvidas sobre manutenção de aparelho ortodôntico convencional.',
    detectedSymptoms: ['Aparelho quebrado', 'Braquete solto'],
    silenceHours: 28,
    lastInteractionAt: 'Ontem às 08:30',
    createdAt: '2026-09-12T15:00:00Z',
    internalNotes: [],
    messages: [
      {
        id: 'om30',
        sender: 'patient',
        senderName: 'Guilherme Toledo',
        content: 'Soltou um braquete do meu aparelho metálico, quanto custa colar de novo?',
        timestamp: '08:20',
        status: 'read',
      },
      {
        id: 'om31',
        sender: 'ai',
        senderName: 'OdontoVida Assistente AI',
        content: 'Olá Guilherme! Para pacientes com aparelho colocado fora da clínica, fazemos a manutenção avulsa ou transferência de caso. Temos vaga hoje à tarde às 17h para recolar.',
        timestamp: '08:22',
        status: 'read',
      },
    ],
  },
];

class DeskcommService {
  private getTenantsFromStorage(): Tenant[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TENANTS);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error('Error reading tenants from localStorage', e);
    }
    this.saveTenantsToStorage(INITIAL_TENANTS);
    return INITIAL_TENANTS;
  }

  private saveTenantsToStorage(tenants: Tenant[]) {
    try {
      localStorage.setItem(STORAGE_KEY_TENANTS, JSON.stringify(tenants));
    } catch (e) {
      console.error('Error saving tenants', e);
    }
  }

  private getLeadsFromStorage(): Lead[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LEADS);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error('Error reading leads from localStorage', e);
    }
    this.saveLeadsToStorage(INITIAL_LEADS);
    return INITIAL_LEADS;
  }

  private saveLeadsToStorage(leads: Lead[]) {
    try {
      localStorage.setItem(STORAGE_KEY_LEADS, JSON.stringify(leads));
    } catch (e) {
      console.error('Error saving leads', e);
    }
  }

  // --- API SIMULATION METHODS ---

  public getTenants(): Tenant[] {
    return this.getTenantsFromStorage();
  }

  public getTenantById(id: string): Tenant | undefined {
    return this.getTenantsFromStorage().find((t) => t.id === id);
  }

  public updateTenant(updatedTenant: Tenant): Tenant {
    const tenants = this.getTenantsFromStorage().map((t) =>
      t.id === updatedTenant.id ? updatedTenant : t
    );
    this.saveTenantsToStorage(tenants);
    return updatedTenant;
  }

  public getLeads(tenantId?: string): Lead[] {
    const leads = this.getLeadsFromStorage();
    if (tenantId) {
      return leads.filter((l) => l.tenantId === tenantId);
    }
    return leads;
  }

  public getLeadById(leadId: string): Lead | undefined {
    return this.getLeadsFromStorage().find((l) => l.id === leadId);
  }

  public updateLeadStage(leadId: string, newStage: PipelineStage): Lead | null {
    const leads = this.getLeadsFromStorage();
    const index = leads.findIndex((l) => l.id === leadId);
    if (index === -1) return null;

    leads[index] = {
      ...leads[index],
      stage: newStage,
      lastInteractionAt: 'Agora mesmo',
    };
    this.saveLeadsToStorage(leads);
    return leads[index];
  }

  public toggleAiHandoff(
    leadId: string,
    newState: HandoffState,
    operatorName?: string
  ): Lead | null {
    const leads = this.getLeadsFromStorage();
    const index = leads.findIndex((l) => l.id === leadId);
    if (index === -1) return null;

    const lead = leads[index];
    const updatedLead: Lead = {
      ...lead,
      handoffState: newState,
      humanOperatorName: newState === 'humano_assumiu' ? (operatorName || 'Operador Humano') : undefined,
      lastInteractionAt: 'Agora mesmo',
    };

    // Add an audit internal note when handoff changes
    const noteText =
      newState === 'humano_assumiu'
        ? `🚨 KILL-SWITCH DA IA ACIONADO: Operador "${operatorName || 'Humano'}" assumiu o controle deste atendimento no WhatsApp.`
        : `🤖 CONTROLE DEVOLVIDO PARA A IA: Persona clínica reativada para triagem autônoma.`;

    const auditNote: InternalNote = {
      id: 'note_' + Date.now(),
      author: 'Sistema Deskcomm',
      role: 'Auditoria de Handoff',
      content: noteText,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    updatedLead.internalNotes = [auditNote, ...updatedLead.internalNotes];

    leads[index] = updatedLead;
    this.saveLeadsToStorage(leads);
    return updatedLead;
  }

  public sendWhatsAppMessage(
    leadId: string,
    content: string,
    sender: 'patient' | 'ai' | 'human',
    senderName: string
  ): Lead | null {
    const leads = this.getLeadsFromStorage();
    const index = leads.findIndex((l) => l.id === leadId);
    if (index === -1) return null;

    const lead = leads[index];
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newMessage: LeadMessage = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      sender,
      senderName,
      content,
      timestamp: timeStr,
      status: 'sent',
    };

    const updatedLead: Lead = {
      ...lead,
      messages: [...lead.messages, newMessage],
      lastInteractionAt: 'Agora mesmo',
      silenceHours: sender === 'patient' ? 0.05 : 0.1,
    };

    leads[index] = updatedLead;
    this.saveLeadsToStorage(leads);
    return updatedLead;
  }

  public addInternalNote(leadId: string, content: string, author: string, role: string): Lead | null {
    const leads = this.getLeadsFromStorage();
    const index = leads.findIndex((l) => l.id === leadId);
    if (index === -1) return null;

    const lead = leads[index];
    const newNote: InternalNote = {
      id: 'note_' + Date.now(),
      author,
      role,
      content,
      createdAt: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    lead.internalNotes = [newNote, ...lead.internalNotes];
    leads[index] = lead;
    this.saveLeadsToStorage(leads);
    return lead;
  }

  public updateLead(updatedLead: Lead): Lead {
    const leads = this.getLeadsFromStorage().map((l) =>
      l.id === updatedLead.id ? updatedLead : l
    );
    this.saveLeadsToStorage(leads);
    return updatedLead;
  }

  public createLead(tenantId: string, leadData: Partial<Lead>): Lead {
    const leads = this.getLeadsFromStorage();
    const tenant = this.getTenantById(tenantId);
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newLead: Lead = {
      id: 'lead_' + Date.now(),
      tenantId,
      name: leadData.name || 'Novo Paciente',
      phone: leadData.phone || '5511999990000',
      formattedPhone: leadData.formattedPhone || '+55 (11) 99999-0000',
      avatarUrl:
        leadData.avatarUrl ||
        `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
      cpf: leadData.cpf || '',
      birthDate: leadData.birthDate || '',
      insuranceType: leadData.insuranceType || 'particular',
      insuranceName: leadData.insuranceName || '',
      priority: leadData.priority || 'normal',
      stage: leadData.stage || 'novo_contato',
      handoffState: 'ia_ativa',
      mainComplaint: leadData.mainComplaint || 'Primeiro contato via WhatsApp',
      detectedSymptoms: leadData.detectedSymptoms || ['Contato inicial'],
      silenceHours: 0.1,
      lastInteractionAt: 'Agora mesmo',
      createdAt: now.toISOString(),
      messages: [
        {
          id: 'msg_init_' + Date.now(),
          sender: 'patient',
          senderName: leadData.name || 'Paciente',
          content: leadData.mainComplaint || 'Olá! Gostaria de informações sobre agendamento.',
          timestamp: timeStr,
          status: 'delivered',
        },
        {
          id: 'msg_ai_' + Date.now(),
          sender: 'ai',
          senderName: tenant?.aiEngine.personaName || 'Assistente IA',
          content: `Olá, ${leadData.name || 'seja bem-vindo'}! Sou o assistente oficial de WhatsApp da ${
            tenant?.name || 'nossa clínica'
          }. Como posso ajudar com sua saúde hoje?`,
          timestamp: timeStr,
          status: 'sent',
        },
      ],
      internalNotes: [
        {
          id: 'note_lead_created',
          author: 'Deskcomm CRM',
          role: 'Automação',
          content: 'Lead criado no sistema via integração WhatsApp Webhook Evolution API.',
          createdAt: new Date().toLocaleDateString('pt-BR') + ' ' + timeStr,
        },
      ],
    };

    leads.unshift(newLead);
    this.saveLeadsToStorage(leads);
    return newLead;
  }

  // Simulate AI smart response when patient sends message and IA is active
  public generateAiResponse(tenant: Tenant, patientMessage: string): string {
    const isCardio = tenant.specialty.toLowerCase().includes('cardio');
    const msg = patientMessage.toLowerCase();

    if (isCardio) {
      if (msg.includes('dor') || msg.includes('peito') || msg.includes('pressão') || msg.includes('urgente')) {
        return `Entendido. Casos com desconforto ou alteração pressórica demandam atenção clínica especial. O Dr. Matheus orienta agendamento prioritário. Temos disponibilidade para encaixe hoje mesmo ou amanhã cedo. Você tem preferência de horário?`;
      }
      if (msg.includes('plano') || msg.includes('convênio') || msg.includes('bradesco') || msg.includes('sulamerica') || msg.includes('amil')) {
        return `Aceitamos os principais planos como Bradesco Saúde, SulAmérica e Amil One para consultas e exames complementares. Caso o seu seja outro, fornecemos nota fiscal para reembolso integral. Deseja verificar para este mês?`;
      }
      return `Perfeito! Entendi perfeitamente. Na Clínica Cardiológica Dr. Matheus realizamos triagem completa com retorno em até 15 dias e laudos no mesmo dia. Gostaria de agendar para o período da manhã ou da tarde?`;
    } else {
      if (msg.includes('dor') || msg.includes('dente') || msg.includes('canal') || msg.includes('emergencia')) {
        return `Entendo sua dor. Dor dental aguda requer alívio imediato para evitar que a inflamação se agrave. A Dra. Camila possui protocolo de pronto-atendimento odontológico. Consegue comparecer hoje em nosso consultório no Cambuí?`;
      }
      if (msg.includes('clareamento') || msg.includes('aparelho') || msg.includes('alinhador') || msg.includes('implante')) {
        return `Excelente escolha! Para implantes e alinhadores invisíveis realizamos escaneamento 3D gratuito na primeira consulta para simular o resultado do seu sorriso. Qual dia fica mais fácil para você vir à clínica?`;
      }
      return `Obrigado pela mensagem! A Dra. Camila Nogueira e nossa equipe OdontoVida terão prazer em atendê-lo. Você busca atendimento particular ou gostaria de usar convênio?`;
    }
  }

  public async testAiConnection(config: AiEngineConfig): Promise<{ success: boolean; latencyMs: number; message: string }> {
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (config.mode === 'hermes_vps') {
      if (!config.hermesEndpoint.startsWith('http')) {
        return { success: false, latencyMs: 0, message: 'URL do Endpoint Hermes inválida. Deve iniciar com https:// ou http://' };
      }
      return {
        success: true,
        latencyMs: 142,
        message: 'Conectado à VPS Hermes v2.4 com sucesso. Latência de 142ms. Modelo Llama-3-70B-Clinical ativo.',
      };
    } else {
      if (!config.byokKey || config.byokKey.length < 8) {
        return { success: false, latencyMs: 0, message: 'API Key BYOK inválida ou muito curta.' };
      }
      return {
        success: true,
        latencyMs: 280,
        message: `Conexão validada com sucesso com a API da ${config.byokProvider.toUpperCase()} (${config.byokModel}). Quota de tokens disponível.`,
      };
    }
  }

  public async reconnectWhatsAppInstance(tenantId: string): Promise<Tenant | null> {
    const tenants = this.getTenantsFromStorage();
    const index = tenants.findIndex((t) => t.id === tenantId);
    if (index === -1) return null;

    tenants[index].whatsappInstance.status = 'reconnecting';
    this.saveTenantsToStorage(tenants);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    tenants[index].whatsappInstance.status = 'connected';
    tenants[index].whatsappInstance.lastSync = 'Agora mesmo';
    this.saveTenantsToStorage(tenants);
    return tenants[index];
  }

  public getGlobalMetrics() {
    const tenants = this.getTenantsFromStorage();
    const leads = this.getLeadsFromStorage();

    const totalLeads = leads.length;
    const scheduledTotal = leads.filter((l) => l.stage === 'consulta_agendada').length;
    const urgentTotal = leads.filter((l) => l.priority === 'urgente' || l.stage === 'falar_pessoalmente').length;
    const activeAiTotal = leads.filter((l) => l.handoffState === 'ia_ativa').length;
    const humanAssumedTotal = leads.filter((l) => l.handoffState === 'humano_assumiu').length;

    return {
      tenantsCount: tenants.length,
      totalLeads,
      scheduledTotal,
      urgentTotal,
      activeAiTotal,
      humanAssumedTotal,
      connectedInstances: tenants.filter((t) => t.whatsappInstance.status === 'connected').length,
    };
  }

  public resetToDefaults() {
    this.saveTenantsToStorage(INITIAL_TENANTS);
    this.saveLeadsToStorage(INITIAL_LEADS);
  }
}

export const deskcommService = new DeskcommService();
