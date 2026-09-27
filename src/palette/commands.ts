import type { ComponentType } from 'react';
import type { DocMeta, Folder } from '../db/db';
import { compareLabels, folderPath, isWithin } from '../db/tree';
import { formatUpdatedAt } from '../lib/format';
import { keys } from '../lib/platform';
import type { ThemePreference } from '../lib/theme';
import type { ItemRef } from '../sidebar/DocumentTree';
import {
  DownloadIcon,
  FileIcon,
  FocusIcon,
  FolderIcon,
  MonitorIcon,
  MoonIcon,
  MoveIcon,
  PinIcon,
  PlusIcon,
  PrinterIcon,
  SidebarIcon,
  SunIcon,
  TrashIcon,
} from '../ui/icons';
import { fuzzyMatch } from './fuzzy';
import { AssistantIcon } from '../assistant/AssistantIcon';
import { ASSISTANT_NAME } from '../assistant/provider';
import { openAssistant } from '../assistant/store';
import { createDocument } from '../db/documents';
import { openDocumentRoute } from '../lib/router';

export interface Command {
  id: string;
  group: string;
  label: string;
  keywords?: string[];
  icon: ComponentType;
  /** Raccourci, date ou chemin, affiché à droite. */
  hint?: string;
  checked?: boolean;
  run: () => void;
}

export interface PaletteContext {
  docs: DocMeta[];
  folders: Folder[];
  currentId: string | null;
  theme: ThemePreference;
  sidebarOpen: boolean;
  openDocument: (id: string) => void;
  createDocument: () => void;
  deleteDocument: (id: string) => void;
  togglePin: (id: string) => void;
  moveDocument: (id: string) => void;
  toggleSidebar: () => void;
  setTheme: (theme: ThemePreference) => void;
  focusMode: boolean;
  toggleFocusMode: () => void;
  exportMarkdown: () => void;
  exportPdf: () => void;
  createSample: () => void;
}

const THEMES: { value: ThemePreference; label: string; icon: ComponentType; keywords: string[] }[] = [
  { value: 'light', label: 'Thème clair', icon: SunIcon, keywords: ['light', 'jour'] },
  { value: 'dark', label: 'Thème sombre', icon: MoonIcon, keywords: ['dark', 'nuit'] },
  { value: 'system', label: 'Thème du système', icon: MonitorIcon, keywords: ['system', 'auto'] },
];

export function buildCommands(ctx: PaletteContext): Command[] {
  const actions: Command[] = [
    {
      id: 'new',
      group: 'Actions',
      label: 'Nouveau document',
      keywords: ['créer', 'new', 'page'],
      icon: PlusIcon,
      hint: keys('alt', 'mod', 'N'),
      run: ctx.createDocument,
    },
    {
      id: 'assistant',
      group: 'Actions',
      label: `Demander à ${ASSISTANT_NAME}`,
      keywords: ['ia', 'ai', 'assistant', 'mistral', 'question', 'aide'],
      icon: AssistantIcon,
      hint: keys('alt', 'Espace'),
      run: () => openAssistant(),
    },
    {
      id: 'assistant-new-doc',
      group: 'Actions',
      label: `Nouveau document avec ${ASSISTANT_NAME}…`,
      keywords: ['ia', 'ai', 'mistral', 'créer', 'rédiger', 'résumé', 'générer'],
      icon: AssistantIcon,
      // Un document vide, ouvert, et l'assistant prêt à l'écrire dans le panneau.
      run: () =>
        void createDocument().then((id) => {
          openDocumentRoute(id);
          openAssistant();
        }),
    },
    {
      id: 'sample',
      group: 'Actions',
      label: 'Créer le document d’exemple',
      keywords: ['exemple', 'demo', 'tutoriel', 'aide', 'visite'],
      icon: FileIcon,
      run: ctx.createSample,
    },
    {
      id: 'sidebar',
      group: 'Actions',
      label: ctx.sidebarOpen ? 'Masquer la barre latérale' : 'Afficher la barre latérale',
      keywords: ['sidebar', 'liste', 'panneau'],
      icon: SidebarIcon,
      hint: keys('mod', '\\'),
      run: ctx.toggleSidebar,
    },
    {
      id: 'focus',
      group: 'Actions',
      label: ctx.focusMode ? 'Quitter le mode focus' : 'Mode focus',
      keywords: ['focus', 'zen', 'concentration', 'distraction'],
      icon: FocusIcon,
      hint: keys('shift', 'mod', 'F'),
      run: ctx.toggleFocusMode,
    },
    ...THEMES.map(
      (theme): Command => ({
        id: `theme-${theme.value}`,
        group: 'Actions',
        label: theme.label,
        keywords: ['theme', 'apparence', 'mode', ...theme.keywords],
        icon: theme.icon,
        checked: ctx.theme === theme.value,
        run: () => ctx.setTheme(theme.value),
      }),
    ),
  ];

  const current = ctx.docs.find((doc) => doc.id === ctx.currentId);
  if (current) {
    const pinned = current.pinnedAt !== null;
    actions.push(
      {
        id: 'pin',
        group: 'Actions',
        label: pinned ? 'Désépingler le document' : 'Épingler le document',
        keywords: ['pin', 'favori'],
        icon: PinIcon,
        run: () => ctx.togglePin(current.id),
      },
      {
        id: 'move',
        group: 'Actions',
        label: 'Déplacer le document vers…',
        keywords: ['move', 'dossier', 'ranger'],
        icon: MoveIcon,
        run: () => ctx.moveDocument(current.id),
      },
      {
        id: 'export-md',
        group: 'Actions',
        label: 'Exporter en Markdown',
        keywords: ['export', 'markdown', 'md', 'télécharger'],
        icon: DownloadIcon,
        run: ctx.exportMarkdown,
      },
      {
        id: 'export-pdf',
        group: 'Actions',
        label: 'Exporter en PDF',
        keywords: ['export', 'pdf', 'imprimer', 'print'],
        icon: PrinterIcon,
        hint: keys('mod', 'P'),
        run: ctx.exportPdf,
      },
      {
        id: 'delete',
        group: 'Actions',
        label: 'Supprimer le document',
        keywords: ['delete', 'corbeille', 'effacer'],
        icon: TrashIcon,
        run: () => ctx.deleteDocument(current.id),
      },
    );
  }

  // Le document ouvert n'est pas une destination.
  const documents = ctx.docs
    .filter((doc) => doc.id !== ctx.currentId)
    .map(
      (doc): Command => ({
        id: `doc-${doc.id}`,
        group: 'Documents',
        label: doc.title.trim() || 'Sans titre',
        keywords: doc.folderId ? [folderPath(ctx.folders, doc.folderId)] : [],
        icon: FileIcon,
        hint: formatUpdatedAt(doc.updatedAt),
        run: () => ctx.openDocument(doc.id),
      }),
    );

  return [...actions, ...documents];
}

