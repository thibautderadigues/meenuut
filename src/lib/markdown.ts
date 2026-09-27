import type { JSONContent } from '@tiptap/react';

/**
 * Sérialiseur JSON TipTap → Markdown (GFM). Le schéma est fermé et connu : un parcours
 * direct suffit, sans dépendance. Ce qui n'a pas d'équivalent Markdown (souligné, indice,
 * exposant) passe en HTML ; ce qui est purement visuel (couleurs, alignement) est ignoré.
 */

type Delimiters = [open: string, close: string];

function markDelimiters(mark: { type: string; attrs?: Record<string, unknown> }): Delimiters | null {
  switch (mark.type) {
    case 'bold':
      return ['**', '**'];
    case 'italic':
      return ['*', '*'];
    case 'strike':
      return ['~~', '~~'];
    case 'highlight':
      return ['==', '=='];
    case 'code':
      return ['`', '`'];
    case 'underline':
      return ['<u>', '</u>'];
    case 'subscript':
      return ['<sub>', '</sub>'];
    case 'superscript':
      return ['<sup>', '</sup>'];
    case 'link':
      return ['[', `](${String(mark.attrs?.href ?? '')})`];
    default:
      return null;
  }
}

/** Clé d'identité d'une marque : deux liens différents ne sont pas la même marque. */
const markKey = (mark: { type: string; attrs?: Record<string, unknown> }) =>
  mark.type === 'link' ? `link:${String(mark.attrs?.href ?? '')}` : mark.type;

