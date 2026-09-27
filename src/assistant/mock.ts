import type { JSONContent } from '@tiptap/react';

/**
 * Réponses simulées, le temps de valider l'interface : aucune IA n'est appelée.
 * Même forme que la future réponse réelle : un texte, et éventuellement une proposition
 * que l'utilisateur applique ou non.
 */

export type Proposal =
  | { kind: 'replace'; original: string; replacement: string }
  | { kind: 'create'; title: string; content: JSONContent; text: string };

export interface MockReply {
  text: string;
  proposal?: Proposal;
}

export interface MockContext {
  prompt: string;
  selection: string | null;
  docTitle: string;
  headings: string[];
  wordCount: number;
  attachments: { name: string; kind: string }[];
}

const firstSentence = (text: string) => /^.*?[.!?…](\s|$)/s.exec(text)?.[0].trim() ?? text;

function rewrite(kind: string, text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  switch (kind) {
    case 'shorten':
      return firstSentence(clean);
    case 'fix': {
      const capitalized = clean.charAt(0).toUpperCase() + clean.slice(1);
      return /[.!?…]$/.test(capitalized) ? capitalized : `${capitalized}.`;
    }
    case 'translate':
      return `[EN] ${clean}`;
    default:
      return `Autrement dit : ${clean.charAt(0).toLowerCase()}${clean.slice(1)}`;
  }
}

const REWRITES: [RegExp, string, string][] = [
  [/raccourc|plus court|résume ce passage/i, 'shorten', 'Voici une version plus courte :'],
  [/corrig|faute|orthographe/i, 'fix', 'J’ai corrigé la ponctuation et les majuscules :'],
  [/tradui|anglais|english/i, 'translate', 'Voici la traduction :'],
  [/reformul|réécri|autrement|simplifi/i, 'rephrase', 'Voici une reformulation :'],
];

export function mockReply(ctx: MockContext): MockReply {
  const { prompt, selection, attachments } = ctx;

  if (attachments.length) {
    const list = attachments.map((file) => `• ${file.name} (${file.kind})`).join('\n');
    return {
      text: `J’ai bien reçu :\n\n${list}\n\nUne fois branché, je les lirai pour répondre à votre question, en résumer le contenu ou en tirer un document.`,
    };
  }

  if (selection) {
    for (const [pattern, kind, intro] of REWRITES) {
      if (pattern.test(prompt)) {
        return {
          text: `${intro} Rien n’est modifié tant que vous n’appliquez pas.`,
          proposal: { kind: 'replace', original: selection, replacement: rewrite(kind, selection) },
        };
      }
    }
  }

  if (/cré|nouveau doc|rédige un doc/i.test(prompt)) {
    const subject =
      /(?:sur|à propos de|pour)\s+(.+)$/i.exec(prompt)?.[1]?.replace(/[.?!]+$/, '') ?? 'Nouvelles idées';
    const title = subject.charAt(0).toUpperCase() + subject.slice(1);
    const items = ['Contexte', 'Points clés', 'Prochaines étapes'];
    return {
      text: `Je peux créer un document « ${title} » avec une structure de départ. Il ne sera créé que si vous confirmez.`,
      proposal: {
        kind: 'create',
        title,
        content: {
          type: 'doc',
          content: items.flatMap((heading) => [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: heading }] },
            { type: 'paragraph' },
          ]),
        },
        text: items.join('\n\n'),
      },
    };
  }

  if (/résum|synthè|points? clés|de quoi parle/i.test(prompt)) {
    const outline = ctx.headings.length
      ? ctx.headings.map((heading) => `• ${heading}`).join('\n')
      : '• Pas encore de titres dans ce document.';
    return {
      text: `« ${ctx.docTitle || 'Sans titre'} » fait ${ctx.wordCount} mots. Il s’articule ainsi :\n\n${outline}\n\n(Aperçu : une fois branché, je lirai vraiment le texte pour le résumer.)`,
    };
  }

  if (selection) {
    const words = selection.split(/\s+/).filter(Boolean).length;
    return {
      text: `Ce passage fait ${words} mot${words > 1 ? 's' : ''}. Une fois branché, je répondrai ici à votre question à son sujet, sans toucher au texte.\n\nPour le modifier, demandez par exemple « reformule », « raccourcis » ou « corrige ».`,
    };
  }

  return {
    text: 'Je suis en mode aperçu : mes réponses sont simulées pour tester l’interface.\n\nEssayez « résume ce document », « crée un doc sur mes vacances », ou sélectionnez un passage et demandez « reformule ».',
  };
}

/** Découpe en petits morceaux, pour simuler l'écriture en direct. */
export function* chunks(text: string): Generator<string> {
  for (const match of text.matchAll(/\S+\s*|\s+/g)) yield match[0];
}
