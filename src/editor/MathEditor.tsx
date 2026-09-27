import type { Editor } from '@tiptap/react';
import katex from 'katex';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '../ui/Popover';
import type { MathTarget } from './extensions';

interface MathEditorProps {
  editor: Editor;
  target: MathTarget;
  onClose: () => void;
}

/** Position d'ancrage : sous le nœud de formule. */
function anchorFor(editor: Editor, pos: number) {
  const dom = editor.view.nodeDOM(pos);
  const rect = dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
  if (rect) return { x: rect.left, y: rect.bottom };
  const coords = editor.view.coordsAtPos(pos);
  return { x: coords.left, y: coords.bottom };
}

/**
 * Édition LaTeX avec aperçu KaTeX en direct. Entrée applique (⇧Entrée : retour à la ligne),
 * Échap annule, formule vide = suppression.
 */
export function MathEditor({ editor, target, onClose }: MathEditorProps) {
  const [latex, setLatex] = useState(target.latex);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const anchor = useMemo(() => anchorFor(editor, target.pos), [editor, target.pos]);

  const preview = useMemo(
    () =>
      katex.renderToString(latex || '\\,', {
        throwOnError: false,
        displayMode: target.kind === 'block',
      }),
    [latex, target.kind],
  );

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const apply = () => {
    const chain = editor.chain().focus();
    if (!latex.trim()) {
      if (target.kind === 'inline') chain.deleteInlineMath({ pos: target.pos }).run();
      else chain.deleteBlockMath({ pos: target.pos }).run();
    } else if (target.kind === 'inline') {
      chain.updateInlineMath({ latex, pos: target.pos }).run();
    } else {
      chain.updateBlockMath({ latex, pos: target.pos }).run();
    }
    onClose();
  };

  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      role="dialog"
      aria-label={target.kind === 'inline' ? 'Formule' : 'Bloc de formule'}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          onClose();
          editor.commands.focus();
        }
      }}
      className="w-[22rem] p-2"
    >
      <textarea
        ref={inputRef}
        value={latex}
        rows={target.kind === 'block' ? 3 : 1}
        spellCheck={false}
        aria-label="Formule LaTeX"
        placeholder="\frac{a}{b}"
        onChange={(event) => setLatex(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            apply();
          }
        }}
        className="block w-full resize-none rounded-md bg-surface px-2.5 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-faint focus:shadow-[inset_0_0_0_1px_var(--accent)]"
      />
      <div
        aria-live="polite"
        className="mt-2 min-h-10 overflow-x-auto rounded-md px-2 py-2 text-center text-ink"
        dangerouslySetInnerHTML={{ __html: preview }}
      />
      <div className="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
        <span>↵ valider · ⇧↵ retour à la ligne · Échap annuler</span>
        <button
          type="button"
          onClick={apply}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent"
        >
          Valider
        </button>
      </div>
    </Popover>
  );
}
