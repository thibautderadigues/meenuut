/**
 * Fantôme de glisser-déposer : une étiquette compacte (icône + nom) plutôt que
 * la capture par défaut de toute la ligne, fond et boutons de survol compris.
 * L'élément doit être rendu dans la page au moment de setDragImage, puis peut disparaître.
 */
export function setDragGhost(event: DragEvent, row: HTMLElement, label: string) {
  const ghost = document.createElement('div');
  ghost.className =
    'fixed top-0 left-[-9999px] flex h-7 max-w-56 items-center gap-2 rounded-md border border-rule-strong bg-elevated px-2.5 font-sans text-[13px] text-ink';

  const icon = row.querySelector('[data-row-icon]')?.cloneNode(true);
  if (icon instanceof HTMLElement) {
    icon.className = 'shrink-0 text-accent';
    ghost.append(icon);
  }
  const text = document.createElement('span');
  text.className = 'truncate';
  text.textContent = label;
  ghost.append(text);

  document.body.append(ghost);
  event.dataTransfer?.setDragImage(ghost, 14, 14);
  requestAnimationFrame(() => ghost.remove());
}
