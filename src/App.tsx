import { useLiveQuery } from 'dexie-react-hooks';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AssistantPanel } from './assistant/AssistantPanel';
import { closeAssistant, openAssistant, useAssistant } from './assistant/store';
import { Toast, type ToastData } from './chrome/Toast';
import {
  createDocument,
  createDocumentWith,
  deleteDocument,
  latestDocumentId,
  listDocuments,
  moveDocument,
  openDocument,
  restoreDocument,
  setPinned,
  type OpenedDocument,
} from './db/documents';
import { deleteFolder, listFolders, moveFolder, restoreFolder } from './db/folders';
import { docLabel, folderPath } from './db/tree';
import { Editor } from './editor/Editor';
import { exportMarkdown, exportPdf } from './lib/exports';
import {
  LINKED_CONTENT,
  LINKED_ICON,
  LINKED_TITLE,
  plainText,
  sampleContent,
  SAMPLE_ICON,
  SAMPLE_TITLE,
} from './lib/sampleDocument';
import { isModKey, keys } from './lib/platform';
import { openDocumentRoute, useRouteDocId } from './lib/router';
import { setThemePreference, useThemePreference } from './lib/theme';
import { buildCommands, buildMoveCommands } from './palette/commands';
import { CommandPalette } from './palette/CommandPalette';
import type { ItemRef } from './sidebar/DocumentTree';
import { Sidebar } from './sidebar/Sidebar';
import { IconButton } from './ui/IconButton';
import { SidebarIcon } from './ui/icons';
import { TooltipLayer } from './ui/TooltipLayer';

const wideScreen = window.matchMedia('(min-width: 768px)');

function initialSidebarOpen() {
  // Sur petit écran, la sidebar recouvre le texte : fermée au démarrage.
  if (!wideScreen.matches) return false;
  try {
    return localStorage.getItem('sidebar') !== 'closed';
  } catch {
    return true;
  }
}

/** La palette sert aussi de sélecteur de dossier pour « Déplacer vers… ». */
// `id` : chaque ouverture crée une palette neuve (clé React), même juste après une fermeture.
type PaletteState = { id: number } & ({ mode: 'commands' } | { mode: 'move'; item: ItemRef });
let paletteCount = 0;

