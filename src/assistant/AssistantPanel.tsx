import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createDocumentWith } from '../db/documents';
import { insertMarked } from '../editor/aiHighlight';
import { toMarkdown } from '../lib/markdown';
import { keys } from '../lib/platform';
import { openDocumentRoute } from '../lib/router';
import { IconButton } from '../ui/IconButton';
import { AssistantIcon } from './AssistantIcon';
import { MAX_INSTRUCTIONS, usePersonalInstructions, withInstructions } from './instructions';
import { ASSISTANT_NAME } from './provider';
import {
  ArrowUpSendIcon,
  CloseIcon,
  CopyIcon,
  FileIcon,
  PlusIcon,
  PaperclipIcon,
  PencilIcon,
  StopIcon,
} from '../ui/icons';
import {
  AssistantError,
  chatSystem,
  CREATE_PATTERN,
  CREATE_SYSTEM,
  ERROR_MESSAGES,
  markdownToContent,
  markdownToHtml,
  REWRITE_PATTERN,
  REWRITE_SYSTEM,
  WRITE_PATTERN,
  writeSystem,
  splitTitle,
  streamReply,
  type ChatMessage,
  type Proposal,
} from './ai';
import {
  clearSelectionContext,
  closeAssistant,
  setSelectionContext,
  useAssistant,
  type SelectionContext,
} from './store';

/** Fichier joint à la question (PDF, présentation, image…). Lu localement, jamais stocké. */
interface Attachment {
  id: number;
  name: string;
  size: number;
  kind: string;
  /** Aperçu local des images (URL d'objet). */
  preview?: string;
}

const ACCEPTED = '.pdf,.ppt,.pptx,.key,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,image/*';

function fileKind(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'pdf') return 'PDF';
  if (['ppt', 'pptx', 'key'].includes(extension)) return 'Présentation';
  if (['doc', 'docx', 'txt', 'md'].includes(extension)) return 'Texte';
  if (['csv', 'xls', 'xlsx'].includes(extension)) return 'Tableur';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(extension)) return 'Image';
  return extension.toUpperCase() || 'Fichier';
}

