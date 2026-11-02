# StreamSense submission video — edit plan

Target: about **2 minutes 40 seconds**, below the official three-minute limit. English narration, readable captions, actual product audio and no background music. Do not upload until the creator reviews and approves. A separate illustrated narrated draft is provided for story review; it is not a live screen recording or final submission video.

## Final footage plan and narration

| Time | Actual footage | Suggested narration |
| --- | --- | --- |
| 0:00–0:15 | Product title and public dashboard | “StreamSense helps blind and low-vision Twitch streamers catch what matters in chat while staying focused on their stream. It turns repeated messages and common questions into short summaries you can read or hear.” |
| 0:15–0:55 | Real Twitch question sent manually, then arrival/TWITCH label/counter in StreamSense | “The streamer connects their own Twitch account through OAuth. The backend receives real chat using EventSub. Here, a question sent in Twitch appears in StreamSense. These are actual received messages, separate from the demo dataset.” |
| 0:55–1:15 | Generate summary, transcript, real speech and Stop | “The same processing pipeline groups repetitions, identifies candidate questions and creates a short, rule-based summary. Speech is off until enabled. Listen to the generated summary.” **Pause narration so the actual product voice can be heard.** “The streamer can stop it immediately.” |
| 1:15–1:45 | Load Demo Batch with clear DEMO labels, metrics and groups | “For repeatable testing, Load Demo Batch sends twenty-eight fictional messages through the same processing code. Demo and Twitch keep separate queues and histories, and the Twitch account stays connected. Questions, repetitions, activity and the transcript remain inspectable.” |
| 1:45–2:05 | Keyboard focus, voice settings and speech controls | “Native keyboard-accessible controls provide pause, resume, repeat and stop. Voice, rate, pitch and volume are adjustable. Only on-device voices are selected. Narrator and complete accessibility validation are still being tested; we do not claim certification.” |
| 2:05–2:30 | Creator-recorded safe Codex prompt/diff and actual passing checks | “Codex helped build and review the React and TypeScript frontend, Express backend, Twitch integration, batching and speech service. We added tests for duplicate events, failure recovery, mode separation and cleanup. Mocked tests and human live verification are recorded separately.” |
| 2:30–2:40 | Public address and concise closing | “StreamSense is a lightweight hackathon preview focused on clarity and streamer control. Try the public app and review the source and setup instructions in the repository.” |

## Facts to keep accurate

- Summaries are deterministic rules, not a general-purpose language model or sentiment engine.
- Voice output uses browser SpeechSynthesis with on-device voices. The explainer draft's synthetic narrator is a separate offline voiceover, not captured browser speech.
- The owner verified hosted login, a received message/counter and audible generated speech. The agent's current Firefox automation is blocked, so it has not independently observed those native audio checks.
- One integration-test timing assertion was corrected during re-verification; show only the actual final passing result after checks finish. Do not label a mock test as proof of live Twitch or audio.
- The free Cloudflare/Render preview has quota/idle limits and in-memory sessions. It is not production-hardened or certified accessible.
- A visual state change alone cannot prove an utterance was audible or that Narrator is usable.

## Safe Codex clip

The creator must manually capture a short, relevant Codex view. The agent cannot automate Codex UI. Show a safe project prompt, code diff or completed test output; exclude credentials, account emails, authorization links/codes, private messages and unrelated tabs. Include the actual Codex session ID in the submission form separately, obtained from the thread containing most work.

## After recording

Keep the three original clips and tell the assistant their local paths. The edit can then replace the two draft placeholders, trim dead time, mix narration with actual product audio, add captions and verify the resulting MP4 with ffprobe. Final review must confirm no private data, duration below three minutes, audible product speech, real Twitch functionality and genuine Codex footage. No YouTube upload or Devpost submission is authorized by preparation alone.

Official requirements: https://twitchcon-codex.devpost.com/rules
