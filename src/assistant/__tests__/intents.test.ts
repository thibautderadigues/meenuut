import { expect, test } from 'vitest';

// ai.ts crée le client Supabase à l'import : variables d'environnement factices.
import.meta.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test';
const { CREATE_PATTERN, REWRITE_PATTERN, WRITE_PATTERN } = await import('../ai');

/** Reconnaissance de ce que la personne demande : créer, écrire, réécrire. */
test.each([
  'Crée un document de test',
  'Crée un peu un document de test stp',
  'crée-moi vite fait un doc sur Lisbonne',
  'Fais-moi une fiche de révision',
  'Écris-moi un document sur mes vacances',
  'Rédige une page de présentation',
  'Nouveau document : budget du mois',
  'Crée une note avec mes idées',
])('crée : %s', (prompt) => expect(CREATE_PATTERN.test(prompt)).toBe(true));

test.each([
  'Ajoute une note à la fin',
  'Résume ce document',
  'Écris un paragraphe sur les voyages',
  'Quels sont les points clés du document ?',
  'Écris une conclusion pour le document ouvert',
])('ne crée pas : %s', (prompt) => expect(CREATE_PATTERN.test(prompt)).toBe(false));

test.each(['Écris-moi un paragraphe démo', 'Ajoute une conclusion', 'rédige une intro', 'Fais-moi une liste de courses'])(
  'écrit : %s',
  (prompt) => expect(WRITE_PATTERN.test(prompt)).toBe(true),
);

test.each(['Reformule ce passage', 'Raccourcis-le', 'Corrige les fautes', 'Traduis en anglais'])(
  'réécrit : %s',
  (prompt) => expect(REWRITE_PATTERN.test(prompt)).toBe(true),
);

const { parseQuestions } = await import('../ai');

test('questions à choix de l’IA', () => {
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
