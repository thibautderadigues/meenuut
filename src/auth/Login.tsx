import { useState, type FormEvent } from 'react';
import { supabase } from '../sync/supabase';

type LoginState =
  | { step: 'form'; error?: string }
  | { step: 'sending' }
  | { step: 'sent'; email: string };

/** Connexion par lien magique : pas de mot de passe, un compte est créé au premier lien. */
export function Login() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<LoginState>({ step: 'form' });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    setState({ step: 'sending' });
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    if (error) {
      setState({
        step: 'form',
        error:
          error.status === 429
            ? 'Trop de demandes. Réessayez dans quelques minutes.'
            : 'Impossible d’envoyer le lien. Vérifiez l’adresse et réessayez.',
      });
      console.error(error);
    } else {
      setState({ step: 'sent', email: address });
    }
  };

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center px-6 pb-[10vh] font-sans">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Meenuut</h1>

      {state.step === 'sent' ? (
        <div className="mt-6 animate-fade-in space-y-3 text-sm text-ink-muted">
          <p>
            Un lien de connexion a été envoyé à{' '}
            <strong className="font-medium text-ink">{state.email}</strong>.
          </p>
          <p>Ouvrez-le dans ce même navigateur pour accéder à vos documents.</p>
          <button
            type="button"
            onClick={() => setState({ step: 'form' })}
            className="rounded text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            Utiliser une autre adresse
          </button>
        </div>
      ) : (
        <form onSubmit={(event) => void onSubmit(event)} className="mt-6 space-y-3">
          <p className="text-sm text-ink-muted">
            Connectez-vous pour retrouver vos documents sur tous vos appareils.
          </p>
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="vous@exemple.fr"
            aria-label="Adresse e-mail"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-10 w-full rounded-md border border-rule-strong bg-canvas px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <button
            type="submit"
            disabled={state.step === 'sending'}
            className="h-10 w-full rounded-md bg-ink text-sm font-medium text-canvas transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          >
            {state.step === 'sending' ? 'Envoi…' : 'Recevoir un lien de connexion'}
          </button>
          {state.step === 'form' && state.error && (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          )}
        </form>
      )}
    </main>
  );
}
