import { useSyncExternalStore } from 'react';

/** Passage sélectionné dans l'éditeur, joint à la prochaine question. */
export interface SelectionContext {
  docId: string;
  from: number;
  to: number;
  text: string;
}

interface AssistantState {
  open: boolean;
  selection: SelectionContext | null;
  /** Incrémenté à chaque ouverture demandée : le panneau place alors le focus dans le champ. */
  focusRequest: number;
}

let state: AssistantState = { open: false, selection: null, focusRequest: 0 };
const listeners = new Set<() => void>();

function set(next: Partial<AssistantState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function useAssistant(): AssistantState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** Ouvre le panneau, avec le passage sélectionné s'il y en a un. */
export function openAssistant(selection: SelectionContext | null = null) {
  set({ open: true, selection: selection ?? state.selection, focusRequest: state.focusRequest + 1 });
}

export function closeAssistant() {
  set({ open: false });
}

export function toggleAssistant() {
  if (state.open) closeAssistant();
  else openAssistant();
}

/** Suit la sélection de l'éditeur pendant que le panneau est ouvert (sans lui prendre le focus). */
export function setSelectionContext(selection: SelectionContext | null) {
  const current = state.selection;
  if (
    current === selection ||
    (current && selection && current.docId === selection.docId && current.from === selection.from && current.to === selection.to)
  ) {
    return;
  }
  set({ selection });
}

export function clearSelectionContext() {
  set({ selection: null });
}
