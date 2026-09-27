import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

const MAC_LABELS: Record<string, string> = { mod: '⌘', alt: '⌥', shift: '⇧' };
const OTHER_LABELS: Record<string, string> = { mod: 'Ctrl', alt: 'Alt', shift: 'Maj' };

/** keys('alt', 'mod', 'N') → "⌥⌘N" sur Mac, "Alt+Ctrl+N" ailleurs. */
export function keys(...parts: string[]): string {
  const labels = isMac ? MAC_LABELS : OTHER_LABELS;
  return parts.map((part) => labels[part] ?? part).join(isMac ? '' : '+');
}

/** ⌘ sur Mac, Ctrl ailleurs. */
export function isModKey(event: KeyboardEvent | ReactKeyboardEvent): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}
