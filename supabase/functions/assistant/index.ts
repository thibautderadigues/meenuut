// Fonction Supabase « assistant » : relaie les questions du panneau vers Mistral.
// La clé Mistral reste ici (secret MISTRAL_API_KEY), jamais dans le navigateur.
// Seuls les utilisateurs connectés à Meenuut peuvent l'appeler.

const MODELS: Record<string, string> = {
  // Retouches rapides (reformuler, corriger…) : petit modèle, rapide et économe.
  quick: 'mistral-small-latest',
  // Questions, rédaction de documents.
  chat: 'mistral-medium-latest',
};

const MAX_MESSAGES = 40;
const MAX_CHARS = 200_000;
const MAX_TOKENS = 2000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method' });

  // Vérifie la session auprès de Supabase, quel que soit le réglage « Verify JWT ».
  const authorization = req.headers.get('Authorization') ?? '';
  const user = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    // La clé publishable envoyée par l'app (publique) suffit pour interroger l'auth.
    headers: {
      Authorization: authorization,
      apikey: req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    },
  });
  if (!user.ok) return json(401, { error: 'unauthorized' });

  const apiKey = Deno.env.get('MISTRAL_API_KEY');
  if (!apiKey) return json(500, { error: 'missing_key' });

  let body: { messages?: ChatMessage[]; mode?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  const messages = body.messages;
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > MAX_MESSAGES ||
    messages.some(
      (m) => !['system', 'user', 'assistant'].includes(m?.role) || typeof m?.content !== 'string',
    ) ||
    messages.reduce((sum, m) => sum + m.content.length, 0) > MAX_CHARS
  ) {
    return json(400, { error: 'invalid_messages' });
  }

  const upstream = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS[body.mode ?? 'chat'] ?? MODELS.chat,
      messages,
      stream: true,
      max_tokens: MAX_TOKENS,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    console.error('Mistral', upstream.status, detail);
    return json(upstream.status === 429 ? 429 : 502, { error: 'upstream', status: upstream.status });
  }

  // Flux SSE de Mistral renvoyé tel quel au navigateur.
  return new Response(upstream.body, {
    headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
});
