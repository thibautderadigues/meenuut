import { NodeSelection } from '@tiptap/pm/state';
import { useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { displayHref, normalizeHref } from '../lib/links';
import { isModKey, keys } from '../lib/platform';
import { IconButton } from '../ui/IconButton';
import { AssistantIcon } from '../assistant/AssistantIcon';
import { ASSISTANT_NAME } from '../assistant/provider';
import { openAssistant } from '../assistant/store';
import { CheckIcon, ExternalIcon, LinkIcon, PencilIcon, UnlinkIcon } from '../ui/icons';
import { activeMarks, MARK_BUTTONS } from './marks';
import { ColorPicker } from './ColorPicker';
import type { Point } from '../ui/Popover';

const PLUGIN_KEY = 'bubbleMenu';

type ShouldShowProps = Parameters<NonNullable<Parameters<typeof BubbleMenu>[0]['shouldShow']>>[0];

/**
 * Trois états dans une même bulle :
 * - sélection de texte → formatage ;
 * - curseur dans un lien → aperçu (ouvrir, modifier, retirer) ;
 * - édition de lien (bouton ou ⌘K) → champ URL.
 */
interface BubbleToolbarProps {
  editor: Editor;
  docId: string;
  /** Incrémenté par la barre d'outils pour ouvrir l'édition de lien ici. */
  linkRequest: number;
}

export function BubbleToolbar({ editor, docId, linkRequest }: BubbleToolbarProps) {
  const [editingLink, setEditingLinkState] = useState(false);
  // Lu par shouldShow, qui vit dans le plugin : doit être à jour immédiatement, pas au prochain rendu.
  const editingLinkRef = useRef(false);
  const [colorAnchor, setColorAnchor] = useState<Point | null>(null);

  const setEditingLink = useCallback((value: boolean) => {
    editingLinkRef.current = value;
    setEditingLinkState(value);
  }, []);

  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      marks: activeMarks(editor),
      highlight: editor.isActive('highlight')
        ? ((editor.getAttributes('highlight').color as string | undefined) ?? 'var(--hl-yellow)')
        : null,
      color: (editor.getAttributes('textStyle').color as string | undefined) ?? null,
      link: editor.isActive('link'),
      href: editor.getAttributes('link').href as string | undefined,
      empty: editor.state.selection.empty,
    }),
  });

  const shouldShow = useCallback(({ editor, state, from, to }: ShouldShowProps) => {
    if (editingLinkRef.current) return true;
    if (!editor.isFocused || !editor.isEditable) return false;
    if (state.selection instanceof NodeSelection || editor.isActive('codeBlock')) return false;
    if (from === to) return editor.isActive('link');
    return state.doc.textBetween(from, to).length > 0;
  }, []);

  const startLinkEditing = useCallback(() => {
    if (editor.state.selection.empty) editor.commands.extendMarkRange('link');
    setEditingLink(true);
    editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, 'show'));
  }, [editor, setEditingLink]);

  const stopLinkEditing = useCallback(
    (refocusEditor: boolean) => {
      if (!editingLinkRef.current) return;
      setEditingLink(false);
      if (refocusEditor) editor.commands.focus();
      else editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, 'hide'));
    },
    [editor, setEditingLink],
  );

  useEffect(() => {
    if (linkRequest > 0) startLinkEditing();
  }, [linkRequest, startLinkEditing]);

  // ⌘K sur une sélection : édition du lien. Sinon (y compris curseur posé dans un lien, état
  // invisible), on laisse passer : c'est la palette.
  useEffect(() => {
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isModKey(event) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'k')
        return;
      if (editor.state.selection.empty) return;
      event.preventDefault();
      event.stopPropagation();
      startLinkEditing();
    };
    dom.addEventListener('keydown', onKeyDown);
    return () => dom.removeEventListener('keydown', onKeyDown);
  }, [editor, startLinkEditing]);

  // On sort du mode édition avant de refocaliser l'éditeur : le blur du champ qui suit ne doit rien annuler.
  const applyLink = (href: string | null) => {
    setEditingLink(false);
    const chain = editor.chain().focus().extendMarkRange('link');
    if (href) chain.setLink({ href }).run();
    else chain.unsetLink().run();
  };

  const removeLink = () => {
    setEditingLink(false);
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
  };

  let content: ReactNode;
  if (editingLink) {
    content = (
      <LinkForm
        initialHref={state.href ?? ''}
        onSubmit={applyLink}
        onCancel={stopLinkEditing}
        onRemove={state.link ? removeLink : undefined}
      />
    );
  } else if (state.empty && state.link && state.href) {
    content = (
      <div className="flex items-center gap-0.5">
        <a
          href={state.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex max-w-[30ch] items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-ink-muted transition-colors duration-100 hover:bg-surface hover:text-ink"
        >
          <span className="truncate">{displayHref(state.href)}</span>
          <ExternalIcon />
        </a>
        <Separator />
        <IconButton label="Modifier le lien" shortcut={keys('mod', 'K')} onClick={startLinkEditing}>
          <PencilIcon />
        </IconButton>
        <IconButton label="Retirer le lien" onClick={removeLink}>
          <UnlinkIcon />
        </IconButton>
      </div>
    );
  } else {
    const chain = () => editor.chain().focus();
    content = (
      <div className="flex items-center gap-0.5">
        {MARK_BUTTONS.map((mark) => (
          <IconButton
            key={mark.name}
            label={mark.label}
            shortcut={mark.shortcut}
            pressed={state.marks[mark.name]}
            onClick={() => mark.toggle(chain()).run()}
          >
            {mark.glyph}
          </IconButton>
        ))}
        <IconButton
          label="Couleur et surlignage"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setColorAnchor({ x: rect.left, y: rect.bottom + 4 });
          }}
        >
          <span className="flex flex-col items-center leading-none">
            <span className="text-[14px] font-semibold" style={{ color: state.color ?? undefined }}>
              A
            </span>
            <span
              className="mt-0.5 h-[3px] w-4 rounded-full"
              style={{ background: state.highlight ?? 'var(--hl-yellow)' }}
            />
          </span>
        </IconButton>
        <Separator />
        <IconButton
          label="Lien"
          shortcut={keys('mod', 'K')}
          pressed={state.link}
          onClick={startLinkEditing}
        >
          <LinkIcon />
        </IconButton>
        <Separator />
        <button
          type="button"
          data-tooltip={`Demander à ${ASSISTANT_NAME} à propos de ce passage`}
          onClick={() => {
            const { from, to } = editor.state.selection;
            openAssistant({ docId, from, to, text: editor.state.doc.textBetween(from, to, '\n') });
          }}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-ai transition-colors duration-100 hover:bg-ai-soft focus-visible:outline-2 focus-visible:outline-accent"
        >
          <AssistantIcon />
          Demander
        </button>
      </div>
    );
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={PLUGIN_KEY}
      data-print-hidden
      shouldShow={shouldShow}
      options={{ placement: 'top', offset: 8, flip: true, shift: { padding: 8 } }}
      className="z-40"
    >
      <div
        // Garde le focus et la sélection dans l'éditeur quand on clique un bouton.
        onMouseDown={(event) => {
          if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
        }}
        className="animate-pop-in rounded-lg border border-rule bg-elevated p-1 font-sans shadow-popover"
      >
        {content}
      </div>
      {colorAnchor && (
        <ColorPicker editor={editor} anchor={colorAnchor} onClose={() => setColorAnchor(null)} />
      )}
    </BubbleMenu>
  );
}

