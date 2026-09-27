import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { openDocumentRoute } from '../lib/router';
import { formatUpdatedAt } from '../lib/format';
import {
  deleteForever,
  listTrash,
  purgeTrash,
  restoreFromTrash,
  RETENTION_DAYS,
  type TrashEntry,
} from '../db/trash';
import { Popover, type Point } from '../ui/Popover';
import { FileIcon, FolderIcon, TrashIcon, UndoIcon } from '../ui/icons';
import { ItemIcon } from '../ui/itemIcons';

/** Bas de la sidebar : accès à la corbeille, avec le nombre d'éléments. */
export function TrashButton({ onNavigate }: { onNavigate: () => void }) {
  const entries = useLiveQuery(listTrash);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const count = entries?.length ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.top - 4 });
        }}
        className="mx-2 mb-1 flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-ink-muted transition-colors duration-100 hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        <TrashIcon />
        Corbeille
        {count > 0 && <span className="ml-auto text-xs text-ink-faint tabular-nums">{count}</span>}
      </button>
      {anchor && (
        <TrashPanel
          entries={entries ?? []}
          anchor={anchor}
          onClose={() => setAnchor(null)}
          onNavigate={onNavigate}
        />
      )}
    </>
  );
}

interface TrashPanelProps {
  entries: TrashEntry[];
  anchor: Point;
  onClose: () => void;
  onNavigate: () => void;
}

function TrashPanel({ entries, anchor, onClose, onNavigate }: TrashPanelProps) {
  // Clé de l'élément dont la suppression définitive attend confirmation ('all' : tout vider).
  const [confirming, setConfirming] = useState<string | null>(null);

  const restore = async (entry: TrashEntry) => {
    await restoreFromTrash(entry);
    if (entry.kind === 'doc') {
      openDocumentRoute(entry.id);
      onClose();
      onNavigate();
    }
  };

  const destroy = async (entry: TrashEntry) => {
    const key = `${entry.kind}:${entry.id}`;
    if (confirming !== key) {
      setConfirming(key);
      return;
    }
    setConfirming(null);
    await deleteForever(entry);
  };

  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      role="dialog"
      aria-label="Corbeille"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
      }}
      className="flex w-80 flex-col p-1.5 font-sans"
    >
      <div className="flex items-baseline justify-between px-2 pt-1 pb-2">
        <h2 className="text-[13px] font-semibold text-ink">Corbeille</h2>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (confirming !== 'all') setConfirming('all');
              else void purgeTrash().then(() => setConfirming(null));
            }}
            className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
              confirming === 'all'
                ? 'bg-danger text-white'
                : 'text-ink-faint hover:bg-surface hover:text-danger'
            }`}
          >
            {confirming === 'all' ? 'Tout supprimer définitivement ?' : 'Vider'}
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="px-2 pt-2 pb-4 text-center text-[13px] text-ink-faint">La corbeille est vide.</p>
      ) : (
        <ul className="max-h-80 overflow-y-auto">
          {entries.map((entry) => {
            const key = `${entry.kind}:${entry.id}`;
            return (
              <li
                key={key}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface"
              >
                <span className="shrink-0 text-ink-faint">
                  <ItemIcon
                    value={entry.icon}
                    fallback={entry.kind === 'folder' ? <FolderIcon /> : <FileIcon />}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{entry.label}</span>
                  <span className="block text-[11px] text-ink-faint">
                    {formatUpdatedAt(entry.deletedAt)}
                    {entry.kind === 'folder' &&
                      entry.docCount > 0 &&
                      ` · ${entry.docCount} document${entry.docCount > 1 ? 's' : ''}`}
                  </span>
                </span>
                {confirming === key ? (
                  <button
                    type="button"
                    onClick={() => void destroy(entry)}
                    className="shrink-0 rounded bg-danger px-1.5 py-0.5 text-[11px] font-medium text-white"
                  >
                    Supprimer ?
                  </button>
                ) : (
                  <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
                    <button
                      type="button"
                      aria-label={`Restaurer « ${entry.label} »`}
                      data-tooltip="Restaurer"
                      onClick={() => void restore(entry)}
                      className="grid size-6 place-items-center rounded text-ink-muted hover:bg-canvas hover:text-ink"
                    >
                      <UndoIcon />
                    </button>
                    <button
                      type="button"
                      aria-label={`Supprimer définitivement « ${entry.label} »`}
                      data-tooltip="Supprimer définitivement"
                      onClick={() => void destroy(entry)}
                      className="grid size-6 place-items-center rounded text-ink-muted hover:bg-canvas hover:text-danger"
                    >
                      <TrashIcon />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="border-t border-rule px-2 pt-2 pb-1 text-[11px] text-ink-faint">
        Supprimés définitivement après {RETENTION_DAYS} jours.
      </p>
    </Popover>
  );
}
