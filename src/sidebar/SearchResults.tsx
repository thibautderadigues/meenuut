import type { KeyboardEvent } from 'react';
import type { Folder } from '../db/db';
import type { SearchResult } from '../db/documents';
import { docLabel, folderPath } from '../db/tree';
import { docHref } from '../lib/router';

interface SearchResultsProps {
  results: SearchResult[] | undefined;
  folders: Folder[];
  activeId: string | null;
  onOpen: () => void;
  onExitTop: () => void;
}

export function SearchResults({ results, folders, activeId, onOpen, onExitTop }: SearchResultsProps) {
  if (results?.length === 0) {
    return <p className="px-2.5 py-2 text-[13px] text-ink-faint">Aucun document ne correspond</p>;
  }

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-nav-item]'));
    const index = links.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') links[index + 1]?.focus();
    else if (event.key === 'ArrowUp') {
      if (index <= 0) onExitTop();
      else links[index - 1]?.focus();
    } else return;
    event.preventDefault();
  };

  return (
    <ul aria-label="Résultats de recherche" onKeyDown={onKeyDown} className="flex flex-col gap-px pt-2">
      {results?.map(({ meta, snippet }, index) => {
        const path = folderPath(folders, meta.folderId);
        const active = meta.id === activeId;
        return (
          <li key={meta.id}>
            <a
              href={docHref(meta.id)}
              data-nav-item
              tabIndex={index === 0 ? 0 : -1}
              aria-current={active ? 'page' : undefined}
              onClick={onOpen}
              className={`flex flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-100 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)] ${
                active ? 'bg-accent-soft text-ink' : 'text-ink-muted hover:bg-surface hover:text-ink'
              }`}
            >
              <span className="truncate">{docLabel(meta)}</span>
              {(snippet || path) && (
                <span className="truncate text-xs text-ink-faint">
                  {snippet ? (
                    <>
                      {snippet.before}
                      <mark className="rounded-sm bg-accent-soft text-ink-muted">{snippet.match}</mark>
                      {snippet.after}
                    </>
                  ) : (
                    path
                  )}
                </span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
