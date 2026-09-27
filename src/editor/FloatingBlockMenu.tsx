import type { Editor } from '@tiptap/react';
import { FloatingMenu } from '@tiptap/react/menus';
import { IconButton } from '../ui/IconButton';
import { SLASH_ITEMS } from './slash/items';

type ShouldShowProps = Parameters<NonNullable<Parameters<typeof FloatingMenu>[0]['shouldShow']>>[0];

// Sélection resserrée ; le menu "/" reste la liste complète.
const FLOATING_IDS = ['h1', 'h2', 'h3', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'table', 'image'];
const ITEMS = SLASH_ITEMS.filter((item) => FLOATING_IDS.includes(item.id));

/** Ligne vide à la racine du document, éditeur au focus. Pas sur une page blanche : le placeholder guide déjà. */
function shouldShow({ editor, state }: ShouldShowProps) {
  const { $anchor, empty } = state.selection;
  return (
    editor.isFocused &&
    editor.isEditable &&
    empty &&
    !editor.isEmpty &&
    $anchor.depth === 1 &&
    $anchor.parent.type.name === 'paragraph' &&
    $anchor.parent.content.size === 0
  );
}

/**
 * Menu flottant de TipTap : raccourcis d'insertion de blocs sur les lignes vides.
 * Il apparaît avec un léger délai, pour ne pas clignoter à chaque Entrée pendant la frappe.
 * Au clavier, le menu "/" et la barre d'outils offrent les mêmes actions.
 */
export function FloatingBlockMenu({ editor }: { editor: Editor }) {
  return (
    <FloatingMenu
      editor={editor}
      shouldShow={shouldShow}
      options={{ placement: 'right', offset: 12 }}
      className="z-30"
      data-print-hidden
    >
      <div
        onMouseDown={(event) => event.preventDefault()}
        className="flex animate-[fade-in_150ms_ease-out_450ms_both] items-center gap-px font-sans"
      >
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <IconButton
              key={item.id}
              size="sm"
              tabIndex={-1}
              label={item.label}
              shortcut={item.hint}
              onClick={() => item.run(editor.chain().focus(), editor)}
              className="text-ink-faint"
            >
              <Icon />
            </IconButton>
          );
        })}
      </div>
    </FloatingMenu>
  );
}
