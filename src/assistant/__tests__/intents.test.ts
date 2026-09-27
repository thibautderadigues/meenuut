import { expect, test } from 'vitest';

// ai.ts crée le client Supabase à l'import : variables d'environnement factices.
import.meta.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test';
const { detectAction, parseEdits, parseQuestions, REWRITE_PATTERN, stripAction } = await import('../ai');

/** Forme de la réponse choisie par l'IA, reconnue dès les premiers caractères. */
test('action choisie par l’IA', () => {
  expect(detectAction('EDI')).toBeNull();
  expect(detectAction('EDITS: {"edits":[]}')).toBe('edits');
  expect(detectAction('  **WRITE:** Un paragraphe')).toBe('write');
  expect(detectAction('CREATE:\n# Lisbonne')).toBe('create');
  expect(detectAction('QUESTION: {')).toBe('question');
  expect(detectAction('Voici la réponse')).toBe('answer');
  expect(detectAction('C')).toBeNull();
  expect(stripAction('**WRITE:** Un paragraphe')).toBe('Un paragraphe');
  expect(stripAction('CREATE:\n# Lisbonne')).toBe('# Lisbonne');
});

test('modifications proposées', () => {
  const parsed = parseEdits(
    '```json\n{"summary":"Corrige deux fautes","edits":[{"find":"Il sont","replace":"Ils sont"},{"find":"phrase inutile.","replace":""},{"after":"Fin.","insert":"Un ajout."},{"oups":1}]}\n```',
  );
  expect(parsed).toEqual({
    summary: 'Corrige deux fautes',
    edits: [
      { find: 'Il sont', replace: 'Ils sont' },
      { find: 'phrase inutile.', replace: '' },
      { after: 'Fin.', insert: 'Un ajout.' },
    ],
  });
  expect(parseEdits('pas de json')).toBeNull();
});

test('questions à choix', () => {
  const parsed = parseQuestions(
    ' {"questions":[{"question":"Quel ton ?","options":["Sérieux","Drôle"],"multiple":false},{"question":"Pour qui ?","options":["Moi","Mon équipe"],"multiple":true}]}',
  );
  expect(parsed).toEqual([
    { question: 'Quel ton ?', options: ['Sérieux', 'Drôle'], multiple: false },
    { question: 'Pour qui ?', options: ['Moi', 'Mon équipe'], multiple: true },
  ]);
  expect(parseQuestions('Sur quel sujet ?')).toBeNull();
  expect(parseQuestions('{"questions": [oups')).toBeNull();
});

test.each(['Reformule ce passage', 'Raccourcis-le', 'Corrige les fautes', 'Traduis en anglais'])(
  'réécriture d’un extrait : %s',
  (prompt) => expect(REWRITE_PATTERN.test(prompt)).toBe(true),
);
