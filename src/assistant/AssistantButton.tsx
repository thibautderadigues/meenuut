import { keys } from '../lib/platform';
import { IconButton } from '../ui/IconButton';
import { ClaudeIcon } from './ClaudeIcon';
import { toggleAssistant, useAssistant } from './store';

/** Accès à l'assistant depuis la barre d'outils : discret, dans la teinte de l'IA. */
export function AssistantButton() {
  const { open } = useAssistant();
  return (
    <IconButton
      label={open ? 'Fermer Claude' : 'Demander à Claude'}
      shortcut={keys('alt', 'Espace')}
      pressed={open}
      onClick={toggleAssistant}
      // Discret tant qu'on ne s'en sert pas : noir, estompé ; en couleur au survol ou ouvert.
      className={
        open
          ? 'bg-ai-soft! text-ai!'
          : 'text-ink! opacity-35 hover:bg-ai-soft! hover:text-ai! hover:opacity-100 focus-visible:opacity-100'
      }
    >
      <ClaudeIcon />
    </IconButton>
  );
}
