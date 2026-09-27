import { useSyncStatus, type SyncStatus } from './sync';

const STATES: Record<SyncStatus, { tooltip: string; dot: string; label?: string }> = {
  synced: { tooltip: 'Tout est enregistré en ligne', dot: 'bg-[var(--tx-green)]' },
  pending: { tooltip: 'Enregistrement en ligne…', dot: 'animate-pulse bg-accent' },
  offline: {
    tooltip: 'Enregistré sur cet appareil, envoi au retour du réseau',
    dot: 'bg-[var(--tx-orange)]',
    label: 'Hors ligne',
  },
  error: {
    tooltip: 'L’envoi en ligne a échoué, nouvel essai dans quelques secondes',
    dot: 'bg-[var(--tx-orange)]',
    label: 'Non synchronisé',
  },
};

/** Point discret dans la barre d'outils ; un mot seulement quand quelque chose cloche. */
export function SyncIndicator() {
  const state = STATES[useSyncStatus()];
  return (
    <span
      role="status"
      tabIndex={0}
      aria-label={state.tooltip}
      data-tooltip={state.tooltip}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 font-sans text-xs text-ink-muted outline-none focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span aria-hidden className={`size-2 rounded-full ${state.dot}`} />
      {state.label}
    </span>
  );
}
