import type { JSONContent } from '@tiptap/react';
import {
  ChartIcon,
  ColumnsIcon,
  InfoIcon,
  QuoteMarkIcon,
  StepsIcon,
} from '../../ui/icons';
import type { SlashItem } from '../slash/items';
import { insertBlock } from './helpers';

const p = (): JSONContent => ({ type: 'paragraph' });

const block =
  (content: JSONContent): SlashItem['run'] =>
  (chain, editor) => {
    // La chaîne porte le focus (et, depuis le menu "/", la suppression de la requête).
    chain.run();
    insertBlock(editor, content);
  };

/** Blocs spéciaux : proposés dans le menu "/" et dans le panneau « Insérer » de la barre. */
export const CUSTOM_ITEMS: SlashItem[] = [
  {
    id: 'callout',
    label: 'Encadré',
    description: 'Un passage mis en valeur, couleur et icône au choix',
    keywords: ['callout', 'encadre', 'info', 'astuce', 'attention', 'important', 'note', 'alerte'],
    icon: InfoIcon,
    run: block({ type: 'callout', attrs: { color: 'blue', icon: 'icon:info' }, content: [p()] }),
  },
  {
    id: 'pullQuote',
    label: 'Citation mise en avant',
    description: 'Une phrase forte, en grand',
    keywords: ['pull quote', 'citation', 'exergue'],
    icon: QuoteMarkIcon,
    run: block({ type: 'pullQuote', content: [p()] }),
  },
  {
    id: 'columns',
    label: 'Deux colonnes',
    description: 'Deux contenus côte à côte',
    keywords: ['colonnes', 'columns', 'grille', 'cote a cote'],
    icon: ColumnsIcon,
    run: block({
      type: 'columns',
      content: [
        { type: 'column', content: [p()] },
        { type: 'column', content: [p()] },
      ],
    }),
  },
  {
    id: 'steps',
    label: 'Étapes',
    description: 'Une marche à suivre : libellé et description',
    keywords: ['etapes', 'steps', 'processus', 'timeline', 'tutoriel'],
    icon: StepsIcon,
    run: block({
      type: 'steps',
      content: [1, 2].map(() => ({ type: 'step', content: [p(), p()] })),
    }),
  },
  {
    id: 'metrics',
    label: 'Chiffres clés',
    description: 'De 1 à 4 cartes « chiffre + libellé »',
    keywords: ['chiffres', 'stats', 'kpi', 'metriques', 'nombres'],
    icon: ChartIcon,
    run: block({
      type: 'metrics',
      content: [1, 2, 3].map(() => ({ type: 'metric', content: [p(), p()] })),
    }),
  },
];
