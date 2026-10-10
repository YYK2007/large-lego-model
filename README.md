# Large Lego Model

Turn an idea and existing LEGO bricks into a detailed three-dimensional build, exact parts list, and illustrated instructions. **Large Lego Model** is the architecture name. **Sprout** is a provisional product name.

HackNC 2026 · React / TypeScript / Three.js / Node · Gemini · Photon Spectrum

## Run the review checkpoint

Requires Node.js 22 or newer and npm. Clone this repository, then:

```sh
npm ci
cp -n .env.example .env
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The API runs on port 3001. The website updates automatically during frontend edits; restart `npm run dev` after server/shared-code changes. Credentials are re-read from `.env` when used.

The six curated sample builds work without API keys. Start with the [1,345-piece courtyard castle](http://127.0.0.1:5173/?design=sample-castle): hollow towers, a central keep, furnished rooms, window openings, and five sloped roofs. Samples are labeled and are never substituted for an AI response. Rotate the model, open **Build steps** and **Pieces**, add owned bricks, then use **Let's build** for the matching PDF, CSV, LDraw model, USDZ, and preview. Assembly steps contain at most 12 new pieces with per-piece navigation, exact part/color quantities, a top-down placement map, replay, and saved viewing progress.

There is no application piece-count ceiling or default small-piece budget. Explicit API budgets and owned-only stock still apply. Review this checkpoint with `npm test` and the castle's 127-step guide; additional pieces alone do not establish good design.

## Connect the real services

| Service | Local environment variables | Setup |
| --- | --- | --- |
| Gemini | `GEMINI_API_KEY`, optional `GEMINI_MODEL` | [Google AI Studio](https://aistudio.google.com/apikey) |
| Rebrickable | `REBRICKABLE_API_KEY` | [API key instructions](https://rebrickable.com/api/) |
| Photon Spectrum | `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET` | [Photon dashboard](https://app.photon.codes/dashboard), HackNC promo `HACKWITHPHOTON` |
| Phone viewer links | `PUBLIC_BASE_URL` | Your deployed HTTPS origin; localhost does not work on someone else's phone |

Keys belong only in `.env`, which Git ignores. Never use a `VITE_` prefix for these secrets. The app's Connections panel reports configured fields, not a successful live service test.

After configuring Photon and Gemini, run `npm run photon` in a separate terminal. This starts a real agent that replies to incoming messages. See [Photon setup and track requirements](docs/photon-setup.md). The app's **Copy command to continue in iMessage** action freezes the current design and inventory and gives you an `/open` command for that worker.

## Architecture

```mermaid
flowchart LR
  A[Text or inspiration image] --> B[Gemini: colored shape plan]
  C[Confirmed inventory] --> D[Catalog brick compiler]
  B --> D
  D --> E[Geometry and inventory checks]
  E -->|rejected: bounded repair| B
  E -->|accepted| F[Immutable design revision]
  F --> G[Three.js preview]
  F --> H[Parts and source allocation]
  F --> I[PDF and LDraw]
  F --> J[Photon feedback loop]
```

Gemini describes occupied colored space, directional slope runs, and repeated feature groups. Its planning instructions prioritize actual openings, interiors, floors, roofs, and connected sections. The compiler chooses real catalog pieces, interlocks neighboring layers where possible, and enforces exact stock in owned-only mode. No overlap, unsupported elevated piece, or disconnected final assembly passes the geometry gate. A request gets one initial plan and at most one repair within a shared 60-second provider deadline. The UI reports progress; failure preserves the current design. These checks do not yet verify every requested semantic feature.

All outputs derive from the same placements. Exported/shared snapshots receive new IDs and cannot overwrite earlier revisions. Source allocations retain exact part/color and the set instance or loose-brick lot. An inventory photo produces suggestions that the user must confirm.

## Current boundaries

- Ten real part IDs: seven upright bricks, 3022 and 3020 plates, and 3039 upright slopes; nine colors and four yaw orientations. Coordinates use studs horizontally and plate heights vertically. The physical workspace remains 24 × 24 studs × 72 plate heights; there is no piece-count ceiling. Request size, provider output, and execution-time limits still apply. The heuristic compiler may reject feasible geometry or inventory instead of finding an optimal packing.
- Geometric support and connectivity are checked. Clutch strength, torque, tipping, material wear, and intermediate physical stability are **not simulated**. A real hand-build remains part of demo validation.
- Tiles, curves, wedges, and verified moving/connector families remain required catalog expansions. Current parts stay upright on the stud grid; slope collision envelopes are conservative. Specific part/color availability has not been checked against current catalogs. Minifigures, arbitrary mesh conversion, and collaborative assembly remain unimplemented.
- Rebrickable imports the endpoint's available set inventory. It excludes spares/unsupported parts and does not automatically resolve alternate historical inventory versions. Verify counts against the physical set.
- Earlier live Gemini text/recolor and owned-only checks passed. The new complex-generation path has only deterministic/offline verification: a live test timed out, then a second returned the project's exhausted daily free-tier quota (20 requests for this model). The castle is curated. Complex AI quality and improved successful latency remain unverified; see the verification record. Rebrickable, Photon delivery, and target-iPhone behavior also need live checks.
- The API binds to localhost by default. Before public hosting, add user authentication, quotas, durable shared storage, and deployment-specific origin controls. This checkpoint is a local/team prototype.

## Team workflow

- `main`: clean research baseline.
- `feat/brick-studio`: current review implementation. Make your own branch from it for contributions; do not force-push a teammate's work.
- [Stage checklists](docs/STAGES.md) define what is ready to review and what remains.
- [Accepted objective](docs/OBJECTIVE.md) preserves scope, including native 3D feedback in iMessage and later ElevenLabs voice.
- [Verification record](docs/VERIFICATION.md) records checks and service boundaries.

```sh
npm test
npm run build
npm start
```

`npm start` serves the built frontend and API at [http://127.0.0.1:3001](http://127.0.0.1:3001). Local runtime state is stored under ignored `data/`. Generated review artifacts are under ignored `output/`.

## Research and attribution

- [Generation options and the BrickGPT decision](docs/generation-research.md)
- [Observed LEGO Builder screens and assembly UX](docs/lego-builder-ux.md)
- [Complex models and catalog expansion](docs/complex-builds.md)
- [First plate and slope increment](docs/part-catalog-increment.md)
- [Parts, geometry, inventory provenance, and instructions](docs/parts-research.md)
- [Native 3D viewing and messages](docs/imessage-3d-preview.md)
- [HackNC / Photon setup and sources](docs/photon-setup.md)

The code implements a new restricted compiler; it does not include or run BrickGPT model weights. Rendered brick exteriors are procedural geometry with catalog dimensions, rather than redistributed LDraw library assets. LDraw exports reference official part filenames. Rebrickable catalogs and images are not bundled. LEGO is a trademark of the LEGO Group; this is an independent hackathon project.
