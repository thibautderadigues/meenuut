import type { DragEvent, MouseEvent } from 'react';
import type { DocMeta, Folder } from '../db/db';
import { docLabel } from '../db/tree';
import { IconButton } from '../ui/IconButton';
import {
  ChevronIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreIcon,
  PlusIcon,
} from '../ui/icons';
import { ItemIcon } from '../ui/itemIcons';
import type { Point } from '../ui/Menu';
import { RenameInput } from './RenameInput';

export type Row =
  | {
      key: string;
      kind: 'folder';
      folder: Folder;
      level: number;
      expanded: boolean;
      count: number;
      parentKey: string | null;
    }
  | { key: string; kind: 'doc'; doc: DocMeta; level: number; parentKey: string | null };

const INDENT_PX = 14;

interface TreeRowProps {
  row: Row;
  active: boolean;
  tabbable: boolean;
  renaming: boolean;
  dropTarget: boolean;
  /** Ligne en cours de glissement : estompée. */
  dragging: boolean;
  onClick: () => void;
  onFocus: () => void;
  onMenu: (anchor: Point) => void;
  onPickIcon: (anchor: Point) => void;
  onCreateInside: () => void;
  onRename: (value: string, refocus: boolean) => void;
  onCancelRename: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

export function TreeRow({
  row,
  active,
  tabbable,
  renaming,
  dropTarget,
  dragging,
  onClick,
  onFocus,
  onMenu,
  onPickIcon,
  onCreateInside,
  onRename,
  onCancelRename,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: TreeRowProps) {
  const isFolder = row.kind === 'folder';
  const label = isFolder ? row.folder.name : docLabel(row.doc);
  const untitled = !isFolder && !row.doc.title.trim();

  const openMenuFromButton = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onMenu({ x: rect.left, y: rect.bottom });
  };

  let tone = 'text-ink-muted hover:bg-surface hover:text-ink';
  if (active) tone = 'bg-accent-soft text-ink';
  if (dropTarget) tone = 'bg-accent-soft text-ink shadow-[inset_0_0_0_1px_var(--accent)]';

  return (
    <div
      role="treeitem"
      aria-level={row.level}
      aria-expanded={isFolder ? row.expanded : undefined}
      aria-selected={active}
      aria-keyshortcuts="F2 Delete Shift+F10"
      tabIndex={tabbable ? 0 : -1}
      data-row-key={row.key}
      data-nav-item
      draggable={!renaming}
      onClick={onClick}
      onFocus={onFocus}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ paddingLeft: 6 + (row.level - 1) * INDENT_PX }}
      className={`group relative flex h-[30px] shrink-0 cursor-pointer items-center gap-1 rounded-md pr-1 text-[13px] transition-colors duration-100 outline-none select-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)] ${tone} ${dragging ? 'opacity-40' : ''}`}
    >
      <span
        aria-hidden
        className={`grid size-4 shrink-0 place-items-center text-ink-faint transition-transform duration-150 ${
          isFolder && row.expanded ? 'rotate-90' : ''
        }`}
      >
        {isFolder && <ChevronIcon />}
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Changer l’icône"
        data-tooltip="Changer l’icône"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onPickIcon({ x: rect.left, y: rect.bottom });
        }}
        className={`grid size-5 shrink-0 place-items-center rounded transition-colors duration-100 hover:bg-rule ${
          active ? 'text-accent' : 'text-ink-faint'
        }`}
      >
        <span data-row-icon className="grid place-items-center">
          <ItemIcon
            value={isFolder ? row.folder.icon : row.doc.icon}
            fallback={isFolder ? row.expanded ? <FolderOpenIcon /> : <FolderIcon /> : <FileIcon />}
          />
        </span>
      </button>

      {renaming ? (
        <RenameInput
          initial={isFolder ? row.folder.name : row.doc.title}
          label={isFolder ? 'Renommer le dossier' : 'Renommer le document'}
          onCommit={onRename}
          onCancel={onCancelRename}
        />
      ) : (
        <span className={`ml-0.5 min-w-0 flex-1 truncate ${untitled ? 'text-ink-faint' : ''}`}>
          {label}
        </span>
      )}

      {!renaming && (
        <>
          {isFolder && row.count > 0 && (
            <span className="shrink-0 px-1.5 text-[11px] text-ink-faint tabular-nums group-hover:hidden">
              {row.count}
            </span>
          )}
          <span className="hidden shrink-0 items-center group-hover:flex">
            {isFolder && (
              <IconButton
                size="sm"
                tabIndex={-1}
                label="Nouveau document dans ce dossier"
                onClick={(event) => {
                  event.stopPropagation();
                  onCreateInside();
                }}
              >
                <PlusIcon />
              </IconButton>
            )}
            <IconButton size="sm" tabIndex={-1} label="Plus d’actions" onClick={openMenuFromButton}>
              <MoreIcon />
            </IconButton>
          </span>
        </>
      )}
    </div>
  );
}
