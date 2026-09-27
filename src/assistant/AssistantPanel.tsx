import type { Editor } from '@tiptap/react';
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createDocumentWith, deleteDocument, latestDocumentId, renameDocument } from '../db/documents';
import { plainText } from '../lib/sampleDocument';
import { insertMarked } from '../editor/aiHighlight';
import {
  acceptAll,
  acceptSuggestion,
  beginSuggestion,
  findText,
  getPending,
  getPendings,
  onSuggestionSettled,
  finishWriting,
  pendingText,
  rejectAll,
  resumeWriting,
  revealSuggestion,
  setRefineHandler,
  rejectSuggestion,
  writeSuggestion,
} from '../editor/aiSuggestion';
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
  UndoIcon,
  StopIcon,
} from '../ui/icons';
import {
  actionHint,
  agentSystem,
  hintNote,
  stripChatter,
  unwrapFence,
  AssistantError,
  detectAction,
  ERROR_MESSAGES,
  parseEdits,
  parseQuestions,
  REWRITE_PATTERN,
  REWRITE_SYSTEM,
  splitTitle,
  streamReply,
  stripAction,
  type Action,
  type AskQuestion,
  type ChatMessage,
  type EditOp,
  type Proposal,
} from './ai';
import { markdownInlineToHtml, markdownToContent, markdownToHtml, markdownToRichHtml } from './markdown';
import {
  clearSelectionContext,
  closeAssistant,
  openAssistant,
  takePendingDraft,
  takePendingPrompt,
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

type ProposalStatus = 'pending' | 'applied' | 'dismissed' | 'stale' | 'revised';

type Message =
  | {
      id: number;
      role: 'user';
      text: string;
      quote: SelectionContext | null;
      files: Attachment[];
      /** Document ouvert au moment de la demande : la conversation est rattachée à lui. */
      docId: string | null;
      docTitle: string;
    }
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
      /** Questions à choix posées avant d'agir, et la réponse donnée. */
      questions?: AskQuestion[];
      answered?: boolean;
      /** Suggestions écrites dans le document par cette réponse, encore en attente. */
      suggestionIds?: number[];
      /** Combien ont été acceptées (pour l'état final de la carte). */
      acceptedCount?: number;
      /** Pendant la rédaction d'un document : avancement affiché à la place du texte. */
      progress?: string;
      /** Texte écrit dans le document (suggestion) : repris dans l'historique envoyé à l'IA. */
      written?: string;
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

const SELECTION_SUGGESTIONS = ['Reformule ce passage', 'Raccourcis-le', 'Corrige les fautes', 'Explique-moi ce passage ?', 'Traduis en anglais'];
/** Document vide ou presque : aider à démarrer. */
/** Document vide : ce qu'il pourrait contenir (« … » : à compléter avant d'envoyer). */
const EMPTY_DOC_SUGGESTIONS = ['Une fiche de révision sur…', 'Un carnet de voyage pour…', 'Un plan de projet pour…', 'Une liste de choses à faire cette semaine'];
const DOC_SUGGESTIONS = ['Résume ce document', 'Quels sont les points clés ?', 'Continue le texte', 'Écris une conclusion', 'Relis et signale les fautes ?'];
/** Sans document : conversation libre, ou nouveau document. */
const FREE_SUGGESTIONS = ['Crée un document sur…', 'Explique-moi simplement…', 'Fais-moi un plan de révision pour…'];

/** Dernier titre avant le curseur : la section où l'on se trouve. */
function currentSection(editor: Editor): string {
  const { from } = editor.state.selection;
  let section = '';
  editor.state.doc.nodesBetween(0, from, (node) => {
    if (node.type.name === 'heading') section = node.textContent;
    return node.isBlock && !node.isTextblock;
  });
  return section.trim();
}

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
  // « Préciser » sur une modification du document : la prochaine consigne la réécrit, elle.
  const [refineTarget, setRefineTarget] = useState<number | null>(null);
  useEffect(() => {
    setRefineHandler((id) => {
      setRefineTarget(id);
      openAssistant();
    });
    return () => setRefineHandler(null);
  }, []);
  // Document vide ou non, suivi en direct (le panneau ne se redessine pas à chaque frappe).
  const [editorEmpty, setEditorEmpty] = useState(() => editor?.isEmpty ?? true);
  useEffect(() => {
    if (!editor) return;
    const update = () => setEditorEmpty(editor.isEmpty);
    update();
    editor.on('update', update);
    return () => {
      editor.off('update', update);
    };
  }, [editor]);
  // Document dans lequel on a placé le curseur soi-même (clic, frappe) : on écrit là.
  const cursorPlaced = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    cursorPlaced.current = null;
    // Vrais gestes seulement : à l'ouverture, l'éditeur se place de lui-même au début.
    const mark = () => {
      cursorPlaced.current = docId;
    };
    const dom = editor.view.dom;
    dom.addEventListener('mousedown', mark);
    dom.addEventListener('keydown', mark);
    return () => {
      dom.removeEventListener('mousedown', mark);
      dom.removeEventListener('keydown', mark);
    };
  }, [editor, docId]);
  // Document ouvert joint au contexte ; on peut le détacher pour parler d'autre chose.
  const [withDocument, setWithDocument] = useState(true);
  useEffect(() => setWithDocument(true), [docId]);

  // Document vide tout juste ouvert (« Nouveau document avec Mistral ») : le champ du panneau
  // garde la main, plutôt que le titre du document.
  useEffect(() => {
    if (!open || !editor || !editor.isEmpty || docTitle.trim()) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seulement à l'ouverture d'un document
  }, [docId, editor]);
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

  // Défile avec la réponse, sauf si on est remonté lire plus haut.
  const stickToBottom = useRef(true);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && stickToBottom.current) scroller.scrollTop = scroller.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Suggestion acceptée ou refusée (depuis le texte ou le panneau) : la carte suit.
  useEffect(
    () =>
      onSuggestionSettled((id, outcome) =>
        setMessages((list) =>
          list.map((message) => {
            if (message.role !== 'assistant' || !message.suggestionIds?.includes(id)) return message;
            const remaining = message.suggestionIds.filter((other) => other !== id);
            const acceptedCount = (message.acceptedCount ?? 0) + (outcome === 'accepted' ? 1 : 0);
            return {
              ...message,
              suggestionIds: remaining,
              acceptedCount,
              status: remaining.length ? message.status : acceptedCount > 0 ? 'applied' : 'dismissed',
            };
          }),
        ),
      ),
    [],
  );

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

  /**
   * Où écrire un nouveau passage : à la place d'une ligne vide si le curseur y est,
   * sinon juste après le bloc du curseur (jamais au milieu d'une phrase).
   */
  const insertionRange = (ed: Editor) => {
    const { $from } = ed.state.selection;
    if ($from.depth === 0) return { from: $from.pos, to: $from.pos };
    const block = $from.node(1);
    if (block.isTextblock && block.content.size === 0) {
      return { from: $from.before(1), to: $from.after(1) };
    }
    const after = $from.after(1);
    return { from: after, to: after };
  };

  /**
   * Où écrire : l'endroit demandé (« en bas », « au début »…), sinon le curseur si on a
   * cliqué ou tapé dans le document, sinon la fin du document (le curseur par défaut, tout
   * en haut, n'est pas un choix).
   */
  const requestedRange = (ed: Editor, prompt: string) => {
    const { doc } = ed.state;
    const endRange = () => {
      // Une ligne vide en fin de document est remplacée plutôt que laissée au-dessus.
      const last = doc.lastChild;
      if (last?.isTextblock && last.content.size === 0) {
        return { from: doc.content.size - last.nodeSize, to: doc.content.size };
      }
      return { from: doc.content.size, to: doc.content.size };
    };
    if (/(^|[\s,;:(])(tout en bas|en bas|à la fin|a la fin|en fin de|en dernier|fin du (doc|document|texte)|dernier paragraphe)(?=$|[\s,.;:!?)])/i.test(prompt)) {
      return endRange();
    }
    if (/(^|[\s,;:(])(tout en haut|en haut|au début|au debut|en premier|début du (doc|document|texte)|avant tout)(?=$|[\s,.;:!?)])/i.test(prompt)) {
      return { from: 0, to: 0 };
    }
    return cursorPlaced.current === docId ? insertionRange(ed) : endRange();
  };

  const send = async (text: string, options: { quote?: SelectionContext | null } = {}) => {
    const prompt = text.trim() || (files.length ? 'Que contiennent ces fichiers ?' : '');
    if (!prompt || streaming) return;
    stickToBottom.current = true;

    const target = options.quote !== undefined ? options.quote : selection;
    // Modification visée par « Préciser », sinon la plus récente.
    const pending = editor
      ? ((refineTarget !== null ? getPending(editor.state, refineTarget) : null) ?? getPending(editor.state))
      : null;
    setRefineTarget(null);
    // Deux cas se décident sans l'IA : réécrire l'extrait sélectionné (« reformule »…),
    // ou retoucher la suggestion en attente (« plus court »…). Pour tout le reste, c'est
    // l'IA qui choisit : répondre, modifier le document, écrire, créer ou demander.
    const mode: 'rewrite' | 'revise' | 'agent' =
      pending && pending.kind !== 'delete' && !/\?\s*$/.test(prompt) && !/\b(cré|nouveau doc)/i.test(prompt)
        ? 'revise'
        : target && REWRITE_PATTERN.test(prompt) && !/\?\s*$/.test(prompt)
          ? 'rewrite'
          : 'agent';
    const fileNote = files.length
      ? `\n\n[Fichiers joints, que l’assistant ne sait pas encore lire : ${files.map((file) => file.name).join(', ')}]`
      : '';
    const useDocument = Boolean(editor && withDocument);
    const emptyDoc = Boolean(editor && editor.state.doc.textContent.trim() === '' && !docTitle.trim());
    const hint = mode === 'agent' ? actionHint(prompt, useDocument, emptyDoc) : null;
    const writeRange = editor && useDocument ? requestedRange(editor, prompt) : null;

    let request: ChatMessage[];
    if (mode !== 'agent' && editor) {
      const passage = mode === 'revise' ? pendingText(editor) : (target?.text ?? '');
      request = [
        { role: 'system', content: withInstructions(REWRITE_SYSTEM, instructions.text) },
        { role: 'user', content: `Consigne : ${prompt}\n\nPassage :\n${passage}` },
      ];
    } else {
      // Seuls les échanges sur ce document : ceux d'un autre document brouilleraient le contexte.
      let about: string | null = null;
      const sameDoc = messages.filter((message) => {
        if (message.role === 'user') about = message.docId;
        return about === docId;
      });
      const history = sameDoc.slice(-HISTORY_LENGTH).flatMap((message): ChatMessage[] => {
        if (message.role === 'user') return [{ role: 'user', content: quoted(message.quote) + message.text }];
        const content = message.text || message.written || '';
        return content ? [{ role: 'assistant', content }] : [];
      });
      const context =
        editor && useDocument && writeRange
          ? {
              docTitle,
              docMarkdown: toMarkdown(docTitle, editor.getJSON()),
              section: currentSection(editor),
              empty: emptyDoc,
              before: editor.state.doc
                .textBetween(Math.max(0, writeRange.from - 300), writeRange.from, '\n')
                .slice(-300)
                .trim(),
              after: editor.state.doc
                .textBetween(writeRange.to, Math.min(editor.state.doc.content.size, writeRange.to + 200), '\n')
                .slice(0, 200)
                .trim(),
            }
          : null;
      request = [
        { role: 'system', content: withInstructions(agentSystem(context), instructions.text) },
        ...history,
        { role: 'user', content: quoted(target) + prompt + fileNote + hintNote(hint) },
      ];
    }

    const answerId = ++messageCount;
    setMessages((list) => [
      // La suggestion retouchée passe à la nouvelle réponse.
      ...list.map((message) =>
        mode === 'revise' && pending && message.role === 'assistant' && message.suggestionIds?.includes(pending.id)
          ? { ...message, suggestionIds: message.suggestionIds.filter((id) => id !== pending.id), status: 'revised' as const }
          : message,
      ),
      { id: ++messageCount, role: 'user', text: prompt, quote: target, files, docId, docTitle },
      { id: answerId, role: 'assistant', text: '', thinking: true, streaming: true, selection: target },
    ]);
    setDraft('');
    clearSelectionContext();
    setFiles([]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const small = !window.matchMedia('(min-width: 640px)').matches;
    let written = '';
    let lastPaint = 0;
    // Retouche : la suggestion existe déjà ; réécriture d'un extrait : on l'ouvre sur l'extrait.
    let suggestion: { id: number; kind: 'block' | 'inline' } | null = null;
    if (editor && mode === 'revise' && pending) {
      suggestion = { id: pending.id, kind: pending.kind === 'inline' ? 'inline' : 'block' };
      resumeWriting(editor, pending.id);
    }
    if (editor && mode === 'rewrite' && target) {
      suggestion = { id: beginSuggestion(editor, target.from, target.to, 'inline', true), kind: 'inline' };
    }
    // Suivre l'écriture dans le document, sauf si l'on fait défiler soi-même.
    let follow = true;
    // Seul un défilement du document compte, pas celui de la conversation.
    const stopFollowing = (event: Event) => {
      if (!(event.target instanceof Element && event.target.closest('[data-assistant]'))) follow = false;
    };
    window.addEventListener('wheel', stopFollowing, { passive: true });
    window.addEventListener('touchmove', stopFollowing, { passive: true });
    if (editor && suggestion) revealSuggestion(editor, suggestion.id);
    if (suggestion) {
      updateMessage(answerId, {
        proposal: { kind: 'inline', mode: 'rewrite' },
        suggestionIds: [suggestion.id],
      });
      // Sur téléphone, le panneau couvre le texte : on le ferme pour voir l'écriture en direct.
      if (small) closeAssistant();
    }
    let action: Action | null = mode === 'agent' ? null : 'write';
    const body = () => (mode === 'agent' ? stripAction(written) : written);
    const render = (markdown: string) =>
      suggestion?.kind === 'inline'
        ? markdown.trim()
          ? [{ type: 'text', text: markdown.trim() }]
          : ''
        : markdownToRichHtml(markdown);

    // L'IA a choisi d'écrire au curseur : on ouvre la suggestion à cet endroit.
    const startWriting = () => {
      if (!editor || !writeRange || suggestion) return;
      suggestion = { id: beginSuggestion(editor, writeRange.from, writeRange.to, 'block', true), kind: 'block' };
      revealSuggestion(editor, suggestion.id);
      updateMessage(answerId, { proposal: { kind: 'inline', mode: 'write' }, suggestionIds: [suggestion.id] });
      if (small) closeAssistant();
    };

    // Demande d'écriture évidente : le curseur apparaît tout de suite à l'endroit prévu,
    // pendant que l'IA réfléchit. Il est retiré si elle choisit finalement autre chose.
    const anchored = mode === 'agent' && hint === 'write' && Boolean(writeRange);
    if (anchored) startWriting();
    const dropAnchor = () => {
      if (!anchored || !editor || !suggestion) return;
      rejectSuggestion(editor, suggestion.id);
      suggestion = null;
      updateMessage(answerId, { proposal: undefined, suggestionIds: [] });
    };

    try {
      for await (const chunk of streamReply(request, mode === 'agent' ? 'chat' : 'quick', controller.signal)) {
        written += chunk;
        if (action === null) {
          action = detectAction(written, hint);
          if (action === null) continue;
          if (action !== 'write') dropAnchor();
          if (action === 'write') {
            if (writeRange) startWriting();
            else action = 'answer';
          }
          if (action === 'edits' && !editor) action = 'answer';
        }
        if (action === 'write' && editor && suggestion) {
          // Écriture en direct dans le document, sans repeindre à chaque morceau.
          if (performance.now() - lastPaint > 90) {
            writeSuggestion(editor, render(body()), suggestion.id);
            lastPaint = performance.now();
            if (follow) revealSuggestion(editor, suggestion.id, 'auto');
          }
          updateMessage(answerId, { thinking: false });
        } else if (action === 'create') {
          const words = body().split(/\s+/).filter(Boolean).length;
          updateMessage(answerId, { progress: `Rédaction de « ${splitTitle(body()).title} » · ${words} mots` });
        } else if (action === 'edits') {
          updateMessage(answerId, { progress: 'Préparation des modifications…' });
        } else if (action === 'question') {
          updateMessage(answerId, { progress: 'Quelques questions pour bien viser…' });
        } else {
          updateMessage(answerId, { thinking: false, text: body() });
        }
      }
      if (action === null) action = written.trim() ? 'answer' : null;
      if (action === null) dropAnchor();
      // Filet : un document complet renvoyé comme simple réponse alors qu'on demandait de le créer.
      if (action === 'answer' && hint === 'create' && /^\s*#\s/.test(unwrapFence(written)) && written.length > 200) {
        action = 'create';
        updateMessage(answerId, { text: '' });
      }

      if (action === 'write' && editor && suggestion) {
        // Document vide et sans titre : le « # Titre » écrit par l'IA devient son titre.
        if (emptyDoc && docId && /^\s*#\s/.test(body())) {
          const { title, body: rest } = splitTitle(stripChatter(body()));
          writeSuggestion(editor, render(rest), suggestion.id);
          void renameDocument(docId, title);
        } else if (body().trim()) writeSuggestion(editor, render(body()), suggestion.id);
        else if (mode !== 'revise') rejectSuggestion(editor, suggestion.id);
        const alive = getPending(editor.state, suggestion.id);
        updateMessage(answerId, { written: body(), status: alive ? 'pending' : 'dismissed' });
      } else if (action === 'question') {
        const questions = parseQuestions(body());
        updateMessage(answerId, questions ? { questions, progress: undefined } : { text: body(), progress: undefined });
      } else if (action === 'edits' && editor) {
        const parsed = parseEdits(body());
        if (!parsed) {
          // Réponse mal formée : on le dit, avec « Réessayer » (souvent suffisant).
          updateMessage(answerId, {
            error: 'Les modifications proposées étaient illisibles. Réessayez, ou précisez ce qu’il faut changer.',
            progress: undefined,
          });
        } else {
          const { ids, missing } = applyEdits(editor, parsed.edits, writeRange);
          if (ids[0] !== undefined) revealSuggestion(editor, ids[0]);
          if (!ids.length) {
            // Rien de retrouvé : ce n'est pas un refus, on le dit et on propose de réessayer.
            updateMessage(answerId, {
              progress: undefined,
              error: 'Je n’ai pas retrouvé les passages à modifier dans le document. Réessayez, ou citez le passage visé.',
            });
            return;
          }
          updateMessage(answerId, {
            progress: undefined,
            written: `Modifications proposées dans le document : ${parsed.summary}`,
            proposal: { kind: 'edits', summary: parsed.summary, count: ids.length, missing },
            suggestionIds: ids,
            status: ids.length ? 'pending' : 'dismissed',
          });
          if (ids.length && small) closeAssistant();
        }
      } else if (action === 'create' && !controller.signal.aborted && body().trim()) {
        // Le document est créé et ouvert tout de suite (annulable depuis le panneau).
        const { title, body: markdown } = splitTitle(stripChatter(body()));
        const content = markdownToContent(markdown);
        const id = await createDocumentWith({ title, content, text: plainText(content) });
        openDocumentRoute(id);
        updateMessage(answerId, {
          written: `Document créé : « ${title} »`,
          progress: undefined,
          proposal: { kind: 'create', title, content, text: markdown },
          status: 'applied',
          createdId: id,
        });
      }
    } catch (error) {
      if (editor && suggestion && mode === 'rewrite' && !written.trim()) rejectSuggestion(editor, suggestion.id);
      if (!written.trim()) dropAnchor();
      if (!controller.signal.aborted) {
        updateMessage(answerId, {
          error: ERROR_MESSAGES[error instanceof AssistantError ? error.code : 'server'],
          errorDetail: error instanceof AssistantError ? error.detail : String(error),
          progress: undefined,
        });
      }
    } finally {
      window.removeEventListener('wheel', stopFollowing);
      window.removeEventListener('touchmove', stopFollowing);
      if (editor && suggestion) finishWriting(editor, suggestion.id);
      abortRef.current = null;
      setStreaming(false);
      updateMessage(answerId, { thinking: false, streaming: false });
    }
  };

  /**
   * Applique les modifications proposées par l'IA comme suggestions dans le document :
   * chaque passage retrouvé est réécrit sur place (l'ancien texte barré), supprimé en
   * suggestion, ou suivi d'un nouveau paragraphe. Les passages introuvables sont comptés.
   */
  const applyEdits = (ed: Editor, edits: EditOp[], fallback: { from: number; to: number } | null) => {
    const ids: number[] = [];
    let missing = 0;
    for (const edit of edits) {
      const passage = 'find' in edit ? edit.find : edit.after;
      const hit = locate(ed, passage);
      // Ajout après un passage introuvable : on l'ajoute quand même, là où on écrirait par défaut.
      if (!hit && 'after' in edit && fallback) {
        const id = beginSuggestion(ed, fallback.from, fallback.to, 'block');
        writeSuggestion(ed, markdownToRichHtml(unwrapFence(edit.insert)), id);
        ids.push(id);
        fallback = null;
        continue;
      }
      if (!hit) {
        missing++;
        continue;
      }
      if ('after' in edit) {
        const id = beginSuggestion(ed, hit.block.to, hit.block.to, 'block');
        writeSuggestion(ed, markdownToRichHtml(unwrapFence(edit.insert)), id);
        ids.push(id);
        continue;
      }
      const replacement = unwrapFence(edit.replace).trim();
      if (!replacement) {
        const range = hit.wholeBlock ? hit.block : hit;
        ids.push(beginSuggestion(ed, range.from, range.to, 'delete'));
        continue;
      }
      // Plusieurs paragraphes (ou un paragraphe entier réécrit en plusieurs) : on remplace les blocs.
      if (hit.multiBlock || (hit.wholeBlock && /\n\s*\n|^\s*([-*+]|\d+\.|#{1,3}|>)\s/m.test(replacement))) {
        const id = beginSuggestion(ed, hit.block.from, hit.block.to, 'block');
        writeSuggestion(ed, markdownToRichHtml(replacement), id);
        ids.push(id);
        continue;
      }
      const id = beginSuggestion(ed, hit.from, hit.to, 'inline');
      writeSuggestion(ed, markdownInlineToHtml(replacement), id);
      ids.push(id);
    }
    return { ids, missing };
  };

  /**
   * Retrouve un passage cité par l'IA : dans un seul paragraphe, sinon sur plusieurs
   * paragraphes qui se suivent (du premier au dernier ligne cité).
   */
  const locate = (ed: Editor, passage: string) => {
    const single = findText(ed.state.doc, passage);
    if (single) return { ...single, multiBlock: false };
    const lines = passage.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const first = findText(ed.state.doc, lines[0] ?? '');
    const last = findText(ed.state.doc, lines.at(-1) ?? '');
    if (!first || !last || last.block.to < first.block.from) return null;
    const block = { from: first.block.from, to: last.block.to };
    return { from: block.from, to: block.to, wholeBlock: true, block, multiBlock: true };
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

    if (proposal.kind === 'inline' || proposal.kind === 'edits') {
      if (editor) acceptAll(editor, message.suggestionIds ?? []);
      return;
    }

    if (proposal.kind === 'insert') {
      if (!editor) return;
      insertMarked(editor, markdownToRichHtml(proposal.markdown));
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
    } else if (event.key === 'ArrowUp' && !draft) {
      // ↑ dans le champ vide : reprendre la dernière demande pour la corriger.
      const lastUser = [...messages].reverse().find((message) => message.role === 'user');
      if (lastUser) {
        event.preventDefault();
        setDraft(lastUser.text);
      }
    }
  };

  /** Relance la dernière demande (erreur, ou autre réponse souhaitée). */
  const retry = (answerId: number) => {
    const index = messages.findIndex((message) => message.id === answerId);
    const question = messages[index - 1];
    if (!question || question.role !== 'user') return;
    setMessages((list) => list.filter((message) => message.id !== answerId && message.id !== question.id));
    void send(question.text, { quote: question.quote });
  };

  // Action en un clic depuis le texte (« Reformuler »…) : envoyée dès l'ouverture.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!open) return;
    const draftRequest = takePendingDraft();
    if (draftRequest) {
      setDraft(draftRequest.text);
      if (draftRequest.detached) setWithDocument(false);
      // Curseur en fin de texte, prêt à compléter « Crée un document sur … ».
      requestAnimationFrame(() => {
        const input = inputRef.current;
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    }
    const prompt = takePendingPrompt();
    if (prompt) void sendRef.current(prompt);
  }, [open, focusRequest]);

  const onPanelKeyDown = (event: KeyboardEvent) => {
    // ⌘↵ depuis le panneau : accepter la suggestion en attente dans le document.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && editor && getPending(editor.state)) {
      event.preventDefault();
      acceptSuggestion(editor);
      return;
    }
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    // Échap arrête d'abord une réponse en cours, puis ferme le panneau.
    if (streaming) {
      stop();
      return;
    }
    closeAssistant();
    editor?.commands.focus();
  };

  const documentEmpty = editorEmpty && !docTitle.trim();
  const suggestions = selection
    ? SELECTION_SUGGESTIONS
    : !withDocument
      ? FREE_SUGGESTIONS
      : editorEmpty
        ? EMPTY_DOC_SUGGESTIONS
        : DOC_SUGGESTIONS;

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
              setWithDocument(true);
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

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
      >
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
                  onClick={() => {
                    // Suggestion à compléter (« … ») : dans le champ, curseur à la fin.
                    if (!suggestion.endsWith('…')) return void send(suggestion);
                    const text = `${suggestion.slice(0, -1)} `;
                    setDraft(text);
                    requestAnimationFrame(() => {
                      inputRef.current?.focus();
                      inputRef.current?.setSelectionRange(text.length, text.length);
                    });
                  }}
                  className="rounded-lg border border-rule px-2.5 py-1.5 text-left text-[13px] text-ink-muted transition-colors duration-100 hover:border-rule-strong hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-5 pt-2">
            {messages.map((message, index) =>
              message.role === 'user' ? (
                <Fragment key={message.id}>
                {(() => {
                  // Changement de document entre deux demandes : repère discret.
                  const previous = messages.slice(0, index).reverse().find((item) => item.role === 'user');
                  return previous && previous.role === 'user' && previous.docId !== message.docId ? (
                    <li aria-hidden className="flex items-center gap-2 text-[11px] text-ink-faint">
                      <span className="h-px flex-1 bg-rule" />
                      <span className="max-w-[70%] truncate">{message.docTitle.trim() || 'Sans titre'}</span>
                      <span className="h-px flex-1 bg-rule" />
                    </li>
                  ) : null;
                })()}
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
                </Fragment>
              ) : (
                <li key={message.id} className="group animate-fade-in px-1">
                  {message.thinking ? (
                    <Thinking label={message.progress} />
                  ) : (
                    message.text && (
                      <div
                        className="assistant-md text-[13px] leading-relaxed text-ink"
                        // Markdown de l'IA, nettoyé par DOMPurify.
                        dangerouslySetInnerHTML={{ __html: markdownToHtml(message.text) }}
                      />
                    )
                  )}
                  {message.error && (
                    <p className="flex items-center gap-2 text-[13px] text-danger">
                      {message.error}
                      {!streaming && (
                        <button
                          type="button"
                          onClick={() => retry(message.id)}
                          className="rounded px-1.5 py-0.5 text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
                        >
                          Réessayer
                        </button>
                      )}
                    </p>
                  )}
                  {message.questions && (
                    <QuestionsCard
                      questions={message.questions}
                      answered={Boolean(message.answered) || message.id !== messages.at(-1)?.id}
                      disabled={streaming}
                      onSubmit={(answer) => {
                        updateMessage(message.id, { answered: true });
                        void send(answer);
                      }}
                    />
                  )}
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
                      onDismiss={() => {
                        if (message.proposal?.kind === 'inline' || message.proposal?.kind === 'edits') {
                          if (editor) rejectAll(editor, message.suggestionIds ?? []);
                        } else {
                          updateMessage(message.id, { status: 'dismissed' });
                        }
                      }}
                      onRevise={
                        message.proposal?.kind === 'inline' && !streaming
                          ? (prompt: string) => void send(prompt)
                          : undefined
                      }
                      onUndo={
                        message.proposal?.kind === 'create' && message.createdId
                          ? () => {
                              const id = message.createdId as string;
                              updateMessage(message.id, { status: 'dismissed' });
                              void deleteDocument(id).then(async () => {
                                // Il était ouvert : on revient au dernier document.
                                if (id === docId) openDocumentRoute(await latestDocumentId(), { replace: true });
                              });
                            }
                          : undefined
                      }
                      onShow={
                        (message.proposal?.kind === 'inline' || message.proposal?.kind === 'edits') && editor
                          ? () => {
                              // Première suggestion encore en attente de cette réponse.
                              const first = getPendings(editor.state)
                                .filter((pending) => message.suggestionIds?.includes(pending.id))
                                .sort((a, b) => a.from - b.from)[0];
                              if (first) editor.chain().focus().setTextSelection(first.to).scrollIntoView().run();
                            }
                          : undefined
                      }
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
                        label="Insérer"
                        icon={<PlusIcon />}
                        onClick={() => editor && insertMarked(editor, markdownToRichHtml(message.text))}
                      />
                      {message.id === messages.at(-1)?.id && !streaming && (
                        <SmallAction label="Régénérer" icon={<UndoIcon />} onClick={() => retry(message.id)} />
                      )}
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
            {withDocument ? (
              <span className="flex max-w-full items-center gap-1 rounded-md bg-surface py-0.5 pr-0.5 pl-1.5 text-[11px] text-ink-muted">
                <FileIcon />
                <span className="truncate">{docTitle.trim() || 'Sans titre'}</span>
                <button
                  type="button"
                  aria-label="Parler sans ce document"
                  data-tooltip="Parler sans ce document"
                  onClick={() => setWithDocument(false)}
                  className="grid size-4 shrink-0 place-items-center rounded hover:bg-rule [&_svg]:size-3"
                >
                  <CloseIcon />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setWithDocument(true)}
                data-tooltip="Joindre le document ouvert"
                className="flex items-center gap-1 rounded-md border border-dashed border-rule-strong px-1.5 py-0.5 text-[11px] text-ink-faint hover:text-ink"
              >
                <PlusIcon />
                Document
              </button>
            )}
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
              placeholder={
                refineTarget !== null
                  ? 'Que faut-il changer dans cette modification ?'
                  : selection
                  ? 'Que faire de ce passage ?'
                  : documentEmpty && withDocument
                    ? 'Que doit contenir ce document ?'
                    : `Demander à ${ASSISTANT_NAME}…`
              }
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
  /** Suggestion dans le document : y aller. */
  onShow?: () => void;
  /** Document créé : l'envoyer à la corbeille. */
  onUndo?: () => void;
  /** Suggestion en attente : la réécrire selon une consigne rapide. */
  onRevise?: (prompt: string) => void;
}

const REVISIONS = [
  { label: 'Plus court', prompt: 'Rends-le plus court' },
  { label: 'Plus développé', prompt: 'Développe-le davantage' },
  { label: 'Plus simple', prompt: 'Rends-le plus simple et plus clair' },
  { label: 'Autre version', prompt: 'Propose une autre version, différente' },
];

function ProposalCard({ proposal, status, onApply, onDismiss, onOpen, onShow, onUndo, onRevise }: ProposalCardProps) {
  if (proposal.kind === 'edits') {
    const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
    return (
      <div className="mt-2 space-y-2 rounded-lg border border-rule-strong bg-canvas px-3 py-2.5 text-xs">
        <p className="flex items-center gap-2 text-ink">
          <span className="size-1.5 shrink-0 rounded-full bg-ai" aria-hidden />
          <span className="font-medium">
            {status === 'applied'
              ? '✓ Modifications appliquées'
              : status === 'dismissed'
                ? 'Modifications refusées'
                : `${plural(proposal.count, 'modification')} dans le document`}
          </span>
        </p>
        {proposal.summary && <p className="text-ink-muted">{proposal.summary}</p>}
        {proposal.missing > 0 && (
          <p className="text-ink-faint">
            {plural(proposal.missing, 'passage')} introuvable{proposal.missing > 1 ? 's' : ''} dans le document, laissé
            {proposal.missing > 1 ? 's' : ''} tel{proposal.missing > 1 ? 's' : ''} quel{proposal.missing > 1 ? 's' : ''}.
          </p>
        )}
        {status === 'pending' && (
          <div className="flex items-center gap-2">
            {onShow && (
              <button type="button" onClick={onShow} className="rounded-md px-1.5 py-1 text-ink-muted hover:bg-surface hover:text-ink">
                Voir
              </button>
            )}
            <span className="flex-1" />
            <button type="button" onClick={onDismiss} className="rounded-md px-2 py-1 text-ink-muted hover:bg-surface hover:text-ink">
              Tout refuser
            </button>
            <button
              type="button"
              onClick={onApply}
              title="Tout accepter (⌘↵)"
              className="rounded-md bg-ink px-2.5 py-1 font-medium text-canvas hover:opacity-90"
            >
              Tout accepter
            </button>
          </div>
        )}
        {status === 'pending' && (
          <p className="text-[11px] text-ink-faint">Ou une par une, directement dans le texte.</p>
        )}
      </div>
    );
  }

  if (proposal.kind === 'inline') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-rule-strong bg-canvas px-3 py-2 text-xs">
        <span className="size-1.5 shrink-0 rounded-full bg-ai" aria-hidden />
        <span className="min-w-0 flex-1 text-ink-muted">
          {status === undefined
            ? proposal.mode === 'write'
              ? 'Écrit dans le document…'
              : 'Réécrit dans le document…'
            : status === 'pending'
              ? 'Dans le document, à valider'
              : status === 'applied'
                ? '✓ Accepté'
                : status === 'revised'
                  ? 'Remplacé par la version suivante'
                  : 'Refusé'}
        </span>
        {status === 'pending' && (
          <>
            {onShow && (
              <button type="button" onClick={onShow} className="rounded-md px-1.5 py-1 text-ink-muted hover:bg-surface hover:text-ink">
                Voir
              </button>
            )}
            <button type="button" onClick={onDismiss} className="rounded-md px-2 py-1 text-ink-muted hover:bg-surface hover:text-ink">
              Refuser
            </button>
            <button
              type="button"
              onClick={onApply}
              title="Accepter (⌘↵ dans le texte)"
              className="rounded-md bg-ink px-2.5 py-1 font-medium text-canvas hover:opacity-90"
            >
              Accepter
            </button>
          </>
        )}
        {status === 'pending' && onRevise && (
          <div className="flex w-full flex-wrap gap-1 pt-0.5">
            {REVISIONS.map((revision) => (
              <button
                key={revision.label}
                type="button"
                onClick={() => onRevise(revision.prompt)}
                className="rounded-full border border-rule px-2 py-0.5 text-[11px] text-ink-muted transition-colors hover:border-rule-strong hover:text-ink"
              >
                {revision.label}
              </button>
            ))}
          </div>
        )}
        {status === 'pending' && (
          <p className="w-full text-[11px] text-ink-faint">
            Ou écrivez ce qu’il faut changer. Dans le texte : ⌘↵ accepte, Échap refuse.
          </p>
        )}
      </div>
    );
  }

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
          <p className="mt-1 truncate text-xs text-ink-faint">
            {proposal.text
              .split('\n')
              .filter((line) => /^#{2,3}\s/.test(line))
              .map((line) => line.replace(/^#+\s*/, ''))
              .join(' · ') || `${proposal.text.split(/\s+/).filter(Boolean).length} mots`}
          </p>
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
            {onUndo && (
              <button
                type="button"
                onClick={onUndo}
                className="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface hover:text-danger"
              >
                Annuler
              </button>
            )}
          </>
        )}
        {status === 'dismissed' && (
          <span className="text-xs text-ink-faint">
            {proposal.kind === 'create' ? 'Annulé · document mis à la corbeille' : 'Ignoré'}
          </span>
        )}
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
function Thinking({ label = 'Réflexion…' }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-0.5 text-[13px]">
      <span className="text-ai">
        <AssistantIcon size={14} thinking />
      </span>
      <span className="animate-shimmer bg-[linear-gradient(90deg,var(--ink-faint)_0%,var(--ink-faint)_40%,var(--ink)_50%,var(--ink-faint)_60%,var(--ink-faint)_100%)] bg-[length:200%_100%] bg-clip-text text-transparent">
        {label}
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

interface QuestionsCardProps {
  questions: AskQuestion[];
  /** Déjà répondu (ou conversation passée à autre chose) : lecture seule. */
  answered: boolean;
  disabled: boolean;
  onSubmit: (answer: string) => void;
}

/**
 * Questions à choix de l'IA, comme dans Claude : on coche une option (ou plusieurs),
 * « Autre » permet de répondre librement, « Envoyer » transmet le tout.
 */
function QuestionsCard({ questions, answered, disabled, onSubmit }: QuestionsCardProps) {
  const [chosen, setChosen] = useState<string[][]>(() => questions.map(() => []));
  const [other, setOther] = useState<string[]>(() => questions.map(() => ''));
  const [otherOn, setOtherOn] = useState<boolean[]>(() => questions.map(() => false));

  const answerFor = (index: number) => {
    const picks = [...(chosen[index] ?? [])];
    const free = other[index]?.trim();
    if (otherOn[index] && free) picks.push(free);
    return picks;
  };
  const complete = questions.every((_, index) => answerFor(index).length > 0);
  const locked = answered || disabled;

  const toggle = (index: number, option: string, multiple: boolean) => {
    setChosen((all) =>
      all.map((picks, i) => {
        if (i !== index) return picks;
        if (!multiple) return [option];
        return picks.includes(option) ? picks.filter((pick) => pick !== option) : [...picks, option];
      }),
    );
    if (!multiple) setOtherOn((all) => all.map((on, i) => (i === index ? false : on)));
  };

  const submit = () => {
    if (!complete || locked) return;
    const lines = questions.map((item, index) => `- ${item.question} → ${answerFor(index).join(', ')}`);
    onSubmit(`Mes réponses :\n${lines.join('\n')}`);
  };

  return (
    <div className={`mt-2 space-y-3 rounded-xl border border-rule-strong bg-canvas p-3 ${locked ? 'opacity-60' : ''}`}>
      {questions.map((item, index) => (
        <fieldset key={item.question} disabled={locked} className="space-y-1">
          <legend className="mb-1.5 text-[13px] font-medium text-ink">{item.question}</legend>
          {item.options.map((option) => {
            const selected = chosen[index]?.includes(option) ?? false;
            return (
              <label
                key={option}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors duration-100 ${
                  selected ? 'border-ai/50 bg-ai-soft text-ink' : 'border-rule text-ink-muted hover:border-rule-strong hover:text-ink'
                }`}
              >
                <input
                  type={item.multiple ? 'checkbox' : 'radio'}
                  name={`question-${index}`}
                  checked={selected}
                  onChange={() => toggle(index, option, item.multiple)}
                  className="size-3.5 shrink-0 accent-[var(--ai)]"
                />
                {option}
              </label>
            );
          })}
          <label
            className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-1 text-[13px] transition-colors duration-100 ${
              otherOn[index] ? 'border-ai/50 bg-ai-soft' : 'border-rule hover:border-rule-strong'
            }`}
          >
            <input
              type={item.multiple ? 'checkbox' : 'radio'}
              name={`question-${index}`}
              checked={otherOn[index] ?? false}
              onChange={() => {
                setOtherOn((all) => all.map((on, i) => (i === index ? (item.multiple ? !on : true) : on)));
                if (!item.multiple) setChosen((all) => all.map((picks, i) => (i === index ? [] : picks)));
              }}
              className="size-3.5 shrink-0 accent-[var(--ai)]"
            />
            <input
              type="text"
              value={other[index] ?? ''}
              placeholder="Autre…"
              aria-label={`Autre réponse : ${item.question}`}
              onFocus={() => {
                setOtherOn((all) => all.map((on, i) => (i === index ? true : on)));
                if (!item.multiple) setChosen((all) => all.map((picks, i) => (i === index ? [] : picks)));
              }}
              onChange={(event) => setOther((all) => all.map((text, i) => (i === index ? event.target.value : text)))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
              className="min-w-0 flex-1 bg-transparent py-0.5 text-base text-ink outline-none placeholder:text-ink-faint sm:text-[13px]"
            />
          </label>
        </fieldset>
      ))}
      {!answered && (
        <div className="flex items-center justify-end gap-2 pt-0.5">
          <button
            type="button"
            disabled={locked}
            onClick={() => onSubmit('Fais au mieux, choisis pour moi.')}
            className="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface hover:text-ink"
          >
            Choisis pour moi
          </button>
          <button
            type="button"
            disabled={!complete || locked}
            onClick={submit}
            className="rounded-md bg-ink px-3 py-1 text-xs font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            Envoyer
          </button>
        </div>
      )}
    </div>
  );
}