/** N'échappe que ce qui aurait un sens : "=" et "~" seulement doublés (surlignage, barré). */
function escapeText(text: string): string {
  return text
    .replace(/([\\`*_[\]<])/g, '\\$1')
    .replace(/==/g, '\\=\\=')
    .replace(/~~/g, '\\~\\~');
}

/**
 * Texte et marques. Les marques restent ouvertes tant que les nœuds voisins les partagent :
 * "**gras *et italique***" plutôt que "**gras ****_et italique_**".
 */
function inline(nodes: JSONContent[] = []): string {
  let output = '';
  const open: { key: string; close: string }[] = [];

  const closeUntil = (keep: Set<string>) => {
    while (open.length && !open.every((mark) => keep.has(mark.key))) {
      output += open.pop()!.close;
    }
  };

  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      closeUntil(new Set());
      output += '  \n';
      continue;
    }
    if (node.type === 'image') {
      output += image(node);
      continue;
    }
    if (node.type === 'mention') {
      output += `[${String(node.attrs?.label ?? '')}](#/d/${String(node.attrs?.id ?? '')})`;
      continue;
    }
    if (node.type === 'inlineMath') {
      output += `\$${String(node.attrs?.latex ?? '')}\$`;
      continue;
    }
    const marks = (node.marks ?? []).filter((mark) => markDelimiters(mark) !== null);
    const keys = new Set(marks.map(markKey));
    closeUntil(keys);
    for (const mark of marks) {
      const key = markKey(mark);
      if (open.some((entry) => entry.key === key)) continue;
      const [opening, closing] = markDelimiters(mark)!;
      output += opening;
      open.push({ key, close: closing });
    }
    const isCode = keys.has('code');
    output += isCode ? (node.text ?? '') : escapeText(node.text ?? '');
  }
  closeUntil(new Set());
  return output;
}

function image(node: JSONContent): string {
  const alt = String(node.attrs?.alt ?? '').replace(/[[\]]/g, '');
  return `![${alt}](${String(node.attrs?.src ?? '')})`;
}

/** Préfixe la première ligne par `marker`, décale les suivantes de sa largeur. */
function prefixLines(text: string, marker: string): string {
  const padding = ' '.repeat(marker.length);
  return text
    .split('\n')
    .map((line, index) => (index === 0 ? marker + line : line ? padding + line : line))
    .join('\n');
}

function listItems(node: JSONContent, marker: (index: number, item: JSONContent) => string): string {
  return (node.content ?? [])
    .map((item, index) => prefixLines(blocks(item.content ?? [], '\n'), marker(index, item)))
    .join('\n');
}

function tableCell(cell: JSONContent): string {
  return (cell.content ?? [])
    .map((child) => inline(child.content))
    .join('<br>')
    .replace(/\n/g, ' ')
    .replace(/\|/g, '\\|');
}

function table(node: JSONContent): string {
  const rows = (node.content ?? []).map((row) => (row.content ?? []).map(tableCell));
  const [header = [], ...body] = rows;
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  return [line(header), line(Array(width).fill('---')), ...body.map(line)].join('\n');
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

function block(node: JSONContent): string {
  switch (node.type) {
    case 'paragraph':
      return inline(node.content);
    case 'heading':
      // Le titre du document occupe le niveau 1 : les titres internes descendent d'un cran.
      return `${'#'.repeat(Number(node.attrs?.level ?? 1) + 1)} ${inline(node.content)}`;
    case 'bulletList':
      return listItems(node, () => '- ');
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return listItems(node, (index) => `${start + index}. `);
    }
    case 'taskList':
      return listItems(node, (_, item) => (item.attrs?.checked ? '- [x] ' : '- [ ] '));
    case 'blockquote':
      return quote(blocks(node.content ?? []));
    case 'codeBlock': {
      const code = (node.content ?? []).map((child) => child.text ?? '').join('');
      const fence = code.includes('```') ? '````' : '```';
      return `${fence}${String(node.attrs?.language ?? '')}\n${code}\n${fence}`;
    }
    case 'horizontalRule':
      return '---';
    case 'image':
      return image(node);
    case 'table':
      return table(node);
    case 'callout': {
      // Format des alertes GitHub, d'après la couleur (ou l'ancien type fixe).
      const byColor: Record<string, string> = { blue: 'NOTE', gray: 'NOTE', green: 'TIP', orange: 'WARNING', red: 'CAUTION', purple: 'IMPORTANT' };
      const byVariant: Record<string, string> = { info: 'NOTE', tip: 'TIP', warning: 'WARNING', danger: 'CAUTION', note: 'IMPORTANT' };
      const kind =
        byColor[String(node.attrs?.color)] ?? byVariant[String(node.attrs?.variant)] ?? 'NOTE';
      return quote(`[!${kind}]\n${blocks(node.content ?? [])}`);
    }
    case 'pullQuote':
      return quote(blocks(node.content ?? []));
    case 'keyPoints':
      return quote(`**À retenir**\n\n${blocks(node.content ?? [])}`);
    case 'columns':
      return (node.content ?? []).map((column) => blocks(column.content ?? [])).join('\n\n');
    case 'steps':
      // Libellé en gras, description en dessous.
      return (node.content ?? [])
        .map((step, index) => {
          const [title, ...rest] = step.content ?? [];
          const body = [`**${inline(title?.content)}**`, blocks(rest, '\n')].filter(Boolean).join('\n');
          return prefixLines(body, `${index + 1}. `);
        })
        .join('\n');
    case 'metrics':
      return (node.content ?? [])
        .map((metric) => {
          const [value, label] = metric.content ?? [];
          return `- **${inline(value?.content)}** — ${inline(label?.content)}`;
        })
        .join('\n');
    case 'blockMath':
      return `\$\$\n${String(node.attrs?.latex ?? '')}\n\$\$`;
    case 'details': {
      const summary = node.content?.find((child) => child.type === 'detailsSummary');
      const body = node.content?.find((child) => child.type === 'detailsContent');
      return `<details>\n<summary>${inline(summary?.content)}</summary>\n\n${blocks(body?.content ?? [])}\n\n</details>`;
    }
    default:
      return blocks(node.content ?? []);
  }
}

function blocks(nodes: JSONContent[], separator = '\n\n'): string {
  return nodes
    .map(block)
    .filter((text) => text !== '')
    .join(separator);
}

export function toMarkdown(title: string, doc: JSONContent): string {
  const heading = title.trim() ? `# ${escapeText(title.trim())}\n\n` : '';
  return `${heading}${blocks(doc.content ?? []).trim()}\n`;
}
