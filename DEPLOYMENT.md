# StreamSense public demo deployment

Selected target: a **free Cloudflare Worker public address + one free Render Node service**. The Worker forwards requests; Render runs the existing Express, Twitch EventSub and summary code. The browser uses one Cloudflare HTTPS origin for the dashboard, API and Twitch callback. `render.yaml` and `wrangler.jsonc` contain configuration, not credentials. No paid Containers, paid Workers plan or purchased domain is required. Free-plan quotas and sleep limits apply. This is a hackathon preview; sessions/tokens/history remain in memory and are cleared on backend restarts. It is not a production-hardened or highly available service.

## Assigned service addresses

- Public dashboard: **https://streamsense.streamsense.workers.dev**
- Render backend: **https://streamsense-bgqp.onrender.com**
- Twitch callback: **https://streamsense.streamsense.workers.dev/auth/twitch/callback**

Cloudflare deployment succeeded and its proxied health endpoint returned HTTP 200. Render's dashboard/health and an isolated 28-message demo/scheduler check passed. Render's final frontend/callback settings and Twitch's registered callback must be confirmed before the full public login/control flow is accepted. Browser rendering, native audio and real Twitch delivery on this hosted origin remain separate manual checks.

## What is prepared

- Root `npm start` starts the compiled Express backend.
- `npm run build` builds React and the backend; Express serves `frontend/dist` in production.
- Production binds to `0.0.0.0` and uses the host's `PORT`. Development remains on loopback with its existing Vite proxy.
- Render supplies `RENDER_EXTERNAL_URL`. For the selected Cloudflare setup, set `FRONTEND_URL` on Render to the actual deployed Worker HTTPS origin. The callback is derived from that public origin. Leaving it unset temporarily supports direct Render Demo Mode during initial setup. Public port 443 is independent of the internal service port.
- Production configuration requires HTTPS, a single origin, no URL credentials/query/fragment and the exact callback path. Invalid production URLs stop startup with a safe explanation.
- Secure/HttpOnly/SameSite=Lax cookies also apply to public anonymous Demo Mode. Origin checks use the public origin; no permissive CORS or forwarded-host trust was added.
- Production serves only built frontend files, with CSP/security headers. Missing API/auth/assets and private files return errors rather than fake dashboard success pages. Missing frontend build stops startup.
- Production reads platform environment settings, never the local root `.env` file. Local development still reads `.env`.
- The small Worker preserves request paths, query, cookies, Origin and response cookies/status. OAuth redirects are returned to the browser, never followed server-side with the session cookie. Responses are not cached. The Render hostname supplied by the platform is accepted as the actual proxy backend Host; client-supplied forwarded-host headers are not trusted.

## Account steps needed from the owner

