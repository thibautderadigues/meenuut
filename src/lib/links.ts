/**
 * Transforme une saisie libre en href sûr.
 * "exemple.fr" → "https://exemple.fr", "moi@exemple.fr" → "mailto:…".
 * Retourne null pour les protocoles non autorisés (javascript:, data:…).
 */
export function normalizeHref(input: string): string | null {
  const value = input.trim();
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value)) return `mailto:${value}`;
  if (/^[a-z][a-z\d+.-]*:(?!\d)/i.test(value)) return null;
  if (value.startsWith('#') || value.startsWith('/')) return value;
  return `https://${value}`;
}

/** Version lisible d'une URL pour l'aperçu : sans protocole ni slash final. */
export function displayHref(href: string): string {
  return href
    .replace(/^(https?:\/\/)(www\.)?/i, '')
    .replace(/^mailto:/i, '')
    .replace(/\/$/, '');
}
