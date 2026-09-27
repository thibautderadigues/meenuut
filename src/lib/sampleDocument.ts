import type { JSONContent } from '@tiptap/react';

/** Documents de démonstration : chaque fonctionnalité de l'éditeur y apparaît au moins une fois. */

type Mark = { type: string; attrs?: Record<string, unknown> };

const t = (text: string, ...marks: Mark[]): JSONContent =>
  marks.length ? { type: 'text', text, marks } : { type: 'text', text };
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const h = (level: 1 | 2 | 3, text: string): JSONContent => ({
  type: 'heading',
  attrs: { level },
  content: [t(text)],
});
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content: [p(...content)] });
const bullets = (...items: JSONContent[][]): JSONContent => ({
  type: 'bulletList',
  content: items.map((content) => li(...content)),
});
const task = (checked: boolean, text: string): JSONContent => ({
  type: 'taskItem',
  attrs: { checked },
  content: [p(t(text))],
});
const cell = (type: 'tableHeader' | 'tableCell', ...content: JSONContent[]): JSONContent => ({
  type,
  content: [p(...content)],
});
const row = (type: 'tableHeader' | 'tableCell', ...cells: JSONContent[][]): JSONContent => ({
  type: 'tableRow',
  content: cells.map((content) => cell(type, ...content)),
});
const callout = (color: string, icon: string, ...content: JSONContent[]): JSONContent => ({
  type: 'callout',
  attrs: { color, icon },
  content: [p(...content)],
});
const step = (title: string, description: string): JSONContent => ({
  type: 'step',
  content: [p(t(title)), p(t(description))],
});
const metrics = (...cards: [string, string][]): JSONContent => ({
  type: 'metrics',
  content: cards.map(([value, label]) => ({ type: 'metric', content: [p(t(value)), p(t(label))] })),
});

const bold: Mark = { type: 'bold' };
const italic: Mark = { type: 'italic' };
const code: Mark = { type: 'code' };
const underline: Mark = { type: 'underline' };
const strike: Mark = { type: 'strike' };
const sup: Mark = { type: 'superscript' };
const sub: Mark = { type: 'subscript' };
const highlight = (name: string): Mark => ({ type: 'highlight', attrs: { color: `var(--hl-${name})` } });
const color = (name: string): Mark => ({ type: 'textStyle', attrs: { color: `var(--tx-${name})` } });
const link = (href: string): Mark => ({ type: 'link', attrs: { href } });

// ——— Document lié (cible de la mention) ———

export const LINKED_TITLE = 'Carnet d’idées';
export const LINKED_ICON = 'emoji:💡';

export const LINKED_CONTENT: JSONContent = {
  type: 'doc',
  content: [
    p(t('Un second document, pour voir les liens entre documents. Renommez-le : la mention dans « Bienvenue dans Meenuut » suit toute seule.')),
    {
      type: 'taskList',
      content: [task(false, 'Écrire un premier article'), task(false, 'Trier les notes de la semaine')],
    },
  ],
};

// ——— Visite guidée ———

export const SAMPLE_TITLE = 'Bienvenue dans Meenuut';
export const SAMPLE_ICON = 'icon:rocket';