export function App() {
  const routeId = useRouteDocId();
  const docs = useLiveQuery(listDocuments);
  const folders = useLiveQuery(listFolders);
  const [opened, setOpened] = useState<OpenedDocument | null>(null);
  const [failed, setFailed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [editor, setEditor] = useState<TiptapEditor | null>(null);
  const theme = useThemePreference();
  const assistant = useAssistant();
  const openedId = opened?.meta.id ?? null;

  // Route vide ou document introuvable → dernier document modifié.
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const doc = routeId ? await openDocument(routeId) : null;
      if (cancelled) return;
      if (doc) setOpened(doc);
      else openDocumentRoute(await latestDocumentId(), { replace: true });
    };
    resolve().catch((error: unknown) => {
      console.error(error);
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  useEffect(() => {
    if (!wideScreen.matches) return;
    try {
      localStorage.setItem('sidebar', sidebarOpen ? 'open' : 'closed');
    } catch {
      // Préférence non persistée : sans conséquence.
    }
  }, [sidebarOpen]);

  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);

  const closeSidebarOnSmallScreens = useCallback(() => {
    if (!wideScreen.matches) setSidebarOpen(false);
  }, []);

  const handleCreate = useCallback(
    async (folderId: string | null = null) => {
      openDocumentRoute(await createDocument(folderId));
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens],
  );

  const handleDelete = useCallback(
    async (item: ItemRef) => {
      if (item.kind === 'doc') {
        const snapshot = await deleteDocument(item.id);
        if (!snapshot) return;
        const wasOpen = item.id === openedId;
        if (wasOpen) openDocumentRoute(await latestDocumentId(), { replace: true });
        setToast({
          id: Date.now(),
          message: `« ${docLabel(snapshot.meta)} » supprimé`,
          action: {
            label: 'Annuler',
            run: async () => {
              await restoreDocument(snapshot);
              if (wasOpen) openDocumentRoute(snapshot.meta.id);
            },
          },
        });
        return;
      }

      const snapshot = await deleteFolder(item.id);
      if (!snapshot) return;
      const wasOpen = snapshot.docs.some((doc) => doc.meta.id === openedId);
      if (wasOpen) openDocumentRoute(await latestDocumentId(), { replace: true });
      const name = snapshot.folders.find((folder) => folder.id === item.id)?.name ?? '';
      const count = snapshot.docs.length;
      setToast({
        id: Date.now(),
        message:
          count === 0
            ? `Dossier « ${name} » supprimé`
            : `Dossier « ${name} » et ${count} document${count > 1 ? 's' : ''} supprimés`,
        action: {
          label: 'Annuler',
          run: async () => {
            await restoreFolder(snapshot);
            if (wasOpen && openedId) openDocumentRoute(openedId);
          },
        },
      });
    },
    [openedId],
  );

  const handleMove = useCallback(
    async (item: ItemRef, folderId: string | null) => {
      if (item.kind === 'doc') await moveDocument(item.id, folderId);
      else await moveFolder(item.id, folderId);
      setToast({
        id: Date.now(),
        message: `Déplacé dans « ${folderId ? folderPath(folders ?? [], folderId) : 'Documents'} »`,
      });
    },
    [folders],
  );

  const dismissToast = useCallback(() => setToast(null), []);

  const toggleFocusMode = useCallback(() => {
    if (!focusMode) setToast({ id: Date.now(), message: 'Mode focus · Échap pour quitter' });
    setFocusMode(!focusMode);
  }, [focusMode]);

  const currentTitle = docs?.find((doc) => doc.id === openedId)?.title ?? opened?.meta.title ?? '';
  const handleExportMarkdown = useCallback(() => {
    if (editor) exportMarkdown(currentTitle, editor.getJSON());
  }, [editor, currentTitle]);
  const handleExportPdf = useCallback(() => exportPdf(currentTitle), [currentTitle]);

  const handleCreateSample = useCallback(async () => {
    // Le document lié d'abord : la visite guidée le mentionne.
    const linkedId = await createDocumentWith({
      title: LINKED_TITLE,
      icon: LINKED_ICON,
      content: LINKED_CONTENT,
      text: plainText(LINKED_CONTENT),
    });
    const content = sampleContent(linkedId);
    const id = await createDocumentWith({
      title: SAMPLE_TITLE,
      icon: SAMPLE_ICON,
      content,
      text: plainText(content),
    });
    openDocumentRoute(id);
    closeSidebarOnSmallScreens();
  }, [closeSidebarOnSmallScreens]);
  const openPalette = useCallback(() => setPalette({ id: ++paletteCount, mode: 'commands' }), []);
  const openMovePicker = useCallback(
    (item: ItemRef) => setPalette({ id: ++paletteCount, mode: 'move', item }),
    [],
  );

  const commands = useMemo(() => {
    if (palette?.mode === 'move') {
      return buildMoveCommands(palette.item, docs ?? [], folders ?? [], (folderId) =>
        void handleMove(palette.item, folderId),
      );
    }
    return buildCommands({
      docs: docs ?? [],
      folders: folders ?? [],
      currentId: openedId,
      theme,
      sidebarOpen,
      openDocument: (id) => {
        openDocumentRoute(id);
        closeSidebarOnSmallScreens();
      },
      createDocument: () => void handleCreate(),
      deleteDocument: (id) => void handleDelete({ kind: 'doc', id }),
      togglePin: (id) => {
        const doc = docs?.find((candidate) => candidate.id === id);
        if (doc) void setPinned(id, doc.pinnedAt === null);
      },
      moveDocument: (id) => openMovePicker({ kind: 'doc', id }),
      toggleSidebar,
      setTheme: setThemePreference,
      focusMode,
      toggleFocusMode,
      exportMarkdown: handleExportMarkdown,
      exportPdf: handleExportPdf,
      createSample: () => void handleCreateSample(),
    });
  }, [
    handleCreateSample,
    focusMode,
    toggleFocusMode,
    handleExportMarkdown,
    handleExportPdf,
    palette,
    docs,
    folders,
    openedId,
    theme,
    sidebarOpen,
    closeSidebarOnSmallScreens,
    handleCreate,
    handleDelete,
    handleMove,
    openMovePicker,
    toggleSidebar,
  ]);

  // ⌥Espace (ou ⌘J) : appeler l'assistant, avec la sélection en cours s'il y en a une.
  // Depuis le panneau, le même raccourci le referme et rend la main au texte.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const altSpace = event.altKey && event.code === 'Space' && !event.metaKey && !event.ctrlKey;
      const modJ = isModKey(event) && event.code === 'KeyJ' && !event.shiftKey && !event.altKey;
      if (!altSpace && !modJ) return;
      event.preventDefault();
      if (assistant.open && document.activeElement?.closest('[data-assistant]')) {
        closeAssistant();
        editor?.commands.focus();
        return;
      }
      const selection = editor?.state.selection;
      openAssistant(
        editor && openedId && selection && !selection.empty
          ? {
              docId: openedId,
              from: selection.from,
              to: selection.to,
              text: editor.state.doc.textBetween(selection.from, selection.to, '\n'),
            }
          : null,
      );
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [assistant.open, editor, openedId]);

  // Échap quitte le mode focus. En phase de capture : dans le texte, ProseMirror la consomme
  // (sélection du bloc parent). Un menu ou un dialogue ouvert garde la priorité.
  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const popupOpen = document.querySelector(
        '[role=menu], [role=dialog], dialog[open], [data-suggestion-list]',
      );
      if (popupOpen) return;
      event.preventDefault();
      event.stopPropagation();
      setFocusMode(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [focusMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isModKey(event)) return;
      if (event.shiftKey && event.code === 'KeyF') {
        event.preventDefault();
        toggleFocusMode();
        return;
      }
      if (event.key.toLowerCase() === 'p' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        handleExportPdf();
        return;
      }
      // ⌘K dans une sélection de texte est intercepté plus tôt par l'éditeur (lien).
      if (event.key.toLowerCase() === 'k' && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        openPalette();
        return;
      }
      // event.code : ⌥ modifie event.key sur Mac (⌥N → "˜").
      if (event.altKey && event.code === 'KeyN') {
        event.preventDefault();
        void handleCreate();
      } else if (event.key === '\\' || event.code === 'Backslash') {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleCreate, handleExportPdf, openPalette, toggleFocusMode, toggleSidebar]);

  if (failed) {
    return (
      <p className="mx-auto max-w-md px-6 pt-[30vh] text-center text-sm text-ink-muted">
        Impossible d’accéder au stockage local du navigateur. Vérifiez que la navigation privée ou
        un bloqueur ne l’empêche pas.
      </p>
    );
  }

  const moveLabel = (() => {
    if (palette?.mode !== 'move') return undefined;
    const { item } = palette;
    const doc = item.kind === 'doc' ? docs?.find((candidate) => candidate.id === item.id) : undefined;
    const name = doc
      ? docLabel(doc)
      : (folders?.find((folder) => folder.id === item.id)?.name ?? '');
    return `Déplacer « ${name} » vers…`;
  })();

  return (
    <>
      <Sidebar
        open={sidebarOpen && !focusMode}
        docs={docs}
        folders={folders}
        activeId={openedId}
        onToggle={toggleSidebar}
        onOpenPalette={openPalette}
        onCreateDocument={(folderId) => void handleCreate(folderId)}
        onDeleteItem={(item) => void handleDelete(item)}
        onMoveItem={openMovePicker}
        onNavigate={closeSidebarOnSmallScreens}
      />

      {!sidebarOpen && !focusMode && (
        <IconButton
          data-print-hidden
          label="Afficher la barre latérale"
          shortcut={keys('mod', '\\')}
          onClick={toggleSidebar}
          className="fixed top-2 left-3 z-20 animate-fade-in"
        >
          <SidebarIcon />
        </IconButton>
      )}

      {sidebarOpen && !focusMode && (
        <div
          aria-hidden
          onClick={toggleSidebar}
          className="fixed inset-0 z-20 animate-fade-in bg-black/25 md:hidden"
        />
      )}

      <div
        data-print-full
        className={`transition-[padding] duration-150 ease-out ${sidebarOpen && !focusMode ? 'md:pl-64' : ''} ${assistant.open ? 'lg:pr-(--assistant-width)' : ''}`}
      >
        {opened && (
          <Editor
            key={opened.meta.id}
            doc={opened}
            title={currentTitle}
            focusMode={focusMode}
            onEditor={setEditor}
          />
        )}
      </div>

      <AssistantPanel editor={editor} docId={openedId} docTitle={currentTitle} />

      <Toast toast={toast} onDismiss={dismissToast} />
      <TooltipLayer />

      {palette && (
        <CommandPalette
          key={palette.id}
          commands={commands}
          placeholder={moveLabel}
          // Une palette qui se ferme ne doit pas effacer celle qui vient de la remplacer.
          onClose={() => setPalette((current) => (current?.id === palette.id ? null : current))}
        />
      )}
    </>
  );
}
