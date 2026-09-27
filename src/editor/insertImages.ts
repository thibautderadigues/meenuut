import type { Editor } from '@tiptap/react';
import { altFromFileName, imageToDataUrl } from '../lib/images';

/** Insère des images (réduites) au curseur, ou à une position donnée (dépôt). */
export async function insertImages(editor: Editor, files: File[], position?: number) {
  for (const file of files) {
    const src = await imageToDataUrl(file);
    const content = { type: 'image', attrs: { src, alt: altFromFileName(file) } };
    if (position === undefined) editor.chain().focus().insertContent(content).run();
    else editor.chain().focus().insertContentAt(position, content).run();
  }
}
