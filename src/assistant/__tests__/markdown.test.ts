// @vitest-environment jsdom
import type { JSONContent } from '@tiptap/core';
import { expect, test } from 'vitest';
import { markdownToContent } from '../markdown';

/** Réponses de l'IA → blocs de Meenuut. */
const types = (doc: JSONContent) => (doc.content ?? []).map((node) => node.type);
const find = (node: JSONContent, type: string): JSONContent | undefined =>
  node.type === type ? node : (node.content ?? []).map((child) => find(child, type)).find(Boolean);

test('encadrés depuis les alertes « > [!TIP] »', () => {
  const doc = markdownToContent('> [!TIP]\n> Partez hors saison.\n\n> Une vraie citation.');
  expect(types(doc)).toEqual(['callout', 'blockquote']);
  expect(doc.content?.[0]?.attrs).toMatchObject({ color: 'green', icon: 'icon:lightbulb' });
  expect(find(doc.content![0]!, 'text')?.text).toBe('Partez hors saison.');
});

test('cases à cocher', () => {
  const doc = markdownToContent('- [ ] Réserver le train\n- [x] Faire le budget');
  const list = doc.content?.[0];
  expect(list?.type).toBe('taskList');
  expect(list?.content?.map((item) => item.attrs?.checked)).toEqual([false, true]);
  expect(find(list!.content![0]!, 'text')?.text).toBe('Réserver le train');
});

test('bloc dépliable', () => {
  const doc = markdownToContent('<details><summary>Combien ça coûte ?</summary>\n\nEnviron **300 €**.\n\n</details>');
  const details = doc.content?.[0];
  expect(details?.type).toBe('details');
  expect(details?.content?.map((child) => child.type)).toEqual(['detailsSummary', 'detailsContent']);
});

test('surlignage et formules, mais pas les prix ni le code', () => {
  const doc = markdownToContent('Un ==point clé== et $x^2$, pour 5 $ et 10 $.\n\n`a == b`\n\n$$\n\\frac{1}{2}\n$$');
  const paragraph = doc.content?.[0];
  expect(paragraph?.content?.some((node) => node.marks?.some((mark) => mark.type === 'highlight'))).toBe(true);
  expect(find(paragraph!, 'inlineMath')?.attrs?.latex).toBe('x^2');
  expect(paragraph?.content?.filter((node) => node.type === 'inlineMath')).toHaveLength(1);
  expect(find(doc.content![1]!, 'text')?.text).toBe('a == b');
  expect(doc.content?.[2]).toMatchObject({ type: 'blockMath', attrs: { latex: '\\frac{1}{2}' } });
});
