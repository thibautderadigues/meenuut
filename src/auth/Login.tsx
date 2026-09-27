import { useState, type FormEvent } from 'react';
import { supabase } from '../sync/supabase';

type LoginState =
  | { step: 'form'; error?: string }
  | { step: 'sending' }
  | { step: 'sent'; email: string; checking?: boolean; error?: string };

/** Connexion par e-mail (lien ou code) : pas de mot de passe, le compte est créé à la première connexion. */
export function Login({ onDevOffline }: { onDevOffline?: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [state, setState] = useState<LoginState>({ step: 'form' });

  // Le code marche partout, y compris dans l'app installée sur l'écran d'accueil,
  // où le lien s'ouvrirait dans le navigateur et non dans l'app.
  const onVerify = async (event: FormEvent, email: string) => {
    event.preventDefault();
    const token = code.replace(/\s/g, '');
    if (!token) return;
    setState({ step: 'sent', email, checking: true });
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    // En cas de succès, AuthGate prend le relais.
    if (error) {
      console.error(error);
      setState({ step: 'sent', email, error: 'Code incorrect ou expiré.' });
    }
  };

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
            Un e-mail a été envoyé à{' '}
            <strong className="font-medium text-ink">{state.email}</strong>. Cliquez sur le lien,
            ou saisissez le code qu’il contient :
          </p>
          <form onSubmit={(event) => void onVerify(event, state.email)} className="space-y-3">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              aria-label="Code reçu par e-mail"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="h-10 w-full rounded-md border border-rule-strong bg-canvas px-3 text-center font-mono text-base tracking-[0.3em] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
            />
            <button
              type="submit"
              disabled={state.checking}
              className="h-10 w-full rounded-md bg-ink text-sm font-medium text-canvas transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
            >
              {state.checking ? 'Vérification…' : 'Se connecter'}
            </button>
            {state.error && (
              <p role="alert" className="text-danger">
                {state.error}
              </p>
            )}
          </form>
          <button
            type="button"
            onClick={() => {
              setCode('');
              setState({ step: 'form' });
            }}
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
            className="h-10 w-full rounded-md border border-rule-strong bg-canvas px-3 text-base text-ink outline-none placeholder:text-ink-faint focus:border-accent sm:text-sm"
          />
          <button
            type="submit"
            disabled={state.step === 'sending'}
            className="h-10 w-full rounded-md bg-ink text-sm font-medium text-canvas transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          >
            {state.step === 'sending' ? 'Envoi…' : 'Recevoir un e-mail de connexion'}
          </button>
          {state.step === 'form' && state.error && (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          )}
        </form>
      )}
      {onDevOffline && (
        <button
          type="button"
          onClick={onDevOffline}
          className="mt-8 self-start rounded text-xs text-ink-faint underline underline-offset-2 hover:text-ink"
        >
          Continuer sans connexion (développement, sans synchro)
        </button>
      )}
    </main>
  );
}
