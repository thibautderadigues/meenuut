import { useEditorState, type ChainedCommands, type Editor } from '@tiptap/react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { pickImages } from '../lib/images';
import { keys } from '../lib/platform';
import { IconButton } from '../ui/IconButton';
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BulletListIcon,
  ChevronDownIcon,
  CodeBlockIcon,
  DividerIcon,
  ImageIcon,
  LinkIcon,
  OrderedListIcon,
  PlusIcon,
  QuoteIcon,
  RedoIcon,
  TableIcon,
  TaskListIcon,
  TrashIcon,
  UndoIcon,
} from '../ui/icons';
import { Menu, type MenuEntry, type Point } from '../ui/Menu';
import { ColorPicker } from './ColorPicker';
import { InsertPanel } from './InsertPanel';
import { insertImages } from './insertImages';
import { activeMarks, MARK_BUTTONS } from './marks';
import { SLASH_ITEMS } from './slash/items';

interface ToolbarProps {
  editor: Editor;
  onLink: () => void;
}

type ToolbarEntry =
  | {
      id: string;
      label: string;
      shortcut?: string;
      icon: ReactNode;
      pressed?: boolean;
      disabled?: boolean;
      /** Action directe… */
      run?: (chain: ChainedCommands) => void;
      /** …ou menu déroulant ancré sous le bouton. */
      popup?: (anchor: Point) => void;
    }
  | 'separator';

type Popup = { kind: 'insert' | 'block' | 'align' | 'table' | 'color'; anchor: Point } | null;

const BLOCK_TYPES = SLASH_ITEMS.filter((item) => ['paragraph', 'h1', 'h2', 'h3'].includes(item.id));

const ALIGNMENTS = [
  { value: 'left', label: 'Aligner à gauche', shortcut: keys('shift', 'mod', 'L'), icon: AlignLeftIcon },
  { value: 'center', label: 'Centrer', shortcut: keys('shift', 'mod', 'E'), icon: AlignCenterIcon },
  { value: 'right', label: 'Aligner à droite', shortcut: undefined, icon: AlignRightIcon },
  { value: 'justify', label: 'Justifier', shortcut: keys('shift', 'mod', 'J'), icon: AlignJustifyIcon },
] as const;

/**
 * Barre d'outils (motif WAI-ARIA toolbar) : un seul arrêt de tabulation, ←/→ pour circuler,
 * ⌥F10 depuis le texte pour y entrer, Échap pour revenir au texte.
 */
