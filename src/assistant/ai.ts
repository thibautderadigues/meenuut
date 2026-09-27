import type { JSONContent } from '@tiptap/core';
import { supabase } from '../sync/supabase';

/** Proposition de l'assistant : rien n'est appliqué sans le clic de l'utilisateur. */
export type Proposal =
  | { kind: 'replace'; original: string; replacement: string }
  | { kind: 'create'; title: string; content: JSONContent; text: string }
  | { kind: 'insert'; markdown: string }
  /** Écrit directement dans le document, en attente d'acceptation. */
  | { kind: 'inline'; mode: 'write' | 'rewrite' }
  /** Plusieurs passages modifiés dans le document, chacun à accepter ou refuser. */
  | { kind: 'edits'; summary: string; count: number; missing: number };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Retouche rapide ou conversation : choisit le modèle côté serveur. */
export type Mode = 'quick' | 'chat';

export class AssistantError extends Error {
  constructor(
    readonly code: 'signed-out' | 'rate-limit' | 'network' | 'server',
    /** Réponse brute du serveur (message de Mistral), affichée en petit pour diagnostiquer. */
    readonly detail = '',
  ) {
    super(code);
  }
}

export const ERROR_MESSAGES: Record<AssistantError['code'], string> = {
  'signed-out': 'Connectez-vous pour utiliser l’assistant.',
  'rate-limit': 'Mistral est saturé ou la limite gratuite est atteinte. Réessayez dans une minute.',
  network: 'Pas de réseau : l’assistant a besoin d’une connexion.',
  server: 'L’assistant n’a pas pu répondre. Réessayez dans un instant.',
};

const RETRIES_ON_SATURATION = 2;
const RETRY_DELAY_MS = 1500;

/** Réponse de l'IA, morceau par morceau (flux SSE relayé par la fonction Supabase). */
export async function* streamReply(
  messages: ChatMessage[],
  mode: Mode,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AssistantError('signed-out');

  const call = () =>
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages, mode }),
      signal,
    });

  let response: Response;
  try {
    response = await call();
    // Offre gratuite saturée : souvent passager, un second essai discret suffit.
    for (let attempt = 1; response.status === 429 && attempt <= RETRIES_ON_SATURATION; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      if (signal.aborted) return;
      response = await call();
    }
  } catch (error) {
    if (signal.aborted) return;
    console.error(error);
    throw new AssistantError(navigator.onLine ? 'server' : 'network');
  }
  if (!response.ok) {
    const detail = await response.text();
    console.error('Assistant', response.status, detail);
    if (response.status === 401) throw new AssistantError('signed-out', detail);
    if (response.status === 429) throw new AssistantError('rate-limit', detail);
    throw new AssistantError('server', `${response.status} ${detail}`);
  }
  if (!response.body) throw new AssistantError('server');

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) yield delta;
      } catch {
        // Ligne incomplète ou de contrôle : ignorée.
      }
    }
  }
}

// --- Consignes ---

const BASE = `Tu es l’assistant intégré à Meenuut, un éditeur de documents personnel. Tu aides la personne à écrire, comprendre et organiser ses documents.

Principes :
- Appuie-toi d’abord sur le document fourni. N’invente ni faits, ni chiffres, ni détails qui n’y figurent pas ; si l’information manque, dis-le simplement.
- Sois exact : reprends les noms, termes et exemples tels qu’ils apparaissent dans le document.
- Va droit au but : pas de préambule (« Bien sûr », « Voici… ») ni de conclusion de politesse. Une question simple appelle une réponse courte.
- Adapte la longueur : un résumé tient en quelques lignes ou en une courte liste, jamais plus d’un cinquième du texte d’origine.
- Réponds dans la langue de la personne et reprends son registre (tutoiement ou vouvoiement).
- Mise en forme légère en Markdown : paragraphes courts, listes seulement quand elles aident, gras avec parcimonie, pas de titres dans une réponse de quelques lignes.
- Tu ne modifies jamais un document toi-même : la personne applique tes propositions. Ne dis donc pas « j’ai modifié » ou « j’ai créé ».
- Dans la conversation, reste en Markdown simple : paragraphes, listes, gras, italique, liens, tableaux, blocs de code. Pas de formules, d’encadrés ni de HTML.`;

