import type { JSONContent } from '@tiptap/core';
import { supabase } from '../sync/supabase';

/** Proposition de l'assistant : rien n'est appliqué sans le clic de l'utilisateur. */
export type Proposal =
  | { kind: 'replace'; original: string; replacement: string }
  | { kind: 'create'; title: string; content: JSONContent; text: string }
  | { kind: 'insert'; markdown: string }
  /** Écrit directement dans le document, en attente d'acceptation. */
  | { kind: 'inline'; mode: 'write' | 'rewrite' };

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

const ASK_FIRST = `Si la demande est trop vague pour écrire quelque chose de vraiment utile (sujet, but ou destinataire impossibles à deviner, même avec le document), n’écris rien : réponds uniquement par « ${QUESTION_PREFIX} » suivi d’une ou deux questions courtes pour préciser. Si tu peux raisonnablement deviner, écris directement, sans poser de question.`;

export const REWRITE_SYSTEM = `Tu réécris un extrait de document selon la consigne donnée.

Règles :
- Réponds UNIQUEMENT par le texte réécrit : pas de guillemets, pas d’introduction, pas d’explication.
- Garde le sens, les faits, les noms et les chiffres. N’ajoute aucune information.
- Garde la langue de l’extrait, sauf si la consigne demande une traduction.
- Corriger : ne change que les fautes (orthographe, grammaire, ponctuation), garde le style.
- Raccourcir : vise environ la moitié de la longueur, en gardant l’essentiel.
- Reformuler : même idée, formulation plus claire et plus naturelle, longueur proche.
- Garde la forme de l’extrait (une phrase reste une phrase, une liste reste une liste).`;

export const CREATE_SYSTEM = `${BASE}

On te demande de rédiger un nouveau document. Réponds uniquement par le document, en Markdown :
- première ligne « # Titre » (titre court et parlant) ;
- des sections « ## » seulement si le sujet le justifie ;
- du contenu concret et directement utilisable, sans texte de remplissage ni crochets à compléter.

${RICH_FORMATS}

${ASK_FIRST}`;

/** Contexte du document ouvert, sans les images (inutiles et coûteuses). */
export function chatSystem(docTitle: string, docMarkdown: string, section = ''): string {
  const MAX = 60_000;
  const cleaned = docMarkdown.replace(/!\[[^\]]*\]\(data:[^)]*\)/g, '[image]');
  const body =
    cleaned.length > MAX
      ? `${cleaned.slice(0, MAX)}\n\n[… document tronqué : seul le début est fourni]`
      : cleaned;
  const where = section ? `\n\nLa personne est actuellement dans la section « ${section} » du document.` : '';
  return `${BASE}\n\n${documentContext(docTitle, body)}${where}`;
}

function documentContext(docTitle: string, body: string): string {
  return `Document ouvert : « ${docTitle || 'Sans titre'} ». Il sert de contexte : appuie-toi dessus quand la demande s’y rapporte, mais n’en imite ni le contenu ni la forme quand on te demande autre chose.\n<document>\n${body}\n</document>`;
}

/** Rédiger un passage à insérer dans le document ouvert (« écris un paragraphe sur… »). */
export function writeSystem(docTitle: string, docMarkdown: string, section = ''): string {
  return `${chatSystem(docTitle, docMarkdown, section)}

On te demande de rédiger un passage à insérer dans ce document, à l’endroit indiqué. Il doit s’y intégrer naturellement : dans la suite logique de ce qui précède, sans répéter ce qui est déjà écrit, dans la langue et le ton du document. Réponds UNIQUEMENT par ce passage, prêt à être inséré : pas de préambule, pas de commentaire, pas de titre sauf si on t’en demande un. Écris un vrai texte, concret, sur le sujet demandé (ou, faute de sujet, sur celui du document).

${RICH_FORMATS}

${ASK_FIRST}`;
}

export const REWRITE_PATTERN =
  /reformul|réécri|raccourc|plus court|corrig|faute|orthographe|simplifi|tradui|anglais|english|améliore|allonge|développe/i;
export const WRITE_PATTERN =
  /^(écris|ecris|rédige|redige|ajoute|génère|genere|propose|fais)(-moi|\s+moi)?\s+(un|une|des|la|le|l’|l')?\s*(\S+\s+)?(paragraphe|phrase|intro|introduction|conclusion|texte|liste|tableau|section|partie|plan|exemple)/i;
/**
 * « Crée un doc… », « crée-moi vite fait un document… », « fais-moi une fiche… », « nouveau document… ».
 * Pas « ajoute une note à ce document » (c'est une écriture dans le document ouvert).
 */
export const CREATE_PATTERN =
  /(^|\s)(cré\w*|crée\w*|nouveau|nouvelle|(rédige|écris|ecris|fais|génère|genere|prépare|prepare)(-moi|\s+moi)?\s+(un|une))\b[^.?!]{0,40}?\b(doc|docs|document|fiche|page|note)\b(?!\s*(ouvert|actuel))/i;

/** « # Titre » en tête → titre du document, le reste → contenu. */
export function splitTitle(markdown: string): { title: string; body: string } {
  const match = /^\s*#\s+(.+)\n?/.exec(markdown);
  if (!match) return { title: 'Nouveau document', body: markdown };
  return { title: (match[1] ?? '').trim(), body: markdown.slice(match[0].length) };
}
