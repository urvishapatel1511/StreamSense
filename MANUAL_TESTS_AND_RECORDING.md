# StreamSense: remaining tests and screen recording

App: https://streamsense.streamsense.workers.dev

The hosted login, actual message/counter and generated summary audio were already confirmed by the owner. Automated mocks cannot establish native playback or accessibility. The current Windows Firefox automation tool refused operation because browser URL policy enforcement is unsupported, so the agent did not perform the manual checks below or record live browser footage. The initial screenshot attempt timed out; the accessibility-only retry returned the policy stop. No alternate browser automation was used to bypass it.

## How to run the remaining checks

Use Firefox and a comfortable output volume. Record Pass, Fail or Not tested for each check; an attractive UI or a button state is not proof of audible behaviour. Stop if something fails and note the exact action, visible error, browser version and voice, without credentials.

### 1. A repeatable starting point

1. Open the app, note your Twitch username/connection state, then choose **Load Demo Batch**. The real account should remain connected in the background.
2. Choose **Pause summarisation** so the timer does not race your inspection. Clear pending messages and summary history, then load one new batch.
3. Confirm 28 pending DEMO inputs and individual DEMO labels. Activity is a rolling count: prior loads can keep it elevated even after clearing the queue. For fresh Busy activity, wait at least 20 seconds after earlier loads before loading the single test batch.
4. Choose Generate summary now. For a fresh batch, expect 28 processed, 12 question messages and 12 extra repeat occurrences across 6 repeated groups. Inspect detected questions, repeated messages and transcript. General paraphrases are not universally understood: grouping uses conservative rules.

### 2. Speech controls — listen, do not rely on the badge

1. **Enable Speech:** hear the short test announcement. **Repeat Last Summary:** hear the displayed generated summary.
2. During a long utterance, choose **Pause Speech**. Confirm audible speech pauses; wait a few seconds. **Resume Speech** should continue. If the utterance finishes too quickly, reduce rate and repeat before pausing.
3. **Stop Speaking** mid-sentence. Load/generate another batch: it must remain silent until Enable Speech. If generation is suppressed as unchanged, clear history and generate a new batch before testing this silence requirement.
4. Enable again, repeat and choose **Disable Speech** mid-sentence. Current and waiting audio must stop; later summaries stay silent.
5. Summarisation pause and speech pause are separate. With scheduling paused, manual generation should work. With only speech paused, summary text/history may continue updating.
6. While speech is paused, generate several different useful summaries. Resume and confirm only the newest waiting summary follows the current utterance, with no stale backlog. Repeated polling of one entry must not replay it.
7. Watch/listen as chat arrives: individual rows must not automatically be spoken. You can still read them manually using your screen reader.

### 3. Voice preferences

1. Change the on-device voice, rate, pitch and volume one at a time. Repeat the latest summary after each change. New settings apply to the next utterance, not the one already speaking.
2. Test volume zero and restore it. Confirm Stop is still reachable while muted or paused.
3. Reload. Preferences should remain but speech must be off. No previous summary should autoplay.
4. If no on-device voices exist, expect a helpful message and no remote-voice fallback. Install a suitable Windows voice if desired; do not assume every browser exposes the same voices.

### 4. Keyboard and shortcuts

1. Start without the mouse. Tab to the skip link, press Enter, then navigate with Tab/Shift+Tab. Confirm visible focus and a logical order through connection, chat, summary controls, transcript and speech controls.
2. Activate buttons with Enter/Space. Operate selects and sliders with their normal keyboard keys. Scroll the focusable chat/transcript lists.
3. Turn on optional shortcuts, then move focus out of settings: Alt+S toggles speech, Alt+P pauses/resumes, Alt+R repeats and Alt+M stops.
4. Confirm shortcuts do not intercept input/select/range/checkbox/editable controls. Test in your keyboard layout and with assistive technology. Leave shortcuts off if your browser or screen reader uses the same keys.

### 5. Zoom and readable states

1. Use Firefox's menu to set **200% zoom**. Reach every control without text clipping or lost focus. Also try a narrow window and 400% zoom if practical.
2. Inspect ordinary text, errors, disabled controls and focus outlines. Important states must have text, not colour alone. Note any low-contrast or hard-to-read state; source colours alone do not certify rendered contrast.
3. Restore your preferred zoom when finished.

### 6. Windows Narrator — owner performs this

