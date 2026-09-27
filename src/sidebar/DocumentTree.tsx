import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { DocMeta, Folder } from '../db/db';
import { moveDocument, renameDocument, setDocumentIcon, setPinned } from '../db/documents';
import { createFolder, moveFolder, renameFolder, setFolderIcon } from '../db/folders';
import { buildTree, docLabel, folderChain, isWithin, type TreeNode } from '../db/tree';
import { keys } from '../lib/platform';
import { IconButton } from '../ui/IconButton';
import {
  FolderPlusIcon,
  MoveIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SmileIcon,
  TrashIcon,
} from '../ui/icons';
import { Menu, type MenuEntry, type Point } from '../ui/Menu';
import { setDragGhost } from './dragGhost';
import { IconPicker } from './IconPicker';
import { TreeRow, type Row } from './TreeRow';

export interface ItemRef {
  kind: 'doc' | 'folder';
  id: string;
}

interface DocumentTreeProps {
  docs: DocMeta[];
  folders: Folder[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onCreateDocument: (folderId: string | null) => void;
  onDeleteItem: (item: ItemRef) => void;
  onMoveItem: (item: ItemRef) => void;
  /** ↑ sur la première ligne : remonter vers la recherche. */
  onExitTop: () => void;
}

/** Cible de dépôt : un dossier, ou la racine. */
type DropTarget = { folderId: string | null };

const AUTO_EXPAND_DELAY_MS = 600;

function flatten(nodes: TreeNode[], expanded: Set<string>, level = 1, parentKey: string | null = null): Row[] {
  return nodes.flatMap((node): Row[] => {
    if (node.kind === 'doc') {
      return [{ key: `doc:${node.doc.id}`, kind: 'doc', doc: node.doc, level, parentKey }];
    }
    const key = `folder:${node.folder.id}`;
    const open = expanded.has(node.folder.id);
    const row: Row = {
      key,
      kind: 'folder',
      folder: node.folder,
      level,
      expanded: open,
      count: node.count,
      parentKey,
    };
    return open ? [row, ...flatten(node.children, expanded, level + 1, key)] : [row];
  });
}

function useExpandedFolders() {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('expanded') ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('expanded', JSON.stringify([...expanded]));
    } catch {
      // Préférence non persistée : sans conséquence.
    }
  }, [expanded]);
  return [expanded, setExpanded] as const;
}

const itemOf = (row: Row): ItemRef =>
  row.kind === 'folder' ? { kind: 'folder', id: row.folder.id } : { kind: 'doc', id: row.doc.id };

