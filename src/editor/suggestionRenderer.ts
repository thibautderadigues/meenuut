import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import {
  SuggestionList,
  type SuggestionListHandle,
  type SuggestionListOptions,
  type SuggestionListProps,
} from './SuggestionList';

/**
 * Branche une SuggestionList sur le plugin Suggestion. Le plugin gère la détection,
 * le positionnement (Floating UI via `mount`) et Échap ; on fournit rendu et clavier.
 */
export function suggestionRenderer<T>(
  options: SuggestionListOptions<T>,
): NonNullable<SuggestionOptions<T, T>['render']> {
  return () => {
    let renderer: ReactRenderer<SuggestionListHandle, SuggestionListProps<T>> | null = null;
    let unmount: (() => void) | null = null;
    const withOptions = (props: SuggestionProps<T, T>) => ({ ...props, ...options });

    return {
      onStart: (props) => {
        renderer = new ReactRenderer(SuggestionList<T>, {
          props: withOptions(props),
          editor: props.editor,
          className: 'z-40',
        });
        unmount = props.mount(renderer.element);
      },
      onUpdate: (props) => renderer?.updateProps(withOptions(props)),
      onKeyDown: ({ event }) => renderer?.ref?.onKeyDown(event) ?? false,
      onExit: () => {
        unmount?.();
        renderer?.destroy();
        renderer = null;
        unmount = null;
      },
    };
  };
}
