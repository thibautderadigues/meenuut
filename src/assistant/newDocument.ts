import { createDocument } from '../db/documents';
import { openDocumentRoute } from '../lib/router';
import { openAssistant } from './store';

/** Un document vide, ouvert, et l'assistant prêt à l'écrire dans le panneau (⌥⇧Espace). */
export async function newDocumentWithAssistant() {
  openDocumentRoute(await createDocument());
  openAssistant();
}
