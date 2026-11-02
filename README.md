# StreamSense

An accessible chat companion for blind and low-vision Twitch streamers.

StreamSense helps blind and low-vision Twitch streamers follow busy chat through short, spoken summaries of repeated messages and common questions. It connects to the streamer's own channel through Twitch OAuth and EventSub. Demo Mode provides 28 labelled fictional inputs through the same processing code, using a separate queue and history. Speech reads completed summaries only after explicit enabling. Voice settings, optional keyboard shortcuts, summary timing, transcript and metrics remain under the streamer's control. No external AI or paid speech service is used.

The stack is React + TypeScript + Vite, Node.js + TypeScript + Express, Twitch OAuth/EventSub WebSocket, browser SpeechSynthesis, and Vitest/Testing Library. Milestone 5 adds integration checks and reliability fixes without adding dependencies or redesigning the app. Hosting preparation now supports a free Cloudflare Worker public address with one free Render Node backend, as selected by the owner. It is not production-hardened or certified accessible. See [DEPLOYMENT.md](DEPLOYMENT.md) for hosting setup and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for remaining release gates. No public service is claimed until account setup, deployment and live checks finish.

The user has confirmed actual Twitch message appearance and an increasing real-message count, plus a working Firefox dashboard with an audible enable announcement and generated demo summary. New automated integration tests use actual loopback HTTP and the real dashboard/processor but mock Twitch and audio. Those tests are separate evidence; actual spoken live summaries, native pause/resume, Narrator and the complete keyboard/zoom walkthrough remain manual checks.

## Requirements

