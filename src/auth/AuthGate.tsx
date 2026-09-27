import type { User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { prepareLocalData, startSync, syncNow } from '../sync/sync';
import { supabase } from '../sync/supabase';
import { Login } from './Login';

/** Au-delà, on ouvre l'app avec les données locales ; la synchro continue en arrière-plan. */
const FIRST_SYNC_TIMEOUT_MS = 5000;

type AuthState = { status: 'loading' } | { status: 'signed-out' } | { status: 'ready'; user: User };

const UserContext = createContext<User | null>(null);

export function useUser(): User | null {
  return useContext(UserContext);
}

export async function signOut() {
  await syncNow();
  await supabase.auth.signOut();
}

/** Affiche l'écran de connexion, ou l'app une fois les données du compte prêtes. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  // En développement seulement : tester l'interface sans e-mail (données locales, sans synchro).
  const [devOffline, setDevOffline] = useState(false);

  useEffect(() => {
    let currentId: string | null | undefined;
    let stopSync: (() => void) | undefined;

    const open = async (user: User) => {
      await prepareLocalData(user.id);
      if (currentId !== user.id) return;
      stopSync = startSync(user.id);
      await Promise.race([
        syncNow(),
        new Promise((resolve) => window.setTimeout(resolve, FIRST_SYNC_TIMEOUT_MS)),
      ]);
      if (currentId === user.id) setState({ status: 'ready', user });
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      // Rafraîchissement du jeton : même compte, rien à faire.
      if ((user?.id ?? null) === currentId) return;
      currentId = user?.id ?? null;
      stopSync?.();
      stopSync = undefined;
      if (!user) {
        setState({ status: 'signed-out' });
        return;
      }
      setState({ status: 'loading' });
      // Pas d'appel à Supabase dans ce callback (il tient le verrou d'authentification).
      window.setTimeout(() => {
        open(user).catch((error: unknown) => {
          console.error(error);
          if (currentId === user.id) setState({ status: 'ready', user });
        });
      }, 0);
    });

    return () => {
      subscription.unsubscribe();
      stopSync?.();
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <p className="animate-fade-in pt-[40vh] text-center font-sans text-sm text-ink-faint">
        Chargement…
      </p>
    );
  }
  if (state.status === 'signed-out') {
    if (import.meta.env.DEV && devOffline) return children;
    return <Login onDevOffline={import.meta.env.DEV ? () => setDevOffline(true) : undefined} />;
  }
  return (
    <UserContext.Provider key={state.user.id} value={state.user}>
      {children}
    </UserContext.Provider>
  );
}
