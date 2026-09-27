import { useCallback, useEffect, useRef, useState } from 'react';

/** `dirty` : modifié, écriture pas encore partie (délai d'inactivité). */
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** IndexedDB répond presque toujours sous ce seuil : on n'affiche "Enregistrement…" qu'au-delà. */
const SLOW_SAVE_MS = 300;

/**
 * Sauvegarde différée : `markDirty` à chaque modification, écriture après `delay` ms
 * d'inactivité. Écriture forcée quand l'onglet passe en arrière-plan et au démontage.
 */
export function useAutosave(save: () => Promise<void>, delay = 400) {
  const [state, setState] = useState<{ status: SaveStatus; savedAt: number }>({
    status: 'idle',
    savedAt: 0,
  });
  const saveRef = useRef(save);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;

    const slow = window.setTimeout(
      () => setState((s) => ({ ...s, status: 'saving' })),
      SLOW_SAVE_MS,
    );
    try {
      await saveRef.current();
      setState({ status: 'saved', savedAt: Date.now() });
    } catch (error) {
      console.error('Autosave failed', error);
      // La prochaine modification (ou "Réessayer") retentera l'écriture.
      dirty.current = true;
      setState((s) => ({ ...s, status: 'error' }));
    } finally {
      window.clearTimeout(slow);
    }
  }, []);

  const markDirty = useCallback(() => {
    dirty.current = true;
    setState((s) => (s.status === 'dirty' ? s : { ...s, status: 'dirty' }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delay);
  }, [flush, delay]);

  /** ⌘S : écrit si besoin, et confirme dans tous les cas. */
  const saveNow = useCallback(async () => {
    if (dirty.current) return flush();
    setState({ status: 'saved', savedAt: Date.now() });
  }, [flush]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      void flush();
    };
  }, [flush]);

  return { ...state, markDirty, flush, saveNow };
}
