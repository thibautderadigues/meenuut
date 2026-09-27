/** Minuscules sans accents. Préserve la longueur pour un texte en NFC (le cas courant). */
export function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const timeFormat = new Intl.DateTimeFormat('fr', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'short' });
const fullFormat = new Intl.DateTimeFormat('fr', { day: 'numeric', month: 'short', year: 'numeric' });

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

export function formatUpdatedAt(timestamp: number, now = Date.now()): string {
  const elapsed = now - timestamp;
  if (elapsed < 60_000) return 'À l’instant';
  if (elapsed < 3_600_000) return `Il y a ${Math.floor(elapsed / 60_000)} min`;

  const date = new Date(timestamp);
  const today = new Date(now);
  if (isSameDay(date, today)) return timeFormat.format(date);

  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Hier';

  return date.getFullYear() === today.getFullYear()
    ? dayFormat.format(date)
    : fullFormat.format(date);
}
