# YouTube consent and direct-upload compatibility probe

This is a staging-only validation tool for issue #1, not the production upload
workflow in #15. Google sign-in remains unchanged. YouTube is connected separately
by an already signed-in user, with upload and readonly scopes. Readonly is needed
to confirm the selected channel and the uploaded video's processing/privacy.

## Google setup

1. Keep YouTube Data API v3 enabled in your selected Google staging project.
2. Under Google Auth Platform → Data Access include both scopes:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
3. Under Audience keep staging in Testing and add your test account.
4. Create a **separate Web application OAuth client** named VideoAlbum YouTube
   staging. Do not overwrite the working Supabase sign-in client. Its JavaScript
   origin is `https://krzysztofstudniarek.github.io`. Its authorized redirect URI
   is exactly:

   ```text
   https://krzysztofstudniarek.github.io/video_gallery/?youtube_callback=1
   ```

   The callback is the frontend, which immediately removes the code/state from
   the address bar and submits them with the existing Supabase user JWT to the
   backend. It must not use the Supabase Auth `/auth/v1/callback` URL: that URL
   belongs to sign-in. The marker prevents the Supabase SDK from trying to
   exchange a YouTube code as a Supabase login code.

## Supabase secrets (backend only)

Under your project → Edge Functions → Secrets add:

| Name | Value |
| --- | --- |
| `YOUTUBE_CLIENT_ID` | The new web client ID |
| `YOUTUBE_CLIENT_SECRET` | The new web client secret |
| `YOUTUBE_REDIRECT_URI` | The exact callback URL above |
| `YOUTUBE_TOKEN_KEY_B64` | A privately generated base64 encoding of 32 random bytes |

Generate the encryption key on your own machine, then save it privately:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Never send these secrets in chat/issues, put them in VITE_* variables or commit
them. Retain the key in a password manager: replacing it makes existing encrypted
credentials and sessions unreadable. This spike has a versioned v1 envelope but
does not implement key rotation; migrate/re-encrypt before any future rotation.
Local tests use synthetic values, never the real client secret/key.

Deploy the reviewed change through the existing manual staging workflow. It adds
the private-schema migration and `youtube` function. Existing FRONTEND_ORIGIN
remains the frontend origin without its path. Auth URL settings are unchanged.
The workflow does not copy YouTube secrets from GitHub or overwrite them.

## Live staging sequence (requires your explicit browser consent)

1. Sign in to VideoAlbum and click **Connect YouTube**. Grant both permissions,
   choosing the intended test channel. Canceling is safe and starts no upload.
2. Confirm the displayed channel name/ID. If it is wrong, disconnect before
   connecting another channel. A channel change cannot reuse an old upload job.
3. Click **Test server-side token refresh**. Only a boolean result is shown;
   refresh/access tokens never reach the browser.
4. Choose a tiny synthetic MP4 (1–10 MiB), confirm Unlisted and the destination
   channel, and answer the required made-for-kids question accurately.
5. Click **Start one Unlisted test upload**. Metadata initiation occurs in the
   Edge Function; the browser PUTs the video bytes directly to Google's returned
   session in 256 KiB chunks. Supabase receives no video bytes and uses no video
   storage bucket.
6. Test pause/resume. Select the exact original file after a reload. Size and
   SHA-256 must match; the browser queries the existing session's accepted offset.
   If CORS/preflight or exposed Range headers fail, record the browser and the
   sanitised error and stop. This is an unresolved feasibility result, not a
   reason to fall back to proxying/storage or start duplicate videos.
7. After transfer completes, click **Check processing and Unlisted status**.
   Repeat manually at reasonable intervals if processing is still in progress.
   The backend checks the connected channel and per-job description marker.
   Private/Public fails verification; no privacy fallback or automatic conversion.
8. Verify anonymous playback yourself from the video's YouTube Studio sharing
   link in a signed-out browser. Do not paste that link or a screenshot of it into
   a public issue. Remove test videos in Studio afterward if desired.

One private upload reservation per user prevents parallel/repeated initiation.
An uncertain initiation failure retains the reservation. **Clear probe record**
is an explicit reset after checking Studio; it does not cancel the remote session
or delete a video. Completed sessions can be queried through Resume to recover
the video ID after reload. No video IDs, media names or session URLs are stored
in browser storage. Session URLs are capabilities delivered only to the verified
owner; treat them as credentials and do not capture them in public evidence.

**Disconnect** revokes the Google grant, then deletes encrypted credentials,
state and probe rows. It never deletes YouTube videos. A failed revocation retains
the record for retry. Revoking Google access can affect other grants under the
same Google project; a separate OAuth client alone is not a guarantee of grant
isolation. Use a separate Google Cloud project if that isolation is required.
Account deletion cascades local records; complete provider-revocation/account
deletion workflows remain separate MVP work.

## Security and limitations

- Backend verifies the Supabase JWT for every action. Owner IDs come solely from
  that identity; anonymous/authenticated callers cannot execute the private RPCs.
- Consent state is random, stored hashed, owner-bound, expires after 10 minutes,
  and consumed atomically once. OAuth uses PKCE S256 and offline access.
- Refresh tokens/session URLs use AES-256-GCM with random nonces and owner/purpose
  additional authenticated data. Only ciphertext is stored in the private schema.
- No provider error bodies, OAuth codes, tokens, URLs or media are logged by our
  function. Browser callback codes necessarily traverse the frontend host; review
  host/platform access-log retention separately before public launch. HTML uses
  no-referrer and query values are removed promptly.
- Quota/rate limiting, periodic processing polling, robust cancellation, token-key
  rotation, account deletion/revocation and production upload idempotency remain
  feature work. Do not launch this probe as the upload product.
- OAuth testing-mode grants can expire; reconnect when refresh is rejected. Do
  not interpret reconsent in Testing as proven durable production access.

## Evidence

The prior staging Google sign-in and authenticated compatibility probe were
confirmed by the owner on 2026-10-19; sign-out rejection was also confirmed.
Real YouTube consent, refresh, CORS/range handling, resume, processing and Unlisted
playback for this new code are **not yet verified**. Synthetic tests are the
precondition for those owner-authorized live checks, not a substitute for them.

2026-10-20 local validation: 5 deployment configuration tests and 14 Deno tests
passed, including synthetic consent/refresh/initiation and browser-transport
state-machine tests. All 21 pgTAP tests passed against the local database.
Two-user local Auth/Edge integration passed, including denied direct token RPCs
and anonymous consent, plus the authenticated YouTube status path without live
Google credentials. Type checks and the Pages base-path build passed. Browser
transport tests use synthetic responses; they do not establish real Google CORS.

References:
- [Google server-side OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [YouTube authorization](https://developers.google.com/youtube/data/guides/auth/server-side-web-apps)
- [Resumable protocol](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol)
- [Channel confirmation](https://developers.google.com/youtube/data/reference/rest/v3/channels/list)