1. Create free accounts at [Cloudflare](https://dash.cloudflare.com/sign-up) and [Render](https://dashboard.render.com/register). Complete account/GitHub authorization yourself; do not share passwords, login codes or API tokens in chat. Render can be connected through its app for assistant-managed deployment; the manual steps below also work.
2. Enter the existing **TWITCH_CLIENT_ID** and **TWITCH_CLIENT_SECRET** directly in Render's private environment settings when needed. Never put actual credentials in GitHub, render.yaml or this chat. The template uses `sync: false` to request private values during Blueprint creation.
3. After the Worker receives its public URL, set that origin in Render's FRONTEND_URL and add its callback URL in the Twitch Developer Console. The callback is the Cloudflare public origin followed by `/auth/twitch/callback`, with no trailing slash. Keep the existing localhost callback too if continuing local development.
4. Authorize Twitch yourself in the deployed dashboard, then verify actual messages, summary generation and audio. Report the public URL and any error text without credentials.

No paid plan is authorized. If Render asks for an upgrade/payment, stop and review that separately. The free option has idle/suspension/usage limits; do not assume an always-on production service.

## Render backend setup

Use the source repository `https://github.com/urvishapatel1511/StreamSense` after the prepared `main` branch is pushed.

Preferred: **New → Blueprint**, select the repository/main branch and use the root `render.yaml`. Confirm the service plan is **Free**, then provide the two Twitch settings privately. If testing without Twitch credentials, placeholder values starting with `replace_` leave the dashboard in Demo Mode; replace them privately before testing OAuth.

For **New → Web Service**, use:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Branch | main |
| Root directory | Leave empty (repository root) |
| Plan | Free |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check | `/api/health` |
| NODE_ENV | `production` |
| NODE_VERSION | `26.13.0` (the locally tested runtime) |
| TWITCH_CLIENT_ID | Enter your real ID privately |
| TWITCH_CLIENT_SECRET | Enter your real secret privately |
| Auto deploy | Off; deploy reviewed changes manually |

Do **not** copy the local `PORT=3001`, `FRONTEND_URL=http://localhost:5173`, or local callback into Render. Let Render supply PORT and RENDER_EXTERNAL_URL, then set FRONTEND_URL to the actual Worker origin as described next. Do not upload `.env`. Keep a single instance while the session store is in memory.

## Cloudflare free Worker setup

1. On the new Cloudflare account, select the Workers **Free** plan and create its free workers.dev subdomain. A custom domain is optional, not needed for this deployment.
2. Copy the Render service's actual HTTPS URL into `BACKEND_ORIGIN` in root `wrangler.jsonc`. The placeholder deliberately returns a configuration error until replaced. This value is a public service address, not a secret.
3. Log into Cloudflare locally and deploy the Worker. These commands use pinned Wrangler without adding it to the application runtime. Complete any browser authorization yourself. Local `.env` loading is explicitly disabled so Twitch settings cannot accidentally become Worker development bindings.

```powershell
Set-Location 'C:\Users\Urvi Shah\Documents\Hackathon'
$env:CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
$env:WRANGLER_SEND_METRICS = 'false'
npm.cmd exec --yes --package=wrangler@4.156.1 -- wrangler login --browser=false --scopes account:read user:read workers:write workers_scripts:write
npm.cmd exec --yes --package=wrangler@4.156.1 -- wrangler deploy
```

Open the login link printed by Wrangler in Firefox and authorize it yourself; do not share the returned code or login token. Do not run deploy until the backend URL is set and the account is confirmed Free. Wrangler returns the actual Worker URL; do not invent or guess it. The Worker requires only BACKEND_ORIGIN, with no Twitch secret or Cloudflare API token stored in source.

4. In Render, set `FRONTEND_URL` to the Worker URL's origin (no extra path). Remove any local or direct-Render TWITCH_REDIRECT_URI override so it derives the Worker callback, or explicitly set the exact Worker callback. Redeploy/restart Render for these changes.
5. Register the Worker callback in Twitch. Open the Worker URL in Firefox and follow the acceptance checks below. Use that URL consistently for all dashboard actions. Direct Render access is not the configured browser origin after the switch and can fail protected controls.

For a local packaging-only check with no account login, resource creation or deployment:

```powershell
npm.cmd exec --yes --package=wrangler@4.156.1 -- wrangler deploy --dry-run --outdir .wrangler/dry-run
```

Wrangler output and local development-secret files are ignored by Git. Cloudflare Workers Free currently has 100,000 requests/day shared across the account; one-second dashboard polling counts toward this limit. Avoid unnecessary duplicate tabs and verify current quotas before a public demo. Quota exhaustion can interrupt service; no paid upgrade is authorized.

For a custom domain, set `FRONTEND_URL=https://your-owned-domain` and, optionally, `TWITCH_REDIRECT_URI=https://your-owned-domain/auth/twitch/callback`. These must share the exact origin. Register that callback in Twitch and use that same domain consistently for browser visits; cookie hosts differ between the custom domain and onrender.com.

## Verify before creating the service

In Windows PowerShell, enter each command separately:

```powershell
Set-Location 'C:\Users\Urvi Shah\Documents\Hackathon'
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run verify:deployment
npm.cmd run verify:security
```

To exercise the live public demo pipeline using an isolated session after Render's public-origin settings are active:

```powershell
$env:STREAMSENSE_VERIFY_URL = 'https://streamsense.streamsense.workers.dev'
npm.cmd run verify:demo
Remove-Item Env:\STREAMSENSE_VERIFY_URL
```

Without STREAMSENSE_VERIFY_URL, verify:demo continues to target the local frontend. The hosted target must use HTTPS. The verifier does not log into Twitch or use your browser's session; it removes its own temporary session afterwards.

`verify:deployment` starts and stops its own temporary compiled production server with **no credentials**. It verifies the actual built HTML/JavaScript, API, 28-message demo analysis, Secure cookie flags, public Origin checks and private/missing-file errors. Local HTTP simulates a TLS reverse proxy; this is not evidence of a public HTTPS deployment, live Twitch delivery, browser rendering or audible speech.

## Verify the actual public service

1. Wait for both deployments and the Render FRONTEND_URL update. Open the actual Cloudflare Worker HTTPS URL in Firefox. Confirm the dashboard and Backend online, with explicit Demo Mode until connected.
2. Open `<public-origin>/api/health`: it should return `status: ok`. Confirm no cookie/origin/proxy errors in normal controls.
3. Load Demo Batch → Generate summary now. Check 28 inputs, 12 questions, 12 repeat occurrences and Busy activity for a fresh batch. Enable Speech and confirm an audible announcement/summary, then test Stop.
4. Register `<public-origin>/auth/twitch/callback` in Twitch, then Connect Twitch and complete authorization yourself. Confirm Listening for chat, send a distinctive message in your own channel, and match its text/counter in StreamSense.
5. Send repeated questions; verify a real-source summary, transcript and explicitly enabled speech. Demo preview must preserve the Twitch account/socket while keeping inputs separate.
6. Check disconnect, native audio controls, keyboard-only navigation, Narrator and 200% zoom on this actual URL. Prior local or mocked results do not verify the hosted service.

## Limits and troubleshooting

- Free Render services can spin down after 15 idle minutes and take roughly a minute to wake; usage limits can also suspend a service. In-memory sessions/tokens/history disappear on restart or redeploy. Reconnect Twitch afterwards. Browser polling while the dashboard is open normally supplies inbound traffic; this is not an uptime guarantee.
- One process only: independent instances would have different session stores. Existing caps remain: 50 server sessions, 100 displayed messages per feed, 500 queued/active processing messages by default, 20 summaries, and 500 waiting EventSub frames per socket. This preview is not designed for unrestricted high-volume public traffic.
- Build fails: confirm repository root, the Node version, and inclusion of development dependencies during the build. The host needs TypeScript/Vite to build, even though runtime uses production mode.
- Missing frontend files: run the full root build before npm start, not only the backend build.
- Production URL error: remove local URL overrides and use Render's automatically supplied origin, or set one valid HTTPS custom origin/callback pair.
- Redirect loop or protected controls fail through Cloudflare: Worker BACKEND_ORIGIN must be the real Render origin; Render FRONTEND_URL/callback must be the real Worker origin. Keep RENDER_EXTERNAL_URL intact so the backend recognizes the platform Host without trusting forwarded headers.
- Twitch redirect mismatch: copy the actual assigned callback exactly into the console. Do not guess the service URL. Changing/creating a Twitch secret can invalidate the old one; no new secret is needed solely to add a callback.
- Secure-cookie/login loop: use HTTPS and one hostname consistently; allow site cookies. Do not disable cookie security to work around a hosting configuration problem.
- Health works but dashboard fails: inspect Render build/runtime logs and the failed asset request; do not post credentials or raw authorization URLs in chat.
- No sound: read the speech status and confirm an installed on-device voice in Firefox. Hosting does not supply speaker output or Windows voices.

References: [Cloudflare proxy pattern](https://developers.cloudflare.com/workers/examples/respond-with-another-site/), [Workers free limits](https://developers.cloudflare.com/workers/platform/limits/), [Wrangler secret-file handling](https://developers.cloudflare.com/workers/local-development/environment-variables/), [Render Node deployment](https://render.com/docs/deploy-node-express-app), [web services and port binding](https://render.com/docs/web-services), [automatic environment variables](https://render.com/docs/environment-variables), [Blueprint secret settings](https://render.com/docs/blueprint-spec), [free-service limitations](https://render.com/docs/free), and [Twitch app registration](https://dev.twitch.tv/docs/authentication/register-app/).