const fileSize = (bytes: number) =>
  bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} Ko` : `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} Mo`;

type ProposalStatus = 'pending' | 'applied' | 'dismissed' | 'stale';

type Message =
  | { id: number; role: 'user'; text: string; quote: SelectionContext | null; files: Attachment[] }
  | {
      id: number;
      role: 'assistant';
      text: string;
      /** Avant le premier mot : animation de réflexion. */
      thinking: boolean;
      streaming: boolean;
      proposal?: Proposal;
      status?: ProposalStatus;
      /** Passage visé par une proposition de remplacement. */
      selection?: SelectionContext | null;
      createdId?: string;
      error?: string;
      errorDetail?: string;
    };

interface AssistantPanelProps {
  editor: Editor | null;
  docId: string | null;
  docTitle: string;
}

let messageCount = 0;
/** Derniers échanges renvoyés à l'IA : au-delà, l'historique coûte sans beaucoup aider. */
const HISTORY_LENGTH = 12;

const quoted = (selection: SelectionContext | null | undefined) =>
  selection ? `Passage sélectionné dans le document :\n« ${selection.text} »\n\n` : '';

const SELECTION_SUGGESTIONS = ['Reformule ce passage', 'Raccourcis-le', 'Corrige les fautes', 'Explique-moi ce passage', 'Traduis en anglais'];
const DOC_SUGGESTIONS = ['Résume ce document', 'Quels sont les points clés ?', 'Crée un doc sur mes idées de projet'];

const excerpt = (text: string, max = 90) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

/**
 * Panneau de l'assistant, à droite. Il ne s'ouvre que sur demande (bouton, ⌘J, sélection)
 * et ne modifie jamais un document de lui-même : chaque changement est une proposition
 * à appliquer ou à ignorer.
 */
export function AssistantPanel({ editor, docId, docTitle }: AssistantPanelProps) {
  const { open, selection: pendingSelection, focusRequest } = useAssistant();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const instructions = usePersonalInstructions();
  const [showInstructions, setShowInstructions] = useState(false);

  // Un passage d'un autre document ne vaut plus comme contexte.
  const selection = pendingSelection?.docId === docId ? pendingSelection : null;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, focusRequest]);

  // Panneau ouvert : sélectionner du texte le joint à la question, le désélectionner l'en retire.
  useEffect(() => {
    if (!open || !editor || !docId) return;
    const follow = () => {
      const { from, to, empty } = editor.state.selection;
      setSelectionContext(
        empty ? null : { docId, from, to, text: editor.state.doc.textBetween(from, to, '\n') },
      );
    };
    editor.on('selectionUpdate', follow);
    return () => {
      editor.off('selectionUpdate', follow);
    };
  }, [open, editor, docId]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Le champ grandit avec le texte, jusqu'à une limite.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [draft]);

  const updateMessage = (id: number, patch: Partial<Extract<Message, { role: 'assistant' }>>) =>
    setMessages((list) =>
      list.map((message) =>
        message.id === id && message.role === 'assistant' ? { ...message, ...patch } : message,
      ),
    );

  const stop = () => abortRef.current?.abort();

  const addFiles = (list: FileList | File[] | null) => {
    const added = Array.from(list ?? []).map((file): Attachment => {
      const image = file.type.startsWith('image/');
      // Une capture collée s'appelle toujours « image.png » : on lui donne un nom lisible.
      const pasted = image && /^image\.\w+$/.test(file.name);
      return {
        id: ++messageCount,
        name: pasted ? 'Image collée' : file.name,
        size: file.size,
        kind: image ? 'Image' : fileKind(file.name),
        preview: image ? URL.createObjectURL(file) : undefined,
      };
    });
    if (added.length) setFiles((current) => [...current, ...added]);
    inputRef.current?.focus();
  };

  const send = async (text: string) => {
    const prompt = text.trim() || (files.length ? 'Que contiennent ces fichiers ?' : '');
    if (!prompt || streaming) return;

    const target = selection;
    // Réécriture d'un extrait → remplacement ; « crée un doc… » → nouveau document ;
    // « écris un paragraphe… » → passage à insérer ; sinon, conversation.
    const intent =
      target && REWRITE_PATTERN.test(prompt)
        ? 'rewrite'
        : CREATE_PATTERN.test(prompt)
          ? 'create'
          : WRITE_PATTERN.test(prompt)
            ? 'write'
            : 'chat';
    const fileNote = files.length
      ? `\n\n[Fichiers joints, que l’assistant ne sait pas encore lire : ${files.map((file) => file.name).join(', ')}]`
      : '';

    let request: ChatMessage[];
    if (intent === 'rewrite' && target) {
      request = [
        { role: 'system', content: withInstructions(REWRITE_SYSTEM, instructions.text) },
        { role: 'user', content: `Consigne : ${prompt}\n\nPassage :\n${target.text}` },
      ];
    } else {
      const history = messages.slice(-HISTORY_LENGTH).flatMap((message): ChatMessage[] => {
        if (message.role === 'user') return [{ role: 'user', content: quoted(message.quote) + message.text }];
        const content = message.text || (message.proposal?.kind === 'replace' ? message.proposal.replacement : '');
        return content ? [{ role: 'assistant', content }] : [];
      });
      const docMarkdown = editor ? toMarkdown(docTitle, editor.getJSON()) : '';
      const system =
        intent === 'create'
          ? CREATE_SYSTEM
          : intent === 'write'
            ? writeSystem(docTitle, docMarkdown)
            : chatSystem(docTitle, docMarkdown);
      request = [
        { role: 'system', content: withInstructions(system, instructions.text) },
        ...history,
        { role: 'user', content: quoted(target) + prompt + fileNote },
      ];
    }

    const answerId = ++messageCount;
    setMessages((list) => [
      ...list,
      { id: ++messageCount, role: 'user', text: prompt, quote: target, files },
      { id: answerId, role: 'assistant', text: '', thinking: true, streaming: true, selection: target },
    ]);
    setDraft('');
    clearSelectionContext();
    setFiles([]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let written = '';
    try {
      for await (const chunk of streamReply(request, intent === 'rewrite' ? 'quick' : 'chat', controller.signal)) {
        written += chunk;
        if (intent === 'rewrite' && target) {
          updateMessage(answerId, {
            thinking: false,
            proposal: { kind: 'replace', original: target.text, replacement: written.trim() },
          });
        } else if (intent === 'write') {
          updateMessage(answerId, { thinking: false, proposal: { kind: 'insert', markdown: written } });
        } else {
          updateMessage(answerId, { thinking: false, text: written });
        }
      }
      if (controller.signal.aborted) {
        updateMessage(answerId, {
          status: intent === 'rewrite' || intent === 'write' ? 'dismissed' : undefined,
        });
      } else if (intent === 'rewrite' || intent === 'write') {
        updateMessage(answerId, { status: written.trim() ? 'pending' : undefined });
      } else if (intent === 'create' && written.trim()) {
        const { title, body } = splitTitle(written);
        updateMessage(answerId, {
          proposal: { kind: 'create', title, content: markdownToContent(body), text: body },
          status: 'pending',
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        updateMessage(answerId, {
          error: ERROR_MESSAGES[error instanceof AssistantError ? error.code : 'server'],
          errorDetail: error instanceof AssistantError ? error.detail : String(error),
        });
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      updateMessage(answerId, { thinking: false, streaming: false });
    }
  };

  /** Clic sur un passage cité : on y retourne dans le document, sélectionné. */
  const reveal = (target: SelectionContext) => {
    if (target.docId !== docId || !editor) {
      openDocumentRoute(target.docId);
      return;
    }
    const { doc } = editor.state;
    const intact =
      target.to <= doc.content.size && doc.textBetween(target.from, target.to, '\n') === target.text;
    const chain = editor.chain().focus();
    if (intact) chain.setTextSelection({ from: target.from, to: target.to });
    else chain.setTextSelection(Math.min(target.from, doc.content.size - 1));
    chain.scrollIntoView().run();
    // Teinte de l'assistant jusqu'au prochain clic ou à la prochaine frappe dans le texte.
    const dom = editor.view.dom;
    dom.setAttribute('data-ai-reveal', '');
    const clear = () => {
      dom.removeAttribute('data-ai-reveal');
      dom.removeEventListener('mousedown', clear);
      dom.removeEventListener('keydown', clear);
    };
    dom.addEventListener('mousedown', clear);
    dom.addEventListener('keydown', clear);
    // Sur petit écran, le panneau recouvre le texte.
    if (!window.matchMedia('(min-width: 640px)').matches) closeAssistant();
  };

  const apply = async (message: Extract<Message, { role: 'assistant' }>) => {
    const { proposal } = message;
    if (!proposal) return;

    if (proposal.kind === 'insert') {
      if (!editor) return;
      insertMarked(editor, markdownToHtml(proposal.markdown));
      updateMessage(message.id, { status: 'applied' });
      return;
    }

    if (proposal.kind === 'create') {
      const id = await createDocumentWith({
        title: proposal.title,
        content: proposal.content,
        text: proposal.text,
      });
      updateMessage(message.id, { status: 'applied', createdId: id });
      return;
    }

    // Le passage doit être intact : sinon on refuse plutôt que d'écraser autre chose.
    const target = message.selection;
    const intact =
      editor &&
      target &&
      target.docId === docId &&
      target.to <= editor.state.doc.content.size &&
      editor.state.doc.textBetween(target.from, target.to, '\n') === target.text;
    if (!intact) {
      updateMessage(message.id, { status: 'stale' });
      return;
    }
    insertMarked(editor, proposal.replacement, { from: target.from, to: target.to });
    updateMessage(message.id, { status: 'applied' });
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft);
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    closeAssistant();
    editor?.commands.focus();
  };

  const suggestions = selection ? SELECTION_SUGGESTIONS : DOC_SUGGESTIONS;

  return (
    <aside
      data-print-hidden
      aria-label="Assistant"
      data-assistant
      inert={!open}
      onKeyDown={onPanelKeyDown}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
      className={`fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-rule bg-sidebar font-sans transition-transform duration-200 ease-out sm:w-(--assistant-width) ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <ResizeHandle />

      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <span className="grid size-7 place-items-center text-ai">
          <AssistantIcon size={16} />
        </span>
        <h2 className="text-[13px] font-semibold text-ink">{ASSISTANT_NAME}</h2>
        <div className="flex-1" />
        {instructions.available && (
          <IconButton
            label="Mes instructions"
            pressed={showInstructions}
            onClick={() => setShowInstructions((shown) => !shown)}
          >
            <PencilIcon />
          </IconButton>
        )}
        {messages.length > 0 && (
          <IconButton
            label="Nouvelle conversation"
            onClick={() => {
              stop();
              setMessages([]);
              inputRef.current?.focus();
            }}
          >
            <PlusIcon />
          </IconButton>
        )}
        <IconButton label="Fermer" shortcut={keys('alt', 'Espace')} onClick={closeAssistant}>
          <CloseIcon />
        </IconButton>
      </header>

      {showInstructions && (
        <section className="mx-3 mb-2 animate-fade-in rounded-xl border border-rule bg-canvas p-2.5">
          <div className="mb-1.5 flex items-baseline justify-between gap-2 px-0.5">
            <h3 className="text-xs font-medium text-ink">Mes instructions</h3>
            <span className={`text-[11px] ${instructions.status === 'error' ? 'text-danger' : 'text-ink-faint'}`}>
              {instructions.status === 'saving'
                ? 'Enregistrement…'
                : instructions.status === 'saved'
                  ? 'Enregistré'
                  : instructions.status === 'error'
                    ? 'Échec de l’enregistrement'
                    : 'Ajoutées à chaque demande'}
            </span>
          </div>
          <textarea
            value={instructions.text}
            maxLength={MAX_INSTRUCTIONS}
            rows={4}
            aria-label="Mes instructions pour l’assistant"
            placeholder={'Ex. : Tutoie-moi. Je suis étudiant en droit. Réponses courtes, sans jargon.'}
            onChange={(event) => instructions.setText(event.target.value)}
            className="w-full resize-none rounded-lg bg-surface px-2.5 py-2 text-base text-ink outline-none placeholder:text-ink-faint sm:text-[13px]"
          />
          <p className="mt-1 px-0.5 text-[11px] text-ink-faint">
            Enregistrées dans votre compte, sur tous vos appareils.
          </p>
        </section>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {messages.length === 0 ? (
          <div className="animate-fade-in pt-[12vh]">
            <p className="text-[15px] font-medium text-ink">Comment puis-je aider ?</p>
            <p className="mt-1 text-[13px] text-ink-muted">
              Je lis vos documents et je propose. Rien n’est modifié sans votre accord.
            </p>
            <div className="mt-5 flex flex-col items-start gap-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="rounded-lg border border-rule px-2.5 py-1.5 text-left text-[13px] text-ink-muted transition-colors duration-100 hover:border-rule-strong hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-5 pt-2">
            {messages.map((message) =>
              message.role === 'user' ? (
                <li
                  key={message.id}
                  className="animate-fade-in rounded-xl border border-rule bg-canvas p-2"
                >
                  {(message.quote || message.files.length > 0) && (
                    <div className="mb-1.5 flex flex-col gap-1">
                      {message.quote && (
                        <QuoteBox
                          text={message.quote.text}
                          onClick={() => message.quote && reveal(message.quote)}
                        />
                      )}
                      {message.files.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {message.files.map((file) => (
                            <FileChip key={file.id} file={file} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <p className="px-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
                    {message.text}
                  </p>
                </li>
              ) : (
                <li key={message.id} className="group animate-fade-in px-1">
                  {message.thinking ? (
                    <Thinking />
                  ) : (
                    message.text && (
                      <div
                        className="assistant-md text-[13px] leading-relaxed text-ink"
                        // Markdown de l'IA, nettoyé par DOMPurify.
                        dangerouslySetInnerHTML={{ __html: markdownToHtml(message.text) }}
                      />
                    )
                  )}
                  {message.error && <p className="text-[13px] text-danger">{message.error}</p>}
                  {message.errorDetail && (
                    <p className="mt-1 font-mono text-[10px] break-all text-ink-faint select-text">
                      {message.errorDetail}
                    </p>
                  )}
                  {message.proposal && (
                    <ProposalCard
                      proposal={message.proposal}
                      status={message.status}
                      onApply={() => void apply(message)}
                      onDismiss={() => updateMessage(message.id, { status: 'dismissed' })}
                      onOpen={
                        message.createdId
                          ? () => openDocumentRoute(message.createdId as string)
                          : undefined
                      }
                    />
                  )}
                  {!message.streaming && !message.proposal && message.text && (
                    <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
                      <SmallAction
                        label="Copier"
                        icon={<CopyIcon />}
                        onClick={() => void navigator.clipboard?.writeText(message.text)}
                      />
                      <SmallAction
                        label="Insérer dans le document"
                        icon={<PlusIcon />}
                        onClick={() => editor && insertMarked(editor, markdownToHtml(message.text))}
                      />
                    </div>
                  )}
                </li>
              ),
            )}
          </ol>
        )}
      </div>

      <div className="shrink-0 p-3 pt-0">
        <div className="rounded-xl border border-rule-strong bg-canvas transition-shadow duration-100 focus-within:border-ink-faint/60">
          <div className="flex flex-wrap gap-1 px-2.5 pt-2">
            <span className="flex max-w-full items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-ink-muted">
              <FileIcon />
              <span className="truncate">{docTitle.trim() || 'Sans titre'}</span>
            </span>
            {files.map((file) => (
              <FileChip
                key={file.id}
                file={file}
                onRemove={() => setFiles((current) => current.filter((item) => item.id !== file.id))}
              />
            ))}
            {selection && (
              <span className="flex max-w-full items-center gap-1 rounded-md bg-surface py-0.5 pr-0.5 pl-1.5 text-[11px] text-ink-muted">
                <span className="truncate">« {excerpt(selection.text, 40)} »</span>
                <button
                  type="button"
                  aria-label="Retirer le passage"
                  onClick={clearSelectionContext}
                  className="grid size-4 shrink-0 place-items-center rounded hover:bg-rule [&_svg]:size-3"
                >
                  <CloseIcon />
                </button>
              </span>
            )}
          </div>
          <div className="flex items-end gap-1 p-2 pl-1.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED}
              hidden
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <IconButton
              label="Joindre des fichiers (PDF, présentation…)"
              onClick={() => fileInputRef.current?.click()}
              className="size-7!"
            >
              <PaperclipIcon />
            </IconButton>
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              placeholder={selection ? 'Que faire de ce passage ?' : `Demander à ${ASSISTANT_NAME}…`}
              aria-label={`Message à ${ASSISTANT_NAME}`}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onInputKeyDown}
              // ⌘V d'une image (capture, copie depuis le navigateur) : jointe à la question.
              onPaste={(event) => {
                const images = Array.from(event.clipboardData.files).filter((file) =>
                  file.type.startsWith('image/'),
                );
                if (images.length === 0) return;
                event.preventDefault();
                addFiles(images);
              }}
              className="max-h-40 min-h-7 flex-1 resize-none bg-transparent py-1 text-base text-ink outline-none placeholder:text-ink-faint sm:text-[13px]"
            />
            {streaming ? (
              <button
                type="button"
                aria-label="Arrêter"
                onClick={stop}
                className="grid size-7 shrink-0 place-items-center rounded-lg bg-ink text-canvas"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Envoyer"
                disabled={!draft.trim() && files.length === 0}
                onClick={() => void send(draft)}
                className="grid size-7 shrink-0 place-items-center rounded-lg bg-ai text-white transition-opacity duration-100 disabled:opacity-30"
              >
                <ArrowUpSendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-2 border-dashed border-ai/50 bg-ai-soft text-[13px] font-medium text-ai backdrop-blur-sm">
          Déposer pour joindre à la question
        </div>
      )}
    </aside>
  );
}

function SmallAction({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent [&_svg]:size-3"
    >
      {icon}
      {label}
    </button>
  );
}

interface ProposalCardProps {
  proposal: Proposal;
  /** Absent pendant l'écriture de la proposition : pas encore de boutons. */
  status?: ProposalStatus;
  onApply: () => void;
  onDismiss: () => void;
  onOpen?: () => void;
}

function ProposalCard({ proposal, status, onApply, onDismiss, onOpen }: ProposalCardProps) {
  const settled = status !== 'pending';
  const writing = status === undefined;
  return (
    <div
      className={`mt-3 overflow-hidden rounded-lg border border-rule-strong bg-canvas transition-opacity duration-150 ${
        status === 'dismissed' ? 'opacity-50' : ''
      }`}
    >
      <p className="border-b border-rule px-3 py-1.5 text-[11px] font-medium text-ink-faint">
        {proposal.kind === 'replace'
          ? 'Remplacer l’extrait'
          : proposal.kind === 'insert'
            ? 'Insérer dans le document'
            : 'Nouveau document'}
      </p>

      {proposal.kind === 'replace' ? (
        <div className="space-y-2 px-3 py-2.5 text-[13px] leading-relaxed">
          <p className="text-ink-faint line-through decoration-danger/40">{excerpt(proposal.original, 220)}</p>
          <p className="rounded bg-[var(--hl-green)] px-1 text-ink">{proposal.replacement}</p>
        </div>
      ) : proposal.kind === 'insert' ? (
        <div
          className="assistant-md max-h-72 overflow-y-auto px-3 py-2.5 text-[13px] leading-relaxed text-ink"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(proposal.markdown) }}
        />
      ) : (
        <div className="px-3 py-2.5 text-[13px]">
          <p className="flex items-center gap-1.5 font-medium text-ink">
            <FileIcon />
            {proposal.title}
          </p>
          <p className="mt-1 text-xs text-ink-faint">{proposal.text.split('\n\n').join(' · ')}</p>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-rule px-3 py-2">
        {writing && <span className="text-xs text-ink-faint">Rédaction…</span>}
        {!settled && !writing && (
          <>
            <button
              type="button"
              onClick={onApply}
              className="rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-canvas hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {proposal.kind === 'replace' ? 'Appliquer' : proposal.kind === 'insert' ? 'Insérer' : 'Créer'}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              Ignorer
            </button>
          </>
        )}
        {status === 'applied' && (
          <>
            <span className="text-xs text-[var(--tx-green)]">
              {proposal.kind === 'replace' ? '✓ Appliqué' : proposal.kind === 'insert' ? '✓ Inséré' : '✓ Créé'}
            </span>
            {onOpen && (
              <button
                type="button"
                onClick={onOpen}
                className="ml-auto rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface hover:text-ink"
              >
                Ouvrir
              </button>
            )}
          </>
        )}
        {status === 'dismissed' && <span className="text-xs text-ink-faint">Ignoré</span>}
        {status === 'stale' && (
          <span className="text-xs text-danger">Le passage a changé depuis : rien n’a été modifié.</span>
        )}
      </div>
    </div>
  );
}

function FileChip({ file, onRemove }: { file: Attachment; onRemove?: () => void }) {
  if (file.preview) {
    return (
      <span className="group/chip relative block size-14 shrink-0 overflow-hidden rounded-lg border border-rule bg-surface">
        <img src={file.preview} alt={file.name} className="size-full object-cover" />
        {onRemove && (
          <button
            type="button"
            aria-label={`Retirer ${file.name}`}
            onClick={onRemove}
            className="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-ink/70 text-canvas opacity-0 transition-opacity group-hover/chip:opacity-100 focus-visible:opacity-100 max-md:opacity-100 [&_svg]:size-2.5"
          >
            <CloseIcon />
          </button>
        )}
      </span>
    );
  }
  return (
    <span
      className="flex max-w-full items-center gap-1 rounded-md border border-rule bg-canvas py-0.5 pr-0.5 pl-1.5 text-[11px] text-ink-muted"
      title={`${file.name} · ${fileSize(file.size)}`}
    >
      <FileIcon />
      <span className="max-w-[14ch] truncate">{file.name}</span>
      <span className="text-ink-faint">{file.kind}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Retirer ${file.name}`}
          onClick={onRemove}
          className="grid size-4 shrink-0 place-items-center rounded hover:bg-surface [&_svg]:size-3"
        >
          <CloseIcon />
        </button>
      ) : (
        <span className="w-1" />
      )}
    </span>
  );
}

/** Extrait cité, dans un petit cadre ; un clic y ramène dans le document. */
function QuoteBox({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tooltip="Afficher dans le document"
      className="flex w-full items-start gap-2 rounded-lg bg-surface px-2 py-1.5 text-left text-xs text-ink-muted transition-colors duration-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span aria-hidden className="mt-px h-3.5 w-0.5 shrink-0 rounded-full bg-ink-faint/60" />
      <span className="line-clamp-2">{text.replace(/\s+/g, ' ').trim()}</span>
    </button>
  );
}

/** Pendant la réflexion : les bandes du logo s'allument tour à tour, le mot scintille. */
function Thinking() {
  return (
    <p role="status" className="flex items-center gap-2 py-0.5 text-[13px]">
      <span className="text-ai">
        <AssistantIcon size={14} thinking />
      </span>
      <span className="animate-shimmer bg-[linear-gradient(90deg,var(--ink-faint)_0%,var(--ink-faint)_40%,var(--ink)_50%,var(--ink-faint)_60%,var(--ink-faint)_100%)] bg-[length:200%_100%] bg-clip-text text-transparent">
        Réflexion…
      </span>
    </p>
  );
}

const WIDTH_KEY = 'assistant-width';
const MIN_WIDTH = 300;
const DEFAULT_WIDTH = 352;
const maxWidth = () => Math.max(MIN_WIDTH, Math.min(720, window.innerWidth * 0.6));

function setWidth(width: number) {
  const clamped = Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, width)));
  document.documentElement.style.setProperty('--assistant-width', `${clamped}px`);
  return clamped;
}

// Largeur mémorisée, appliquée avant le premier rendu du panneau.
setWidth(
  (() => {
    try {
      return Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  })(),
);

/** Bord gauche du panneau : glisser pour redimensionner, double-clic pour la largeur par défaut. */
function ResizeHandle() {
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    document.documentElement.dataset.resizing = '';
    let width = DEFAULT_WIDTH;

    const onMove = (move: PointerEvent) => {
      width = setWidth(window.innerWidth - move.clientX);
    };
    const onUp = () => {
      delete document.documentElement.dataset.resizing;
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      try {
        localStorage.setItem(WIDTH_KEY, String(width));
      } catch {
        // Largeur non mémorisée : sans conséquence.
      }
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  const reset = () => {
    setWidth(DEFAULT_WIDTH);
    try {
      localStorage.removeItem(WIDTH_KEY);
    } catch {
      // Sans conséquence.
    }
  };

  return (
    <div
      aria-hidden
      onPointerDown={onPointerDown}
      onDoubleClick={reset}
      className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize max-sm:hidden"
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors duration-100 group-hover:bg-ink-faint/50 group-active:bg-ai/60" />
    </div>
  );
}
