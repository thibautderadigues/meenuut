import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const media = window.matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem('theme');
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Même logique que le script inline de index.html. */
function applyTheme() {
  const pref = readPreference();
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Suit les changements de thème du système en direct. */
export function watchSystemTheme() {
  media.addEventListener('change', applyTheme);
}

export function setThemePreference(pref: ThemePreference) {
  try {
    if (pref === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', pref);
  } catch {
    // Non persisté : le thème s'applique quand même pour la session.
  }
  // Fondu enchaîné entre les deux thèmes plutôt qu'un basculement sec.
  if (document.startViewTransition && !reducedMotion.matches) {
    document.startViewTransition(applyTheme);
  } else {
    applyTheme();
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readPreference);
}