- Windows PowerShell, Node.js 22.12 or newer, and npm. Verified development environment: Node 26.13.0, npm 11.20.0.
- Internet access to Twitch for login and EventSub, and to npm for initial installation.
- Your own Twitch account and a registered Twitch application for live chat. Credentials are not required to explore Demo Mode.
- Firefox (the user's preferred browser for final checks), or Chrome, with SpeechSynthesis and installed on-device voices for spoken summaries. The user verified the basic Firefox dashboard, enable announcement and demo summary audio. Voice availability and native pause/resume can differ by browser; remaining speech/screen-reader controls need manual testing.

## Twitch Developer Console settings

Open the [Twitch Developer Console](https://dev.twitch.tv/console/apps), select your application, and choose Manage. If creating a new application, use a unique name such as StreamSense and an appropriate application category. Twitch requires a verified email and two-factor authentication for developer registration.

Use these settings:

| Setting | Value |
| --- | --- |
| Application name | StreamSense, or a unique variant if already taken |
| OAuth Redirect URL | `http://localhost:3001/auth/twitch/callback` |
| Client type | Confidential, for this backend Authorization Code flow |
| Frontend address | `http://localhost:5173` (open this in your browser; do not register it as the callback) |
| Requested OAuth scope | `user:read:chat` (the app supplies this automatically) |

Save the redirect URL exactly, with no trailing slash. Copy the application's client ID and client secret into your local root `.env` only. Do not paste them into a chat, screenshot, README, frontend file, or Git. Generating a replacement secret invalidates the old secret, so use the currently active one.

This app reads the authenticated account's own channel: both `broadcaster_user_id` and `user_id` use that account's ID. It does not send messages, moderate chat, request write permissions, or use an app access token.

Official references: [application registration](https://dev.twitch.tv/docs/authentication/register-app/), [Authorization Code flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow), [chat permissions](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage), and [WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/).

## Local setup in Windows PowerShell

Enter each command separately. If PowerShell displays `>>`, press Ctrl+C and enter the commands again. `npm.cmd` avoids changing PowerShell's script execution policy.

```powershell
Set-Location 'C:\Users\Urvi Shah\Documents\Hackathon'
node --version
npm.cmd --version
npm.cmd ci
```

Create `.env` only if it does not already exist:

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
notepad.exe .env
```

Enter or check these values in that file:

```dotenv
PORT=3001
TWITCH_CLIENT_ID=your_actual_application_client_id
TWITCH_CLIENT_SECRET=your_actual_application_client_secret
TWITCH_REDIRECT_URI=http://localhost:3001/auth/twitch/callback
FRONTEND_URL=http://localhost:5173
```

Replace only the client ID and client secret placeholders. The local credentials previously entered into `.env.example` were preserved in an ignored `.env` during Milestone 2 setup; check that file rather than copying over it. `.env.example` contains safe placeholders again. Never share the contents of `.env`.

In local development, the backend loads `.env` from the project root. Changing `.env` requires restarting the backend. Production ignores this file and uses the hosting platform's environment settings. A legacy `SESSION_SECRET` entry is unused: sessions use unguessable opaque IDs with all associated data stored on the server. Do not use `VITE_` for secrets; Vite exposes variables with that prefix to browsers.

## Run the project

In a PowerShell window:

```powershell
Set-Location 'C:\Users\Urvi Shah\Documents\Hackathon'
npm.cmd run dev
```

This starts Vite on port 5173 and Express on port 3001. Open [http://localhost:5173](http://localhost:5173) in Firefox. Keep the terminal open. Ctrl+C stops both servers; if Windows asks `Terminate batch job (Y/N)?`, enter `Y`. Do not start a duplicate when the servers are already running. Editing backend source in watch mode can restart it and clear its in-memory Twitch sessions; reconnect afterwards.

Alternatively, in two separate PowerShell windows, each in the project folder:

```powershell
# Window 1
npm.cmd run dev:frontend
```

```powershell
# Window 2
npm.cmd run dev:backend
```

For local development, use **localhost consistently** for the browser, FRONTEND_URL, and registered callback. `localhost` and `127.0.0.1` use different cookie hosts. If Connect Twitch is clicked from 127.0.0.1, the backend first redirects to localhost to establish the correct cookie. Development servers bind to loopback. The production hosting configuration is described separately in DEPLOYMENT.md.

Vite proxies `/api` and `/auth` to `http://127.0.0.1:3001`. The auth proxy preserves the original Host header. Keep the documented ports; if changing them, update `.env`, the Vite proxy/port configuration, and the registered Twitch redirect together.

## Test with your Twitch account

1. Open `http://localhost:5173`. Confirm Backend online, Demo mode, and the six sample messages. If Connect Twitch is disabled, check the displayed missing-configuration explanation and restart after fixing `.env`.
2. Click **Connect Twitch**. Complete login and authorization on Twitch yourself. The app requests read-chat permission only. Never enter your Twitch password into StreamSense.
3. On returning to StreamSense, look for your username and **Connecting to EventSub**, followed by **Listening for chat**. The latter requires Twitch to confirm an enabled subscription. OAuth success alone is not shown as a live chat connection.
4. Sample messages disappear in Twitch chat mode. An empty feed is expected until a real message arrives. Summaries are generated only from actual messages received by this session; no sample inputs enter the real processor. Enable Speech explicitly to read newly generated summaries; existing history is not automatically played.
5. Open your channel's Twitch chat in another tab and manually send a distinctive message, such as `StreamSense live check 001`. This app does not send it for you. Verify that the exact text and sender appear in StreamSense and the real-message counter increases. The backend's session status reports `realChatReceived: true` only after receiving a valid notification.
6. Send repeated messages and questions, then wait for the default 20-second interval or choose **Generate summary now**. Verify the summary metrics and transcript against your actual inputs. Click **Disconnect Twitch** when finished: sockets, tokens, processing timers, queues and histories are cleared before returning to Demo Mode. Speech stops immediately when Disconnect is activated, even if the network request fails.
7. Repeat with keyboard navigation: Tab and Shift+Tab move focus; Enter or Space activates buttons. Test the skip link, interval select, and a Windows screen reader such as Narrator. Speech and screen-reader audio may overlap; no full accessibility-compliance claim is made.

A confirmed subscription with zero received messages is not proof that chat events are arriving. Record the real-message test separately from mocked automated results. Disconnecting locally does not revoke the app's grant in Twitch Connections; you can remove that grant in Twitch's own settings if desired.

## Try deterministic summaries in Demo Mode

No Twitch credentials or AI API key are needed. With the app running at `http://localhost:5173`:

1. Click **Load Demo Batch** from either the Twitch view or Demo Mode. No disconnect is required. When Twitch is authenticated, only the displayed view changes: the same account, cookie, socket, real queue and real history remain in place. Real messages continue to use the real processor in the background.
2. The batch contains **28 messages from 28 fictional viewers**, including repeated greetings and compliments, game questions, requests to explain a dodge/puzzle, map requests, ordinary conversation and unrelated tea/cat/weather messages. It arrives as one intentional busy-chat burst. Each visible message has a **DEMO** badge. The initial six-message preview remains separate and is not silently queued.
3. Choose **Generate summary now**, or pause summarisation first if you want time to inspect the pending batch. Manual generation works while scheduling is paused. For a fresh batch at the default settings, expect **28 processed messages, 12 question messages, 12 extra repeat occurrences across 6 repeated groups, and Busy activity**. The summary prioritizes game/explanation questions and repeated greetings; the open explanation area separately lists detected questions and repeated messages, including compliments. Generated text stays silent unless Enable Speech has been activated in this view.
4. Load another demo batch, then use **Clear pending messages**. Pending returns to zero while the chat feed and summary history remain. An already active batch may still finish.
5. Use **Clear summary history**. This clears the latest summary and transcript, without clearing pending inputs or the chat feed. A generation already in progress when history was cleared is not allowed to repopulate it.
6. Load a new batch, select an interval, then **Resume summarisation**. The default is 20 seconds; 5 seconds is available for quick checks. One timer processes a batch at a time. The dashboard shows the next batch time, pending count, processing count and paused/running state.

If Twitch is authenticated, choose **Return to Twitch chat** to restore its feed, queue, settings and transcript. Demo inputs/history remain in their separate processor and are never sent to Twitch. Pause, Generate and Clear affect only the currently displayed processor. Disconnect Twitch is still available as a separate deliberate action, but the demo loader never calls it. Repeated loads accumulate activity, so more than one batch in the activity window can show Very busy; the separate burst-increase flag still requires a real observed baseline window.

The **Why this summary?** disclosure shows representative original text, repetition counts and example senders. Repeated counts mean messages, not an invented number of viewers. The transcript is bounded, scrollable and keyboard focusable.

In a second PowerShell window, run a repeatable check against the running frontend/backend:

```powershell
Set-Location 'C:\Users\Urvi Shah\Documents\Hackathon'
npm.cmd run verify:demo
```

This creates a separate anonymous demo session, checks the 28-message metrics and Busy activity, pause/manual generation, queue/history clearing and a real five-second scheduled batch, then deletes its own session. It does not alter your browser's Twitch session or contact Twitch. A successful demo check does not verify real Twitch delivery.

## Processing rules and settings

- Comparison normalizes Unicode, case and whitespace, and ignores terminal punctuation. Question and statement forms are kept separate. Original readable text and representative sender names are retained.
- Near-duplicate question grouping uses explicit whole-question aliases for game, keyboard and map questions. It does not merge arbitrary messages because they share a word. Other similar phrasings can remain separate; there is no general language understanding.
- Question marks outside URLs, anchored question patterns and polite requests such as can you/could you identify candidate questions. Narrative text such as What a great game and This is how we play is not treated as a question. These explainable heuristics can still miss informal or non-English questions.
- Summaries prioritize up to two question groups and a repeated phrase, with useful activity information. They contain at most three generated sentences; quoted messages can themselves contain punctuation. There is no invented sentiment or inferred viewer intent. Unknown questions/phrases are quoted rather than interpreted.
- Unchanged question/repetition highlights are suppressed in consecutive batches. Empty queues produce no summary. Activity changes can still justify a new factual update, especially in busy chat. Counts and groups remain inspectable even when no duplicate transcript entry is added.
- Activity uses server receipt time in one-second buckets, separately from the number processed in a batch. The rolling activity window defaults to 20 seconds: Quiet is 0–4 messages, Normal is 5–14, Busy is 15–29, and Very busy is 30 or more. A burst requires two observed windows, Busy-level volume, at least double the previous window and at least five additional messages. No AI inference is involved.
- The pending queue plus active batch is capped at 500 messages by default. New arrivals go into the next queue before generation is awaited. A failed generation restores its accepted batch for retry. At capacity, new inputs are not queued and an explicit overflow count appears; the live chat feed and activity count still reflect received messages. Overflow is not silently called successful processing.
- History keeps the latest 20 generated summaries. Queue size, history length, ID deduplication and activity buckets are bounded. Disconnect/session expiry/server shutdown disposes processing resources; restarting the backend clears in-memory state and requires reconnecting Twitch.
- The browser continues to use the existing HTTP polling path and avoids replacing state when the response data is unchanged.

Optional root `.env` settings, with their defaults:

```dotenv
SUMMARY_INTERVAL_SECONDS=20
SUMMARY_MAX_QUEUE_SIZE=500
SUMMARY_MAX_HISTORY=20
SUMMARY_ACTIVITY_WINDOW_SECONDS=20
ACTIVITY_NORMAL_MIN=5
ACTIVITY_BUSY_MIN=15
ACTIVITY_VERY_BUSY_MIN=30
```

Existing `.env` files need no changes to use these defaults. Intervals are whole seconds from 5 to 300; the activity window is 5 to 300 seconds; queue size is 10 to 5000; history size is 1 to 100. Activity thresholds must be positive, increasing integers. Invalid environment settings fail at backend startup with an explanation. The dashboard's interval control changes only the current mode/session; environment changes require a restart. Do not overwrite your existing credential values when adding settings.

Generated summaries now feed the dedicated speech service described below. The fixed handwritten sample-audio path has been replaced; the six initial chat preview messages are still never silently queued or spoken.

## Spoken summaries and accessibility (Milestone 4)

Speech starts **off on every page load**. **Enable Speech** provides a short test announcement, then reads new, nonempty completed summaries from the displayed demo or Twitch processor. It does not read chat rows or replay earlier history. **Repeat Last Summary** explicitly reads the latest completed summary, including one generated before speech was enabled. Demo labels remain visible; the service does not prefix each summary with “demo”.

- **Disable Speech** cancels current audio, clears waiting audio, and disables automatic speech.
- **Pause Speech / Resume Speech** control audio independently of Pause/Resume summarisation. Summary processing continues while audio is paused.
- **Stop Speaking** immediately cancels current/waiting audio and keeps automatic speech off until **Enable Speech** is activated again. Stop works while speech is paused or between summaries too.
- New summaries do not interrupt current speech. Only the newest waiting summary is kept; older waiting items are replaced. Identical summary IDs/generation times and consecutive equivalent text are suppressed; deliberate Repeat bypasses automatic deduplication.
- Switching demo/Twitch views or accounts stops speech and requires explicit enabling again. Only the displayed view is eligible for speech. Loading a demo batch still preserves the Twitch account/socket and its independent real processor. Disconnect stops speech before its network request; leaving, refreshing or unmounting the page also cancels audio.
- Voice, rate (0.5–2), pitch (0–2) and volume (0–1) apply to the next utterance without interrupting current speech. Defaults are 1 for rate/pitch/volume and an available local default voice. Only these four preferences are saved in browser localStorage. Chat, summaries, tokens and enabled state are never saved there. Blocked/malformed storage falls back safely.
- Voices can appear later through `voiceschanged`. To satisfy the requirement against external speech services, only voices reported by the browser as `localService: true` are listed and explicitly selected. Remote/default fallback speech is not used. No installed local voice means helpful feedback and no audio; install an appropriate Windows speech voice, then retry. See [MDN's localService explanation](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService). The app relies on the browser reporting this property correctly.

Keyboard shortcuts are **optional and off each load**. Activate **Enable optional keyboard shortcuts** to use:

| Shortcut | Action |
| --- | --- |
| Alt + S | Enable/disable speech |
| Alt + P | Pause/resume speech |
| Alt + R | Repeat last completed summary |
| Alt + M | Stop speaking and automatic speech |

Shortcuts ignore text fields, ranges, checkboxes, selects and editable content; held-key repeats, additional modifiers, AltGraph and already-handled events are ignored. Browser, Windows, keyboard layout and assistive technology assignments vary, so universal conflict freedom cannot be guaranteed. Leave shortcuts off if they conflict. All controls remain native labelled elements usable with Tab/Shift+Tab and Enter/Space; ranges support arrow keys. No screen reader is detected or disabled.

The existing skip link, headings, visible focus outline and responsive layout remain. Status text does not rely on colour alone. Raw chat, summary transcript and frequently changing queue counts are not live announcements. Connection/backend/speech status regions are polite while speech is off, and their live announcements are quiet while it is enabled to reduce overlapping voices. Errors remain available as alerts. This is an intentional tradeoff: read the visible status manually while speech is enabled. Actual screen-reader behaviour, contrast across states and zoom usability still need human review; no full accessibility compliance is claimed.

### Manual Windows / Firefox and Chrome checklist — partially verified

Start the app with the PowerShell commands above, then open `http://localhost:5173` in Firefox first, as requested. Also test Chrome before describing it as supported. Run the checklist separately for each browser and record differences:

User-confirmed on 2 November 2026: Firefox dashboard works; the enable announcement and generated demo summary are audible. This is human-reported evidence, not agent-observed output. The other checks below remain open; record browser version, voice and findings as you perform them.

1. Reload and confirm silence and **Speech disabled**, including after a previous enabled session. Click **Enable Speech** and confirm the short announcement is actually audible. Check Windows output/mixer and installed local voices if not; automation cannot listen for you.
2. In Demo Mode, **Load Demo Batch**, then **Generate summary now** (or wait for the batching interval). Confirm the generated summary is read after the test announcement, matching the displayed summary. Confirm DEMO labels and that individual chat messages are not read.
3. During a long summary, **Pause Speech**, wait, and **Resume Speech**. Confirm it continues audibly. Confirm summary generation still runs independently. Use **Repeat Last Summary** to hear the latest summary again.
4. **Stop Speaking** mid-sentence. Generate more summaries: they must stay silent until **Enable Speech**. Repeat with **Disable Speech**. Try stopping while paused and re-enabling; audio should work again.
5. Change the on-device voice and rate, pitch and volume; use Repeat to hear each change. Test volume zero and restore it. Reload: preferences should remain but speech must be off. Check no-voice feedback if your browser has no local voices.
6. While one summary speaks or audio is paused, generate several distinct summaries. Resume/finish: hear only the newest waiting summary, with no stale backlog. Repeated polling of one summary must not replay it.
7. Use only the keyboard: skip link, logical Tab/Shift+Tab order, buttons with Enter/Space, voice select and arrow-key sliders, summary controls and scrollable chat/transcript. Enable optional shortcuts, move focus out of settings, try all four, and confirm they do not intercept typing/settings. Disable them if your browser or assistive technology uses those keys.
8. Start **Windows Narrator** with Ctrl+Windows+Enter. First test with app speech off: verify headings, labels, values, focus and connection/speech status changes. Then enable app speech; assess audio overlap and quiet live regions. Stop app speech immediately if it competes with Narrator. Confirm no incoming-message announcement flood. Turn Narrator off with the same Windows shortcut when finished.
9. Test 200% and 400% browser zoom and a narrow window: all controls/text must remain reachable, readable and visibly focused. Inspect contrast in normal, hover, disabled, focus, error and high-contrast states. Record problems rather than assuming compliance.
10. With Twitch authenticated, verify an actual chat message arrives, then generate a real-source summary and listen. While speaking, **Disconnect Twitch**: audio must stop immediately, with no waiting audio afterwards. Switching demo/Twitch views must also stop audio without disconnecting the preserved account. Re-enable in the new view as needed. Navigate away/reload and confirm no old audio continues.

Record browser/version, selected voice, output device, audible results, Narrator/keyboard/zoom findings and any conflicts. Browser drivers can differ in voice loading, error events and native pause/resume timing. If speech gets stuck, Stop, check status and Enable again. Mocked tests verify our control logic, not actual Windows sound or usability for blind streamers.

## Automated and HTTP checks

With both apps running, use a second PowerShell window:

```powershell
Set-Location 'C:\Users\Urvi Shah\Documents\Hackathon'
Invoke-RestMethod -Uri 'http://localhost:3001/api/health'
Invoke-RestMethod -Uri 'http://localhost:5173/api/health'
Invoke-RestMethod -Uri 'http://localhost:3001/health'
```

Each returns `status: ok`. A PowerShell request has no browser session cookie, so its connection flags reflect an unauthenticated session even when your browser is signed in.

Run all checks from the project root:

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```

Run checks sequentially on a smaller laptop to avoid competing build/test workloads. The HTTP/UI integration scenarios allow 15 seconds each; individual API requests still have their normal application deadlines. Vitest runs at most two workers. All **228 tests across 15 files** passed after hosting preparation. The suite includes a 10,000-input capacity test; this is not an eight-GB Windows performance certification.

Additional release checks:

```powershell
npm.cmd run test:integration
npm.cmd run verify:security
npm.cmd run verify:deployment
npm.cmd audit --omit=dev --audit-level=high
```

`test:integration` starts isolated local HTTP servers on temporary ports, exercises the real React/Express/summary path, and mocks Twitch and audio. It requires neither real credentials nor the development servers. It covers credential-free demo summaries and speech controls, mocked OAuth/EventSub with demo/live isolation, and disconnect during an active batch. Its own servers/sessions are cleaned up. `verify:demo` separately checks the running app's backend/proxy using its own anonymous session.

`verify:security` compares locally configured credential values against source, docs and build files, prints no credential values, and checks example/ignore rules. It does not prove that unknown secrets or Git history are clean. The production-only npm audit reported zero vulnerabilities on this review; advisory data can change, and development dependencies are outside that command's scope.

Or run each workspace check explicitly:

```powershell
npm.cmd run typecheck -w frontend
npm.cmd run typecheck -w backend
npm.cmd run build -w frontend
npm.cmd run build -w backend
npm.cmd test
```

The root Vitest command runs both frontend and backend tests. Tests never load local `.env` credentials or require a Twitch account. Coverage includes the previous OAuth/EventSub controls, normalization, grouping, questions, activity and bursts, summaries, batching and timing, arrivals during generation, failure recovery, capacity limits, pause/resume, clearing, deduplication, demo/real processing isolation, disconnect cleanup, transcript rendering and generated-summary speech, voice/settings handling, duplicate and backlog prevention, optional shortcuts, disconnect/navigation/unmount cleanup. Mocked tests do not verify live Twitch.

Build outputs are `frontend/dist` and `backend/dist`. To run the compiled backend, stop the development copy first, then run:

```powershell
npm.cmd run start:backend
```

For a public browser URL, follow [DEPLOYMENT.md](DEPLOYMENT.md). With `NODE_ENV=production`, `npm start` serves the built frontend and API together and requires a public HTTPS origin. `render.yaml` prepares the free single-instance backend; `wrangler.jsonc` and `backend/src/cloudflare.ts` prepare the free Cloudflare proxy. Set its actual backend URL and set Render's FRONTEND_URL to the actual Worker origin before public OAuth testing. The files contain no credentials and do not mean a public service has been created or verified.

## Architecture and development-session strategy

- React keeps the existing semantic dashboard, dark styles, focus indicators, skip link, native buttons, and labelled interval select.
- The frontend polls `/api/twitch/status` roughly once per second, reusing the foundation's HTTP approach. It returns safe connection state, the latest 100 normalized chat messages and the active mode's summary snapshot. `/api/summaries/control` handles protected summary actions using the same Origin/custom-header strategy as Disconnect. Anonymous Demo Mode uses a scoped server session too. No credentials or tokens are returned, and there is no new browser WebSocket or Socket.IO dependency.
- Express owns OAuth, token exchange/validation, refresh, and the EventSub socket. Node's built-in WebSocket handles protocol ping/pong. No new npm dependencies were needed.
- OAuth state has 32 cryptographically random bytes, expires after 10 minutes, is bound to the server session, and is consumed once. Session IDs rotate after login.
- The browser stores only an opaque, random session ID in an HttpOnly, SameSite=Lax, host-only cookie. `Secure` is false for the documented local HTTP configuration and enabled for an HTTPS callback configuration. This server does not provide TLS or production hosting.
- Sessions and tokens live in memory for at most 8 hours; restarting the backend logs everyone out. The local store is capped at 50 sessions. Signing in again for the same Twitch account stops its older local session.
- Disconnect requires the exact configured frontend Origin and a custom request header. Cross-origin reads are not enabled. Cookies and frontend/backend URLs must use the same hostname.
- Tokens are validated on login and at least hourly (the maintenance loop checks every minute, with validation due after 55 minutes). Expired tokens and HTTP 401 responses trigger serialized refresh and revalidation. Invalid refresh/validation ends the local authenticated session.
- EventSub subscribes after welcome, confirms the enabled subscription before reporting Listening for chat, tracks keepalive deadlines, deduplicates both notification and chat IDs, and handles revocation. Twitch-directed reconnects keep the original socket until the replacement welcomes and do not resubscribe. Dropped connections use a fresh session/subscription and bounded exponential retries.
- At most 500 EventSub frames per socket may wait behind asynchronous processing, including a slow subscription request. Overflow closes the socket with an explicit reconnect/missing-messages warning. Envelope/chat IDs and frame sizes are bounded too. This protects memory rather than silently claiming that overloaded chat was processed; Twitch cannot replay the gap.
- Chat is untrusted text. It is rendered as text, never HTML, executable instructions, or an AI prompt. No incoming message is spoken automatically.
- Chat history is not durable. The latest 100 messages and a rolling deduplication set are bounded in memory; the total counter counts accepted unique notifications for the local connection. More than 100 arrivals between polls can exceed the displayed history window. Twitch does not replay messages missed during a dropped connection.

This in-memory session design is for a single-machine hackathon MVP, **not production**. Deployment requires a durable session/token strategy, HTTPS, origin/proxy review, and operational hardening.

## Source layout

```text
backend/src/
  app.ts             HTTP routes and session orchestration
  server.ts          Root .env loading and local server lifecycle
  config.ts          Required environment and local URL validation
  sessions.ts        Opaque sessions, one-use OAuth state and cleanup
  twitch-api.ts      User-token OAuth, validation, refresh and subscription API
  eventsub.ts        EventSub lifecycle, reconnects and deduplication
  chat.ts            Safe normalized chat format
  processing.ts      Normalization, questions, grouping, activity and pure summary rules
  batcher.ts         Bounded queues, timers, pause/resume and summary history
  demo.ts            28 fictional DEMO inputs for the isolated preview processor
  *.test.ts          Mocked Twitch tests and actual local HTTP route tests
  testing.ts         Synthetic fixtures, excluded from production builds
frontend/src/
  App.tsx            Existing dashboard with honest Twitch/demo states
  useTwitch.ts       HTTP polling and connect/disconnect actions
  SummaryPanel.tsx   Text summary, metadata, controls and transcript
  summaryTypes.ts    Summary response contract and safe runtime validation
  speechService.ts   One active utterance plus latest pending summary; device voices
  useSpeech.ts       React lifecycle, safe preferences and opt-in shortcuts
  SpeechPanel.tsx    Labelled speech buttons, settings and shortcut reference
  speechService.test.tsx / useSpeech.test.tsx   Mocked speech and lifecycle tests
  sampleData.ts      Clearly labelled handwritten sample fixtures
  styles.css         Existing responsive dark design
  App.test.tsx       Frontend and speech-control tests
```

## Troubleshooting

- **ENOENT / package.json not found:** run `Set-Location 'C:\Users\Urvi Shah\Documents\Hackathon'` before `npm.cmd run dev`. Do not combine both commands on one line without valid PowerShell syntax.
- **Missing configuration:** edit the root `.env`, leave `.env.example` safe, then restart the backend. Placeholder values are intentionally rejected.
- **Invalid state / login expired:** start again with Connect Twitch from localhost, use the same browser, allow local cookies, and complete login within 10 minutes. Backend restarts invalidate the login attempt.
- **Redirect mismatch:** register `http://localhost:3001/auth/twitch/callback` exactly. Check the active client ID belongs to that application.
- **Login or refresh rejected:** confirm your local client secret is current and the client type supports Authorization Code flow. Disconnect and reconnect if permission was revoked.
- **Authenticated but chat not listening:** check the displayed error, internet connection, and Twitch read-chat permission. This milestone listens to the signed-in user's own channel. Use Disconnect and Connect to retry after a terminal error.
- **Port already in use:** stop the old copy with Ctrl+C before launching another one.
- **Network reset during installation:** check the network and retry `npm.cmd ci`.
- **No generated summary:** load a demo batch or receive real Twitch messages first. Check whether scheduling is paused, use Generate summary now, and inspect pending/overflow/error notices. Repeated unchanged highlights can be suppressed. For audio, explicitly Enable Speech; empty or unchanged batches do not produce new speech.
- **Summary controls fail:** open `http://localhost:5173`, allow local cookies, and confirm the backend is running. State-changing requests require the configured frontend Origin. Read error messages and reload after a server restart.
- **Chat received too many messages:** the socket's waiting-frame safety limit was reached. Reconnect manually and check the displayed state. Some events may be missing; the app does not fabricate a replay. Keep other heavy local workloads low and record recurring overload as a reliability issue.
- **An old open page shows a hook-order or refresh error after development edits:** restart the apps and press Ctrl+Shift+R in Chrome. The dashboard now requests a fresh page on development updates, and the fresh Strict Mode mount is tested. Temporary proxy errors while the backend restarts do not indicate a successful or failed Twitch connection.
- **Speech unavailable / silent:** click Enable Speech and read its status. Wait for local voices to load, check Windows speech settings, selected voice, volume, Windows mixer and output device. Remote-only browser voices are deliberately excluded. After Stop, an error, disconnect or mode change, enable speech again. Use Repeat Last Summary to retest existing text. Browser pause/resume timing can vary; use Stop and Enable if it gets stuck.
- **Verification runner:** the restricted Codex runner has previously blocked tsx's Windows user lookup; the same development command worked outside that runner. The browser-control tool was unavailable for the latest milestone, so its new visual/manual checks remain pending.

## Release status and submission preparation

The Milestone 5 code and automated checks are complete; manual acceptance and submission preparation remain open. The user confirmed real Twitch message/counter delivery and basic Firefox demo audio. Verify an actual live-source summary and its audio, remaining Firefox speech controls, Windows Narrator, keyboard navigation and 200% zoom using the checklist above before marking those gates verified.

Security review found server-side tokens, one-use session-bound OAuth state, HttpOnly SameSite cookies, protected mutations, text-only chat rendering and preference-only localStorage. Configured credential values were not found in scanned source/docs/build files; `.env.example` remains placeholders. Local HTTP intentionally lacks Secure cookies and development binds to loopback. Prepared production mode uses public HTTPS origins, Secure cookies and the host's public-facing bind/port. This is not an exhaustive security audit. Durable session/token storage and further operational hardening remain outside the preview scope. Do not expose the development servers publicly; use DEPLOYMENT.md's production configuration.

The project has a local Git repository on `main`, connected through `origin` to [StreamSense on GitHub](https://github.com/urvishapatel1511/StreamSense). The user authorized the initial local commit on this branch. The last read-only remote check returned no branches or tags; GitHub upload remains a separate approval step. Git confirms that `.env`, node_modules and frontend/backend build outputs are ignored. Review staged/tracked files before each commit; never include credentials, logs, node_modules or generated output. Follow [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for repository access, the short demo video, project description, Codex session ID and current official Devpost requirements. Recheck the [official overview](https://twitchcon-codex.devpost.com/) and [rules](https://twitchcon-codex.devpost.com/rules) before submitting. Do not include credentials or private chat in recordings.

See BUILD_STATUS.md for exact commands, results, failures and fixes. No new feature milestone has started.
