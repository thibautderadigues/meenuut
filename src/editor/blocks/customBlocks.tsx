import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import {
  mergeAttributes,
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type Editor,
  type ReactNodeViewProps,
} from '@tiptap/react';
import { useState } from 'react';
import { IconPicker } from '../../sidebar/IconPicker';
import { SmileIcon } from '../../ui/icons';
import { ItemIcon } from '../../ui/itemIcons';
import type { Point } from '../../ui/Popover';
import { depthOf, exitOnEmptyLine } from './helpers';

// ——— Encadré ———

export const CALLOUT_COLORS = [
  { name: 'gray', label: 'Gris' },
  { name: 'blue', label: 'Bleu' },
  { name: 'green', label: 'Vert' },
  { name: 'orange', label: 'Orange' },
  { name: 'red', label: 'Rouge' },
  { name: 'purple', label: 'Violet' },
] as const;

export type CalloutColor = (typeof CALLOUT_COLORS)[number]['name'];

/** Encadrés créés avant le choix libre (attribut `variant`) : couleur et icône équivalentes. */
const LEGACY_VARIANTS: Record<string, { color: CalloutColor; icon: string }> = {
  info: { color: 'blue', icon: 'icon:info' },
  tip: { color: 'green', icon: 'icon:lightbulb' },
  warning: { color: 'orange', icon: 'icon:warning' },
  danger: { color: 'red', icon: 'icon:danger' },
  note: { color: 'purple', icon: 'icon:pencil' },
};

/** Couleur et icône effectives, anciens encadrés compris. `icon: 'none'` : pas d'icône (choix explicite). */
export function calloutLook(attrs: Record<string, unknown>): { color: CalloutColor; icon: string | null } {
  const legacy = LEGACY_VARIANTS[String(attrs.variant)];
  return {
    color: (attrs.color as CalloutColor | null) ?? legacy?.color ?? 'blue',
    icon: attrs.icon === 'none' ? null : ((attrs.icon as string | null) ?? legacy?.icon ?? 'icon:info'),
  };
}

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const { color, icon } = calloutLook(node.attrs);
  const [picker, setPicker] = useState<Point | null>(null);
  const set = (attrs: Record<string, unknown>) => updateAttributes({ ...attrs, variant: null });

  return (
    <NodeViewWrapper className="callout" data-color={color} data-has-icon={icon ? 'true' : 'false'}>
      <button
        type="button"
        contentEditable={false}
        disabled={!editor.isEditable}
        aria-label="Couleur et icône de l’encadré"
        aria-haspopup="dialog"
        data-tooltip="Couleur et icône"
        // Le clic ne doit pas retirer le focus de l'éditeur.
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPicker({ x: rect.left, y: rect.bottom + 4 });
        }}
        className="callout-icon"
      >
        {icon ? <ItemIcon value={icon} fallback={null} /> : <SmileIcon />}
      </button>
      <NodeViewContent className="callout-content" />

      {picker && (
        <IconPicker
          label="Couleur et icône de l’encadré"
          value={icon}
          anchor={picker}
          noneLabel="Sans icône"
          onClose={() => {
            setPicker(null);
            editor.commands.focus();
          }}
          onSelect={(next) => set({ icon: next ?? 'none', color })}
          header={
            <div role="radiogroup" aria-label="Couleur" className="mb-2 flex items-center gap-1.5 border-b border-rule px-1 pt-1 pb-2.5">
              {CALLOUT_COLORS.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  role="radio"
                  aria-checked={option.name === color}
                  aria-label={option.label}
                  data-tooltip={option.label}
                  onClick={() => set({ color: option.name, icon: icon ?? 'none' })}
                  data-color={option.name}
                  className="callout-swatch"
                />
              ))}
            </div>
          }
        />
      )}
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-color'),
        renderHTML: (attributes) => ({ 'data-color': calloutLook(attributes).color }),
      },
      icon: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-icon'),
        renderHTML: (attributes) => ({ 'data-icon': calloutLook(attributes).icon ?? '' }),
      },
      // Ancien format (encadrés à types fixes), conservé pour la lecture.
      variant: { default: null, rendered: false },
    };
  },
  parseHTML: () => [{ tag: 'div[data-type="callout"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-type': 'callout', class: 'callout' }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(CalloutView),
  addKeyboardShortcuts() {
    return { Enter: () => exitOnEmptyLine(this.editor, this.name) };
  },
});

// ——— Citation mise en avant ———

export const PullQuote = Node.create({
  name: 'pullQuote',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  parseHTML: () => [{ tag: 'figure[data-type="pull-quote"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'figure',
    mergeAttributes(HTMLAttributes, { 'data-type': 'pull-quote', class: 'pull-quote' }),
    0,
  ],
  addKeyboardShortcuts() {
    return { Enter: () => exitOnEmptyLine(this.editor, this.name) };
  },
});

// ——— À retenir ———
// Retiré des menus d'insertion ; le nœud reste déclaré pour ouvrir les documents qui en contiennent.

export const KeyPoints = Node.create({
  name: 'keyPoints',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML: () => [{ tag: 'aside[data-type="key-points"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'aside',
    mergeAttributes(HTMLAttributes, { 'data-type': 'key-points', class: 'key-points' }),
    0,
  ],
  addKeyboardShortcuts() {
    return { Enter: () => exitOnEmptyLine(this.editor, this.name) };
  },
});

// ——— Colonnes ———

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column column',
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-type="columns"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-type': 'columns', class: 'columns' }),
    0,
  ],
});

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-type="column"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'column' }),
    0,
  ],
});

// ——— Étapes ———

