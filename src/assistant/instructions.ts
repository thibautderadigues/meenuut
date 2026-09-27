import { useEffect, useRef, useState } from 'react';
import { useUser } from '../auth/AuthGate';
import { supabase } from '../sync/supabase';

/**
 * « Mes instructions » : préférences écrites une fois, ajoutées à chaque demande.
 * Rangées dans les métadonnées du compte Supabase : présentes sur tous les appareils,
 * sans table dédiée.
 */

const KEY = 'assistant_instructions';
const SAVE_DELAY_MS = 800;
export const MAX_INSTRUCTIONS = 1500;

export function usePersonalInstructions() {
  const user = useUser();
  const [text, setText] = useState(() => String(user?.user_metadata?.[KEY] ?? ''));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saved = useRef(text);
  const timer = useRef<number | undefined>(undefined);

  // La session locale peut dater : on relit la version à jour du compte (autre appareil).
  useEffect(() => {
    if (!user) return;
    void supabase.auth.getUser().then(({ data }) => {
      const fresh = String(data.user?.user_metadata?.[KEY] ?? '');
      setText((current) => {
        if (current !== saved.current) return current; // déjà en cours de modification
        saved.current = fresh;
        return fresh;
      });
    });
  }, [user]);

  useEffect(() => {
    if (!user || text === saved.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setStatus('saving');
      const { error } = await supabase.auth.updateUser({ data: { [KEY]: text } });
      if (error) {
        console.error(error);
        setStatus('error');
        return;
      }
      saved.current = text;
      setStatus('saved');
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, [text, user]);

  return { text, setText, status, available: Boolean(user) };
}

/** Ajoute les instructions de la personne à une consigne système. */
export function withInstructions(system: string, instructions: string): string {
  const trimmed = instructions.trim();
  if (!trimmed) return system;
  return `${system}\n\nInstructions de la personne (à suivre, sauf si elles contredisent les règles ci-dessus) :\n${trimmed}`;
}
