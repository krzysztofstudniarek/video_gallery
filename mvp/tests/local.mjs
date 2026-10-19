// Local-only integration; credentials are captured in memory, never printed.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const config = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] }));
const url = config.API_URL;
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local stack only');
const admin = createClient(url, config.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const users = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
try {
  const health = await fetch(`${url}/functions/v1/health`);
  assert(health.ok && (await health.json()).application === 'videoalbum', 'Public health failed');
  const clients = [];
  for (let i = 0; i < 2; i++) {
    const email = `spike-${randomUUID()}@example.test`, password = randomUUID();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert(!error && data.user, 'Synthetic user creation failed');
    users.push(data.user.id);
    const client = createClient(url, config.ANON_KEY, { auth: { persistSession: false } });
    assert(!(await client.auth.signInWithPassword({ email, password })).error, 'Sign-in failed');
    clients.push(client);
  }
  const { data: row, error } = await clients[0].from('spike_items').insert({ caption: 'synthetic', video_id: 'synthetic01', sharing_enabled: true }).select().single();
  assert(!error && row, 'Owner insert failed');
  const other = await clients[1].from('spike_items').select('id');
  assert(!other.error && other.data.length === 0, 'Cross-user read leaked');
  const spoof = await clients[1].from('spike_items').insert({ owner_id: users[0], caption: 'forged', video_id: 'synthetic02' });
  assert(spoof.error, 'Forged ownership accepted');
  const anon = createClient(url, config.ANON_KEY, { auth: { persistSession: false } });
  assert((await anon.from('spike_items').select('id')).error, 'Anonymous table read allowed');
  const session = (await clients[0].auth.getSession()).data.session;
  const call = (token) => fetch(`${url}/functions/v1/compatibility`, { method: 'POST', headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${token}` } });
  assert((await call('invalid')).status === 401, 'Invalid JWT accepted');
  const timings = [];
  for (let i = 0; i < 6; i++) {
    const start = performance.now();
    const response = await call(session.access_token);
    const result = await response.json();
    assert(response.ok && result.jwt_verified && result.aes_gcm && result.https && result.oauth_synthetic.privacy === 'unlisted', 'Edge probe failed');
    timings.push(Math.round(performance.now() - start));
  }
  const share = () => fetch(`${url}/functions/v1/share?token=${row.share_token}`, { redirect: 'manual' });
  assert((await share()).status === 302, 'Enabled share did not resolve');
  assert(!(await clients[0].from('spike_items').update({ sharing_enabled: false }).eq('id', row.id)).error, 'Disable failed');
  assert((await share()).status === 404, 'Disabled share resolved');
  console.log(JSON.stringify({ local_integration: 'passed', users: 2, first_request_ms: timings[0], warm_samples_ms: timings.slice(1) }));
} finally {
  for (const id of users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error('Synthetic user cleanup failed');
  }
}
