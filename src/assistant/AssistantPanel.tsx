import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createDocumentWith } from '../db/documents';
import { keys } from '../lib/platform';
import { openDocumentRoute } from '../lib/router';
import { IconButton } from '../ui/IconButton';
import {
  ArrowUpSendIcon,
  CloseIcon,
  CopyIcon,
  FileIcon,
  PlusIcon,
  SparkleIcon,
  PaperclipIcon,
  StopIcon,
} from '../ui/icons';
import { chunks, mockReply, type Proposal } from './mock';
import {
  clearSelectionContext,
  closeAssistant,
  useAssistant,
  type SelectionContext,
} from './store';

/** Fichier joint à la question (PDF, présentation, image…). Lu localement, jamais stocké. */
interface Attachment {
  id: number;
  name: string;
  size: number;
  kind: string;
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
  | { id: number; role: 'user'; text: string; quote: string | null; files: Attachment[] }
  | {
      id: number;
      role: 'assistant';
      text: string;
      streaming: boolean;
      proposal?: Proposal;
      status?: ProposalStatus;
      /** Passage visé par une proposition de remplacement. */
      selection?: SelectionContext | null;
      createdId?: string;
    };

interface AssistantPanelProps {
  editor: Editor | null;
  docId: string | null;
  docTitle: string;
}

const STREAM_INTERVAL_MS = 16;
let messageCount = 0;

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
  const streamTimer = useRef<number | undefined>(undefined);

