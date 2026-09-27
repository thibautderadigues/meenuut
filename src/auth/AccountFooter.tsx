import { useSyncStatus, type SyncStatus } from '../sync/sync';
import { signOut, useUser } from './AuthGate';

const LABELS: Record<SyncStatus, string> = {
  synced: 'Synchronisé',
  pending: 'Synchronisation…',
  offline: 'Hors ligne · enregistré sur cet appareil',
  error: 'Synchronisation en échec · nouvel essai bientôt',
};

/** Bas de la sidebar : compte connecté, état de la synchro, déconnexion. */
export function AccountFooter() {
  const user = useUser();
  const status = useSyncStatus();
  if (!user) return null;

  return (
    <div className="shrink-0 border-t border-rule px-3 py-2.5 font-sans text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-ink-muted" title={user.email}>
          {user.email}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="shrink-0 rounded px-1.5 py-0.5 text-ink-faint hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          Déconnexion
        </button>
      </div>
      <p
        role="status"
        className={`mt-1 flex items-center gap-1.5 ${status === 'error' ? 'text-danger' : 'text-ink-faint'}`}
      >
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${
            status === 'synced'
              ? 'bg-[var(--tx-green)]'
              : status === 'error'
                ? 'bg-danger'
                : 'bg-ink-faint'
          }`}
        />
        {LABELS[status]}
      </p>
    </div>
  );
}
