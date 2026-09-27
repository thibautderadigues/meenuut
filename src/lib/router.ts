import { useSyncExternalStore } from 'react';

const DOC_ROUTE = /^#\/d\/([\w-]+)$/;

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function readDocId() {
  return DOC_ROUTE.exec(window.location.hash)?.[1] ?? null;
}

/** Id du document dans l'URL (`#/d/:id`), ou null. */
export function useRouteDocId(): string | null {
  return useSyncExternalStore(subscribe, readDocId);
}

export function docHref(id: string) {
  return `#/d/${id}`;
}

export function openDocumentRoute(id: string, { replace = false } = {}) {
  if (replace) window.location.replace(docHref(id));
  else window.location.hash = docHref(id);
}
