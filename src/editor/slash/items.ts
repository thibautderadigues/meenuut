import type { ChainedCommands, Editor } from '@tiptap/react';
import type { ComponentType } from 'react';
import { normalizeForSearch } from '../../lib/format';
import { pickImages } from '../../lib/images';
import {
  BulletListIcon,
  CodeBlockIcon,
  DividerIcon,
  AtIcon,
  ImageIcon,
  SigmaIcon,
  TableIcon,
  ToggleIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  OrderedListIcon,
  QuoteIcon,
  TaskListIcon,
  TextIcon,
} from '../../ui/icons';
import { insertImages } from '../insertImages';

export interface SlashItem {
  id: string;
  label: string;
  /** Termes de recherche supplémentaires (français, anglais, syntaxe). */
  keywords: string[];
  /** Syntaxe Markdown équivalente : affichée pour l'apprendre au passage. */
  hint?: string;
  /** Phrase courte, affichée dans le panneau « Insérer ». */
  description?: string;
  icon: ComponentType;
  /** `chain` : déjà focalisée (et la requête "/" supprimée, pour le menu slash). */
  run: (chain: ChainedCommands, editor: Editor) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'paragraph',
    label: 'Texte',
    keywords: ['paragraphe', 'paragraph', 'text'],
    icon: TextIcon,
    run: (chain) => chain.setParagraph().run(),
  },
  {
    id: 'h1',
    label: 'Titre 1',
    keywords: ['h1', 'heading', 'grand'],
    hint: '#',
    icon: Heading1Icon,
    run: (chain) => chain.setHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Titre 2',
    keywords: ['h2', 'heading', 'moyen'],
    hint: '##',
    icon: Heading2Icon,
    run: (chain) => chain.setHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Titre 3',
    keywords: ['h3', 'heading', 'petit'],
    hint: '###',
    icon: Heading3Icon,
    run: (chain) => chain.setHeading({ level: 3 }).run(),
  },
  {
    id: 'bulletList',
    label: 'Liste à puces',
    keywords: ['ul', 'bullet', 'list'],
    hint: '-',
    icon: BulletListIcon,
    run: (chain) => chain.toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: 'Liste numérotée',
    keywords: ['ol', 'ordered', 'numbered', 'list'],
    hint: '1.',
    icon: OrderedListIcon,
    run: (chain) => chain.toggleOrderedList().run(),
  },
  {
    id: 'taskList',
    label: 'Liste de tâches',
    keywords: ['todo', 'task', 'checkbox', 'cases', 'list'],
    hint: '[ ]',
    icon: TaskListIcon,
    run: (chain) => chain.toggleTaskList().run(),
  },
  {
    id: 'blockquote',
    label: 'Citation',
    keywords: ['quote', 'blockquote'],
    hint: '>',
    icon: QuoteIcon,
    run: (chain) => chain.setBlockquote().run(),
  },
  {
    id: 'codeBlock',
    label: 'Bloc de code',
    keywords: ['code', 'pre', 'snippet'],
    hint: '```',
    icon: CodeBlockIcon,
    run: (chain) => chain.setCodeBlock().run(),
  },
  {
    id: 'divider',
    label: 'Séparateur',
    keywords: ['hr', 'divider', 'ligne', 'rule'],
    hint: '---',
    icon: DividerIcon,
    run: (chain) => chain.setHorizontalRule().run(),
  },
  {
    id: 'table',
    label: 'Tableau',
    keywords: ['table', 'grille', 'colonnes'],
    icon: TableIcon,
    run: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'image',
    label: 'Image',
    keywords: ['image', 'photo', 'picture', 'img'],
    icon: ImageIcon,
    run: (chain, editor) => {
      chain.run();
      void pickImages().then((files) => insertImages(editor, files));
    },
  },
  {
    id: 'details',
    label: 'Bloc dépliable',
    keywords: ['toggle', 'details', 'accordeon', 'replier'],
    icon: ToggleIcon,
    run: (chain) => chain.setDetails().run(),
  },
  {
    id: 'inlineMath',
    label: 'Formule',
    keywords: ['math', 'latex', 'equation', 'katex'],
    hint: '$$',
    icon: SigmaIcon,
    // Le clic sur la formule insérée ouvre son éditeur (voir MathEditor).
    run: (chain) => chain.insertInlineMath({ latex: 'x^2' }).run(),
  },
  {
    id: 'blockMath',
    label: 'Bloc de formule',
    keywords: ['math', 'latex', 'equation', 'katex'],
    hint: '$$$',
    icon: SigmaIcon,
    run: (chain) => chain.insertBlockMath({ latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' }).run(),
  },
  {
    id: 'mention',
    label: 'Lien vers un document',
    keywords: ['mention', 'lien', 'page', 'document'],
    hint: '@',
    icon: AtIcon,
    run: (chain) => chain.insertContent('@').run(),
  },
];

function score(item: SlashItem, query: string): number {
  const label = normalizeForSearch(item.label);
  if (label.startsWith(query)) return 3;
  if (label.split(' ').some((word) => word.startsWith(query))) return 2;
  if (item.keywords.some((keyword) => keyword.startsWith(query))) return 1;
  return 0;
}

/** Préfixe du libellé > préfixe d'un mot > mot-clé. L'ordre d'origine départage. */
export function filterSlashItems(query: string, extra: SlashItem[] = []): SlashItem[] {
  const all = [...SLASH_ITEMS, ...extra];
  const needle = normalizeForSearch(query.trim());
  if (!needle) return all;
  return all.map((item) => ({ item, score: score(item, needle) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}
