// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import.meta.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = window.matchMedia || ((() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as any);

/** Le panneau pour de vrai : un clic sur une suggestion doit envoyer la demande. */
test('clic sur une suggestion : la demande part', async () => {
  const errors: unknown[] = [];
  window.addEventListener('error', (e) => errors.push(e.error));
  const { Editor } = await import('@tiptap/react');
  const { createExtensions } = await import('../../editor/extensions');
  const { AssistantPanel } = await import('../AssistantPanel');
  const { openAssistant } = await import('../store');
  const editor = new Editor({
    extensions: createExtensions({ onTableOfContents: () => {}, onEditMath: () => {} }),
    content: '<h2>Titre</h2><p>Un paragraphe avec du contenu pour tester.</p>',
  });
  const host = document.createElement('div');
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(<AssistantPanel editor={editor} docId="d1" docTitle="Mon doc" />);
  });
  await act(async () => openAssistant());
  const buttons = [...host.querySelectorAll('button')].filter((b) => b.textContent === 'Résume ce document');
  expect(buttons).toHaveLength(1);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => {
    buttons[0]!.click();
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(errors).toEqual([]);
  // La demande apparaît dans la conversation (sans compte, l'IA répond de se connecter).
  expect(host.querySelector('ol')?.textContent).toContain('Résume ce document');
  expect(host.textContent).toContain('Connectez-vous');
});