/** Blocs de Meenuut que l'IA peut produire quand elle écrit dans un document. */
const RICH_FORMATS = `Quand tu écris dans un document, tu peux utiliser, en plus du Markdown (titres ## et ###, listes, gras, italique, liens, citations >, tableaux, blocs de code), les blocs de Meenuut suivants. Sers-t’en quand ils rendent le document plus clair, sans en abuser :
- encadré coloré : une citation commençant par un type, par ex. « > [!TIP] » puis le texte à la ligne suivante (« > … »). Types : NOTE (information), TIP (astuce), IMPORTANT (à retenir), WARNING (attention), CAUTION (danger) ;
- bloc dépliable (FAQ, détails optionnels) : <details><summary>Question ou titre</summary> puis le contenu en Markdown, puis </details> ;
- cases à cocher (tâches, check-lists) : « - [ ] tâche » ou « - [x] tâche faite » ;
- surlignage d’un mot important : ==texte== ;
- formules mathématiques : $x^2$ dans une phrase, ou $$ sur leur propre ligne pour une formule centrée.`;

/** Préfixe d'une réponse qui demande une précision au lieu d'écrire. */
export const QUESTION_PREFIX = 'QUESTION:';

const QUESTION_RULE = `QUESTION: — seulement si la demande est trop vague pour agir utilement (sujet, but ou destinataire impossibles à deviner, même avec le document). Puis un objet JSON, sans rien d’autre :
{"questions":[{"question":"Quel ton ?","options":["Sérieux","Décontracté","Humoristique"],"multiple":false}]}
1 à 3 questions courtes, 2 à 4 options courtes chacune (pas d’option « Autre » : la personne peut toujours répondre librement) ; "multiple": true si plusieurs réponses se cumulent. Si tu peux raisonnablement deviner, agis directement.`;

const CREATE_RULE = `CREATE: — créer un nouveau document, distinct de celui ouvert. Puis le document en Markdown, en commençant par « # Titre » (court et parlant) : des sections ## si le sujet le justifie, du contenu concret et directement utilisable, sans remplissage ni crochets à compléter.`;

export const REWRITE_SYSTEM = `Tu réécris un extrait de document selon la consigne donnée.

Règles :
- Réponds UNIQUEMENT par le texte réécrit : pas de guillemets, pas d’introduction, pas d’explication.
- Garde le sens, les faits, les noms et les chiffres. N’ajoute aucune information.
- Garde la langue de l’extrait, sauf si la consigne demande une traduction.
- Corriger : ne change que les fautes (orthographe, grammaire, ponctuation), garde le style.
- Raccourcir : vise environ la moitié de la longueur, en gardant l’essentiel.
- Reformuler : même idée, formulation plus claire et plus naturelle, longueur proche.
- Garde la forme de l’extrait (une phrase reste une phrase, une liste reste une liste).`;

/** Contexte du document ouvert, sans les images (inutiles et coûteuses). */
function documentContext(docTitle: string, docMarkdown: string): string {
  const MAX = 60_000;
  const cleaned = docMarkdown.replace(/!\[[^\]]*\]\(data:[^)]*\)/g, '[image]');
  const body =
    cleaned.length > MAX
      ? `${cleaned.slice(0, MAX)}\n\n[… document tronqué : seul le début est fourni]`
      : cleaned;
  return `Document ouvert : « ${docTitle || 'Sans titre'} ».\n<document>\n${body}\n</document>`;
}

export interface AgentContext {
  docTitle: string;
  docMarkdown: string;
  /** Section où se trouve le curseur. */
  section: string;
  /** Ce qui entoure le curseur : là où WRITE écrira. */
  before: string;
  after: string;
}

/**
 * Consigne de l'agent : l'IA choisit elle-même comment répondre à la demande — répondre,
 * modifier le document (EDITS), écrire au curseur (WRITE), créer un document (CREATE)
 * ou poser des questions (QUESTION). Sans document (`context` nul) : répondre, créer, demander.
 */
