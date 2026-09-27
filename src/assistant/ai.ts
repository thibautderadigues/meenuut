import { generateJSON, type JSONContent } from '@tiptap/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { createExtensions } from '../editor/extensions';
import { supabase } from '../sync/supabase';

/** Proposition de l'assistant : rien n'est appliqué sans le clic de l'utilisateur. */
export type Proposal =
  | { kind: 'replace'; original: string; replacement: string }
  | { kind: 'create'; title: string; content: JSONContent; text: string };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Retouche rapide ou conversation : choisit le modèle côté serveur. */
export type Mode = 'quick' | 'chat';

export class AssistantError extends Error {
  constructor(readonly code: 'signed-out' | 'rate-limit' | 'network' | 'server') {
    super(code);
  }
}

export const ERROR_MESSAGES: Record<AssistantError['code'], string> = {
  'signed-out': 'Connectez-vous pour utiliser l’assistant.',
  'rate-limit': 'Limite de l’offre gratuite atteinte. Réessayez dans une minute.',
  network: 'Pas de réseau : l’assistant a besoin d’une connexion.',
  server: 'L’assistant n’a pas pu répondre. Réessayez dans un instant.',
};

/** Réponse de l'IA, morceau par morceau (flux SSE relayé par la fonction Supabase). */
export async function* streamReply(
  messages: ChatMessage[],
  mode: Mode,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AssistantError('signed-out');

  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages, mode }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) return;
    console.error(error);
    throw new AssistantError(navigator.onLine ? 'server' : 'network');
  }
  if (response.status === 401) throw new AssistantError('signed-out');
  if (response.status === 429) throw new AssistantError('rate-limit');
  if (!response.ok || !response.body) throw new AssistantError('server');

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

const BASE =
  'Tu es l’assistant d’écriture de Meenuut, un éditeur de documents. Réponds en français (sauf demande contraire), de façon concise et utile, en Markdown simple. Ne prétends jamais avoir modifié un document : l’utilisateur applique lui-même tes propositions.';

export const REWRITE_SYSTEM =
  'Tu réécris le passage fourni selon la consigne. Réponds UNIQUEMENT par le texte réécrit : pas de guillemets, pas d’introduction, pas de commentaire. Garde la langue du passage, sauf si la consigne demande une traduction.';

export const CREATE_SYSTEM = `${BASE} On te demande de rédiger un nouveau document. Réponds uniquement par le document en Markdown, en commençant par une ligne « # Titre ».`;

/** Contexte du document ouvert, sans les images (inutiles et coûteuses). */
export function chatSystem(docTitle: string, docMarkdown: string): string {
  const MAX = 60_000;
  const cleaned = docMarkdown.replace(/!\[[^\]]*\]\(data:[^)]*\)/g, '[image]');
  const body =
    cleaned.length > MAX
      ? `${cleaned.slice(0, MAX)}\n\n[… document tronqué : seul le début est fourni]`
      : cleaned;
  return `${BASE}\n\nDocument ouvert : « ${docTitle || 'Sans titre'} ».\n<document>\n${body}\n</document>`;
}

export const REWRITE_PATTERN =
  /reformul|réécri|raccourc|plus court|corrig|faute|orthographe|simplifi|tradui|anglais|english|améliore|allonge|développe/i;
export const CREATE_PATTERN = /\b(cré|rédige|écris)\w*\s+(moi\s+)?(un|une)\s+(nouveau\s+)?(doc|document|note|page)/i;

// --- Markdown → document ---

const extensions = createExtensions({ onTableOfContents: () => {}, onEditMath: () => {} });

/** Markdown de l'IA → HTML nettoyé (affichage dans la conversation, insertion). */
export function markdownToHtml(markdown: string): string {
  return DOMPurify.sanitize(marked.parse(markdown, { async: false, gfm: true, breaks: false }));
}

export function markdownToContent(markdown: string): JSONContent {
  return generateJSON(markdownToHtml(markdown), extensions);
}

/** « # Titre » en tête → titre du document, le reste → contenu. */
export function splitTitle(markdown: string): { title: string; body: string } {
  const match = /^\s*#\s+(.+)\n?/.exec(markdown);
  if (!match) return { title: 'Nouveau document', body: markdown };
  return { title: (match[1] ?? '').trim(), body: markdown.slice(match[0].length) };
}
