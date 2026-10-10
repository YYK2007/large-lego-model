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

## Conversation flow

- Send a text prompt to create a build. Later prompts revise the current design in that conversation.
- Send a single photo with a description of what you want. A photo without text prompts a clarification; the following text is used with that photo. Photo interpretation is inspiration, not a verified count of owned bricks.
- Send `manual` or `instructions` to receive the current PDF.
- Send `/new your idea` to start a fresh design rather than revise the previous one.
- Send `/open <design-id>` using the command copied from a saved web design. It opens that design and copies its saved inventory into the conversation. Revisions, new ideas, and PDFs then use the same inventory snapshot.
- The bot sends a rendered preview and, when a public URL is configured, a link to the web viewer. The PDF remains available directly in iMessage.

Conversation state lives in local `data/photon-sessions/` files named with a SHA-256 hash of the provider and conversation ID. Each conversation retains its current design ID, an optional owned-inventory snapshot and pending photo, and up to 200 handled message IDs. Do not commit that directory. State and saved designs must live on persistent disk in deployment. A second concurrently running worker for the same project can cause duplicate replies; run only one instance for this prototype.

Only JPEG, PNG, and WebP image inputs up to 5 MiB are accepted; convert HEIC photos to JPEG first. The adapter ignores its own outbound echoes and serializes messages within a conversation. Replayed IDs within the retained history are skipped. IDs are recorded before handling, so a process crash or failed reply is not automatically retried; the user can send a fresh message. This avoids silently regenerating a design or sending duplicate responses after reconnecting.

Owned-brick entry and set import live in the web app. `/open` explicitly transfers the inventory saved with that design; it does not continuously sync later browser changes. Nonempty imported inventories constrain future generation to owned pieces, and each revision saves the snapshot with the new design. Opening a design with no inventory returns the conversation to unlimited catalog mode. Invalid snapshots are rejected instead of dropping the inventory constraint.

A failed generation keeps the previous design. A bare `/new` intentionally clears the current design and pending photo while retaining the imported inventory for the next idea. Saved generated design IDs are random share identifiers: anyone who has the ID can import its design and inventory. `/open` accepts an ID, never a URL or filesystem path.

## Native 3D preview

The adapter now prepares a USDZ attachment from the same brick geometry as the web viewer, with real-world scale (8 mm stud pitch, 9.6 mm brick layers). Apple's Quick Look supports USDZ in Messages; opening the attachment is the planned native way to rotate the model with touch. The PNG and public web link remain fallbacks. Export is tested locally; actual Photon delivery and the recipient's Quick Look behavior still require a phone test.

The feedback loop stays in the conversation: inspect the model, reply with a change, then send `manual` for instructions. Each revision preserves the current owned-inventory snapshot. A turntable GIF/video is optional future preview media and does not provide user-controlled rotation. Spectrum live app cards require the recipient's iMessage extension; WebGL and gestures must be tested before choosing that route. Voice memos remain a later feature. See [the source-grounded 3D preview plan](imessage-3d-preview.md) for platform limits and device checks.

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
