import type { Editor } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { keys } from '../lib/platform';
import { acceptAll, getPendings, rejectAll, type Pending } from './aiSuggestion';

/**
 * Barre de revue, comme dans Cursor : tant que des modifications de l'assistant attendent
 * dans le document, elle flotte en bas de l'écran — combien il y en a, passer de l'une à
 * l'autre, tout refuser, tout accepter.
 */
export function SuggestionReviewBar({ editor }: { editor: Editor }) {
  const [pendings, setPendings] = useState<Pending[]>(() => getPendings(editor.state));
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const update = () => setPendings([...getPendings(editor.state)].sort((a, b) => a.from - b.from));
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);

  const count = pendings.length;
  useEffect(() => {
    if (index >= count) setIndex(Math.max(0, count - 1));
  }, [count, index]);

  if (count === 0) return null;

  const go = (next: number) => {
    const target = (next + count) % count;
    setIndex(target);
    const pending = pendings[target];
    if (!pending) return;
    editor.chain().focus().setTextSelection(pending.from).run();
    // Au milieu de l'écran plutôt qu'au bord : on voit l'avant et l'après.
    const { node } = editor.view.domAtPos(pending.from);
    const element = node instanceof HTMLElement ? node : node.parentElement;
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return (
    <div
      data-print-hidden
      role="toolbar"
      aria-label="Modifications de l’assistant"
      className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 animate-pop-in items-center gap-1 rounded-xl border border-rule-strong bg-elevated p-1 font-sans text-[13px] shadow-popover"
    >
      <span className="flex items-center gap-2 pr-1 pl-2.5 text-ink-muted">
        <span className="size-2 rounded-full bg-[var(--tx-green)]" aria-hidden />
        {count} modification{count > 1 ? 's' : ''}
      </span>
      {count > 1 && (
        <span className="flex items-center text-ink-faint tabular-nums">
          <button
            type="button"
            aria-label="Modification précédente"
            onClick={() => go(index - 1)}
            className="grid size-7 place-items-center rounded-md hover:bg-surface hover:text-ink"
          >
            ‹
          </button>
          {index + 1} / {count}
          <button
            type="button"
            aria-label="Modification suivante"
            onClick={() => go(index + 1)}
            className="grid size-7 place-items-center rounded-md hover:bg-surface hover:text-ink"
          >
            ›
          </button>
        </span>
      )}
      <span className="mx-1 h-5 w-px bg-rule" aria-hidden />
      <button
        type="button"
        onClick={() => rejectAll(editor)}
        className="flex h-8 items-center gap-2 rounded-lg px-3 text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-danger"
      >
        Tout refuser
        <kbd className="font-sans text-[11px] text-ink-faint">{keys('mod', '⌫')}</kbd>
      </button>
      <button
        type="button"
        onClick={() => acceptAll(editor)}
        className="flex h-8 items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--tx-green)_88%,black)] px-3 font-medium text-white transition-colors hover:bg-[color-mix(in_srgb,var(--tx-green)_75%,black)]"
      >
        Tout accepter
        <kbd className="font-sans text-[11px] text-white/70">{keys('mod', '↵')}</kbd>
      </button>
    </div>
  );
}