  // Un passage d'un autre document ne vaut plus comme contexte.
  const selection = pendingSelection?.docId === docId ? pendingSelection : null;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, focusRequest]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [messages]);

  useEffect(() => () => window.clearInterval(streamTimer.current), []);

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

  const stop = () => {
    window.clearInterval(streamTimer.current);
    setStreaming(false);
    setMessages((list) =>
      list.map((message) =>
        message.role === 'assistant' && message.streaming
          ? { ...message, streaming: false, proposal: undefined }
          : message,
      ),
    );
  };

  const addFiles = (list: FileList | null) => {
    const added = Array.from(list ?? []).map((file) => ({
      id: ++messageCount,
      name: file.name,
      size: file.size,
      kind: fileKind(file.name),
    }));
    if (added.length) setFiles((current) => [...current, ...added]);
    inputRef.current?.focus();
  };

  const send = (text: string) => {
    const prompt = text.trim() || (files.length ? 'Que contiennent ces fichiers ?' : '');
    if (!prompt || streaming) return;

    const headings: string[] = [];
    editor?.state.doc.descendants((node) => {
      if (node.type.name === 'heading') headings.push(node.textContent);
    });
    const reply = mockReply({
      prompt,
      selection: selection?.text ?? null,
      attachments: files,
      docTitle,
      headings,
      wordCount: (editor?.storage.characterCount.words() as number | undefined) ?? 0,
    });

    const answerId = ++messageCount;
    setMessages((list) => [
      ...list,
      { id: ++messageCount, role: 'user', text: prompt, quote: selection?.text ?? null, files },
      { id: answerId, role: 'assistant', text: '', streaming: true, selection },
    ]);
    setDraft('');
    clearSelectionContext();
    setFiles([]);
    setStreaming(true);

    const parts = chunks(reply.text);
    let written = '';
    streamTimer.current = window.setInterval(() => {
      const next = parts.next();
      if (next.done) {
        window.clearInterval(streamTimer.current);
        setStreaming(false);
        updateMessage(answerId, {
          streaming: false,
          proposal: reply.proposal,
          status: reply.proposal ? 'pending' : undefined,
        });
        return;
      }
      written += next.value;
      updateMessage(answerId, { text: written });
    }, STREAM_INTERVAL_MS);
  };

  const apply = async (message: Extract<Message, { role: 'assistant' }>) => {
    const { proposal } = message;
    if (!proposal) return;

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
    editor
      .chain()
      .focus()
      .insertContentAt({ from: target.from, to: target.to }, proposal.replacement)
      .run();
    updateMessage(message.id, { status: 'applied' });
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(draft);
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
      className={`fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-rule bg-sidebar font-sans transition-transform duration-200 ease-out sm:w-[22rem] ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <span className="grid size-7 place-items-center rounded-md bg-ai-soft text-ai">
          <SparkleIcon />
        </span>
        <h2 className="text-[13px] font-semibold text-ink">Claude</h2>
        <span
          className="rounded-full border border-rule-strong px-1.5 py-px text-[10px] font-medium text-ink-faint"
          data-tooltip="Réponses simulées : l’IA n’est pas encore branchée"
        >
          Aperçu
        </span>
        <div className="flex-1" />
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
        <IconButton label="Fermer" shortcut={keys('mod', 'J')} onClick={closeAssistant}>
          <CloseIcon />
        </IconButton>
      </header>

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
                  onClick={() => send(suggestion)}
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
                <li key={message.id} className="flex animate-fade-in flex-col items-end gap-1.5">
                  {message.files.length > 0 && (
                    <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
                      {message.files.map((file) => (
                        <FileChip key={file.id} file={file} />
                      ))}
                    </div>
                  )}
                  {message.quote && (
                    <p className="max-w-[85%] border-r-2 border-ai/40 pr-2 text-right text-xs text-ink-faint italic">
                      {excerpt(message.quote)}
                    </p>
                  )}
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-surface px-3 py-2 text-[13px] whitespace-pre-wrap text-ink">
                    {message.text}
                  </p>
                </li>
              ) : (
                <li key={message.id} className="group animate-fade-in">
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
                    {message.text}
                    {message.streaming && (
                      <span
                        aria-hidden
                        className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-ai"
                      />
                    )}
                  </p>
                  {message.proposal && message.status && (
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
                  {!message.streaming && !message.proposal && (
                    <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
                      <SmallAction
                        label="Copier"
                        icon={<CopyIcon />}
                        onClick={() => void navigator.clipboard?.writeText(message.text)}
                      />
                      <SmallAction
                        label="Insérer dans le document"
                        icon={<PlusIcon />}
                        onClick={() => editor?.chain().focus().insertContent(message.text).run()}
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
        <div className="rounded-xl border border-rule-strong bg-canvas transition-shadow duration-100 focus-within:border-ai/60 focus-within:shadow-[0_0_0_3px_var(--ai-soft)]">
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
              <span className="flex max-w-full items-center gap-1 rounded-md bg-ai-soft py-0.5 pr-0.5 pl-1.5 text-[11px] text-ai">
                <span className="truncate">« {excerpt(selection.text, 40)} »</span>
                <button
                  type="button"
                  aria-label="Retirer le passage"
                  onClick={clearSelectionContext}
                  className="grid size-4 shrink-0 place-items-center rounded hover:bg-ai-soft [&_svg]:size-3"
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
              placeholder={selection ? 'Que faire de ce passage ?' : 'Demander à Claude…'}
              aria-label="Message à Claude"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onInputKeyDown}
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
                onClick={() => send(draft)}
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
  status: ProposalStatus;
  onApply: () => void;
  onDismiss: () => void;
  onOpen?: () => void;
}

function ProposalCard({ proposal, status, onApply, onDismiss, onOpen }: ProposalCardProps) {
  const settled = status !== 'pending';
  return (
    <div
      className={`mt-3 overflow-hidden rounded-lg border border-rule-strong bg-canvas transition-opacity duration-150 ${
        status === 'dismissed' ? 'opacity-50' : ''
      }`}
    >
      <p className="border-b border-rule px-3 py-1.5 text-[11px] font-medium text-ink-faint">
        {proposal.kind === 'replace' ? 'Remplacer le passage' : 'Nouveau document'}
      </p>

      {proposal.kind === 'replace' ? (
        <div className="space-y-2 px-3 py-2.5 text-[13px] leading-relaxed">
          <p className="text-ink-faint line-through decoration-danger/40">{excerpt(proposal.original, 220)}</p>
          <p className="rounded bg-[var(--hl-green)] px-1 text-ink">{proposal.replacement}</p>
        </div>
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
        {!settled && (
          <>
            <button
              type="button"
              onClick={onApply}
              className="rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-canvas hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {proposal.kind === 'replace' ? 'Appliquer' : 'Créer'}
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
              {proposal.kind === 'replace' ? '✓ Appliqué' : '✓ Créé'}
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