/** Destinations valides pour déplacer un document ou un dossier. */
export function buildMoveCommands(
  item: ItemRef,
  docs: DocMeta[],
  folders: Folder[],
  move: (folderId: string | null) => void,
): Command[] {
  const currentParent =
    item.kind === 'doc'
      ? (docs.find((doc) => doc.id === item.id)?.folderId ?? null)
      : (folders.find((folder) => folder.id === item.id)?.parentId ?? null);

  const destinations = folders
    // Un dossier ne peut entrer ni en lui-même ni dans sa descendance.
    .filter((folder) => item.kind === 'doc' || !isWithin(folders, folder.id, item.id))
    .map((folder) => ({ folder, path: folderPath(folders, folder.id) }))
    .sort((a, b) => compareLabels(a.path, b.path));

  return [
    {
      id: 'move-root',
      group: 'Déplacer vers',
      label: 'Documents',
      keywords: ['racine', 'root'],
      icon: FolderIcon,
      hint: 'Racine',
      checked: currentParent === null,
      run: () => move(null),
    },
    ...destinations.map(
      ({ folder, path }): Command => ({
        id: `move-${folder.id}`,
        group: 'Déplacer vers',
        label: path,
        icon: FolderIcon,
        checked: currentParent === folder.id,
        run: () => move(folder.id),
      }),
    ),
  ];
}

export interface RankedCommand {
  command: Command;
  indices: number[];
}

export interface Section {
  label: string;
  items: RankedCommand[];
}

const RECENT_LIMIT = 6;

function matchCommand(command: Command, query: string) {
  const onLabel = fuzzyMatch(query, command.label);
  // Un mot-clé compte un peu moins que le libellé, et n'a rien à surligner.
  const onKeywords = (command.keywords ?? [])
    .map((keyword) => fuzzyMatch(query, keyword))
    .filter((match) => match !== null)
    .map((match) => ({ score: match.score - 5, indices: [] }));
  const best = [onLabel, ...onKeywords]
    .filter((match) => match !== null)
    .sort((a, b) => b.score - a.score)[0];
  return best ?? null;
}

/**
 * Sans requête : actions puis documents récents.
 * Avec requête : documents d'abord (la navigation est l'usage principal), triés par score.
 * Les autres groupes (Déplacer vers…) gardent leur ordre d'apparition.
 */
export function rankCommands(commands: Command[], query: string): Section[] {
  const searching = query.trim().length > 0;
  const preferred = searching ? ['Documents', 'Actions'] : ['Actions', 'Documents'];
  const groups = [...new Set(commands.map((command) => command.group))].sort((a, b) => {
    const rank = (group: string) => (preferred.includes(group) ? preferred.indexOf(group) : -1);
    return rank(a) - rank(b);
  });

  return groups
    .map((group) => {
      const inGroup = commands.filter((command) => command.group === group);
      if (!searching) {
        const recent = group === 'Documents';
        return {
          label: recent ? 'Récents' : group,
          items: (recent ? inGroup.slice(0, RECENT_LIMIT) : inGroup).map((command) => ({
            command,
            indices: [],
          })),
        };
      }
      const items = inGroup
        .map((command) => ({ command, match: matchCommand(command, query) }))
        .filter((entry) => entry.match !== null)
        .sort((a, b) => b.match!.score - a.match!.score)
        .map(({ command, match }) => ({ command, indices: match!.indices }));
      return { label: group, items };
    })
    .filter((section) => section.items.length > 0);
}
