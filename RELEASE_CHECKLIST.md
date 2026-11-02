# StreamSense release checklist

Reviewed 2 November 2026 (Asia/Calcutta). Status words mean **Verified**, **Not verified**, or **Not applicable**. Automated evidence, user-reported evidence and agent observation are distinguished below. “Verified” applies to the stated check only, not the whole product. Nothing has been committed, published or submitted.

Release decision: **hold final release/submission approval** until the remaining manual acceptance checks and judging repository/video materials are ready. No known build/type-check/test failure remains. This is a local MVP; it is not production-hosted or certified accessible.

## Automated checks and integration

| Check | Status | Evidence / next action |
| --- | --- | --- |
| Installed direct dependencies | Verified | `npm.cmd ls --depth=0` exit 0; no new dependency added |
| Frontend and backend type-check | Verified | `npm.cmd run typecheck` exit 0 for both workspaces, including tests |
| Frontend and backend production builds | Verified | `npm.cmd run build` exit 0; frontend bundle generated and backend compiled |
| All unit and integration tests | Verified | `npm.cmd test`: 190 tests in 13 files; 110 backend and 80 frontend |
| Credential-free demo → questions/repeats/activity → speech controls | Verified | Real local HTTP + actual React/Express/processor; Twitch/audio mocked in `release.integration.test.tsx` |
| Mocked OAuth/EventSub → real processing/UI → speech and disconnect | Verified | Same integration suite, including duplicate events and preserved demo/live sessions; not a live Twitch test |
| Disconnect during an active batch | Verified | Integration test cancels client request, disposes server processor and rejects late history/UI/audio |
| Auth failure, token expiry/refresh/rejection, dropped sockets/reconnect | Verified | Mocked unit/HTTP tests in app, twitch-api and eventsub suites |
| Unsupported speech, no voices, errors, disable during speech, refresh/unmount | Verified | Mock speech/service/lifecycle tests; stale callbacks and optional shortcut cleanup covered |
| In-flight arrivals, overflow/history limits and 10,000-input capacity | Verified | Batcher tests: default 500 accepted / 9,500 reported overflow, history capped at 20; timer disposal checked |
| Slow-subscription EventSub frame backlog | Verified | 500 waiting-frame cap per socket; explicit error/socket close on overflow, late frames cannot revive the stopped client |
| Running backend/proxy demo check | Verified | `npm.cmd run verify:demo` uses a separate anonymous session and real five-second scheduling; session cleaned up |
| Unchanged polling avoids replacing identical dashboard state | Verified | Hook regression test checks object identity; not a browser performance benchmark |
| Whole application measured on an 8 GB Windows laptop under sustained Twitch load | Not verified | Bounded data and two test workers reduce resource pressure; perform a representative manual load run and record RAM/CPU |

## Manual Twitch and audio acceptance

| Check | Status | Evidence / next action |
| --- | --- | --- |
| Real OAuth and enabled chat subscription | Verified | User previously authorized and reported Listening for chat |
| Actual Twitch message and increasing real-message count | Verified | User explicitly confirmed both during Milestone 5 |
| Live questions/repetitions → correct real-source summary/transcript | Not verified | Send distinctive repeated questions in own channel; compare actual received inputs and summary |
| Actual live summary spoken | Not verified | Enable speech in Twitch mode and listen to a newly generated live summary |
| Firefox dashboard opens | Verified | User reported “Dashboard works and both announcements are audible” |
| Firefox enable test announcement and demo summary audible | Verified | Same user report after Enable Speech → Load Demo Batch → Generate summary now |
| Native Pause/Resume/Repeat, Stop/Disable and silence afterwards | Not verified | Listen while activating each; summaries after Stop must remain silent until Enable |
| Voice/rate/pitch/volume, async loading and no-voice feedback on device | Not verified | Change settings, repeat, reload and confirm preferences with speech initially off |
| No raw-message speech, no duplicate or stale backlog on device | Not verified | Compare audible output with incoming rows and several generated summaries |
| Actual disconnect/navigation/reload stops audio | Not verified | Test with active/paused audio; no old audio should continue |
| Chrome release walkthrough | Not verified | Historical M1 checks predate current UI; current computer-use session ended before navigation because URL confidence was insufficient |

Record browser/version, local voice and output device with each new result. User reports are accepted as human evidence; automated mock tests do not establish real audio.

## Accessibility acceptance

