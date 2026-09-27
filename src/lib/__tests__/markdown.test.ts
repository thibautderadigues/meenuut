import { describe, expect, it } from 'vitest';
import { toMarkdown } from '../markdown';

const text = (value: string, marks: { type: string; attrs?: Record<string, unknown> }[] = []) => ({
  type: 'text',
  text: value,
  marks,
});
const p = (...content: object[]) => ({ type: 'paragraph', content });
const doc = (...content: object[]) => ({ type: 'doc', content });

describe('toMarkdown', () => {
  it('place le titre en H1 et décale les titres internes', () => {
    const md = toMarkdown('Mon doc', doc({ type: 'heading', attrs: { level: 1 }, content: [text('Partie')] }));
    expect(md).toBe('# Mon doc\n\n## Partie\n');
  });

  it('garde ouvertes les marques partagées entre nœuds voisins', () => {
    const md = toMarkdown(
      '',
      doc(p(text('gras ', [{ type: 'bold' }]), text('et italique', [{ type: 'bold' }, { type: 'italic' }]))),
    );
    expect(md).toBe('**gras *et italique***\n');
  });

  it('échappe la syntaxe Markdown dans le texte, pas dans le code', () => {
    const md = toMarkdown('', doc(p(text('2*3 = 6 '), text('a*b', [{ type: 'code' }]))));
    expect(md).toBe('2\\*3 = 6 `a*b`\n');
  });

  it('liens, surlignage, souligné', () => {
    const md = toMarkdown(
      '',
      doc(
        p(
          text('site', [{ type: 'link', attrs: { href: 'https://exemple.fr' } }]),
          text(' '),
          text('clé', [{ type: 'highlight', attrs: { color: 'var(--hl-yellow)' } }]),
          text(' '),
          text('u', [{ type: 'underline' }]),
        ),
      ),
    );
    expect(md).toBe('[site](https://exemple.fr) ==clé== <u>u</u>\n');
  });

  it('listes imbriquées et tâches', () => {
    const item = (label: string, ...children: object[]) => ({
      type: 'listItem',
      content: [p(text(label)), ...children],
    });
    const md = toMarkdown(
      '',
      doc(
        { type: 'bulletList', content: [item('un', { type: 'orderedList', attrs: { start: 1 }, content: [item('a'), item('b')] }), item('deux')] },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [p(text('fait'))] },
            { type: 'taskItem', attrs: { checked: false }, content: [p(text('à faire'))] },
          ],
        },
      ),
    );
    expect(md).toBe('- un\n  1. a\n  2. b\n- deux\n\n- [x] fait\n- [ ] à faire\n');
  });

  it('citation, code, séparateur', () => {
    const md = toMarkdown(
      '',
      doc(
        { type: 'blockquote', content: [p(text('cité'))] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [text('const a = 1;')] },
        { type: 'horizontalRule' },
      ),
    );
    expect(md).toBe('> cité\n\n```js\nconst a = 1;\n```\n\n---\n');
  });

  it('tableau GFM avec en-tête', () => {
    const cell = (type: string, value: string) => ({ type, content: [p(text(value))] });
    const md = toMarkdown(
      '',
      doc({
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('tableHeader', 'Nom'), cell('tableHeader', 'Qté')] },
          { type: 'tableRow', content: [cell('tableCell', 'Pain'), cell('tableCell', '2')] },
        ],
      }),
    );
    expect(md).toBe('| Nom | Qté |\n| --- | --- |\n| Pain | 2 |\n');
  });

  it('ignore les paragraphes vides', () => {
    expect(toMarkdown('', doc(p(text('a')), { type: 'paragraph' }, p(text('b'))))).toBe('a\n\nb\n');
  });
});

describe('toMarkdown — blocs avancés', () => {
  it('mentions et formules en ligne', () => {
    const md = toMarkdown(
      '',
      doc(
        p(
          text('Voir '),
          { type: 'mention', attrs: { id: 'abc', label: 'Recettes' } },
          text(' et '),
          { type: 'inlineMath', attrs: { latex: 'x^2' } },
        ),
      ),
    );
    expect(md).toBe('Voir [Recettes](#/d/abc) et $x^2$\n');
  });

  it('bloc de formule', () => {
    expect(toMarkdown('', doc({ type: 'blockMath', attrs: { latex: 'a+b' } }))).toBe('$$\na+b\n$$\n');
  });

  it('bloc dépliable en <details>', () => {
    const md = toMarkdown(
      '',
      doc({
        type: 'details',
        content: [
          { type: 'detailsSummary', content: [text('Plus')] },
          { type: 'detailsContent', content: [p(text('Caché'))] },
        ],
      }),
    );
    expect(md).toBe('<details>\n<summary>Plus</summary>\n\nCaché\n\n</details>\n');
  });
});

describe('toMarkdown — blocs spéciaux', () => {
  it('encadré au format d’alerte GitHub', () => {
    const md = toMarkdown('', doc({ type: 'callout', attrs: { color: 'green', icon: 'icon:lightbulb' }, content: [p(text('Astuce'))] }));
    expect(md).toBe('> [!TIP]\n> Astuce\n');
    const legacy = toMarkdown('', doc({ type: 'callout', attrs: { variant: 'danger' }, content: [p(text('Stop'))] }));
    expect(legacy).toBe('> [!CAUTION]\n> Stop\n');
  });

  it('à retenir, étapes, chiffres clés', () => {
    const md = toMarkdown(
      '',
      doc(
        { type: 'keyPoints', content: [p(text('Court'))] },
        {
          type: 'steps',
          content: [
            { type: 'step', content: [p(text('Un')), p(text('Préparer'))] },
            { type: 'step', content: [p(text('Deux'))] },
          ],
        },
        { type: 'metrics', content: [{ type: 'metric', content: [p(text('42 %')), p(text('Croissance'))] }] },
      ),
    );
    expect(md).toBe('> **À retenir**\n>\n> Court\n\n1. **Un**\n   Préparer\n2. **Deux**\n\n- **42 %** — Croissance\n');
  });
});
