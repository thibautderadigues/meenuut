/**
 * Couleurs de texte et de surlignage. La valeur stockée dans le document est une variable CSS
 * (ex. "var(--hl-yellow)") : la teinte s'adapte au thème clair ou sombre sans toucher au contenu.
 */
export interface Swatch {
  name: string;
  label: string;
  value: string;
}

export const TEXT_COLORS: Swatch[] = [
  { name: 'gray', label: 'Gris', value: 'var(--tx-gray)' },
  { name: 'red', label: 'Rouge', value: 'var(--tx-red)' },
  { name: 'orange', label: 'Orange', value: 'var(--tx-orange)' },
  { name: 'green', label: 'Vert', value: 'var(--tx-green)' },
  { name: 'blue', label: 'Bleu', value: 'var(--tx-blue)' },
  { name: 'purple', label: 'Violet', value: 'var(--tx-purple)' },
];

export const HIGHLIGHT_COLORS: Swatch[] = [
  { name: 'yellow', label: 'Jaune', value: 'var(--hl-yellow)' },
  { name: 'green', label: 'Vert', value: 'var(--hl-green)' },
  { name: 'blue', label: 'Bleu', value: 'var(--hl-blue)' },
  { name: 'pink', label: 'Rose', value: 'var(--hl-pink)' },
  { name: 'purple', label: 'Violet', value: 'var(--hl-purple)' },
  { name: 'orange', label: 'Orange', value: 'var(--hl-orange)' },
];

export const DEFAULT_HIGHLIGHT = HIGHLIGHT_COLORS[0]!.value;
