import { keys } from '../lib/platform';
import { IconButton } from '../ui/IconButton';
import { SparkleIcon } from '../ui/icons';
import { toggleAssistant, useAssistant } from './store';

/** Accès à l'assistant depuis la barre d'outils : discret, dans la teinte de l'IA. */
export function AssistantButton() {
  const { open } = useAssistant();
  return (
    <IconButton
      label={open ? 'Fermer Claude' : 'Demander à Claude'}
      shortcut={keys('mod', 'J')}
      pressed={open}
      onClick={toggleAssistant}
      className="text-ai! hover:bg-ai-soft!"
    >
      <SparkleIcon />
    </IconButton>
  );
}