1. With app speech off, start Narrator yourself using Ctrl+Windows+Enter. Read headings, buttons, labels, slider values, connection changes and speech status.
2. Confirm incoming chat/queue updates do not cause a constant announcement stream.
3. Enable app speech and judge whether the voices compete. Use Stop Speaking immediately if needed. Routine live announcements are intentionally quiet while app speech is enabled; statuses remain manually readable.
4. Stop Narrator yourself when done. The agent does not toggle Narrator or claim accessibility compliance.

### 7. Real-source grouping and cleanup

1. Return to Twitch chat and confirm the same account remains connected. Manually send questions such as “What game is this?” and “Which game are you playing?” plus a repeated harmless greeting. Respect Twitch's duplicate/spam rules and use different phrasings/participants where needed.
2. Match actual received messages, groups, counts and transcript. Do not expect a message that Twitch rejected to appear. General semantic understanding and sentiment analysis are not implemented.
3. Enable speech, generate or repeat a real summary, then navigate/reload and confirm no old audio continues.
4. Test Disconnect **last**, while audio is active or paused. Audio must stop immediately; no pending summary should speak later. Reconnect yourself afterwards. Reloads and server restarts can require reauthorization because sessions live in memory.

## Recording tool: start with Xbox Game Bar

1. Focus Firefox on the product page. Press **Windows+G** yourself to open Game Bar if available. Use Windows+Alt+R to start/stop a short recording.
2. Make a 10-second test. Play a summary, stop recording and listen to the saved file. Clips normally save to **Videos → Captures** as MP4.
3. Include system/app audio in the recording. Enable the microphone only if narrating yourself; complete any OS permission prompt yourself.
4. Game Bar records an app rather than a complete multi-app story. Record the Firefox product and the safe Codex view as separate clips; they can be combined later. If Game Bar is unavailable or cannot capture the app, use OBS below.

Microsoft guide: https://support.microsoft.com/en-us/accessibility/windows/use-a-screen-reader-to-record-your-screen-with-xbox-game-bar

## OBS fallback

Download only from https://obsproject.com/ if needed. Its Auto-Configuration Wizard can optimise for recording. Choose a **Window Capture** source for Firefox, confirm desktop audio meters move when a summary plays, make a short test recording and play it back. Start with 1280×720 at 30 fps on a modest laptop. Avoid full-desktop capture unless you have checked everything visible. Record Codex in a separate safe window/clip. Native recording software must be installed/operated by the owner when computer use is unavailable.

OBS guide: https://obsproject.com/kb/quick-start-guide

## Footage to record (no fake Twitch events)

1. **Real Twitch, 35–50 seconds:** start already authenticated on the public app so passwords/callback codes are not filmed. Manually send a harmless game question in your channel. Show its arrival/TWITCH label/counter, Generate summary now, enable/repeat audio and Stop. If summarisation happens automatically first, use Repeat Last Summary. The actual product voice should be audible.
2. **Labelled demo, 30–40 seconds:** Load Demo Batch; show 28 DEMO rows, question/repetition metrics and transcript; briefly show speech settings and keyboard focus. Switching to demo should preserve the Twitch account.
3. **Codex contribution, 15–25 seconds:** you manually record a safe project prompt, relevant code change or actual passing test result. Do not record this entire chat: it can include personal details and service authorization links. No `.env`, token, authorization code or secret-manager screen should be visible.

Record only clips you own and have permission to share. Avoid private/unrelated chat and unlicensed music. Keep original clips unedited; give the saved file paths to the assistant for trimming/captioning/assembly. Do not upload publicly until you review the final video and explicitly approve it.

## Submission requirements

Official rules require a video **shorter than three minutes**, with footage showing Twitch functionality and how the project was built with Codex, publicly visible on YouTube. The narrated illustrated draft is a planning/explainer artifact, not evidence that these footage requirements are satisfied. Follow SUBMISSION_VIDEO_SCRIPT.md for the edit plan and recheck the live rules before submitting:

https://twitchcon-codex.devpost.com/rules

## Results template

| Check | Pass / Fail / Not tested | Browser/voice and observations |
| --- | --- | --- |
| Native Pause/Resume/Repeat | Not tested | |
| Stop/Disable and silence afterwards | Not tested | |
| Voice/rate/pitch/volume and reload | Not tested | |
| Latest-summary backlog and no raw-chat speech | Not tested | |
| Keyboard order/focus/shortcuts | Not tested | |
| 200% zoom/reflow/contrast | Not tested | |
| Narrator with app speech off/on | Not tested | |
| Real grouping accuracy | Not tested | |
| Disconnect/navigation audio cleanup | Not tested | |