export function sampleContent(linkedId: string): JSONContent {
  return {
    type: 'doc',
    content: [
      p(
        t('Un éditeur '),
        t('rapide', bold),
        t(' et sans distraction. Tout ce que vous écrivez s’enregistre tout seul et '),
        t('se retrouve sur tous vos appareils', highlight('yellow')),
        t('. Ce document fait le tour de ce qu’il sait faire : modifiez-le, cassez-le, supprimez-le.'),
      ),
      callout(
        'blue',
        'icon:info',
        t('Cliquez sur l’icône de cet encadré pour changer sa '),
        t('couleur', bold),
        t(' et son '),
        t('icône', bold),
        t('.'),
      ),

      h(1, 'Écrire sans friction'),
      p(
        t('Tapez '),
        t('/', code),
        t(' pour insérer un bloc, '),
        t('@', code),
        t(' pour relier un document — comme '),
        { type: 'mention', attrs: { id: linkedId, label: LINKED_TITLE } },
        t(' — ou sélectionnez du texte pour le mettre en forme. Le bouton '),
        t('+ Insérer', bold),
        t(' de la barre ouvre la galerie de tous les blocs.'),
      ),
      bullets(
        [t('# ', code), t(' puis espace : un titre')],
        [t('- ', code), t(' ou '), t('1. ', code), t(' : une liste')],
        [t('[ ] ', code), t(' : une case à cocher')],
        [t('==texte==', code), t(' : du surlignage')],
        [t('$$x^2$$', code), t(' : une formule')],
      ),

      h(2, 'Mettre en forme'),
      p(
        t('Du '),
        t('gras', bold),
        t(', de l’'),
        t('italique', italic),
        t(', du '),
        t('souligné', underline),
        t(', du '),
        t('barré', strike),
        t(', du '),
        t('code', code),
        t(', de la '),
        t('couleur', color('blue')),
        t(', du '),
        t('surlignage vert', highlight('green')),
        t(' ou '),
        t('rose', highlight('pink')),
        t(', des exposants (100 m'),
        t('2', sup),
        t(') et des indices (H'),
        t('2', sub),
        t('O). Et bien sûr des '),
        t('liens', link('https://tiptap.dev')),
        t('.'),
      ),

      h(2, 'S’organiser'),
      {
        type: 'taskList',
        content: [
          task(true, 'Découvrir le menu /'),
          task(true, 'Essayer la palette de commandes (⌘K)'),
          task(false, 'Ranger ses documents dans des dossiers'),
          task(false, 'Exporter un document en PDF (⌘P)'),
        ],
      },
      {
        type: 'steps',
        content: [
          step('Créer un dossier', 'Bouton « Nouveau dossier » ou clic droit dans la sidebar.'),
          step('Y glisser ses documents', 'Par glisser-déposer, ou « Déplacer vers… » au clavier.'),
          step('Épingler l’essentiel', 'Les documents épinglés restent en haut de la sidebar.'),
        ],
      },

      h(2, 'Blocs spéciaux'),
      p(
        t('Chaque encadré a sa couleur et son icône — au trait, en emoji, ou aucune. Les chiffres clés passent de 1 à 4 cartes avec le sélecteur qui apparaît au survol.'),
      ),
      callout('green', 'icon:lightbulb', t('Astuce : ', bold), t('survolez un bloc, la poignée à gauche permet de le glisser, le dupliquer ou le transformer.')),
      callout('orange', 'icon:warning', t('Le point en haut à droite indique la synchro : vert, tout est en ligne ; orange, vous êtes hors ligne et vos modifications partiront au retour du réseau.')),
      callout('purple', 'emoji:🎨', t('Un encadré avec un emoji, pour les notes plus personnelles.')),
      callout('gray', 'none', t('Et un encadré sobre, sans icône.')),
      { type: 'pullQuote', content: [p(t('Écrire, c’est d’abord effacer.'))] },
      metrics(['21', 'types de blocs'], ['1 s', 'pour être en ligne'], ['100 %', 'au clavier'], ['∞', 'documents']),
      {
        type: 'columns',
        content: [
          { type: 'column', content: [p(t('Avant', bold)), p(t('Des notes éparpillées dans dix applications.'))] },
          { type: 'column', content: [p(t('Après', bold)), p(t('Un seul endroit, rapide et rangé.'))] },
        ],
      },

      h(2, 'Tableaux'),
      {
        type: 'table',
        content: [
          row('tableHeader', [t('Raccourci')], [t('Action')]),
          row('tableCell', [t('⌘K', code)], [t('Palette de commandes')]),
          row('tableCell', [t('⌘F', code)], [t('Rechercher et remplacer (⌥⌘F)')]),
          row('tableCell', [t('⌥⇧↑ / ↓', code)], [t('Déplacer le bloc courant')]),
          row('tableCell', [t('⇧⌘F', code)], [t('Mode focus')]),
          row('tableCell', [t('⌥F10', code)], [t('Aller dans la barre d’outils')]),
        ],
      },

      h(2, 'Code et formules'),
      {
        type: 'codeBlock',
        attrs: { language: 'typescript' },
        content: [
          t(
            [
              '// Le temps de lecture affiché en bas à droite',
              'function readingTime(words: number): string {',
              '  const minutes = Math.max(1, Math.round(words / 230));',
              '  return `${minutes} min de lecture`;',
              '}',
            ].join('\n'),
          ),
        ],
      },
      p(
        t('Une formule dans le texte, comme '),
        { type: 'inlineMath', attrs: { latex: 'E = mc^2' } },
        t(', ou en bloc — cliquez dessus pour la modifier :'),
      ),
      { type: 'blockMath', attrs: { latex: '\\int_0^1 x^2\\,dx = \\frac{1}{3}' } },

      h(2, 'Pour aller plus loin'),
      {
        type: 'details',
        content: [
          { type: 'detailsSummary', content: [t('Quelques astuces (cliquez sur la flèche)')] },
          {
            type: 'detailsContent',
            content: [
              bullets(
                [t('Le sommaire, à droite sur grand écran, suit votre lecture.')],
                [t('Clic droit sur un document : renommer, épingler, changer son icône.')],
                [t('Le mode focus (⇧⌘F) estompe tout sauf le paragraphe en cours.')],
                [t('Sur téléphone : Partager → « Sur l’écran d’accueil » pour installer Meenuut comme une app.')],
              ),
            ],
          },
        ],
      },
      { type: 'horizontalRule' },
      { type: 'paragraph', attrs: { textAlign: 'center' }, content: [t('Bonne écriture.', italic)] },
    ],
  };
}

/** Texte brut, pour la recherche plein texte de la sidebar. */
export function plainText(node: JSONContent): string {
  if (node.text) return node.text;
  if (node.type === 'mention') return String(node.attrs?.label ?? '');
  const children = (node.content ?? []).map(plainText);
  const isBlockContainer = (node.content ?? []).some(
    (child) => !child.text && !['inlineMath', 'mention'].includes(child.type ?? ''),
  );
  return children.join(isBlockContainer ? '\n\n' : '');
}
