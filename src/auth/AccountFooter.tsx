import { signOut, useUser } from './AuthGate';

/** Bas de la sidebar : compte connecté et déconnexion. */
export function AccountFooter() {
  const user = useUser();
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
    </div>
  );
}