| Check | Status | Evidence / next action |
| --- | --- | --- |
| Semantic controls, labels, headings, skip link and focus styles in source | Verified | Source review and DOM control/label tests; meaningful states have text |
| Raw chat/transcript do not flood live regions | Verified | Source/DOM checks; frequently changing queue counts are plain text |
| Current UI keyboard-only order/activation and optional shortcuts | Not verified | Firefox: Tab/Shift+Tab, Enter/Space, select/range keys and shortcut opt-in; check conflicts and editable fields |
| Visible focus throughout complete walkthrough | Not verified | Inspect every enabled control and scroll area in Firefox |
| 200% browser zoom and narrow-window reflow | Not verified | Reach/read every control without clipping; also try 400% for low-vision use |
| Complete rendered contrast, including focus/error/disabled/high-contrast states | Not verified | Static palette review alone is insufficient; inspect final rendered states |
| Windows Narrator with speech off and on | Not verified | Follow README manual checklist; assess labels, values, state announcements and audio overlap |
| Automatic Narrator changes | Not applicable | The app neither detects nor disables the user's screen reader; agent did not change Narrator |
| Full accessibility compliance | Not verified | Requires proper review and user testing; no compliance claim is made |

## Security and Git

| Check | Status | Evidence / next action |
| --- | --- | --- |
| Configured credentials absent from scanned source/docs/builds | Verified | `npm.cmd run verify:security`; exact local-value scan only, no values printed |
| Safe `.env.example` and `.gitignore` rules | Verified | Placeholder client settings; `.env`, `.env.*`, node_modules and dist rules inspected |
| Tokens remain on backend; browser storage contains only speech preferences | Verified | Source review plus safe-status and preference tests; no access/refresh token browser storage |
| One-use session-bound OAuth state, cookie rotation and protected mutations | Verified | Source and mocked HTTP tests; HttpOnly/SameSite cookies; exact Origin/custom-header checks |
| Incoming chat validation and text-only rendering | Verified | Length/source/channel validation; untrusted chat is React text, not HTML/code/instructions |
| Application logs do not intentionally log secrets/chat | Verified | Logging sites reviewed; startup/service errors only; not an audit of all external Windows/npm logs |
| Production dependency advisory check | Verified | `npm.cmd audit --omit=dev --audit-level=high`: zero vulnerabilities reported; rerun before release |
| Unknown-secret/exhaustive security audit | Not verified | Local-value scan cannot detect every unknown credential or vulnerability |
| Local Git repository and origin connection | Verified | Project root resolves; origin is `https://github.com/urvishapatel1511/StreamSense.git`; successful remote check returned no branches/tags |
| Initial local commit approval and main branch | Verified | User explicitly authorized a commit on `main`; local branch renamed from the unborn `master` |
| Credential/generated-file exclusion by Git | Verified | `git check-ignore` confirms `.env`, node_modules and frontend/backend dist directories are ignored; verify staged/tracked content before committing |
| Published judging code and reviewer access | Not verified | Origin is connected; the initial local commit is authorized, but GitHub upload still requires separate approval and reviewer-access verification |
| Public deployment / production HTTPS/session-store hardening | Not applicable | This release targets local loopback execution; do not expose development servers publicly |

## Demo video and Devpost preparation

Official sources checked: [overview](https://twitchcon-codex.devpost.com/) and [rules](https://twitchcon-codex.devpost.com/rules). Recheck the live form before submission. This table tracks requirements, not legal eligibility certification.

| Check | Status | Evidence / next action |
| --- | --- | --- |
| Submission requirements reviewed | Verified | Twitch-connected project built with Codex; accessible code repository; description of features and Codex use; main Codex session ID; public YouTube demo shorter than three minutes showing Twitch functionality and Codex development |
| Deadline checked | Verified | Official rules state 2 November 2026, 2:00 pm Pacific Time (3 November, 3:30 am IST); confirm the live deadline before submitting |
| Participant eligibility, rights and build-period compliance | Not verified | User must review official rules and confirm personal/team eligibility, ownership, permissions and build dates |
| Code repository with source/assets/setup and reviewer access | Not verified | GitHub repository URL supplied and connected; remote currently advertises no refs. Source has not been uploaded. Confirm reviewer access under the official form/rules after approval |
| Main Codex session ID recorded for the form | Not verified | Obtain the actual ID for the thread containing most work; do not invent it |
| Accurate project description explaining Codex use | Not verified | Describe rule-based summaries honestly; do not claim semantic AI or certified accessibility |
| Demo recording prepared and reviewed for private data | Not verified | Show real Twitch arrival → summary → speech/stop, labelled demo fallback and Codex contribution; hide credentials/private chat and avoid unlicensed music |
| Public YouTube demo shorter than three minutes | Not verified | Record/review first; upload only after explicit user approval |
| Judging access remains available through judging period | Not verified | Test installation from a clean checkout and follow repository/access requirements |
| Final submission approval and completed Devpost entry | Not verified | User approval required; nothing submitted or published by the agent |

The README contains exact Windows setup/run commands and the detailed manual checklist. BUILD_STATUS.md records executed commands, initial failures, fixes and evidence limits.
