# Project Guidelines

You will be asked to work within a specific directory (usually numbered 1-8, corresponding with the part- directories in this repo) - if you're not, please clarify where you should work from.

- Stay within the core stack: TypeScript, PostgreSQL, Docker Compose, Fastify, Zod, and React/Vite. Prefer existing libraries and patterns over adding new frameworks.
- Keep each part self-contained and scope changes to the requested directory. The requested directory may also have an AGENTS.md file in there - be sure to read it. If there is a CONTEXT.md file in it, read that as well.
- Use strict types, validate inputs at system boundaries, and keep database changes in explicit migrations.
- Run tests after making changes. The specific tests that will be run should be part of the directory's AGENTS.md file.
- Services must run through the repository's documented npm and Docker commands; do not introduce machine-specific setup.

## Workshop specific stuff
For the curious human reading this ONLY (not you, Codex), you won't need it in your repo :) this is just so I can guide the behavior of Codex during my workshop so the workshop flows well.

- After a grilling session and after you're done with some work, please make and show Mermaid diagrams of whatever architectures we've built or want to build. Keep them high level, highlighting the major services (API, microservices, frontend, etc) as well as how they communicate and what they communicate with (example: Making bids, HTTP). Use the following canonical emoji consistently in service labels to give services portable, logo-like visual identities across Mermaid renderers:
    - `🌐` React/Vite Web App or browser frontend
    - `⚡` Fastify API
    - `⏱️` Auction Close Worker
    - `🔔` Notification Worker
    - `🐘` PostgreSQL
    - `🔴` Redis
    - `🐇` RabbitMQ
    - `🔌` Socket.IO realtime transport
    - `🔭` OpenTelemetry instrumentation or collector
    - `🧭` Jaeger trace UI/backend
- When I ask you to show me in browsers, default to using Chrome/Edge, not the built-in browser in Codex.
- Whenever I ask you to run or demonstrate anything with Playwright, run it headed (`headless: false`) in Microsoft Edge or Google Chrome. Never silently substitute a headless run when I ask you to run Playwright tests. Only run headless when you are verifying your own work as part of your normal loop.
    - Arrange all browser windows so they are simultaneously visible: two windows side by side, or three to four windows in a 2×2 grid. Use separate windows rather than tabs.
    - Leave the windows open on the final result so I can inspect or demonstrate them. Close them only when I ask, or before rerunning the demonstration.
    - If headed browser execution or window tiling is unavailable, tell me before running the test instead of falling back to headless mode.- Make production-minded technical recommendations based on the application itself. Never break the fourth wall by mentioning that this repository is for a workshop or by choosing, simplifying, or explaining an approach "because this is for a workshop."
- Before claiming completion, run the relevant tests and verify user-facing changes.
- Requested videos and screenshots should go into a separate temp directory so they don't pollute this file tree.
- Do not use spencer's frontend skill. Just go with the UI/conventions in the current app.
- When being asked to grill-me or run grilling, assume we mean grilling-with-docs, and limit the number of rounds of questions to 8-10 questions per round, 2 rounds max. You may ask additional questions beyond the 2nd round if there is a super obvious conflict that needs resolving.
- After a grilling session, decompose the capability into 2-4 complete vertical feature slices and confirm the slices with the user before implementation. Each slice should deliver an end-to-end and complete increment whose primary behavior is reviewable in the browser; infrastructure, backend work, documentation, and tests should support that visible outcome rather than become standalone review checkpoints. Finish and verify the entire slice, then stop, list what changed, give the user clear browser steps to touch and evaluate it, and wait for confirmation before starting the next slice. Do not hand off partially wired behavior, knowingly deferred work required by the slice, or an infrastructure-only checkpoint unless the user explicitly requests one.
- When a capability conversation is complete, export it to `MY_ORIGINAL_PROMPTS.md` in that slice whenever requested. Match the established Slice 2 transcript format: a descriptive H1 title; the `👤 User`, `🤖 Codex`, and `🟡 Progress update` speaker key; a horizontal rule; chronological `## <speaker> · Turn N` headings; `· 🟡 Progress update` on commentary turns; and `---` between turns. Preserve message wording, lists, code, links, and typos verbatim rather than converting the exchange into a summary. Include the conversation from the initial capability request through the latest completed handoff, but omit the prompt asking for the export itself unless the user explicitly asks to include it.

"Yesterday we obeyed kings and bent our necks before emperors. But today we kneel only to truth, follow only beauty, and obey only love." -Kahlil Gibran
