import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { moveBlock } from '../moveBlock';
import { findMatches } from '../search';

const editorWith = (html: string) => new Editor({ extensions: [StarterKit], content: html });

describe('findMatches', () => {
  it('trouve toutes les occurrences, sans tenir compte de la casse ni des accents', () => {
    const editor = editorWith('<p>Crème brûlée, CREME fraîche</p><p>crème</p>');
    const matches = findMatches(editor.state.doc, 'creme', false);
    expect(matches.map(({ from, to }) => editor.state.doc.textBetween(from, to))).toEqual([
      'Crème',
      'CREME',
      'crème',
    ]);
  });

  it('mode strict : casse et accents respectés', () => {
    const editor = editorWith('<p>Crème crème creme</p>');
    expect(findMatches(editor.state.doc, 'crème', true)).toHaveLength(1);
  });

  it('occurrence à cheval sur plusieurs marques', () => {
    const editor = editorWith('<p>un <strong>mot</strong>clé ici</p>');
    const [match] = findMatches(editor.state.doc, 'motclé', false);
    expect(editor.state.doc.textBetween(match!.from, match!.to)).toBe('motclé');
  });
});

describe('moveBlock', () => {
  const texts = (editor: Editor) => {
    const out: string[] = [];
    editor.state.doc.forEach((node) => out.push(node.textContent));
    return out;
  };

  it('monte et descend le bloc courant, curseur compris', () => {
    const editor = editorWith('<p>A</p><p>B</p><p>C</p>');
    editor.commands.setTextSelection(5); // dans "B"
    moveBlock(editor, 'up');
    expect(texts(editor)).toEqual(['B', 'A', 'C']);
    moveBlock(editor, 'down');
    moveBlock(editor, 'down');
    expect(texts(editor)).toEqual(['A', 'C', 'B']);
    expect(editor.state.selection.$from.parent.textContent).toBe('B');
  });

  it('ne bouge pas au-delà des bords', () => {
    const editor = editorWith('<p>A</p><p>B</p>');
    editor.commands.setTextSelection(1);
    expect(moveBlock(editor, 'up')).toBe(false);
  });
});
