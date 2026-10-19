import { encryptionProbe, oauthProbe } from '../supabase/functions/_shared/probes.ts';

function assert(value: unknown): asserts value { if (!value) throw new Error('Assertion failed'); }
Deno.test('AES-GCM synthetic round trip', async () => assert(await encryptionProbe()));
Deno.test('refresh then resumable initiation always requests Unlisted', async () => {
  let calls = 0;
  const send: typeof fetch = async (_url, options) => {
    calls++;
    if (calls === 1) {
      assert(String(options?.body).includes('grant_type=refresh_token'));
      return Response.json({ access_token: 'synthetic' });
    }
    assert(new Headers(options?.headers).get('Authorization') === 'Bearer synthetic');
    assert(JSON.parse(String(options?.body)).status.privacyStatus === 'unlisted');
    return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/synthetic' } });
  };
  assert((await oauthProbe(send)).privacy === 'unlisted');
  assert(calls === 2);
});
Deno.test('revoked refresh prevents initiation', async () => {
  let calls = 0;
  try {
    await oauthProbe(async () => { calls++; return new Response(null, { status: 400 }); });
    throw new Error('Expected rejection');
  } catch (e) { assert(e instanceof Error && e.message === 'refresh_failed'); }
  assert(calls === 1);
});
Deno.test('reject insecure or unexpected upload Location', async () => {
  for (const location of ['http://www.googleapis.com/upload', 'https://example.com/upload']) {
    try {
      await oauthProbe(async (url) => String(url).includes('oauth2.') ? Response.json({ access_token: 'synthetic' }) : new Response(null, { headers: { Location: location } }));
      throw new Error('Expected rejection');
    } catch (e) { assert(e instanceof Error && e.message === 'invalid_session'); }
  }
});
