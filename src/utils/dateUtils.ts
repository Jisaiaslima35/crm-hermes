/**
 * Utilitários de formatação limpa de datas e horas para o CRM Deskcomm
 * Fuso horário canônico: America/Fortaleza (UTC-3)
 */

const TIMEZONE_CANONICAL = 'America/Fortaleza';

function parseDateSafe(input?: string): Date | null {
  if (!input) return null;
  const str = input.trim();
  if (!str) return null;

  // Se já for formato simples de hora (ex: "13:24"), não precisa converter
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(str)) {
    return null;
  }

  // Normaliza espaços para 'T' para garantir compatibilidade ISO
  let normalized = str;
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}/.test(str)) {
    normalized = str.replace(' ', 'T');
  }

  const d = new Date(normalized);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Formata data/hora para a lista lateral de conversas:
 * - Se for hoje: "13:24"
 * - Se for ontem: "Ontem"
 * - Se for anterior: "07/10"
 */
export function formatConversationTime(isoString?: string): string {
  if (!isoString) return 'Hoje';
  const date = parseDateSafe(isoString);
  if (!date) {
    // Se não for uma data válida (ex: "Hoje", "13:24"), retorna o texto original limpo
    return isoString.length > 15 ? 'Hoje' : isoString;
  }

  try {
    const tz = TIMEZONE_CANONICAL;
    const now = new Date();

    const dateDay = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);

    const nowDay = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(now);

    const timeStr = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);

    if (dateDay === nowDay) {
      return timeStr;
    }

    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayDay = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(yesterday);

    if (dateDay === yesterdayDay) {
      return 'Ontem';
    }

    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
    }).format(date);
  } catch {
    return 'Hoje';
  }
}

/**
 * Formata o timestamp nos balões de chat: apenas o horário "HH:mm" (ex: "13:24")
 */
export function formatMessageTime(isoString?: string): string {
  if (!isoString) return '';
  const date = parseDateSafe(isoString);
  if (!date) {
    // Se for string no formato "HH:mm" ou "HH:mm:ss", corta para HH:mm
    const match = isoString.match(/^(\d{2}:\d{2})/);
    return match ? match[1] : (isoString.length > 8 ? '' : isoString);
  }

  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: TIMEZONE_CANONICAL,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return '';
  }
}

/**
 * Formata a data no cabeçalho do lead: "Hoje às 13:24" ou "Ontem às 18:30" ou "05/10 às 14:00"
 */
export function formatHeaderTime(isoString?: string): string {
  if (!isoString) return 'Hoje';
  const date = parseDateSafe(isoString);
  if (!date) return isoString;

  try {
    const tz = TIMEZONE_CANONICAL;
    const now = new Date();

    const dateDay = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);

    const nowDay = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(now);

    const timeStr = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);

    if (dateDay === nowDay) {
      return `Hoje às ${timeStr}`;
    }

    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayDay = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(yesterday);

    if (dateDay === yesterdayDay) {
      return `Ontem às ${timeStr}`;
    }

    const dayMonth = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
    }).format(date);

    return `${dayMonth} às ${timeStr}`;
  } catch {
    return isoString;
  }
}

/**
 * Formata slot de agendamento (evita exibir ISO bruto no card)
 */
export function formatAppointmentSlot(slot?: string): string {
  if (!slot) return '';
  if (!slot.includes('T') && !slot.includes('-')) return slot;
  const date = parseDateSafe(slot);
  if (!date) return slot;
  return formatHeaderTime(slot);
}
