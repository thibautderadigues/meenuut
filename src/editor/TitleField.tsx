import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { renameDocument } from '../db/documents';

interface TitleFieldProps {
  id: string;
  /** Titre en base : peut changer depuis la sidebar. */
  title: string;
  autoFocus: boolean;
  /** Entrée ou ↓ en fin de titre : passer au corps du document. */
  onExit: () => void;
  ref: RefObject<HTMLTextAreaElement | null>;
}

/** Textarea plutôt qu'input : un titre long doit pouvoir passer à la ligne. */
export function TitleField({ id, title, autoFocus, onExit, ref }: TitleFieldProps) {
  const [value, setValue] = useState(title);

  // Renommé ailleurs (sidebar) : on suit, sauf pendant la saisie ici.
  useEffect(() => {
    if (document.activeElement !== ref.current) setValue(title);
  }, [ref, title]);

  // Hauteur ajustée au contenu, y compris quand la largeur change (sidebar, fenêtre).
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder="Sans titre"
      aria-label="Titre du document"
      autoFocus={autoFocus}
      spellCheck
      onChange={(event) => {
        const next = event.target.value.replace(/\s*\n\s*/g, ' ');
        setValue(next);
        void renameDocument(id, next.trim());
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        const element = event.currentTarget;
        const atEnd = element.selectionStart === element.value.length;
        if (event.key === 'Enter' || (event.key === 'ArrowDown' && atEnd)) {
          event.preventDefault();
          onExit();
        }
      }}
      className="doc-title"
    />
  );
}
