import type { ChainedCommands, Editor } from '@tiptap/react';
import type { ReactNode } from 'react';
import { keys } from '../lib/platform';
import { CodeIcon } from '../ui/icons';

export type MarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

export interface MarkButton {
  name: MarkName;
  label: string;
  shortcut: string;
  glyph: ReactNode;
  toggle: (chain: ChainedCommands) => ChainedCommands;
}

/** Boutons de formatage partagés par la bulle de sélection et la barre d'outils. */
export const MARK_BUTTONS: MarkButton[] = [
  {
    name: 'bold',
    label: 'Gras',
    shortcut: keys('mod', 'B'),
    glyph: <span className="text-[15px] font-bold">B</span>,
    toggle: (chain) => chain.toggleBold(),
  },
  {
    name: 'italic',
    label: 'Italique',
    shortcut: keys('mod', 'I'),
    glyph: <span className="font-serif text-[16px] italic">I</span>,
    toggle: (chain) => chain.toggleItalic(),
  },
  {
    name: 'underline',
    label: 'Souligné',
    shortcut: keys('mod', 'U'),
    glyph: <span className="text-[15px] underline underline-offset-2">U</span>,
    toggle: (chain) => chain.toggleUnderline(),
  },
  {
    name: 'strike',
    label: 'Barré',
    shortcut: keys('shift', 'mod', 'S'),
    glyph: <span className="text-[15px] line-through">S</span>,
    toggle: (chain) => chain.toggleStrike(),
  },
  {
    name: 'code',
    label: 'Code',
    shortcut: keys('mod', 'E'),
    glyph: <CodeIcon />,
    toggle: (chain) => chain.toggleCode(),
  },
];

export function activeMarks(editor: Editor): Record<MarkName, boolean> {
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    code: editor.isActive('code'),
  };
}
