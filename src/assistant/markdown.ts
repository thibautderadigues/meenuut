import { generateJSON, type JSONContent } from '@tiptap/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { createExtensions } from '../editor/extensions';

/** Conversion des réponses de l'IA (Markdown) vers l'éditeur. */

const extensions = createExtensions({ onTableOfContents: () => {}, onEditMath: () => {} });

/** Markdown de l'IA → HTML nettoyé (affichage dans la conversation, insertion). */
export function markdownToHtml(markdown: string): string {
  return DOMPurify.sanitize(marked.parse(markdown, { async: false, gfm: true, breaks: false }));
}

export function markdownToContent(markdown: string): JSONContent {
  return generateJSON(markdownToRichHtml(markdown), extensions);
}

// --- Blocs Meenuut ---

const CALLOUTS: Record<string, { color: string; icon: string }> = {
  NOTE: { color: 'blue', icon: 'icon:info' },
  TIP: { color: 'green', icon: 'icon:lightbulb' },
  IMPORTANT: { color: 'purple', icon: 'icon:pencil' },
  WARNING: { color: 'orange', icon: 'icon:warning' },
  CAUTION: { color: 'red', icon: 'icon:danger' },
};

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Formules et surlignage, hors code (où « $ » et « == » gardent leur sens littéral). */
function preprocess(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .replace(
          /^\s*\$\$\s*\n?([\s\S]+?)\n?\s*\$\$\s*$/gm,
          (_, latex: string) => `\n<div data-type="block-math" data-latex="${escapeAttribute(latex.trim())}"></div>\n`,
        )
        .replace(
          // $…$ : pas d'espace juste à l'intérieur, ni de chiffre juste après (« 5 $ »).
          /(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\d$])/g,
          (_, before: string, latex: string) =>
            `${before}<span data-type="inline-math" data-latex="${escapeAttribute(latex)}"></span>`,
        )
        .replace(/==(?=\S)([^=\n]+?)(?<=\S)==/g, '<mark>$1</mark>')
        // Bloc dépliable : son contenu est du Markdown, isolé par des lignes vides pour être lu
        // comme tel (collé aux balises, il resterait du texte brut, voire disparaîtrait).
        .replace(
          /<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,
          (_, summary: string, body: string) =>
            `\n\n<details><summary>${summary.trim()}</summary>\n\n${dedent(body).trim()}\n\n</details>\n\n`,
        );
    })
    .join('');
}

/** Retire l'indentation commune (contenu d'un bloc dépliable indenté par l'IA). */
function dedent(text: string): string {
  const lines = text.split('\n');
  const indents = lines.filter((line) => line.trim()).map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(common)).join('\n');
}

/**
 * Markdown de l'IA → HTML que l'éditeur reconnaît, blocs de Meenuut compris :
 * alertes « > [!TIP] » → encadrés, « - [ ] » → cases à cocher, <details> → blocs dépliables.
 */
export function markdownToRichHtml(markdown: string): string {
  const html = DOMPurify.sanitize(marked.parse(preprocess(markdown), { async: false, gfm: true }));
  const root = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;

  for (const quote of Array.from(root.querySelectorAll('blockquote'))) {
    const first = quote.firstElementChild;
    const match = first?.tagName === 'P' ? /^\s*\[!(\w+)\]\s*/.exec(first.innerHTML) : null;
    const look = match ? CALLOUTS[(match[1] ?? '').toUpperCase()] : undefined;
    if (!first || !match || !look) continue;
    first.innerHTML = first.innerHTML.slice(match[0].length).replace(/^<br\s*\/?>\s*/, '');
    if (!first.textContent?.trim() && !first.querySelector('*')) first.remove();
    const callout = document.createElement('div');
    callout.setAttribute('data-type', 'callout');
    callout.setAttribute('data-color', look.color);
    callout.setAttribute('data-icon', look.icon);
    callout.append(...Array.from(quote.childNodes));
    if (!callout.firstElementChild) callout.innerHTML = '<p></p>';
    quote.replaceWith(callout);
  }

  // Puces vides (texte en cours d'écriture : « - » sans rien derrière) : l'éditeur les refuse.
  for (const item of Array.from(root.querySelectorAll('li'))) {
    if (!item.textContent?.trim() && !item.querySelector('img, input')) item.remove();
  }
  for (const list of Array.from(root.querySelectorAll('ul, ol'))) {
    if (!list.querySelector('li')) list.remove();
  }

  for (const list of Array.from(root.querySelectorAll('ul'))) {
    const items = Array.from(list.children).filter((child) => child.tagName === 'LI');
    const isTasks = items.length > 0 && items.every((item) => item.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]'));
    if (!isTasks) continue;
    list.setAttribute('data-type', 'taskList');
    for (const item of items) {
      const box = item.querySelector<HTMLInputElement>('input[type="checkbox"]');
      item.setAttribute('data-type', 'taskItem');
      item.setAttribute('data-checked', String(Boolean(box?.hasAttribute('checked'))));
      box?.remove();
      if (!item.querySelector(':scope > p')) item.innerHTML = `<p>${item.innerHTML.trim()}</p>`;
    }
  }

  for (const details of Array.from(root.querySelectorAll('details'))) {
    const content = document.createElement('div');
    content.setAttribute('data-type', 'detailsContent');
    for (const child of Array.from(details.childNodes)) {
      if (child instanceof HTMLElement && child.tagName === 'SUMMARY') continue;
      if (child.nodeType === Node.TEXT_NODE) {
        // Texte resté hors paragraphe : on l'y met, sinon l'éditeur l'ignorerait.
        const text = child.textContent?.trim();
        child.remove();
        if (text) {
          const paragraph = document.createElement('p');
          paragraph.textContent = text;
          content.append(paragraph);
        }
        continue;
      }
      content.append(child);
    }
    if (!content.firstElementChild) content.innerHTML = '<p></p>';
    details.append(content);
  }

  return root.innerHTML;
}

/** Markdown d'une seule ligne (gras, italique, liens…) → HTML en ligne, sans paragraphe autour. */
export function markdownInlineToHtml(markdown: string): string {
  return DOMPurify.sanitize(marked.parseInline(preprocess(markdown), { async: false }));
}
