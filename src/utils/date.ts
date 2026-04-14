const KST_TIME_ZONE = 'Asia/Seoul';

function getParts(
  date: Date,
  options: Intl.DateTimeFormatOptions
): Record<string, string> {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIME_ZONE,
    ...options,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});
}

export function formatKstDate(date: Date = new Date()): string {
  const parts = getParts(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatKstTime(date: Date = new Date()): string {
  const parts = getParts(date, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${parts.hour}:${parts.minute}`;
}

export function getKstWeekday(date: Date = new Date()): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: KST_TIME_ZONE,
    weekday: 'short',
  }).format(date);

  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return map[weekday] ?? 0;
}

export function parseYmdAsUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

export function addDaysToYmd(dateStr: string, days: number): string {
  const date = parseYmdAsUtc(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getWeekdayFromYmd(dateStr: string): number {
  return parseYmdAsUtc(dateStr).getUTCDay();
}
