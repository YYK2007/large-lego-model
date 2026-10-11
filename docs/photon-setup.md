# Photon setup

Large LEGO Model uses Photon Spectrum for iMessage. A request produces a checked preview; feedback revises it; explicit approval sends the guide and final files. This guide was checked against the source on October 11, 2026. HackNC prize research is kept separately at the end.

## Set up and start

1. Open [Photon's dashboard](https://app.photon.codes/dashboard), create a project, and connect its managed iMessage line. Copy its project ID and secret from Settings. The [Spectrum quickstart](https://photon.codes/docs/spectrum-ts/getting-started) covers project credentials.
2. Run `npm ci` and create `.env` from `.env.example` if it doesn't already exist. Fill in the fields below. Keep credentials out of Git, screenshots and chat.
3. Run `npm run build`, then `npm start`. This starts the private app/API on `127.0.0.1:3001` and the signed, read-only guide gateway on `127.0.0.1:3002`. For development, `npm run dev` also starts Vite. Rebuild the assets before testing the phone guide. Don't restart the API while it has active builds unless you intend to interrupt them.
4. Check `http://127.0.0.1:3001/api/status`. The listener requires `photonJobPolicy: 3` and `gemini: true`. The Gemini flag confirms configuration, not a successful provider request.
5. In another terminal, run `npm run photon`. Keep one Photon process running for this project. It uses the API's existing job queue. Starting it enables real replies to incoming messages.
6. Text `/status` to the connected line from the test phone. Confirm a reply about the current conversation. This does not start a build. The startup authentication message alone doesn't prove that iMessage delivery works.

| Field | Use |
| --- | --- |
| `SPECTRUM_PROJECT_ID` | Photon project ID |
| `SPECTRUM_PROJECT_SECRET` | Photon project secret |
| `GEMINI_API_KEY` | Generation and conversational interpretation |
| `REBRICKABLE_API_KEY` | Live part and set lookups; see the main setup guide |
| `PUBLIC_BASE_URL` | Public HTTPS origin for the signed guide, forwarding only to port 3002; leave empty for local-only work |
| `PHOTON_API_BASE_URL` | Optional listener override; defaults to `http://127.0.0.1:3001` |
| `PHOTON_VISUAL_REVIEW_ENABLED` | Defaults to `false`; see below |

The installed SDK is `spectrum-ts` 12.10.1. The listener uses the [cloud iMessage provider](https://photon.codes/docs/spectrum-ts/providers/imessage) and filters the [message stream](https://photon.codes/docs/spectrum-ts/messages) to inbound iMessages. It doesn't need a public webhook or access to the local Messages database. [Webhooks](https://photon.codes/docs/spectrum-ts/webhooks) are a separate SDK option, not this implementation's transport.

## Share the phone guide

Attachments use [Spectrum buffers](https://photon.codes/docs/spectrum-ts/content/attachments), so PNG, USDZ, PDF and CSV delivery doesn't need a public URL. The web guide does.

1. Build the web assets and run the API as above.
2. Route an HTTPS origin only to `http://127.0.0.1:3002`. Never expose the private API on port 3001 or the Vite server to make the guide work.
3. Set that origin as `PUBLIC_BASE_URL` in `.env`. The API reads it when creating a guide link. Restart the Photon listener gracefully to pick up its changed configuration; active API jobs can continue.
4. Approve a checked preview, then open its signed link on the phone. The bare hostname should return 404. Test both the Spectrum card and the plain browser link.

The project demo uses `https://guide.llegomodel.site`. On the machine with its existing tunnel credentials and ignored configuration, the launch command is:

```sh
cloudflared tunnel --config data/cloudflare/guide.yml run large-lego-model-guide
```

That local configuration isn't included in the repository. A fresh installation needs its own tunnel or deployment. Keep the API and tunnel running for links to resolve. For a temporary test, `cloudflared tunnel --url http://127.0.0.1:3002` supplies a random HTTPS hostname; it changes when the tunnel is recreated and has no uptime guarantee. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

Links use `/?build=<revision>&share=<token>`. The gateway permits only that revision's geometry and read-only files, plus application assets. It excludes prompts, photos, research, jobs and unrelated inventory. Keep `data/instruction-share-key` and saved designs persistent and private. Anyone with a signed link can forward it; replacing the key invalidates existing links.

After approval, the transport attempts a Spectrum app card and a plain HTTPS link. App cards open through the [Spectrum iMessage launcher](https://apps.apple.com/ca/app/spectrum-apps-in-messages/id6777616651), which recipients install once. The browser link works without it. Our card uses `app(url, { layout })`; we haven't enabled live rendering in the message bubble. [Photon app cards](https://photon.codes/docs/spectrum-ts/content/app)

## Requests, feedback and approval

New build requests start directly. Clear feedback revises the selected checked build, preserving its original request, photos and owned stock. `/new <idea>` starts another subject and clears the old design/photo context while keeping stock. A failed new subject retains the earlier preview and identifies it as the earlier build.

Before approval, the phone receives a PNG preview and a feedback prompt. Unfinished attempts stay private. Approval pins the successfully previewed or explicitly selected checked revision; a newer background draft can't replace it during delivery. A revision needs its own approval.

| Command | Result |
| --- | --- |
| `/status` | Current build or file-delivery progress; no new build |
| `/stop` | Stops generation and pending delivery; keeps saved drafts and acknowledged files |
| `/approve` | Approves the exact selected preview and sends its final bundle |
| `/retry` | Sends only missing items from the saved approved bundle; no regeneration |
| `/instructions` or `/build` | Reopens the selected approved build's guide |
| `/model` | Sends its phone viewing USDZ |
| `/manual` | Prepares its optional PDF |
| `/parts` | Sends exact part/color quantities, owned allocations and catalog links |
| `/use N` | Stops generation and selects checked attempt N for review |
| `/open ID` | Loads a saved design and its inventory/catalog snapshot |
| `/new <idea>` | Starts a new subject; bare `/new` asks for a description |

Guide and file commands ask for approval if the selected build is still a draft. With a guide URL available, approval sends the guide, model and parts CSV. Without one, it sends the model, PDF and parts CSV. Existing approval records keep their original bundle. `/retry` stays tied to that approved revision even after another selection. Catalog links don't confirm stock or prices.

A photo without text is held until a description arrives. Inputs accept JPEG, PNG or WebP up to 5 MiB; convert HEIC first. Photos guide the design, but don't establish an exact owned-parts count. Nonempty stock imported through `/open ID` constrains later builds; it is a snapshot, not ongoing browser sync.

Status and Stop bypass slow exports. Progress updates are spaced at least 15 seconds apart, with check-ins after 30 seconds without another delivered update. Stop can cancel pending work and suppress later replies, but can't recall a message already handed to Photon.

Quick mode is archived behind `QUICK_MODE_ENABLED=false` in `shared/generation-job.ts`. Restoring it brings back the website choice and iMessage mode question. Existing job qualities and old pending requests remain readable.

## Visual review and recovery

`PHOTON_VISUAL_REVIEW_ENABLED=false` skips the separate concept study, post-build Gemini scoring and automatic visual refinement. References, subject requirements, part discovery, planning, brick checks and structural repairs still run. The first complete checked draft waits for feedback. It is labeled not visually reviewed, not visually passed.

Set the field to `true` and restart the Photon listener to restore review for new jobs. Each job keeps the setting it started with. AI review still doesn't replace explicit user approval or physical build testing.

Private state lives in `data/photon-sessions/`, `data/generation-jobs/` and `data/designs/`. Keep it out of Git and on persistent disk. Conversations retain request context, photos, stock, job bindings, selected/approved revisions, file acknowledgements and the last 200 handled message IDs.

Inbound IDs are recorded before handling. A crash before the job checkpoint may need a fresh user message. Outgoing delivery state advances after acknowledgement, so failed sends can retry; a text may repeat if its following image failed. Exactly-once delivery isn't guaranteed. Restarting Photon reconnects pending conversations without discovering contacts or starting new paid builds. Restarting the API marks unfinished jobs interrupted; continuing requires an explicit request.

## Phone check

1. Send a simple build request and confirm the acknowledgement, progress and checked PNG preview. Ask a natural status question and verify it follows the same job.
2. Request one visible change. Confirm the new preview preserves the subject. Before approval, `/model` should ask you to review and approve.
3. Approve the revision. Check the guide, USDZ and CSV refer to that build. Open the guide from both the card and browser link; rotate, follow placements, then reload and check saved progress.
4. Open and rotate the USDZ, then request `/manual`. Check its diagrams and part counts. Test a photo request and an owned-stock `/open ID` separately.
5. During an export, send `/status` and `/stop`. Confirm responsiveness. Use `/retry` and verify that already acknowledged approved files aren't resent.

Earlier native model rotation and PDF opening were user-confirmed, including the Wilson attachment. The newer phone viewing copy, guide gestures inside Spectrum, recipient-device progress and AR need separate checks. HTTP success and a Photon send acknowledgement don't prove that the recipient opened a file. See [3D viewing and file details](imessage-3d-preview.md) and [recorded verification](VERIFICATION.md).

## HackNC research, recorded October 10, 2026

This is the event research record, not a current offer or submission-status check. The original sources are retained below.

- Photon listed Best iMessage Agent, requiring Spectrum: first place $400 cash, $300 credits and a final-interview fast track; runner-up $200 cash and $100 credits, per team. The guidelines listed `HACKWITHPHOTON` for one month of Pro. Judging covered vision, craft, depth and traction.
- Frutiger Aero required the visual theme plus a sustainability or nature idea. Reusing confirmed owned bricks is our connection; we haven't measured carbon or waste savings. Listed prizes were an ocean mechanical keyboard or JBL Go 5 for first, and a jellyfish lamp, aqua mouse or ocean projector for second.
- Teams selected General or Beginner before additional tracks. Beginner required more than half the team to be first-time participants. The Gemini API category listed MLH swag kits.
- Submission was listed for October 11 at 10:00 AM EDT. The Devpost header used EDT while some body text said EST. One entry per team required a GitHub link and a video of at most two minutes. Rules rejected cross-posted projects and work developed before hacking began; external libraries, models and data needed credit.
- The fair was listed for noon–1:30 PM, with two minutes of demo and two minutes of questions per judge. Closing was listed for 3 PM in Hamilton Hall 100.
- The HackNC guide and Photon guidelines listed the Photon prize; Devpost's prize list omitted it while showing the sponsor logo. That discrepancy needed confirmation in the submission UI or sponsor channel. This document is not evidence of a submission.

Event sources: [hacker guide](https://go.unc.edu/HackNC2026-guide), [tracks](https://past-cushion-a6f.notion.site/HackNC-Tracks-756816442900834e900c016919f003e8), [prizes](https://past-cushion-a6f.notion.site/Prizes-Merch-3e681644290082d9aacd8159f40a5f1e), [Photon guidelines](https://somethingreat.notion.site/Hackathon-Guidelines-for-Photon-3dce443f36bb803696daf4135f063cd1), [Devpost](https://hacknc-2026.devpost.com/), [submission instructions](https://past-cushion-a6f.notion.site/IMPORTANT-Submission-Instructions-648816442900823890388190be1f899e).
