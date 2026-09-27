import type { ComponentType } from 'react';
import { CheckIcon, InfoIcon, PencilIcon, TextIcon, UndoIcon } from '../ui/icons';

/** Actions en un clic sur un extrait sélectionné : envoyées telles quelles à l'assistant. */
export const QUICK_ACTIONS: { label: string; prompt: string; icon: ComponentType }[] = [
  { label: 'Reformuler', prompt: 'Reformule ce passage', icon: PencilIcon },
  { label: 'Raccourcir', prompt: 'Raccourcis ce passage', icon: UndoIcon },
  { label: 'Corriger les fautes', prompt: 'Corrige les fautes de ce passage', icon: CheckIcon },
  { label: 'Simplifier', prompt: 'Simplifie ce passage', icon: TextIcon },
  { label: 'Traduire en anglais', prompt: 'Traduis ce passage en anglais', icon: TextIcon },
  { label: 'Expliquer', prompt: 'Explique-moi ce passage ?', icon: InfoIcon },
];
