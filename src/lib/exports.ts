import type { JSONContent } from '@tiptap/react';
import { toMarkdown } from './markdown';

/** Nom de fichier sûr, accents conservés. */
function fileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Sans titre';
}

export function exportMarkdown(title: string, doc: JSONContent) {
  const blob = new Blob([toMarkdown(title, doc)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName(title)}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * PDF via la boîte d'impression du navigateur et la feuille de style print.
 * Le titre de la page devient le nom proposé pour le fichier PDF.
 */
export function exportPdf(title: string) {
  const previous = document.title;
  document.title = fileName(title);
  window.addEventListener('afterprint', () => (document.title = previous), { once: true });
  window.print();
}
