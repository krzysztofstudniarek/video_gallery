import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { encryptionProbe, oauthProbe, syntheticFetch } from '../_shared/probes.ts';

const headers = { 'Access-Control-Allow-Origin': Deno.env.get('FRONTEND_ORIGIN') ?? 'http://127.0.0.1:5173', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers });
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  // getUser validates the JWT with Auth, including local legacy signing setups.
  // Never authorize using decoded-but-unverified claims or a publishable key.
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  try {
    const { data, error: readError } = await client.from('spike_items').select('id').limit(1);
    if (readError || !data) throw new Error('rls_read_failed');
    const outbound = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10000) });
    if (!outbound.ok) throw new Error('https_failed');
    await outbound.body?.cancel();
    return Response.json({ jwt_verified: true, postgres_read: true, https: true, aes_gcm: await encryptionProbe(), oauth_synthetic: await oauthProbe(syntheticFetch) }, { headers });
  } catch {
    return Response.json({ error: 'probe_failed' }, { status: 502, headers });
  }
});
