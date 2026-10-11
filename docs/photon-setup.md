# Large Lego Model: Photon / HackNC setup

Prize research was verified October 10, 2026 against the live HackNC guide, Devpost, Photon guidelines, and Photon documentation. Transport and instruction-guide behavior was updated October 11.

## Account setup

1. Open [Photon's dashboard](https://app.photon.codes/dashboard), create or sign in to your account, and use **HACKWITHPHOTON**. Photon's hackathon guidelines offer **one month of Pro** with this code.
2. Create a project and connect its managed iMessage line in the dashboard. Record the phone number for the demo.
3. Copy the project ID and secret from project Settings into the local `.env` file as `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET`. Keep them out of Git, browser code, screenshots, and Devpost.
4. Add `GEMINI_API_KEY` for design generation. For phone instruction links, set `PUBLIC_BASE_URL` to an externally reachable HTTPS origin forwarding **only to the signed read-only gateway at `127.0.0.1:3002`**. Do not expose the private API on port 3001 or the Vite development server. A localhost URL will not work on someone else's phone.
5. Run the web/API app and, when you are ready for real inbound messages to trigger replies, run `npm run photon` in a second terminal. Keep this process running for the demo. Starting it enables real replies to people who text the connected line.

This worker uses **Spectrum** (`spectrum-ts`, checked against installed version **12.10.1**) and the managed cloud iMessage provider, as the prize requires. It uses the SDK's message stream; no public webhook or local Messages database access is needed. Spectrum discovers project-owned lines and renews their tokens. Use Node.js or Bun, not a browser or strict edge-worker runtime.

The implementation is separate from account setup. A successful local test or build does not prove that a phone line is connected or that a real iMessage was delivered. Verify a text round trip, an image input, a revision, and a PDF on an actual phone before claiming the integration is live.

## Start and verify the transport

1. Put the project ID and secret in `.env` using the exact fields above. Never paste credentials into chat or screenshots. The running API also needs Gemini configured.
2. Run the latest API/web app with `npm run dev`. Do not restart an API with active jobs without first stopping them or deliberately accepting interruption. `GET http://127.0.0.1:3001/api/status` must report `photonJobPolicy: 3` and `gemini: true`.
3. In a second terminal run `npm run photon`. `PHOTON_API_BASE_URL` defaults to `http://127.0.0.1:3001`; change it only if the API runs elsewhere. The transport uses that API's existing worker queue, never a second owner of the generation-job directory.
4. The startup message confirms authenticated project lookup and line-token provisioning. It does **not** prove a live iMessage round trip. On the test phone, text `/status` to the connected Photon line. Expected result: a reply explaining that no build is active. This check makes no Gemini generation request.
5. Text a simple recognizable subject, such as `Build a small red rocket`. Confirm it starts directly, acknowledges the request, and reports progress. Detail follows the subject and your instructions. It returns the first complete checked draft; queue wait is reported separately. Ask “what’s happening?” and confirm it reports the same job. Reply `make the fins blue` and confirm it revises without a mode question. After the revised preview, reply `Approve`; verify the guide, 3D model and parts CSV all describe that revision. `/stop` cancels generation and pending delivery while keeping checked drafts. Already handed-off messages cannot be recalled.
6. Send `/instructions`, `/model` and `/manual`. Verify the guide opens and resumes, the actual phone can receive/rotate the viewing USDZ, and the optional PDF opens. Test one photo with a caption separately, then `/open <saved-design-id>` with owned stock.

Spectrum sends PNG, USDZ, PDF and CSV bytes directly, so attachments do not need a public URL. The instruction guide does. Build the web assets with `npm run build`; the API process serves a separate read-only listener on port 3002. Its signed `/?build=<revision>&share=<token>` link permits the guide, required public assets, and that revision's allowed read-only files. It rejects mutations and job/configuration/catalog routes. Public design JSON omits prompts, photos and research; owned-stock allocation includes only parts required by the build. Keep `data/instruction-share-key` private and persistent. Links are bearer access: recipients can forward them, and replacing the key invalidates existing links.

For a temporary authorized demo, `cloudflared tunnel --url http://127.0.0.1:3002` prints an HTTPS origin to use as `PUBLIC_BASE_URL`. A Quick Tunnel lasts only while its process runs, changes hostname when recreated, and has no production uptime guarantee. A named deployment is needed for durable links. Do not start a public tunnel before checking the gateway, and do not restart services with active jobs. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

Only an approved revision receives a Spectrum instruction app card and a plain HTTPS fallback link. Before approval the agent sends a PNG preview for feedback, without a full guide or downloadable files. The recipient installs the [Spectrum iMessage launcher](https://apps.apple.com/ca/app/spectrum-apps-in-messages/id6777616651) once to open app cards; the same guide works in a normal browser without that extension. The guide's ordinary 3D instruction mode is primary. Camera access is unnecessary; AR is optional on a supported phone. The implementation uses `app(url, { layout })`, not a custom native iMessage extension or an asserted live-bubble renderer. Test actual gestures inside Spectrum separately. [Photon app cards](https://photon.codes/docs/spectrum-ts/content/app)

## Current Cloudflare demo domain

The registered domain is **llegomodel.site**. The mini-app uses **https://guide.llegomodel.site** so it does not depend on cached Namecheap parking records for the root. Both hostnames route to the same signed gateway; an unsigned homepage returns 404 intentionally.

On the configured Mac, keep the API and Photon listener running, build current assets with `npm run build`, and run:

```sh
cloudflared tunnel --config data/cloudflare/guide.yml run large-lego-model-guide
```

The locally generated, ignored config routes only to `http://127.0.0.1:3002`, with a final 404 rule. Tunnel credentials stay under `~/.cloudflared`; never commit them. `.env` contains `PUBLIC_BASE_URL=https://guide.llegomodel.site`. Restart only the Photon listener gracefully after changing that value; active API jobs can continue. The domain uses Cloudflare's Free plan and automatic Universal SSL. This named tunnel keeps its hostname across restarts, but the Mac, API and tunnel must remain running for links to work.

Send `/instructions` in an existing iMessage conversation to receive the selected approved build's signed card and browser link. The bare hostname is not a build browser. Keep `data/instruction-share-key` and saved designs persistent so previously sent links continue to resolve. Verify real phone card/browser opening, placement navigation, resumed progress, downloads and optional AR separately from HTTP tests.

## Demo visual-review switch

`PHOTON_VISUAL_REVIEW_ENABLED=false` is the demo default. It skips the separate concept study, post-build Gemini visual scoring and automatic visual refinement for newly submitted iMessage jobs. Reference photographs, independent subject requirements, planning, brick checks and structural repairs remain active. The first complete checked draft waits for user feedback or approval. Review metadata says **Not visually reviewed**, never a visual pass or failure.

To restore the reviewer, set `PHOTON_VISUAL_REVIEW_ENABLED=true` in `.env` and restart only the Photon listener. Each submitted job keeps its snapshotted setting; existing jobs are unchanged. Keep the API running while it has active jobs. The reviewer code and tests remain in place. Restored AI review still requires user approval before final delivery.

## Conversation flow

Help covers `/status`, `/stop`, `/approve`, `/retry`, `/instructions` (or `/build`), `/model`, `/manual`, `/parts`, `/use N`, `/open ID` and `/new idea`. Archived mode commands are described only when mode selection is enabled.

- Natural questions and brainstorming use a bounded Gemini conversation call; clear actions route through the existing status, file, new-build and revision handlers. Feasibility questions do not start generation. Ambiguity asks for clarification; provider failure leaves the build unchanged. Stop supersedes late interpretation. Short confirmations can resolve a specific offered subject, while approval stays explicit. Up to eight user/assistant conversational messages persist for continuity. The user has confirmed a natural greeting/help reply on the phone without generation.
- An explicit build request or photo-plus-caption starts directly with the detailed construction path. Quick mode is archived behind `QUICK_MODE_ENABLED=false` in `shared/generation-job.ts`; setting it to true restores the website choice and iMessage mode question. The generator implementation, stored job qualities and tests remain. New revisions use the same full construction capabilities. Existing jobs are unchanged; a saved request waiting for a mode can be resumed with its old mode reply or “go ahead.” With visual review disabled, the agent skips the separate concept study and returns the first complete checked draft for user feedback. Reference analysis, catalog discovery and structural repair remain. Neither geometric nor visual checks prove mechanical strength.
- Checked drafts are sent promptly as PNGs. Provider failure still delivers an available checked draft rather than discarding it. Unfinished attempts stay private and never enter the normal design/export store. No automatic guide or final-file delivery occurs before explicit approval.
- Stage updates are limited to one every 15 seconds, with a check-in after 30 seconds without another delivered update. Queue wait is reported separately. Natural status questions and `/status` reconnect to the existing job without starting generation. `/stop` ends it and keeps the checked draft. Natural Stop requests, `/stop`, and reply-wrapped controls bypass slow work. Stop aborts pending file/validation waits and drops older queued commands; acknowledged approved files stay recorded for an explicit `/retry`. It suppresses late previews and links, but cannot recall a message already handed to Photon. Unfinished attempts stay private in every mode; only complete saved drafts that pass brick checks are sent as previews. Approval and direct export commands report preparation and sending stages, with a check-in after 30 seconds of silence. Progress-text failures do not discard prepared files or acknowledged deliveries.
- `/use 7` stops generation and selects that exact checked attempt. Unfinished attempts cannot be selected or exported. After that exact revision is approved, `/instructions` or `/build` opens its guide; `/model` sends its mobile viewing USDZ; `/manual` requests its PDF; `/parts` sends its parts CSV with catalog links. These commands, including natural-language equivalents, ask for approval when the selected revision is still a draft. A revision does not inherit approval from its parent. New approval sends **guide + 3D model + parts** for the exact previewed revision without generating again. PDF is on demand. Without an available signed guide URL, approval retains the model/PDF/parts bundle. Existing saved approvals retain their original bundle intent. `/retry` sends only missing items from the saved approved revision, even when another design is selected. Unknown slash commands show help instead of creating a build. Catalog links do not establish current stock or prices.
- Ordinary feedback revises the selected or best checked draft. The planner starts with its exact existing placements and requests targeted edits, preserving the original request, photographs and owned inventory. Failed edits retain the old checked draft; they do not silently restart a new model. Before a checked draft exists, feedback retains the original requested subject. `/new your idea` resets subject/design/photo context, keeping owned inventory. Bare `/new` stops work and asks for a new description.
- A photo without text asks for a description and is retained for the following request and revisions. Photo interpretation is inspiration, not a verified brick count. JPEG, PNG and WebP inputs are limited to 5 MiB; convert HEIC to JPEG first.
- `/open <design-id>` explicitly imports a saved web design and its inventory/catalog snapshot. Nonempty stock limits future generation to owned pieces. This is a snapshot, not continuous browser sync. Imported part definitions survive future design switches. Malformed inventory is rejected.
- Builds have no piece-count ceiling. The installed Photon transport limits one request to 100 MiB. Normal model delivery uses `/api/designs/:id/mobile.usdz`: every body, color, exposed stud and imported surface is retained, while covered ordinary stud detail is omitted for phone viewing. This is a viewing copy of the same selected revision, not the canonical export. The guide offers `/model.usdz` with full exact geometry; BOM and instructions remain canonical. USDZ files over 1 MiB try `usdcat` and `usdzip`, when installed, to encode shared geometry as binary USDC without flattening references. If tools are unavailable, the original file remains. A conservative size check reserves request-envelope space; files still too large use the guide download instead. An upload/send acknowledgment is not proof the recipient opened it.

## Persistence and delivery limits

Conversation files under `data/photon-sessions/` use hashed names and private file permissions. They retain the current design, original unbuilt prompt, optional photo and inventory/catalog, job ID, pending request and mode choice, last delivered progress state, attempt delivery cursor, previewed and approved revision IDs, per-file final delivery acknowledgments, and up to 200 handled message IDs. Keep this directory and `data/designs/` on persistent disk and out of Git. Only one Photon process should own a project in this prototype.

Inbound IDs are claimed before handling, so echoed/replayed messages do not silently trigger a second paid build. A crash before the job checkpoint can require a fresh user message. The job ID is saved before HTTP submission; an interrupted response is polled under that same ID and is never automatically resubmitted with a new ID. Definite API rejection or a user-confirmed missing request clears its stale binding, so the conversation can start another request.

Background outgoing cursors advance only after text/media sends are acknowledged. Failed sends remain pending and are retried after reconnect/restart. If text succeeds but its image fails, retry can repeat that text; exactly-once delivery is not claimed. A send acknowledgment is not proof the recipient opened or received it. On restart, only previously inbound conversations with pending jobs reconnect; there is no contact discovery or proactive outreach. API-server restart marks its jobs interrupted and requires an explicit new request; Photon does not silently restart paid generation.

## Building guide, native 3D and next device check

The primary experience is the signed mobile guide: rotate/zoom the model, gather step pieces, advance through checked placements, and resume saved device progress. Approval pins the previewed revision. Normal 3D viewing works without a camera; Safari Quick Look AR is optional. The canonical model keeps 8 mm stud pitch, 3.2 mm plate pitch and 9.6 mm full-brick height. `/model` sends the lighter viewing copy described above; the guide retains the full export and optional PDF.

Prior native attachment rotation was confirmed on the user's phone. The new mobile-copy artifact, guide gestures inside Spectrum, saved progress on the recipient device, and optional AR each require their own live check. A turntable is prerecorded motion, not user-controlled rotation. Voice memos remain later work. See [the source-grounded 3D preview plan](imessage-3d-preview.md).

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
