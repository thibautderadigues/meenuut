import { keys } from '../lib/platform';
import { IconButton } from '../ui/IconButton';
import { AssistantIcon } from './AssistantIcon';
import { ASSISTANT_NAME } from './provider';
import { toggleAssistant, useAssistant } from './store';

/**
 * Accès à l'assistant depuis la barre d'outils. Au repos, le logo est noir (blanc en sombre)
 * et estompé ; au survol ou panneau ouvert, il retrouve ses couleurs. Un seul logo, teinté
 * par un filtre : le passage de l'un à l'autre est un fondu, sans changement d'élément.
 */
export function AssistantButton() {
  const { open } = useAssistant();
  return (
    <IconButton
      label={open ? `Fermer ${ASSISTANT_NAME}` : `Demander à ${ASSISTANT_NAME}`}
      shortcut={keys('alt', 'Espace')}
      pressed={open}
      onClick={toggleAssistant}
      className={`group/ai ${open ? 'bg-ai-soft!' : 'hover:bg-ai-soft!'}`}
    >
      <span
        className={`grid transition-[filter,opacity] duration-150 ${
          open
            ? ''
            : 'opacity-40 [filter:grayscale(1)_brightness(0)] group-hover/ai:opacity-100 group-hover/ai:[filter:none] group-focus-visible/ai:opacity-100 group-focus-visible/ai:[filter:none] dark:[filter:grayscale(1)_brightness(0)_invert(1)]'
        }`}
      >
        <AssistantIcon />
      </span>
    </IconButton>
  );
}
