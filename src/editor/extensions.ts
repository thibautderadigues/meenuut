import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Mathematics } from '@tiptap/extension-mathematics';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import {
  TableOfContents,
  getHierarchicalIndexes,
  type TableOfContentData,
} from '@tiptap/extension-table-of-contents';
import { TextAlign } from '@tiptap/extension-text-align';
import { AiHighlight } from './aiHighlight';
import { AiSuggestion } from './aiSuggestion';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { CharacterCount, Focus, Placeholder } from '@tiptap/extensions';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { Extension, type Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { imageFiles } from '../lib/images';
import { CUSTOM_BLOCKS } from './blocks/customBlocks';
import { insertImages } from './insertImages';
import { DocumentMention } from './mentions';
import { MoveBlock } from './moveBlock';
import { Search } from './search';
import { SlashCommand } from './slash/slashExtension';

export interface MathTarget {
  kind: 'inline' | 'block';
  pos: number;
  latex: string;
}

export interface ExtensionHooks {
  onTableOfContents: (content: TableOfContentData) => void;
  onEditMath: (target: MathTarget) => void;
}

/** Images collées ou déposées : réduites puis insérées à la position du curseur ou du dépôt. */
const ImageDrop = Extension.create({
  name: 'imageDrop',
  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            const files = imageFiles(event.clipboardData?.files);
            if (files.length === 0) return false;
            void insertImages(editor, files);
            return true;
          },
          handleDrop: (view, event) => {
            const files = imageFiles(event.dataTransfer?.files);
            if (files.length === 0) return false;
            const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            void insertImages(editor, files, position);
            return true;
          },
        },
      }),
    ];
  },
});

const CHEVRON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

/** Extensions de l'éditeur ; `hooks` relie le sommaire et l'édition de formules à React. */
export function createExtensions(hooks: ExtensionHooks): Extensions {
  const editMath = (kind: MathTarget['kind']) => (node: PMNode, pos: number) =>
    hooks.onEditMath({ kind, pos, latex: String(node.attrs.latex ?? '') });

  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' },
      dropcursor: { color: 'var(--accent)', width: 2 },
      // Remplacé par la version avec coloration syntaxique.
      codeBlock: false,
    }),
    CodeBlockLowlight.configure({ lowlight: createLowlight(common) }),
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: {
        checkboxLabel: (node, checked) =>
          `${checked ? 'Décocher' : 'Cocher'} « ${node.textContent || 'tâche vide'} »`,
      },
    }),
    // ==texte== ou ⇧⌘H ; couleurs stockées en variables CSS (voir colors.ts).
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    Subscript,
    Superscript,
    AiHighlight,
    AiSuggestion,
    TextAlign.extend({
      // ⌘⇧R reste au navigateur (rechargement forcé) : pas de raccourci pour aligner à droite.
      addKeyboardShortcuts() {
        const { 'Mod-Shift-r': _alignRight, ...shortcuts } = this.parent?.() ?? {};
        return shortcuts;
      },
    }).configure({ types: ['heading', 'paragraph'] }),
    TableKit.configure({ table: { resizable: true, cellMinWidth: 80 } }),
    Image.configure({
      allowBase64: true,
      resize: {
        enabled: true,
        directions: ['left', 'right'],
        minWidth: 80,
        alwaysPreserveAspectRatio: true,
      },
    }),
    ImageDrop,
    Details.configure({
      persist: true,
      renderToggleButton: ({ element, isOpen }) => {
        element.innerHTML = CHEVRON;
        element.setAttribute('aria-label', isOpen ? 'Replier' : 'Déplier');
        element.setAttribute('aria-expanded', String(isOpen));
      },
    }),
    DetailsSummary,
    DetailsContent,
    // $$x^2$$ en ligne, $$$…$$$ en bloc ; un clic ouvre l'éditeur de formule.
    Mathematics.configure({
      katexOptions: { throwOnError: false },
      inlineOptions: { onClick: editMath('inline') },
      blockOptions: { onClick: editMath('block') },
    }),
    DocumentMention,
    ...CUSTOM_BLOCKS,
    TableOfContents.configure({
      getIndex: getHierarchicalIndexes,
      onUpdate: hooks.onTableOfContents,
    }),
    Search,
    MoveBlock,
    CharacterCount,
    // Mode focus : le bloc courant reçoit .has-focus, les autres s'estompent.
    Focus.configure({ className: 'has-focus', mode: 'shallowest' }),
    Placeholder.configure({
      // Indices sur toutes les lignes vides concernées (y compris imbriquées : blocs spéciaux),
      // mais pas sur chaque paragraphe vide ordinaire, pour ne pas encombrer la page.
      showOnlyCurrent: false,
      includeChildren: true,
      // Les indices des blocs spéciaux (Chiffre, Libellé…) sont donnés en CSS selon le contexte :
      // résoudre `pos` ici lirait un état périmé pendant le calcul des décorations.
      placeholder: ({ editor, node }) => {
        if (node.type.name === 'heading') return `Titre ${node.attrs.level}`;
        if (node.type.name === 'detailsSummary') return 'Titre du bloc';
        return editor.isEmpty ? 'Commencez à écrire, tapez / pour un bloc ou @ pour un lien' : '';
      },
    }),
    SlashCommand,
  ];
}