export const Steps = Node.create({
  name: 'steps',
  group: 'block',
  content: 'step+',
  parseHTML: () => [{ tag: 'ol[data-type="steps"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'ol',
    mergeAttributes(HTMLAttributes, { 'data-type': 'steps', class: 'steps' }),
    0,
  ],
});

const emptyPair = (editor: Editor) => {
  const { paragraph } = editor.schema.nodes;
  return [paragraph!.create(), paragraph!.create()];
};

const isBlank = (node: PMNode) => node.textContent.trim() === '' && node.childCount <= 2;

/**
 * Étape : un libellé (1er paragraphe) et une description (la suite).
 * Entrée : libellé → description → nouvelle étape. Entrée sur une étape vide : sortie du bloc.
 * ⇧Entrée dans la description : retour à la ligne.
 */
export const Step = Node.create({
  name: 'step',
  content: 'paragraph block*',
  defining: true,
  parseHTML: () => [{ tag: 'li[data-type="step"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'li',
    mergeAttributes(HTMLAttributes, { 'data-type': 'step', class: 'step' }),
    0,
  ],
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;
        const depth = depthOf($from, this.name);
        if (depth < 0 || $from.depth !== depth + 1) return false;
        const step = $from.node(depth);
        const go = (pos: number, tr = state.tr) => {
          tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
          view.dispatch(tr.scrollIntoView());
          return true;
        };

        const stepStart = $from.before(depth);
        const stepEnd = $from.after(depth);
        const steps = $from.node(depth - 1);
        const index = $from.index(depth - 1);
        const isLast = index === steps.childCount - 1;

        // Dernière étape, vide : on sort du bloc (et elle disparaît s'il en reste d'autres).
        if (isBlank(step) && isLast && steps.childCount > 1) {
          const tr = state.tr.delete(stepStart, stepEnd);
          const after = tr.mapping.map($from.after(depth - 1));
          return go(after + 1, tr.insert(after, state.schema.nodes.paragraph!.create()));
        }

        // Libellé → description (créée si besoin).
        if ($from.index(depth) === 0) {
          const afterTitle = $from.after(depth + 1);
          if (step.childCount > 1) return go(afterTitle + 1);
          return go(afterTitle + 1, state.tr.insert(afterTitle, state.schema.nodes.paragraph!.create()));
        }

        // Description → étape suivante si elle est encore vide, sinon nouvelle étape.
        const next = isLast ? null : steps.child(index + 1);
        if (next && isBlank(next)) return go(stepEnd + 2);
        const tr = state.tr.insert(stepEnd, this.type.create(null, emptyPair(this.editor)));
        return go(stepEnd + 2, tr);
      },
    };
  },
});

// ——— Chiffres clés ———

const MAX_METRICS = 4;

function MetricsView({ node, editor, getPos }: ReactNodeViewProps) {
  const count = node.childCount;

  const setCount = (target: number) => {
    const pos = getPos();
    if (typeof pos !== 'number' || target === count) return;
    const { state } = editor;
    const end = pos + node.nodeSize - 1;
    const tr = state.tr;
    if (target > count) {
      const metric = state.schema.nodes.metric!;
      const added = Array.from({ length: target - count }, () => metric.create(null, emptyPair(editor)));
      tr.insert(end, added);
    } else {
      let cut = pos + 1;
      for (let i = 0; i < target; i++) cut += node.child(i).nodeSize;
      tr.delete(cut, end);
    }
    editor.view.dispatch(tr);
  };

  return (
    <NodeViewWrapper className="metrics-block" data-count={count}>
      <div contentEditable={false} role="radiogroup" aria-label="Nombre de cartes" className="metrics-count">
        {[1, 2, 3, 4].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === count}
            aria-label={`${value} carte${value > 1 ? 's' : ''}`}
            data-tooltip={`${value} carte${value > 1 ? 's' : ''}`}
            disabled={!editor.isEditable}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setCount(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <NodeViewContent className="metrics" />
    </NodeViewWrapper>
  );
}

export const Metrics = Node.create({
  name: 'metrics',
  group: 'block',
  content: 'metric+',
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-type="metrics"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-type': 'metrics', class: 'metrics' }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(MetricsView),
});

/**
 * Carte "chiffre + libellé". Entrée passe du chiffre au libellé, puis à la carte suivante ;
 * après la dernière, ajoute une carte (jusqu'à 4) ou sort du bloc.
 */
export const Metric = Node.create({
  name: 'metric',
  content: 'paragraph paragraph',
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-type="metric"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-type': 'metric', class: 'metric' }),
    0,
  ],
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;
        const depth = depthOf($from, this.name);
        if (depth < 0) return false;
        const go = (pos: number, tr = state.tr) => {
          tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
          view.dispatch(tr.scrollIntoView());
          return true;
        };

        // Chiffre → libellé.
        if ($from.index(depth) === 0) return go($from.after(depth + 1) + 1);

        const metrics = $from.node(depth - 1);
        const index = $from.index(depth - 1);
        const after = $from.after(depth);
        if (index < metrics.childCount - 1) return go(after + 2);

        if (metrics.childCount < MAX_METRICS) {
          const tr = state.tr.insert(after, this.type.create(null, emptyPair(this.editor)));
          return go(after + 2, tr);
        }
        const end = $from.after(depth - 1);
        const tr = state.tr.insert(end, state.schema.nodes.paragraph!.create());
        return go(end + 1, tr);
      },
    };
  },
});

export const CUSTOM_BLOCKS = [Callout, PullQuote, KeyPoints, Columns, Column, Steps, Step, Metrics, Metric];