function Separator() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-rule" />;
}

interface LinkFormProps {
  initialHref: string;
  onSubmit: (href: string | null) => void;
  onCancel: (refocusEditor: boolean) => void;
  onRemove?: () => void;
}

function LinkForm({ initialHref, onSubmit, onCancel, onRemove }: LinkFormProps) {
  const [value, setValue] = useState(initialHref);
  const [invalid, setInvalid] = useState(false);

  return (
    <form
      className="flex items-center gap-0.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.trim()) return onSubmit(null);
        const href = normalizeHref(value);
        if (href) onSubmit(href);
        else setInvalid(true);
      }}
      onBlur={(event) => {
        // Focus parti hors de la bulle : on abandonne sans voler le focus.
        if (!event.currentTarget.contains(event.relatedTarget)) onCancel(false);
      }}
    >
      <input
        autoFocus
        type="text"
        inputMode="url"
        value={value}
        placeholder="Coller ou saisir un lien"
        aria-label="Adresse du lien"
        aria-invalid={invalid}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel(true);
          }
        }}
        className={`h-8 w-64 rounded-md bg-transparent px-2 text-[13px] outline-none placeholder:text-ink-faint ${
          invalid ? 'text-danger' : 'text-ink'
        }`}
      />
      <IconButton type="submit" label="Appliquer" shortcut="↵">
        <CheckIcon />
      </IconButton>
      {onRemove && (
        <IconButton label="Retirer le lien" onClick={onRemove}>
          <UnlinkIcon />
        </IconButton>
      )}
    </form>
  );
}