export function DocumentTree({
  docs,
  folders,
  activeId,
  onOpen,
  onCreateDocument,
  onDeleteItem,
  onMoveItem,
  onExitTop,
}: DocumentTreeProps) {
  const [expanded, setExpanded] = useExpandedFolders();
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ row: Row | null; anchor: Point } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ row: Row; anchor: Point } | null>(null);
  const dragged = useRef<ItemRef | null>(null);
  const expandTimer = useRef<{ folderId: string; timeout: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closePicker = useCallback(() => setPicker(null), []);

  const tree = useMemo(() => buildTree(folders, docs), [folders, docs]);
  const treeRows = useMemo(() => flatten(tree, expanded), [tree, expanded]);
  const pinnedRows = useMemo(
    () =>
      docs
        .filter((doc) => doc.pinnedAt !== null)
        .sort((a, b) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0))
        .map((doc): Row => ({ key: `pin:${doc.id}`, kind: 'doc', doc, level: 1, parentKey: null })),
    [docs],
  );
  const rows = [...pinnedRows, ...treeRows];

  // À l'ouverture d'un document (ou quand il change de dossier), ses dossiers parents se déplient.
  // Volontairement pas à chaque changement de `expanded` : l'utilisateur doit pouvoir les replier.
  const activeFolderId = docs.find((doc) => doc.id === activeId)?.folderId ?? null;
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  useEffect(() => {
    const chain = folderChain(foldersRef.current, activeFolderId);
    if (chain.length === 0) return;
    setExpanded((previous) =>
      chain.every((id) => previous.has(id)) ? previous : new Set([...previous, ...chain]),
    );
  }, [activeId, activeFolderId, setExpanded]);

  // Un seul arrêt de tabulation (roving tabindex).
  const tabbableKey = rows.some((row) => row.key === focusedKey)
    ? focusedKey
    : (treeRows.find((row) => row.kind === 'doc' && row.doc.id === activeId)?.key ?? rows[0]?.key);

  const focusRow = (key: string | undefined) => {
    if (!key) return;
    setFocusedKey(key);
    requestAnimationFrame(() =>
      containerRef.current
        ?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)
        ?.focus(),
    );
  };

  const setOpen = (folderId: string, open: boolean) =>
    setExpanded((previous) => {
      if (previous.has(folderId) === open) return previous;
      const next = new Set(previous);
      if (open) next.add(folderId);
      else next.delete(folderId);
      return next;
    });

  const createFolderIn = async (parentId: string | null) => {
    const id = await createFolder(parentId);
    if (parentId) setOpen(parentId, true);
    setRenamingKey(`folder:${id}`);
  };

  const commitRename = (row: Row, value: string, refocus: boolean) => {
    setRenamingKey(null);
    const name = value.trim();
    if (row.kind === 'folder') {
      if (name) void renameFolder(row.folder.id, name);
    } else {
      void renameDocument(row.doc.id, name);
    }
    if (refocus) focusRow(row.key);
  };

  const activate = (row: Row) => {
    if (row.kind === 'folder') setOpen(row.folder.id, !row.expanded);
    else onOpen(row.doc.id);
  };

  const menuEntries = (row: Row | null): MenuEntry[] => {
    if (!row) {
      return [
        { label: 'Nouveau document', icon: PlusIcon, run: () => onCreateDocument(null) },
        { label: 'Nouveau dossier', icon: FolderPlusIcon, run: () => void createFolderIn(null) },
      ];
    }
    const remove: MenuEntry = {
      label: 'Supprimer',
      icon: TrashIcon,
      shortcut: '⌫',
      danger: true,
      run: () => onDeleteItem(itemOf(row)),
    };
    const rename: MenuEntry = {
      label: 'Renommer',
      icon: PencilIcon,
      shortcut: 'F2',
      run: () => setRenamingKey(row.key),
    };
    const move: MenuEntry = {
      label: 'Déplacer vers…',
      icon: MoveIcon,
      run: () => onMoveItem(itemOf(row)),
    };
    const changeIcon: MenuEntry = {
      label: 'Changer l’icône…',
      icon: SmileIcon,
      run: () => setPicker({ row, anchor: menu?.anchor ?? { x: 0, y: 0 } }),
    };
    if (row.kind === 'folder') {
      const id = row.folder.id;
      return [
        {
          label: 'Nouveau document',
          icon: PlusIcon,
          run: () => {
            setOpen(id, true);
            onCreateDocument(id);
          },
        },
        { label: 'Nouveau sous-dossier', icon: FolderPlusIcon, run: () => void createFolderIn(id) },
        'separator',
        rename,
        changeIcon,
        move,
        'separator',
        remove,
      ];
    }
    const pinned = row.doc.pinnedAt !== null;
    return [
      rename,
      changeIcon,
      {
        label: pinned ? 'Désépingler' : 'Épingler',
        icon: PinIcon,
        run: () => void setPinned(row.doc.id, !pinned),
      },
      move,
      'separator',
      remove,
    ];
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = (event.target as HTMLElement).dataset.rowKey;
    const index = rows.findIndex((row) => row.key === key);
    const row = rows[index];
    if (!row) return;

    switch (event.key) {
      case 'ArrowDown':
        focusRow(rows[index + 1]?.key);
        break;
      case 'ArrowUp':
        if (index === 0) onExitTop();
        else focusRow(rows[index - 1]?.key);
        break;
      case 'Home':
        focusRow(rows[0]?.key);
        break;
      case 'End':
        focusRow(rows.at(-1)?.key);
        break;
      case 'ArrowRight':
        if (row.kind !== 'folder') return;
        if (!row.expanded) setOpen(row.folder.id, true);
        else if (rows[index + 1]?.parentKey === row.key) focusRow(rows[index + 1]?.key);
        break;
      case 'ArrowLeft':
        if (row.kind === 'folder' && row.expanded) setOpen(row.folder.id, false);
        else if (row.parentKey) focusRow(row.parentKey);
        break;
      case 'Enter':
      case ' ':
        activate(row);
        break;
      case 'F2':
        setRenamingKey(row.key);
        break;
      case 'Delete':
      case 'Backspace':
        onDeleteItem(itemOf(row));
        break;
      case 'ContextMenu':
      case 'F10': {
        if (event.key === 'F10' && !event.shiftKey) return;
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        setMenu({ row, anchor: { x: rect.left + 24, y: rect.bottom } });
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  // ——— Glisser-déposer ———

  const canDrop = (item: ItemRef, target: string | null) => {
    if (item.kind === 'doc') {
      const current = docs.find((doc) => doc.id === item.id)?.folderId ?? null;
      return current !== target;
    }
    const folder = folders.find((candidate) => candidate.id === item.id);
    if (!folder || folder.parentId === target) return false;
    return target === null || !isWithin(folders, target, item.id);
  };

  /** Déposer sur un dossier : dedans. Sur un document : à côté de lui. */
  const targetOf = (row: Row): string | null =>
    row.kind === 'folder'
      ? row.folder.id
      : folders.some((folder) => folder.id === row.doc.folderId)
        ? row.doc.folderId
        : null;

  const endDrag = () => {
    dragged.current = null;
    setDraggingKey(null);
    setDropTarget(null);
    window.clearTimeout(expandTimer.current?.timeout);
    expandTimer.current = null;
  };

  const dragOver = (event: DragEvent, target: string | null) => {
    event.stopPropagation();
    const item = dragged.current;
    if (!item || !canDrop(item, target)) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget((current) => (current?.folderId === target ? current : { folderId: target }));

    // Survol prolongé d'un dossier replié : il s'ouvre.
    if (target && !expanded.has(target) && expandTimer.current?.folderId !== target) {
      window.clearTimeout(expandTimer.current?.timeout);
      expandTimer.current = {
        folderId: target,
        timeout: window.setTimeout(() => setOpen(target, true), AUTO_EXPAND_DELAY_MS),
      };
    }
  };

  const drop = async (event: DragEvent, target: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    const item = dragged.current;
    endDrag();
    if (!item || !canDrop(item, target)) return;
    if (item.kind === 'doc') await moveDocument(item.id, target);
    else await moveFolder(item.id, target);
    if (target) setOpen(target, true);
  };

  const renderRow = (row: Row) => {
    const pinnedRow = row.key.startsWith('pin:');
    return (
      <TreeRow
        key={row.key}
        row={row}
        active={row.kind === 'doc' && row.doc.id === activeId}
        tabbable={row.key === tabbableKey}
        renaming={row.key === renamingKey}
        dragging={row.key === draggingKey}
        dropTarget={
          !pinnedRow && row.kind === 'folder' && dropTarget?.folderId === row.folder.id
        }
        onClick={() => activate(row)}
        onFocus={() => setFocusedKey(row.key)}
        onMenu={(anchor) => setMenu({ row, anchor })}
        onPickIcon={(anchor) => setPicker({ row, anchor })}
        onCreateInside={() => {
          if (row.kind !== 'folder') return;
          setOpen(row.folder.id, true);
          onCreateDocument(row.folder.id);
        }}
        onRename={(value, refocus) => commitRename(row, value, refocus)}
        onCancelRename={() => {
          setRenamingKey(null);
          focusRow(row.key);
        }}
        onDragStart={(event) => {
          const label = row.kind === 'folder' ? row.folder.name : docLabel(row.doc);
          dragged.current = itemOf(row);
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', label);
          setDragGhost(event.nativeEvent, event.currentTarget as HTMLElement, label);
          setDraggingKey(row.key);
        }}
        onDragEnd={endDrag}
        // Les lignes épinglées ne sont pas des cibles : elles ne reflètent pas l'arborescence.
        onDragOver={(event) => (pinnedRow ? event.stopPropagation() : dragOver(event, targetOf(row)))}
        onDrop={(event) => (pinnedRow ? event.stopPropagation() : void drop(event, targetOf(row)))}
      />
    );
  };

  const rootTarget = dropTarget !== null && dropTarget.folderId === null;

  return (
    <div
      ref={containerRef}
      onKeyDown={onKeyDown}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
      }}
      className="flex min-h-full flex-col"
    >
      {pinnedRows.length > 0 && (
        <>
          <SectionHeader label="Épinglés" />
          <div role="tree" aria-label="Épinglés" className="flex flex-col gap-px">
            {pinnedRows.map(renderRow)}
          </div>
        </>
      )}

      <SectionHeader
        label="Documents"
        highlighted={rootTarget}
        onDragOver={(event) => dragOver(event, null)}
        onDrop={(event) => void drop(event, null)}
      >
        <IconButton
          size="sm"
          label="Nouveau dossier"
          onClick={() => void createFolderIn(null)}
        >
          <FolderPlusIcon />
        </IconButton>
        <IconButton
          size="sm"
          label="Nouveau document"
          shortcut={keys('alt', 'mod', 'N')}
          onClick={() => onCreateDocument(null)}
        >
          <PlusIcon />
        </IconButton>
      </SectionHeader>

      <div
        role="tree"
        aria-label="Documents"
        onDragOver={(event) => dragOver(event, null)}
        onDrop={(event) => void drop(event, null)}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ row: null, anchor: { x: event.clientX, y: event.clientY } });
        }}
        className={`flex flex-1 flex-col gap-px rounded-md pb-8 transition-colors duration-100 ${
          rootTarget ? 'bg-accent-soft/50' : ''
        }`}
      >
        {treeRows.map(renderRow)}
      </div>

      {picker && (
        <IconPicker
          label={picker.row.kind === 'folder' ? 'Icône du dossier' : 'Icône du document'}
          value={picker.row.kind === 'folder' ? picker.row.folder.icon : picker.row.doc.icon}
          anchor={picker.anchor}
          onClose={closePicker}
          onSelect={(icon) => {
            const { row } = picker;
            if (row.kind === 'folder') void setFolderIcon(row.folder.id, icon);
            else void setDocumentIcon(row.doc.id, icon);
          }}
        />
      )}

      {menu && (
        <Menu
          label={
            menu.row ? (menu.row.kind === 'folder' ? 'Actions du dossier' : 'Actions du document') : 'Créer'
          }
          entries={menuEntries(menu.row)}
          anchor={menu.anchor}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

interface SectionHeaderProps {
  label: string;
  highlighted?: boolean;
  children?: ReactNode;
  onDragOver?: (event: DragEvent) => void;
  onDrop?: (event: DragEvent) => void;
}

function SectionHeader({ label, highlighted, children, onDragOver, onDrop }: SectionHeaderProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="group/header flex h-8 shrink-0 items-center justify-between pt-3 pr-1 pl-2"
    >
      <span
        className={`text-[11px] font-medium transition-colors duration-100 ${
          highlighted ? 'text-accent' : 'text-ink-faint'
        }`}
      >
        {label}
      </span>
      {children && (
        <div className="flex items-center opacity-0 transition-opacity duration-100 group-hover/header:opacity-100 focus-within:opacity-100">
          {children}
        </div>
      )}
    </div>
  );
}