export function agentSystem(context: AgentContext | null): string {
  if (!context) {
    return `${BASE}

Commence ta réponse par l’une de ces formes :
1. Répondre : écris directement ta réponse, en Markdown simple.
2. ${CREATE_RULE}
3. ${QUESTION_RULE}

Quand la personne demande de créer, rédiger ou préparer un document (une fiche, un résumé, un plan…), utilise CREATE : ne lui donne pas un texte à copier-coller.

${RICH_FORMATS}`;
  }
  const where = context.section ? ` Le curseur est dans la section « ${context.section} ».` : '';
  return `${BASE}

${documentContext(context.docTitle, context.docMarkdown)}

Tu peux agir sur ce document.${where} Commence ta réponse par l’une de ces formes :
1. Répondre (question, explication, avis) : écris directement ta réponse, en Markdown simple.
2. EDITS: — modifier le document ouvert : corriger, reformuler, compléter ou supprimer des passages existants, ou ajouter un paragraphe à un endroit précis. Puis un objet JSON, sans rien d’autre :
{"summary":"ce que tu changes, en une phrase","edits":[{"find":"passage exact du document","replace":"nouveau texte"},{"after":"passage exact du document","insert":"nouveau paragraphe en Markdown"}]}
   - « find » et « after » recopient mot pour mot un passage du document, en texte brut (sans #, **, ==, > ni autre syntaxe Markdown), à l’intérieur d’un seul paragraphe ou titre ; prends une phrase entière pour qu’il soit unique.
   - « replace » : le nouveau texte de ce passage (gras et italique en Markdown possibles) ; vide pour le supprimer.
   - « insert » : un ou plusieurs paragraphes ajoutés juste après le paragraphe qui contient « after ».
   - Une entrée par passage changé ; ne touche pas au reste. Autant d’entrées que nécessaire pour tout faire.
3. WRITE: — écrire un nouveau passage à l’emplacement du curseur, entre « ${context.before || '(début du document)'} » et « ${context.after || '(fin du document)'} ». Puis le passage en Markdown, qui s’intègre dans la suite logique de ce qui précède, sans le répéter, dans le ton du document.
4. ${CREATE_RULE}
5. ${QUESTION_RULE}

Quand la personne demande d’agir sur le document (corrige, modifie, ajoute, supprime, réécris, complète, améliore…), agis avec EDITS (pour changer ce qui existe) ou WRITE (pour ajouter un passage au curseur). Ne décris jamais des changements à faire et ne demande jamais de copier-coller : fais-les.

${RICH_FORMATS}`;
}

export type Action = 'answer' | 'edits' | 'write' | 'create' | 'question';

const ACTIONS: [string, Action][] = [
  ['EDITS:', 'edits'],
  ['WRITE:', 'write'],
  ['CREATE:', 'create'],
  [QUESTION_PREFIX, 'question'],
];

/** Forme de la réponse d'après son début ; null tant qu'on ne peut pas encore trancher. */
export function detectAction(text: string): Action | null {
  const head = text.trimStart().replace(/^[*_`#\s]+/, '').toUpperCase();
  for (const [prefix, action] of ACTIONS) if (head.startsWith(prefix)) return action;
  if (ACTIONS.some(([prefix]) => prefix.startsWith(head))) return null;
  return 'answer';
}

/** Le contenu après le préfixe d'action. */
export function stripAction(text: string): string {
  return text.trimStart().replace(/^[*_`#\s]*(EDITS|WRITE|CREATE|QUESTION):[*_`]*\s*/i, '');
}

export type EditOp = { find: string; replace: string } | { after: string; insert: string };

/** « EDITS: {…} » → résumé et modifications ; null si le JSON est absent ou invalide. */
export function parseEdits(text: string): { summary: string; edits: EditOp[] } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as { summary?: unknown; edits?: unknown };
    if (!Array.isArray(data.edits)) return null;
    const edits = data.edits.flatMap((item: Record<string, unknown>): EditOp[] => {
      if (typeof item?.find === 'string' && item.find.trim()) {
        return [{ find: item.find, replace: typeof item.replace === 'string' ? item.replace : '' }];
      }
      if (typeof item?.after === 'string' && typeof item?.insert === 'string' && item.insert.trim()) {
        return [{ after: item.after, insert: item.insert }];
      }
      return [];
    });
    return edits.length ? { summary: String(data.summary ?? '').trim(), edits } : null;
  } catch {
    return null;
  }
}

export const REWRITE_PATTERN =
  /reformul|réécri|raccourc|plus court|corrig|faute|orthographe|simplifi|tradui|anglais|english|améliore|allonge|développe/i;

/** « # Titre » en tête → titre du document, le reste → contenu. */
export function splitTitle(markdown: string): { title: string; body: string } {
  const match = /^\s*#\s+(.+)\n?/.exec(markdown);
  if (!match) return { title: 'Nouveau document', body: markdown };
  return { title: (match[1] ?? '').trim(), body: markdown.slice(match[0].length) };
}

/** Question à choix posée par l'IA avant d'écrire. */
export interface AskQuestion {
  question: string;
  options: string[];
  multiple: boolean;
}

/** « QUESTION: {…} » → questions à choix ; texte libre si le JSON est absent ou invalide. */
export function parseQuestions(text: string): AskQuestion[] | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as { questions?: unknown };
    if (!Array.isArray(data.questions)) return null;
    const questions = data.questions
      .map((item: { question?: unknown; options?: unknown; multiple?: unknown }) => ({
        question: String(item?.question ?? '').trim(),
        options: Array.isArray(item?.options) ? item.options.map(String).filter(Boolean).slice(0, 6) : [],
        multiple: item?.multiple === true,
      }))
      .filter((item) => item.question)
      .slice(0, 4);
    return questions.length ? questions : null;
  } catch {
    return null;
  }
}
