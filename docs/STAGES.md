# Build stages

The current implementation is on `main`. Work in focused branches for review unless the owner requests a direct commit. Repository visibility is separate from deployment: publishing source doesn't expose the local app or its signed guide.

The [verification record](VERIFICATION.md) separates automated coverage, device reports and remaining gaps. Earlier checkpoint notes are preserved in [stage history](archive/stage-history.md).

## 1. One model across the website and exports

Implemented: the studio, saved revisions, part counts, inventory allocation, assembly sequence and PDF, CSV, LDraw and USDZ exports share checked placements. Samples are labeled. The seed contains 80 usable part types and 176 mapped opaque colors.

Review a volumetric model from several sides, follow its placement sequence and compare every export with the same revision. Render and inspect manual pages. Automated geometry checks don't establish clutch strength, balance or physical stability.

## 2. References, generation and targeted edits

Implemented: Gemini planning, reference-photo analysis, optional 3D references, structural repair, simpler-part recovery and targeted edits to saved placements. Owned-only generation enforces confirmed stock. Photo inventory estimates require confirmation.

Remaining: dependable resemblance and completion across a varied set of subjects. Keep failed runs in the evaluation record. Compare silhouette, proportions and defining features from multiple views; don't count extra pieces or one successful landmark as broad progress.

Use [the live test guide](live-testing.md) to check requests, revisions, images and inventory. Broader part support must pass the [catalog admission checks](DYNAMIC-CATALOG.md), including geometry, connections, insertion and exact exports.

## 3. iMessage feedback and approval

Implemented: direct requests, natural conversation, progress, Stop, checked previews, revisions, explicit approval and delivery retries. Quick mode is archived. The demo's post-build visual critic is disabled while reference analysis and structural checks remain active.

The flow is request → checked preview → feedback → revision → approval → final bundle. Before approval, send only the preview and feedback request. Final files belong to the exact approved revision. Each edit needs fresh approval.

Automated tests cover routing, duplicates, restart recovery, approval races and partial delivery. Phone reports confirm ordinary replies, model rotation, PDF delivery and guide navigation. The latest Stop and approval fixes still need their final device confirmation.

## 4. Interactive building guide

Implemented: a signed read-only guide with whole-model inspection, rotation and zoom, part callouts, placement replay, step navigation and saved progress. AR is optional. A compact PDF and exact parts CSV remain available.

The current guide runs through a Cloudflare tunnel to the local read-only gateway. The host computer, API and tunnel must stay running. Follow [Photon setup](photon-setup.md) and keep private generation routes off the public origin.

Repeat phone checks after meaningful UI or export changes. Verify the app card and browser fallback, narrow portrait and landscape views, resume, downloads and AR separately. Earlier device success doesn't prove a later change works.

## 5. Release and handoff

MIT covers the original project code. Third-party assets retain their licenses. Setup, security, contribution and attribution documents are checked in, and GitHub Actions runs a clean install, tests and build without service credentials.

Before a demo, rehearse one full request, targeted edit, approval and final bundle. Check quota, the Photon line and public guide reachability. Use a saved sample to demonstrate the viewer if a provider is unavailable, and identify it as a sample.

Keep voice notes, cooperative assembly, general connector families and physical simulation as future work. See the [accepted objective](OBJECTIVE.md) for the full requirements.
