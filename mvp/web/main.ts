import { createClient } from '@supabase/supabase-js';

const connection = document.querySelector('#connection')!;
fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/health`)
  .then(async response => {
    const data = await response.json();
    if (!response.ok || data.status !== 'ok' || data.application !== 'videoalbum') throw new Error('health');
    connection.textContent = 'Supabase backend connected';
  })
  .catch(() => { connection.textContent = 'Backend unavailable; check deployment configuration.'; });

const client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: true },
});
const output = document.querySelector('output')!;
document.querySelector('#signin')!.addEventListener('click', async () => {
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: new URL(import.meta.env.BASE_URL, location.origin).href } });
  if (error) output.textContent = 'Google sign-in failed; check provider configuration.';
});
document.querySelector('#signout')!.addEventListener('click', async () => {
  await client.auth.signOut();
  output.textContent = 'Signed out';
});
document.querySelector('#probe')!.addEventListener('click', async () => {
  const { data, error } = await client.functions.invoke('compatibility', { body: {} });
  output.textContent = error ? 'Probe failed; check sign-in and local runtime.' : JSON.stringify(data);
});
