// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { expect, test } from 'vitest';
import { AiHighlight } from '../aiHighlight';
import {
  acceptSuggestion,
  AiSuggestion,
  beginSuggestion,
  getPending,
  rejectSuggestion,
  writeSuggestion,
} from '../aiSuggestion';

/** Suggestions de l'assistant écrites dans le document : écrire, réviser, accepter, refuser. */
const make = () => new Editor({ extensions: [StarterKit, AiHighlight, AiSuggestion], content: '<p>Avant</p><p></p><p>Après</p>' });

test('écrire, réviser, refuser', () => {
  const e = make();
  const empty = e.state.doc.child(0).nodeSize; // position de la ligne vide
  beginSuggestion(e, empty, empty + 2, 'block');
  writeSuggestion(e, '<p>Premier</p>');
  writeSuggestion(e, '<p>Premier jet complet</p><p>Deux</p>');
  expect(e.getText()).toContain('Premier jet complet');
  const p = getPending(e.state)!;
  expect(e.state.doc.textBetween(p.from, p.to, '|')).toBe('Premier jet complet|Deux');
  // révision
  writeSuggestion(e, '<p>Version courte</p>');
  expect(e.getHTML()).toBe('<p>Avant</p><p>Version courte</p><p>Après</p>');
  rejectSuggestion(e);
  expect(e.getHTML()).toBe('<p>Avant</p><p></p><p>Après</p>');
  expect(getPending(e.state)).toBeNull();
});

test('accepter puis annuler en un coup', () => {
  const e = make();
  const empty = e.state.doc.child(0).nodeSize;
  beginSuggestion(e, empty, empty + 2, 'block');
  writeSuggestion(e, '<p>A</p>');
  writeSuggestion(e, '<p>AB</p><p>C</p>');
  acceptSuggestion(e);
  expect(e.getHTML()).toBe('<p>Avant</p><p>AB</p><p>C</p><p>Après</p>');
  e.commands.undo();
  expect(e.getHTML()).toBe('<p>Avant</p><p></p><p>Après</p>');
});

test('réécriture en ligne', () => {
  const e = new Editor({ extensions: [StarterKit, AiHighlight, AiSuggestion], content: '<p>Le chat dort ici.</p>' });
  // « chat dort » : positions 4..13
  beginSuggestion(e, 4, 13, 'inline');
  writeSuggestion(e, [{ type: 'text', text: 'chien court' }]);
  expect(e.getText()).toBe('Le chien court ici.');
  rejectSuggestion(e);
  expect(e.getText()).toBe('Le chat dort ici.');
  beginSuggestion(e, 4, 13, 'inline');
  writeSuggestion(e, [{ type: 'text', text: 'lion' }]);
  acceptSuggestion(e);
  expect(e.getText()).toBe('Le lion ici.');
});

test('plusieurs modifications, une par une ou toutes', async () => {
  const { acceptAll, findText, getPendings } = await import('../aiSuggestion');
  const e = new Editor({
    extensions: [StarterKit, AiHighlight, AiSuggestion],
    content: '<p>Il sont partis tôt.</p><p>Phrase inutile.</p><p>Le <strong>train</strong> était en retard.</p>',
  });
  // Faute corrigée dans une phrase
  const faute = findText(e.state.doc, 'Il sont')!;
  const a = beginSuggestion(e, faute.from, faute.to, 'inline');
  writeSuggestion(e, 'Ils sont', a);
  // Paragraphe entier supprimé (en suggestion : il reste visible jusqu'à l'acceptation)
  const inutile = findText(e.state.doc, 'Phrase inutile.')!;
  expect(inutile.wholeBlock).toBe(true);
  const b = beginSuggestion(e, inutile.block.from, inutile.block.to, 'delete');
  // Passage retrouvé malgré le gras (texte brut) et la syntaxe Markdown citée par l'IA
  const retard = findText(e.state.doc, 'Le **train** était en retard')!;
  const c = beginSuggestion(e, retard.from, retard.to, 'inline');
  writeSuggestion(e, 'Le train est arrivé à l’heure', c);

  expect(getPendings(e.state).map((p) => p.id)).toEqual([a, b, c]);
  expect(e.getText()).toContain('Phrase inutile.');

  rejectSuggestion(e, c);
  expect(e.getText()).toContain('était en retard');
  acceptAll(e);
  expect(e.getHTML()).toBe('<p>Ils sont partis tôt.</p><p>Le <strong>train</strong> était en retard.</p>');
  expect(getPendings(e.state)).toHaveLength(0);
});
