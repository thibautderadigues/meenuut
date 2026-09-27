import { Selection } from '@tiptap/pm/state';
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import type { TableOfContentData } from '@tiptap/extension-table-of-contents';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from '../chrome/StatusBar';
import { isEmptyContent, saveBody, type OpenedDocument } from '../db/documents';
import { isModKey } from '../lib/platform';
import { useAutosave } from '../lib/useAutosave';
import { BubbleToolbar } from './BubbleToolbar';
import { BlockHandle } from './BlockHandle';
import { createExtensions, type MathTarget } from './extensions';
import { FindBar } from './FindBar';
import { FloatingBlockMenu } from './FloatingBlockMenu';
import { MathEditor } from './MathEditor';
import { Outline } from './Outline';
import { TitleField } from './TitleField';
import { Toolbar } from './Toolbar';

interface EditorProps {
  doc: OpenedDocument;
  /** Titre à jour (suit les renommages faits depuis la sidebar). */
  title: string;
  /** Mode focus : barre d'outils et statut masqués, blocs voisins estompés. */
  focusMode: boolean;
  /** Reçoit l'instance TipTap (exports, commandes globales), null au démontage. */
  onEditor: (editor: TiptapEditor | null) => void;
}

/** Monté avec `key={id}` : un document = une instance, donc un historique d'annulation propre. */
export function Editor({ doc, title, focusMode, onEditor }: EditorProps) {
  const editorRef = useRef<TiptapEditor | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const id = doc.meta.id;
  const [linkRequest, setLinkRequest] = useState(0);
  const [toc, setToc] = useState<TableOfContentData>([]);
  const [mathTarget, setMathTarget] = useState<MathTarget | null>(null);
  const [find, setFind] = useState<{ replace: boolean; request: number } | null>(null);

  // Une instance d'extensions par éditeur : sommaire et formules remontent jusqu'ici.
  // Différé d'une micro-tâche : le sommaire se calcule parfois pendant la création de l'éditeur.
  const extensions = useMemo(
    () =>
      createExtensions({
        onTableOfContents: (content) => queueMicrotask(() => setToc([...content])),
        onEditMath: setMathTarget,
      }),
    [],
  );
  // Document vierge : on commence par le titre.
  const blank = !doc.meta.title && isEmptyContent(doc.content);

  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (editor) await saveBody(id, editor.getJSON(), editor.getText());
  }, [id]);

  const { status, savedAt, markDirty, flush, saveNow } = useAutosave(save);

  const editor = useEditor({
    extensions,
    content: doc.content,
    autofocus: blank ? false : 'start',
    editorProps: {
      attributes: { 'aria-label': 'Contenu du document', spellcheck: 'true' },
      // Le curseur ne colle jamais aux bords : marge sous la barre d'outils collante et en bas d'écran.
      scrollThreshold: { top: 96, bottom: 120, left: 0, right: 0 },
      scrollMargin: { top: 96, bottom: 160, left: 0, right: 0 },
      // ↑ sur la première ligne du document : remonter au titre.
      handleKeyDown: (view, event) => {
        const { selection } = view.state;
        if (
          event.key === 'ArrowUp' &&
          selection.empty &&
          selection.$head.index(0) === 0 &&
          view.endOfTextblock('up')
        ) {
          const titleField = titleRef.current;
          titleField?.focus();
          titleField?.setSelectionRange(titleField.value.length, titleField.value.length);
          return true;
        }
        return false;
      },
    },
    onUpdate: markDirty,
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  useEffect(() => {
    document.title = title.trim() || 'Sans titre';
  }, [title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isModKey(event) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveNow();
      }
      // ⌘F : rechercher ; ⌥⌘F : rechercher et remplacer (event.code : ⌥ modifie event.key).
      if (isModKey(event) && event.code === 'KeyF' && !event.shiftKey) {
        event.preventDefault();
        setFind((current) => ({
          replace: event.altKey || (current?.replace ?? false),
          request: (current?.request ?? 0) + 1,
        }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveNow]);

  return (
    <>
      <main className={`animate-fade-in px-6 sm:px-10 ${focusMode ? 'focus-mode' : ''}`}>
        {/* Bandeau pleine largeur, collé en haut (marges négatives : il déborde du padding de main). */}
        <div
          data-print-hidden
          inert={focusMode}
          className={`sticky top-0 z-10 -mx-6 border-b border-rule bg-canvas/90 backdrop-blur transition-[opacity,translate] duration-150 sm:-mx-10 ${
            focusMode ? '-translate-y-2 opacity-0' : ''
          }`}
        >
          <Toolbar editor={editor} onLink={() => setLinkRequest((count) => count + 1)} />
        </div>
        <div className="doc-column pt-[6vh]">
          <h1 className="print-title">{title.trim() || 'Sans titre'}</h1>
          <TitleField
            ref={titleRef}
            id={id}
            title={title}
            autoFocus={blank}
            onExit={() => {
              // Synchrone (focus() de TipTap attend une frame) : les frappes qui suivent Entrée
              // ne doivent pas atterrir dans le titre.
              const { state, view } = editor;
              view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)).scrollIntoView());
              view.focus();
            }}
          />
          <EditorContent editor={editor} />
        </div>
        {/* Zone sous le texte : un clic ramène le curseur en fin de document. */}
        <div
          aria-hidden
          data-print-hidden
          className="h-[45vh] cursor-text"
          onMouseDown={(event) => {
            event.preventDefault();
            editor.commands.focus('end');
          }}
        />
      </main>
      {find && (
        <div className="pointer-events-none fixed top-14 right-6 z-20">
          <FindBar
            editor={editor}
            withReplace={find.replace}
            focusRequest={find.request}
            onClose={() => setFind(null)}
          />
        </div>
      )}
      <Outline editor={editor} items={toc} hidden={focusMode} />
      {!focusMode && <BlockHandle editor={editor} />}
      {mathTarget && (
        <MathEditor editor={editor} target={mathTarget} onClose={() => setMathTarget(null)} />
      )}
      <BubbleToolbar editor={editor} linkRequest={linkRequest} />
      <FloatingBlockMenu editor={editor} />
      <StatusBar
        editor={editor}
        status={status}
        savedAt={savedAt}
        hidden={focusMode}
        onRetry={flush}
      />
    </>
  );
}
