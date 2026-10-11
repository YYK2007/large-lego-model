# Large LEGO Model

An iMessage building assistant that turns a description or reference photo into a LEGO draft, lets you revise it, and delivers interactive instructions after you approve it.

Built for HackNC 2026 with Gemini, Photon Spectrum, React, Three.js and TypeScript. Independent project; not affiliated with or endorsed by the LEGO Group.

## How it works

**Request → checked preview → feedback → revised preview → Approve → building guide and files.**

- Describe a subject or send a photo. The generator looks for reference views, plans real parts, and checks connections and placement order.
- Give feedback on the preview. Revisions edit the saved placements; a failed edit keeps the earlier checked build.
- Approve the exact preview you want. The agent sends its interactive guide, a compact phone-viewing USDZ and an exact parts CSV. PDF instructions are optional through `/manual`; without a public guide URL, approval uses the PDF bundle fallback.
- The guide supports normal 3D rotation and zoom, part callouts, placement replay, step navigation and saved progress. AR is an optional action on supported devices.

The website supports the same models, inventory and downloads. Checked connections do not establish physical strength or visual accuracy. This is a working hackathon prototype; difficult subjects can still fail or need user refinement.

## Run locally

Use **Node.js 24 LTS** and npm. Node 22.12 or newer also meets the declared minimum.

```sh
git clone https://github.com/YYK2007/large-lego-model.git
cd large-lego-model
npm ci
cp -n .env.example .env
npm run dev
```

Open [localhost:5173](http://127.0.0.1:5173). The private API runs on port 3001. Curated samples work without API keys; they are labeled and never substituted for generated results. Start with the [courtyard castle](http://127.0.0.1:5173/?design=sample-castle) to try the viewer, build steps, parts list and exports.

To run the built app:

```sh
npm run build
npm start
```

The built website and private API are available at [localhost:3001](http://127.0.0.1:3001). Keep private services on loopback. Runtime jobs, conversations, credentials and user designs stay in ignored `.env` and `data/`; generated diagnostics stay in ignored `output/`.

## Connect services

Put keys in `.env`, never browser code or a `VITE_` variable.

| Service | Environment variables | Setup |
| --- | --- | --- |
| Gemini generation and chat | `GEMINI_API_KEY`, optionally `GEMINI_MODEL` | [Google AI Studio](https://aistudio.google.com/apikey) |
| Rebrickable catalog and owned sets | `REBRICKABLE_API_KEY` | [API setup](https://rebrickable.com/api/) |
| Photon iMessage | `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET` | [Photon dashboard](https://app.photon.codes/dashboard) |
| Shareable instruction guide | `PUBLIC_BASE_URL` | Your HTTPS origin forwarding **only to `127.0.0.1:3002`** |

After configuring Gemini and Photon, keep the API running and start the listener in another terminal:

```sh
npm run photon
```

This enables real replies to messages sent to your configured Photon line. Follow [Photon setup](docs/photon-setup.md) to configure test users and verify delivery on a phone. `/status`, `/stop`, `/approve`, `/instructions`, `/model`, `/manual`, `/parts`, `/retry` and `/new` are available; ordinary language works too.

**Public sharing uses only the signed read-only gateway on port 3002. Do not expose port 3001 or the Vite server.** A signed link grants access to one revision and its downloads; recipients can forward it. Keep `data/instruction-share-key` private and persistent. Local hosting requires the computer, API and tunnel to stay running. See [sharing boundaries](docs/imessage-3d-preview.md) and [security policy](SECURITY.md).

`PHOTON_VISUAL_REVIEW_ENABLED=false` is the demo default: reference analysis and construction checks remain active, but post-build Gemini visual scoring is skipped. User approval is always required. The older Quick choice is archived in code; new requests start directly without a mode question.

## Models and instructions

All previews, guides, parts lists and exports derive from the same checked placements. Owned inventory records exact part, color, quantity and source set or loose-brick lot. Photo inventory estimates require confirmation.

The bundled seed supplies 80 usable part types, with 36 built-in definitions, 44 imported definitions and 176 mapped opaque colors. Each part has its own supported color and connection combinations. Catalog discovery can resolve additional supported parts; a catalog listing alone does not make a connector usable or establish current marketplace stock.

Compact PDF instructions use landscape placement diagrams, pictured parts and repeated assemblies. Phone models merge geometry for rendering while exact part accounting remains in the canonical build. Optional OpenUSD tools (`usdcat` and `usdzip` on `PATH`) provide additional lossless binary packaging. Exports still work without them, but may be larger. Photon has an attachment transport limit; this is separate from the model's piece count.

Current limits:

- No application-imposed piece-count ceiling. Explicit user budgets and owned stock still apply; provider and execution limits remain.
- Upright stud connections and bounded insertion paths are supported. Arbitrary rotations, general subassembly search, hinges and bar/clip attachment are not generally supported.
- The workspace is 96 × 96 studs × 384 plate heights. The heuristic planner and packer can reject feasible designs.
- Clutch strength, tipping, torque and load-bearing stability are not physically simulated. A real hand-build remains necessary for physical validation.
- Resemblance is not guaranteed. Review-disabled drafts are labeled as not visually reviewed. Never treat a passed geometry check as a promise that the model matches its subject.

## Documentation and development

The [documentation index](docs/README.md) separates setup guides, implementation notes and historical research. Start with [the architecture map](docs/ARCHITECTURE.md) when working on the code, or [the live test guide](docs/live-testing.md) when checking the full flow.

`main` contains the current implementation. Create a feature branch from it and submit a pull request. See [contributing](CONTRIBUTING.md).

```sh
npm test
npm run build
```

Tests use mocked providers and need no API keys. Test files run with four-way concurrency to keep CPU-heavy geometry checks predictable. Optional OpenUSD checks skip when the tools are unavailable. GitHub Actions runs a clean install, tests and build without service credentials.

- [Current instruction-delivery checkpoint](docs/INSTRUCTION-DELIVERY-CHECKPOINT.md)
- [Detailed verification and historical checkpoints](docs/VERIFICATION.md)
- [Project objective](docs/OBJECTIVE.md) and [stages](docs/STAGES.md)
- [Reference and generation research](docs/generation-research.md)
- [Observed LEGO Builder assembly UX](docs/lego-builder-ux.md)
- [Catalog discovery and limits](docs/DYNAMIC-CATALOG.md)

## License and attribution

Project code is available under the [MIT License](LICENSE). Third-party assets and data retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md) and [bundled catalog attribution](docs/catalog-licenses/README.md).

The repository includes transformed LDraw part geometry and LDCad connector metadata with source hashes, authors and licenses. Rebrickable catalog facts are attributed; account inventories, credentials and product photographs are not bundled. The [Aero brick symbol](assets/brand/README.md) was generated for this project. This implementation does not bundle BrickGPT model weights.
