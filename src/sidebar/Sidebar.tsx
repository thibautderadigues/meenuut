import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type KeyboardEvent } from 'react';
import { AccountFooter } from '../auth/AccountFooter';
import type { DocMeta, Folder } from '../db/db';
import { searchDocuments } from '../db/documents';
import { keys } from '../lib/platform';
import { openDocumentRoute } from '../lib/router';
import { IconButton } from '../ui/IconButton';
import { CloseIcon, CommandIcon, PlusIcon, SearchIcon, SidebarIcon } from '../ui/icons';
import { DocumentTree, type ItemRef } from './DocumentTree';
import { SearchResults } from './SearchResults';

interface SidebarProps {
  open: boolean;
  docs: DocMeta[] | undefined;
  folders: Folder[] | undefined;
  activeId: string | null;
  onToggle: () => void;
  onOpenPalette: () => void;
  onCreateDocument: (folderId: string | null) => void;
  onDeleteItem: (item: ItemRef) => void;
  onMoveItem: (item: ItemRef) => void;
  onNavigate: () => void;
}

export function Sidebar({
  open,
  docs,
  folders,
  activeId,
  onToggle,
  onOpenPalette,
  onCreateDocument,
  onDeleteItem,
  onMoveItem,
  onNavigate,
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const searching = query.trim().length > 0;
  const results = useLiveQuery(
    () => (searching ? searchDocuments(query) : undefined),
    [query, searching],
  );

  const focusSearch = () => searchRef.current?.focus();

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      navRef.current?.querySelector<HTMLElement>('[data-nav-item]')?.focus();
    } else if (event.key === 'Enter') {
      const first = results?.[0];
      if (first) {
        openDocumentRoute(first.meta.id);
        onNavigate();
      }
    } else if (event.key === 'Escape' && query) {
      event.stopPropagation();
      setQuery('');
    }
  };

  return (
    <aside
      data-print-hidden
      aria-label="Documents"
      inert={!open}
      className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-rule bg-sidebar transition-transform duration-150 ease-out ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <IconButton
          label="Masquer la barre latérale"
          shortcut={keys('mod', '\\')}
          onClick={onToggle}
        >
          <SidebarIcon />
        </IconButton>
        <div className="flex items-center gap-0.5">
          <IconButton label="Commandes" shortcut={keys('mod', 'K')} onClick={onOpenPalette}>
            <CommandIcon />
          </IconButton>
          <IconButton
            label="Nouveau document"
            shortcut={keys('alt', 'mod', 'N')}
            onClick={() => onCreateDocument(null)}
          >
            <PlusIcon />
          </IconButton>
        </div>
      </div>

      <div className="px-3">
        <label className="flex h-8 items-center gap-2 rounded-md bg-surface px-2.5 text-ink-faint transition-shadow duration-100 focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
          <SearchIcon />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Rechercher"
            aria-label="Rechercher dans les documents"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Effacer la recherche"
              onClick={() => {
                setQuery('');
                focusSearch();
              }}
              className="grid size-5 place-items-center rounded text-ink-faint hover:text-ink"
            >
              <CloseIcon />
            </button>
          )}
        </label>
      </div>

      <nav ref={navRef} aria-label="Navigation" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {searching ? (
          <SearchResults
            results={results}
            folders={folders ?? []}
            activeId={activeId}
            onOpen={onNavigate}
            onExitTop={focusSearch}
          />
        ) : (
          docs &&
          folders && (
            <DocumentTree
              docs={docs}
              folders={folders}
              activeId={activeId}
              onOpen={(id) => {
                openDocumentRoute(id);
                onNavigate();
              }}
              onCreateDocument={onCreateDocument}
              onDeleteItem={onDeleteItem}
              onMoveItem={onMoveItem}
              onExitTop={focusSearch}
            />
          )
        )}
      </nav>

      <AccountFooter />
    </aside>
  );
}
