# Large Lego Model: Photon / HackNC setup

Verified October 10, 2026 against the live HackNC guide, Devpost, Photon guidelines, and Photon documentation.

## Account setup

1. Open [Photon's dashboard](https://app.photon.codes/dashboard), create or sign in to your account, and use **HACKWITHPHOTON**. Photon's hackathon guidelines offer **one month of Pro** with this code.
2. Create a project and connect its managed iMessage line in the dashboard. Record the phone number for the demo.
3. Copy the project ID and secret from project Settings into the local `.env` file as `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET`. Keep them out of Git, browser code, screenshots, and Devpost.
4. Add `GEMINI_API_KEY` for design generation. Set `PUBLIC_BASE_URL` to the externally reachable HTTPS address of this application's web/API deployment if you want phone users to open the 3D viewer. A localhost URL will not work on someone else's phone.
5. Run the web/API app and, when you are ready for real inbound messages to trigger replies, run `npm run photon` in a second terminal. Keep this process running for the demo. Starting it enables real replies to people who text the connected line.

This worker uses **Spectrum** (`spectrum-ts`, checked against installed version **12.10.1**) and the managed cloud iMessage provider, as the prize requires. It uses the SDK's message stream; no public webhook or local Messages database access is needed. Spectrum discovers project-owned lines and renews their tokens. Use Node.js or Bun, not a browser or strict edge-worker runtime.

The implementation is separate from account setup. A successful local test or build does not prove that a phone line is connected or that a real iMessage was delivered. Verify a text round trip, an image input, a revision, and a PDF on an actual phone before claiming the integration is live.

## Start and verify the transport

1. Put the project ID and secret in `.env` using the exact fields above. Never paste credentials into chat or screenshots. The running API also needs Gemini configured.
2. Run the latest API/web app with `npm run dev`. Do not restart an API with active jobs without first stopping them or deliberately accepting interruption. `GET http://127.0.0.1:3001/api/status` must report `photonJobPolicy: 2` and `gemini: true`.
3. In a second terminal run `npm run photon`. `PHOTON_API_BASE_URL` defaults to `http://127.0.0.1:3001`; change it only if the API runs elsewhere. The transport uses that API's existing worker queue, never a second owner of the generation-job directory.
4. The startup message confirms authenticated project lookup and line-token provisioning. It does **not** prove a live iMessage round trip. On the test phone, text `/status` to the connected Photon line. Expected result: a reply explaining that no build is active. This check makes no Gemini generation request.
5. Text a simple recognizable subject, such as `Build a small red rocket`. Confirm it asks Quick or Detailed before starting. Reply `Quick`, then check the acknowledgment and progress messages. Quick aims for a checked-draft preview or a clear next choice in about 2.5 minutes after its worker starts; queue wait is separate, and a usable result is not guaranteed. Ask “what’s happening?” and confirm it reports the same job. Reply `make the fins blue` and confirm it asks for a mode again; `/stop` cancels pending requests and keeps the checked draft.
6. Send `/model` and `/manual`. Verify the actual phone can receive/open the USDZ and PDF. Test one photo with a caption separately, then `/open <saved-design-id>` with owned stock.

No public HTTPS URL is currently configured by this implementation. Spectrum sends PNG, USDZ and PDF bytes directly, so those attachments do not need a public URL. `PUBLIC_BASE_URL` enables viewer/attempt links and must be an externally reachable HTTPS address; a desktop localhost address is not useful on another phone. Public hosting is a separate deployment task.

## Conversation flow

Each build-start acknowledgment lists `/status`, `/stop`, `/model`, `/manual`, `/use N`, `/open ID`, `/new idea`, `/quick idea`, and `/detailed idea`, with a short description of each.

- A text or photo-plus-caption is saved while the agent asks Quick or Detailed. An explicit mode with the original request counts as the choice. Each revision asks again. Quick targets about 2.5 minutes: it uses a shared 135-second generation/checking budget and a 150-second worker deadline, excluding queue wait. It stops with the best checked draft or a clear next choice. Detailed retains its refinement loop. The website keeps its existing continuous behavior. Geometry checks and visual review are reported separately; neither proves mechanical strength.
- Checked drafts are sent promptly as PNGs. Provider failure still delivers an available checked draft rather than discarding it. From attempt 4, unfinished attempts get concise checks and any available actual brick preview. They never enter the normal design/export store.
- Stage updates are limited to one every 15 seconds, with a check-in after 30 seconds without another delivered update. Queue wait is reported separately. Natural status questions and `/status` reconnect to the existing job without starting generation. `/stop` ends it and keeps the checked draft. Stop remains available while a PDF/USDZ export is downloading.
- `/use 7` stops generation and selects that exact checked attempt. Unfinished attempts cannot be selected or exported. `/model` sends the selected USDZ; `manual` or `instructions` sends its PDF. Files are generated from the selected immutable revision.
- Ordinary feedback revises the selected or best checked draft. Before a checked draft exists, feedback retains the original requested subject. `/new your idea` resets subject/design/photo context, keeping owned inventory. Bare `/new` stops work and asks for a new description.
- A photo without text asks for a description and is retained for the following request and revisions. Photo interpretation is inspiration, not a verified brick count. JPEG, PNG and WebP inputs are limited to 5 MiB; convert HEIC to JPEG first.
- `/open <design-id>` explicitly imports a saved web design and its inventory/catalog snapshot. Nonempty stock limits future generation to owned pieces. This is a snapshot, not continuous browser sync. Imported part definitions survive future design switches. Malformed inventory is rejected.
- Builds have no piece-count ceiling. The installed Photon transport limits one request to 100 MiB. Before sending a USDZ larger than 8 MiB, the listener uses `usdcat` and `usdzip` when installed to encode the same geometry as binary USDC in a valid USDZ package. This changes storage, not pieces or detail. On hosts without these tools it retains the portable export. A conservative size check reserves space for the request envelope; files still too large are offered through the saved build page instead of a futile retry. Other transfer errors explain retrying `/model` or `/manual`. An upload or send acknowledgment is not proof the recipient opened the file.

## Persistence and delivery limits

Conversation files under `data/photon-sessions/` use hashed names and private file permissions. They retain the current design, original unbuilt prompt, optional photo and inventory/catalog, job ID, pending request and mode choice, last delivered progress state, attempt delivery cursor, and up to 200 handled message IDs. Keep this directory and `data/designs/` on persistent disk and out of Git. Only one Photon process should own a project in this prototype.

Inbound IDs are claimed before handling, so echoed/replayed messages do not silently trigger a second paid build. A crash before the job checkpoint can require a fresh user message. The job ID is saved before HTTP submission; an interrupted response is polled under that same ID and is never automatically resubmitted with a new ID. Definite API rejection or a user-confirmed missing request clears its stale binding, so the conversation can start another request.

Background outgoing cursors advance only after text/media sends are acknowledged. Failed sends remain pending and are retried after reconnect/restart. If text succeeds but its image fails, retry can repeat that text; exactly-once delivery is not claimed. A send acknowledgment is not proof the recipient opened or received it. On restart, only previously inbound conversations with pending jobs reconnect; there is no contact discovery or proactive outreach. API-server restart marks its jobs interrupted and requires an explicit new request; Photon does not silently restart paid generation.

## Native 3D and next device check

The USDZ uses the same actual brick geometry as the web viewer, with 8 mm stud pitch, 3.2 mm plate pitch and 9.6 mm full-brick height. `/model` sends bytes for Apple's compatible Quick Look viewers. PNGs and an optional HTTPS viewer link remain fallbacks. **Let's build → Native 3D model** downloads the same export on the website. Local export tests do not establish Photon delivery or user-controlled rotation on the recipient's phone.

Use ordinary files first. Interactive app cards require a separate recipient-extension and gesture/WebGL check. A turntable is prerecorded motion, not user-controlled rotation. Voice memos remain later work. See [the source-grounded 3D preview plan](imessage-3d-preview.md).

Official API checks: installed `spectrum-ts` 12.10.1 still matches the [cloud iMessage provider](https://photon.codes/docs/spectrum-ts/providers/imessage), [message stream and outbound filtering](https://photon.codes/docs/spectrum-ts/messages), [attachment bytes API](https://photon.codes/docs/spectrum-ts/content/attachments), and [project credentials](https://photon.codes/docs/spectrum-ts/getting-started). No local Messages database access or public webhook is required. Runtime startup, live text delivery, photo input, revision, USDZ and PDF device checks are separate completion gates.

## Prize and submission facts

**Photon: Best iMessage Agent.** Projects must integrate Spectrum. First place is **$400 cash + $300 Photon credits + a fast track to the final interview round**; runner-up is **$200 cash + $100 credits**. These awards are per team. Photon judges vision, craft, depth, and traction, with emphasis on human collaboration, persistent context, and graceful fallbacks. A useful demo is: request a build, inspect the preview, ask for a change, and receive the revised manual.

**Frutiger Aero.** The track asks for the glossy optimistic aesthetic **and a real sustainability or nature-focused idea**. Reusing an existing brick collection is our practical connection. Show actual piece reuse and shortages; do not invent carbon or waste savings. First-place choices are an ocean mechanical keyboard or JBL Go 5 speaker; second-place choices are a jellyfish lamp, aqua mouse, or ocean projector.

**Track selection.** Choose General or Beginner before adding other tracks. Additional tracks are unlimited. Beginner requires more than half the team to have never participated in a hackathon. Gemini integration also fits the Best Use of Gemini API category, whose listed prize is MLH swag kits. Extra sponsor integrations should earn their place in the product.

**Deadline: Sunday, October 11, 2026 at 10:00 AM EDT.** The Devpost header provides EDT; some guide/body text mistakenly says EST. Each team submits one project with a GitHub link and a demo video no longer than two minutes. Both are mandatory. The rules reject cross-posted projects and projects developed before hacking officially began. Clearly credit libraries, models, and external data used in the new implementation.

The demo fair is noon–1:30 PM on October 11. Each judge gets two minutes of demo and two minutes of questions. Keep at least one teammate at the assigned table. Closing is at 3 PM in Hamilton Hall 100.

At verification time, the official HackNC guide and Photon guidelines both listed the Photon prize, while the Devpost prize list omitted it despite displaying the Photon sponsor logo. Confirm the appropriate Photon category/entry route in the final submission UI or the event's sponsor channel. No submission has been made by this setup work.

## Sources

- [HackNC 2026 hacker guide](https://go.unc.edu/HackNC2026-guide)
- [Official HackNC tracks, including Spectrum requirement and promo code](https://past-cushion-a6f.notion.site/HackNC-Tracks-756816442900834e900c016919f003e8)
- [Official HackNC prizes](https://past-cushion-a6f.notion.site/Prizes-Merch-3e681644290082d9aacd8159f40a5f1e)
- [Photon hackathon guidelines](https://somethingreat.notion.site/Hackathon-Guidelines-for-Photon-3dce443f36bb803696daf4135f063cd1)
- [HackNC 2026 Devpost](https://hacknc-2026.devpost.com/)
- [Submission instructions](https://past-cushion-a6f.notion.site/IMPORTANT-Submission-Instructions-648816442900823890388190be1f899e)
- [Spectrum quickstart and credentials](https://photon.codes/docs/spectrum-ts/getting-started)
- [Cloud iMessage provider](https://photon.codes/docs/spectrum-ts/providers/imessage)
- [Incoming messages and outbound filtering](https://photon.codes/docs/spectrum-ts/messages)
- [Sending attachments](https://photon.codes/docs/spectrum-ts/content/attachments)
- [Webhook alternative and delivery semantics](https://photon.codes/docs/spectrum-ts/webhooks)

## Live Quick check (October 10, 2026)

The updated listener authenticated with API policy 2. An actual phone request selected Quick and finished in 67.3 seconds with a checked 180-piece rose. Photon acknowledged the preview and completion; the user confirmed `/model` opened and could be rotated. This verifies that tested device/conversation, not every Apple device or physical buildability.