export function Toolbar({ editor, onLink }: ToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [popup, setPopup] = useState<Popup>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      marks: activeMarks(editor),
      subscript: editor.isActive('subscript'),
      superscript: editor.isActive('superscript'),
      block: editor.isActive('heading', { level: 1 })
        ? 'h1'
        : editor.isActive('heading', { level: 2 })
          ? 'h2'
          : editor.isActive('heading', { level: 3 })
            ? 'h3'
            : editor.isActive('paragraph')
              ? 'paragraph'
              : null,
      align: ALIGNMENTS.find((a) => editor.isActive({ textAlign: a.value }))?.value ?? 'left',
      color: (editor.getAttributes('textStyle').color as string | undefined) ?? null,
      highlight: editor.isActive('highlight')
        ? ((editor.getAttributes('highlight').color as string | undefined) ?? 'var(--hl-yellow)')
        : null,
      link: editor.isActive('link'),
      canLink: !editor.state.selection.empty || editor.isActive('link'),
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      taskList: editor.isActive('taskList'),
      blockquote: editor.isActive('blockquote'),
      codeBlock: editor.isActive('codeBlock'),
      inTable: editor.isActive('table'),
      canMerge: editor.can().mergeOrSplit(),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  });

  // Tous les éléments (pour l'index de l'arrêt de tabulation) ; seuls les actifs sont navigables.
  const items = (): HTMLElement[] =>
    Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-toolbar-item]') ?? []);
  const enabledItems = () => items().filter((item) => !(item as HTMLButtonElement).disabled);

  const focusAt = (index: number) => {
    const enabled = enabledItems();
    enabled[(index + enabled.length) % enabled.length]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = enabledItems().indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    switch (event.key) {
      case 'ArrowRight':
        focusAt(index + 1);
        break;
      case 'ArrowLeft':
        focusAt(index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(-1);
        break;
      case 'Escape':
        editor.commands.focus();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const open = (kind: NonNullable<Popup>['kind']) => (anchor: Point) => setPopup({ kind, anchor });
  const alignment = ALIGNMENTS.find((a) => a.value === state.align) ?? ALIGNMENTS[0];
  const AlignIcon = alignment.icon;

  const entries: ToolbarEntry[] = [
    ...MARK_BUTTONS.map(
      (mark): ToolbarEntry => ({
        id: mark.name,
        label: mark.label,
        shortcut: mark.shortcut,
        icon: mark.glyph,
        pressed: state.marks[mark.name],
        run: (chain) => mark.toggle(chain).run(),
      }),
    ),
    {
      id: 'superscript',
      label: 'Exposant',
      shortcut: keys('mod', '.'),
      icon: (
        <span className="text-[13px]">
          x<sup className="text-[9px]">2</sup>
        </span>
      ),
      pressed: state.superscript,
      run: (chain) => chain.toggleSuperscript().run(),
    },
    {
      id: 'subscript',
      label: 'Indice',
      shortcut: keys('mod', ','),
      icon: (
        <span className="text-[13px]">
          x<sub className="text-[9px]">2</sub>
        </span>
      ),
      pressed: state.subscript,
      run: (chain) => chain.toggleSubscript().run(),
    },
    {
      id: 'color',
      label: 'Couleur et surlignage',
      icon: (
        <span className="flex flex-col items-center leading-none">
          <span className="text-[14px] font-semibold" style={{ color: state.color ?? undefined }}>
            A
          </span>
          <span
            className="mt-0.5 h-[3px] w-4 rounded-full"
            style={{ background: state.highlight ?? 'var(--hl-yellow)' }}
          />
        </span>
      ),
      popup: open('color'),
    },
    'separator',
    { id: 'align', label: alignment.label, icon: <AlignIcon />, popup: open('align') },
    {
      id: 'link',
      label: 'Lien',
      shortcut: keys('mod', 'K'),
      icon: <LinkIcon />,
      pressed: state.link,
      disabled: !state.canLink,
      run: () => onLink(),
    },
    'separator',
    {
      id: 'bulletList',
      label: 'Liste à puces',
      shortcut: keys('shift', 'mod', '8'),
      icon: <BulletListIcon />,
      pressed: state.bulletList,
      run: (chain) => chain.toggleBulletList().run(),
    },
    {
      id: 'orderedList',
      label: 'Liste numérotée',
      shortcut: keys('shift', 'mod', '7'),
      icon: <OrderedListIcon />,
      pressed: state.orderedList,
      run: (chain) => chain.toggleOrderedList().run(),
    },
    {
      id: 'taskList',
      label: 'Liste de tâches',
      shortcut: keys('shift', 'mod', '9'),
      icon: <TaskListIcon />,
      pressed: state.taskList,
      run: (chain) => chain.toggleTaskList().run(),
    },
    'separator',
    {
      id: 'blockquote',
      label: 'Citation',
      shortcut: keys('shift', 'mod', 'B'),
      icon: <QuoteIcon />,
      pressed: state.blockquote,
      run: (chain) => chain.toggleBlockquote().run(),
    },
    {
      id: 'codeBlock',
      label: 'Bloc de code',
      shortcut: keys('alt', 'mod', 'C'),
      icon: <CodeBlockIcon />,
      pressed: state.codeBlock,
      run: (chain) => chain.toggleCodeBlock().run(),
    },
    {
      id: 'divider',
      label: 'Séparateur',
      icon: <DividerIcon />,
      run: (chain) => chain.setHorizontalRule().run(),
    },
    state.inTable
      ? { id: 'table', label: 'Tableau', icon: <TableIcon />, pressed: true, popup: open('table') }
      : {
          id: 'table',
          label: 'Insérer un tableau',
          icon: <TableIcon />,
          run: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        },
    {
      id: 'image',
      label: 'Insérer une image',
      icon: <ImageIcon />,
      run: () => void pickImages().then((files) => insertImages(editor, files)),
    },
    'separator',
    {
      id: 'undo',
      label: 'Annuler',
      shortcut: keys('mod', 'Z'),
      icon: <UndoIcon />,
      disabled: !state.canUndo,
      run: (chain) => chain.undo().run(),
    },
    {
      id: 'redo',
      label: 'Rétablir',
      shortcut: keys('shift', 'mod', 'Z'),
      icon: <RedoIcon />,
      disabled: !state.canRedo,
      run: (chain) => chain.redo().run(),
    },
  ];

  // Index 0 : « Insérer », 1 : le sélecteur de bloc, puis les boutons.
  // Un bouton désactivé ne peut pas porter l'arrêt de tabulation : il revient à « Insérer ».
  const FIXED = 2;
  const buttons = entries.filter((entry) => entry !== 'separator');
  const tabStop = buttons[focusIndex - FIXED]?.disabled ? 0 : focusIndex;

  // ⌥F10 (convention Google Docs / TinyMCE) : entrer dans la barre depuis le texte.
  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.altKey && event.key === 'F10') {
        event.preventDefault();
        items()[tabStop]?.focus();
      }
    };
    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  });

  const chain = () => editor.chain().focus();
  const anchorOf = (element: HTMLElement): Point => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom };
  };

  const tableEntries: MenuEntry[] = [
    { label: 'Ligne au-dessus', icon: PlusIcon, run: () => chain().addRowBefore().run() },
    { label: 'Ligne en dessous', icon: PlusIcon, run: () => chain().addRowAfter().run() },
    { label: 'Colonne à gauche', icon: PlusIcon, run: () => chain().addColumnBefore().run() },
    { label: 'Colonne à droite', icon: PlusIcon, run: () => chain().addColumnAfter().run() },
    'separator',
    { label: 'Ligne d’en-tête', icon: TableIcon, run: () => chain().toggleHeaderRow().run() },
    ...(state.canMerge
      ? [{ label: 'Fusionner ou scinder', icon: TableIcon, run: () => chain().mergeOrSplit().run() }]
      : []),
    'separator',
    { label: 'Supprimer la ligne', icon: TrashIcon, run: () => chain().deleteRow().run() },
    { label: 'Supprimer la colonne', icon: TrashIcon, run: () => chain().deleteColumn().run() },
    {
      label: 'Supprimer le tableau',
      icon: TrashIcon,
      danger: true,
      run: () => chain().deleteTable().run(),
    },
  ];

  const blockLabel = BLOCK_TYPES.find((item) => item.id === state.block)?.label ?? 'Texte';
  const closePopup = () => setPopup(null);
  let index = FIXED - 1;

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Mise en forme"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const position = items().indexOf(event.target as HTMLElement);
        if (position >= 0) setFocusIndex(position);
      }}
      // Garde le focus et la sélection dans l'éditeur au clic souris.
      onMouseDown={(event) => event.preventDefault()}
      className="flex w-full items-center justify-center-safe gap-0.5 overflow-x-auto py-2 pr-3 pl-12 font-sans md:pl-3"
    >
      <button
        type="button"
        data-toolbar-item
        tabIndex={tabStop === 0 ? 0 : -1}
        aria-haspopup="dialog"
        aria-expanded={popup?.kind === 'insert'}
        aria-label="Insérer un bloc"
        data-tooltip="Insérer un bloc"
        data-shortcut="/"
        onClick={(event) => setPopup({ kind: 'insert', anchor: anchorOf(event.currentTarget) })}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setPopup({ kind: 'insert', anchor: anchorOf(event.currentTarget) });
          }
        }}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent-soft px-2.5 text-[13px] font-medium text-accent transition-colors duration-100 hover:bg-accent hover:text-white focus-visible:outline-2 focus-visible:outline-accent"
      >
        <PlusIcon />
        {/* Sur mobile, le pictogramme seul : la barre défile et le texte passerait sous le bouton de la sidebar. */}
        <span className="max-md:sr-only">Insérer</span>
      </button>
      <Separator />

      <button
        type="button"
        data-toolbar-item
        tabIndex={tabStop === 1 ? 0 : -1}
        aria-haspopup="menu"
        aria-expanded={popup?.kind === 'block'}
        aria-label={`Type de bloc : ${blockLabel}`}
        data-tooltip="Type de bloc"
        data-shortcut={keys('alt', 'mod', '0') + '…3'}
        onClick={(event) => setPopup({ kind: 'block', anchor: anchorOf(event.currentTarget) })}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setPopup({ kind: 'block', anchor: anchorOf(event.currentTarget) });
          }
        }}
        className="flex h-8 w-28 shrink-0 items-center justify-between gap-1 rounded-md px-2 text-[13px] text-ink transition-colors duration-100 hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="truncate">{blockLabel}</span>
        <span className="text-ink-faint">
          <ChevronDownIcon />
        </span>
      </button>
      <Separator />

      {entries.map((entry, position) => {
        if (entry === 'separator') return <Separator key={`separator-${position}`} />;
        index += 1;
        const itemIndex = index;
        return (
          <IconButton
            key={entry.id}
            data-toolbar-item
            tabIndex={tabStop === itemIndex ? 0 : -1}
            aria-haspopup={entry.popup ? 'menu' : undefined}
            label={entry.label}
            shortcut={entry.shortcut}
            pressed={entry.pressed}
            disabled={entry.disabled}
            onClick={(event) => {
              if (entry.popup) entry.popup(anchorOf(event.currentTarget));
              else entry.run?.(editor.chain().focus());
            }}
            onKeyDown={(event) => {
              if (entry.popup && event.key === 'ArrowDown') {
                event.preventDefault();
                entry.popup(anchorOf(event.currentTarget));
              }
            }}
            className="disabled:pointer-events-none disabled:opacity-35"
          >
            {entry.icon}
          </IconButton>
        );
      })}

      {popup?.kind === 'block' && (
        <Menu
          label="Type de bloc"
          anchor={popup.anchor}
          onClose={closePopup}
          entries={BLOCK_TYPES.map((item) => ({
            label: item.label,
            icon: item.icon,
            shortcut: item.hint,
            checked: item.id === state.block,
            run: () => item.run(editor.chain().focus(), editor),
          }))}
        />
      )}
      {popup?.kind === 'align' && (
        <Menu
          label="Alignement"
          anchor={popup.anchor}
          onClose={closePopup}
          entries={ALIGNMENTS.map((option) => ({
            label: option.label,
            icon: option.icon,
            shortcut: option.shortcut,
            checked: option.value === state.align,
            run: () => chain().setTextAlign(option.value).run(),
          }))}
        />
      )}
      {popup?.kind === 'table' && (
        <Menu label="Tableau" anchor={popup.anchor} onClose={closePopup} entries={tableEntries} />
      )}
      {popup?.kind === 'insert' && (
        <InsertPanel editor={editor} anchor={popup.anchor} onClose={closePopup} />
      )}
      {popup?.kind === 'color' && (
        <ColorPicker editor={editor} anchor={popup.anchor} onClose={closePopup} />
      )}
    </div>
  );
}

function Separator() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-rule" />;
}
