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

const { actionHint, stripChatter } = await import('../ai');

test.each([
  ['Crée un document de test', 'create'],
  ['Crée un peu un carnet de voyage pour l’Italie', 'create'],
  ['Fais-moi une fiche de révision', 'create'],
  ['corrige les directement dans mon document', 'edits'],
  ['Supprime la dernière phrase', 'edits'],
  ['Ajoute une conclusion', 'write'],
  ['Continue le texte', 'write'],
  ['Résume ce document', null],
  ['Pourquoi tu as mis ça ?', null],
  ['Écris-moi un paragraphe dans ce document', 'write'],
] as const)('indice pour « %s »', (prompt, expected) => expect(actionHint(prompt, true)).toBe(expected));

test('document renvoyé comme réponse', () => {
  expect(detectAction('# Carnet de voyage\n\nContenu', 'create')).toBe('create');
  expect(detectAction('# Carnet', null)).toBe('answer');
  expect(stripChatter('# Titre\n\nTexte.\n\nTu peux copier ce document et l’adapter dans Meenuut.')).toBe('# Titre\n\nTexte.');
});

test('modifications au format AVANT / APRÈS', () => {
  const parsed = parseEdits(`EDITS: Corrige une faute et ajoute une phrase.
<<<<<<< AVANT
Il sont partis tôt.
=======
Ils sont partis tôt.
>>>>>>> APRÈS
<<<<<<< AVANT
Phrase inutile.
=======
>>>>>>> APRÈS
<<<<<<< AVANT
Fin du voyage.
=======
Fin du voyage.

Et un nouveau paragraphe avec des "guillemets".
>>>>>>> APRÈS`);
  expect(parsed).toEqual({
    summary: 'Corrige une faute et ajoute une phrase.',
    edits: [
      { find: 'Il sont partis tôt.', replace: 'Ils sont partis tôt.' },
      { find: 'Phrase inutile.', replace: '' },
      { after: 'Fin du voyage.', insert: 'Et un nouveau paragraphe avec des "guillemets".' },
    ],
  });
});

const { unwrapFence } = await import('../ai');

test('document entouré de ```markdown', () => {
  expect(stripAction('CREATE:\n```markdown\n# Carnet\n\nTexte.\n```')).toBe('# Carnet\n\nTexte.');
  expect(stripAction('CREATE: ```md\n# Carnet\n\nEn cours')).toBe('# Carnet\n\nEn cours');
  expect(unwrapFence('```\n# Titre\n\n- a\n```\n')).toBe('# Titre\n\n- a');
  // Un vrai bloc de code reste un bloc de code.
  expect(unwrapFence('```python\nprint(1)\n```')).toBe('```python\nprint(1)\n```');
  expect(unwrapFence('# Titre\n\n```js\nx()\n```')).toBe('# Titre\n\n```js\nx()\n```');
});

test('document vide : toute demande de contenu s’y écrit', () => {
  expect(actionHint('Crée une fiche de révision sur la Révolution', true, true)).toBe('write');
  expect(actionHint('Un carnet de voyage pour Lisbonne', true, true)).toBe('write');
  expect(actionHint('Tu peux faire quoi ?', true, true)).toBeNull();
});

test.each(['rajoute un paragraphe', 'Ajouter une phrase de conclusion', 'Insère un tableau des prix', 'Complète la liste'])(
  'écriture : %s',
  (prompt) => expect(actionHint(prompt, true)).toBe('write'),
);

const { cleanWritten } = await import('../ai');

test('restes d’indications recopiés par le modèle', () => {
  expect(cleanWritten('e)\nPour les utilisateurs avancés…\n\n(fin du document)')).toBe('Pour les utilisateurs avancés…');
  expect(cleanWritten('(après le passage « Intro »)\nTexte.')).toBe('Texte.');
  expect(cleanWritten('Un texte (normal) reste intact.')).toBe('Un texte (normal) reste intact.');
});

const { modelLabel } = await import('../ai');

test('nom lisible du modèle', () => {
  expect(modelLabel('mistral-small-latest')).toBe('Mistral Small');
  expect(modelLabel('mistral-medium-latest')).toBe('Mistral Medium');
  expect(modelLabel('open-mistral-nemo')).toBe('Mistral Nemo');
});

const { isVagueWrite } = await import('../ai');

test.each([
  ['rajoute un paragraphe', true],
  ['Rajoute un paragraphe en bas stp', true],
  ['écris une section', true],
  ['ajoute un petit texte à la fin', true],
  ['rajoute un paragraphe sur la synchro', false],
  ['Écris une conclusion', false],
  ['ajoute un paragraphe qui résume le document', false],
] as const)('demande sans sujet : « %s » → %s', (prompt, expected) => expect(isVagueWrite(prompt)).toBe(expected));

test('présentation retirée du texte écrit', () => {
  expect(cleanWritten('Voici une extension des fonctionnalités :\n\nCollaborer…')).toBe('Collaborer…');
});
