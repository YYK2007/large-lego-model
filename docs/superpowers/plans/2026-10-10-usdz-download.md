# Reliable USDZ Download Implementation Plan

> **For agentic workers:** Use the `executing-plans` skill for native implementation in this chat, or `subagent-driven-development` if the user selects that approach. Track the steps below with checkboxes. Completed with native implementation and independent review. Draft PR: https://github.com/YYK2007/sprout-hacknc2026/pull/2.

**Goal:** Download a complete USDZ file for the exact model revision the user clicked, expose useful failures and retry, retain a working HTTP save link, and deliver an independently mergeable draft PR.

**Architecture:** Retain the existing canonical brick geometry, Three.js USDZ exporter, immutable snapshot endpoint, and export route. Put USDZ request orchestration and response checks in a small frontend module, with a surgical integration into `App.tsx`. Test the actual generated archive and the browser's saved file rather than treating a completion message as proof of download.

**Tech stack:** Existing React, TypeScript, Three.js, Express, Node 22+, `node:test`; bundled Playwright for browser verification. No new product dependencies.

**Spec:** The bounded design approved in this chat; `AGENTS.md`; `docs/OBJECTIVE.md` requirements 3–4; `docs/VERIFICATION.md` section “USDZ page and archive checks.” This plan adds explicit acceptance criteria below without expanding into generation or iMessage implementation.

## Current evidence

- Repository cloned from `YYK2007/sprout-hacknc2026`, branch `feat/brick-studio`.
- Dedicated contribution branch: `fix/usdz-download-validation`, starting at `2c12206`.
- Dependencies installed with `npm ci`; installation audit reported zero vulnerabilities.
- All **11 existing native-model tests passed**. They inspect real archive alignment, units, colors, geometry references, bodies, studs, and orientations across samples and catalog parts.
- The existing page already creates an immutable snapshot, fetches USDZ, triggers a blob download, and exposes a direct HTTP save link. It currently accepts any successful response body as a model and has no download deadline.
- No product files have changed. The full suite, production build, actual browser download, and remote PR access still need fresh verification.
- Earlier documentation records successful desktop downloads, but those are historical results. This work must produce fresh evidence before claiming the current flow works.

## Global constraints

- Keep the direct **Download 3D (.usdz)** action on the build page.
- Capture the clicked revision before exporting, show failures clearly, and preserve it if the user switches models during preparation.
- All outputs must come from the same validated brick model.
- Preserve the direct HTTP **Save USDZ file** fallback for embedded browsers; its link must reference the frozen snapshot.
- Preserve PDF, CSV, LDraw, PNG, generation, catalog, inventory, and Photon behavior.
- Do not add piece limits, reinterpret placements, change dependencies, or redesign the page.
- A browser download establishes file delivery. Apple Quick Look, target-iPhone rotation, scale, and iMessage delivery require separate device tests.
- Keep credentials, saved user data, generated files, and screenshots out of Git.
- Target the draft PR at `feat/brick-studio`; never merge it or force-push teammate branches.

## Acceptance criteria

1. A real page click saves a nonempty `.usdz` containing the clicked model's exact bodies, studs, colors, and metric Y-up transforms.
2. Switching models during preparation preserves the requested export and its title, filename, and fallback link.
3. HTTP errors, HTML/JSON returned with HTTP 200, empty/truncated files, interrupted streams, and stalled requests produce an actionable error and permit retry.
4. A successful response must contain a recognizable complete USDZ archive before the UI reports that the file is ready. These transport checks do not claim to validate every USD semantic rule.
5. Repeated clicks while preparing cause one active export. The studio remains usable during the asynchronous request.
6. The HTTP fallback works after the automatic browser download and remains available when the selected model changes.
7. Existing tests and production build pass, with fresh desktop and narrow-screen checks recorded.
8. The draft PR contains focused changes and explains merge-sensitive files and remaining device checks.

## Review focus

- A deployment/proxy returns an HTML page with HTTP 200: show an export error instead of downloading HTML as USDZ. Task 1 tests this.
- Headers arrive, but the file stream stalls or ends early: release progress state and enable retry. Tasks 1 and 2 test this.
- The selected design or inventory changes while the request is pending: export the captured inputs and preserve the original title. Tasks 1 and 2 test this.
- An embedded browser suppresses the programmatic blob download: keep the independently clickable HTTP save link. Task 3 tests this where the browser is available.
- A large model downloads correctly but consumes substantial memory or blocks the API: measure the existing castle export and report the limitation; do not add caching/workers without evidence and a scope decision. Task 3 checks this.

## File ownership and merge strategy

| File | Responsibility | Planned change |
| --- | --- | --- |
| `src/usdz-download.ts` | Freeze export inputs, save snapshot, fetch USDZ, check response, return download metadata | New module |
| `tests/usdz-download.test.ts` | Response, request, cancellation, and snapshot regression coverage | New tests |
| `src/App.tsx` | Progress, notices/errors, download trigger, persistent HTTP fallback | Small import and USDZ branch integration only |
| `scripts/check-usdz-download.mjs` | Repeatable browser checks against a running studio | New development-only harness |
| `docs/superpowers/plans/2026-10-10-usdz-download.md` | This plan and execution tracking | New document |
| `docs/VERIFICATION.md` | Fresh results and remaining device requirements | One appended section |

Avoid edits to `server/index.ts`, `server/native-model.ts`, `server/store.ts`, shared geometry, CSS, package files, and broad documentation. If the baseline exposes a defect there, reproduce it with a regression test first and document the necessary scope adjustment. If another agent already supplies an equivalent fix, retain its implementation and adapt tests rather than duplicating it.

## Task 1: Implement a checked, bounded USDZ request

**Files:** Create `src/usdz-download.ts` and `tests/usdz-download.test.ts`.

**Interfaces:**

```ts
type UsdzDownload = {
  url: string;       // direct HTTP URL for this immutable snapshot
  file: Blob;
  filename: string;  // sanitized clicked title, ending in .usdz
  title: string;     // clicked title, even after the viewer changes
};

type UsdzRequestOptions = {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
};

export function prepareUsdzDownload(
  design: Design,
  inventory: InventoryItem[],
  options?: UsdzRequestOptions,
): Promise<UsdzDownload>;
```

- [x] **Establish the baseline.** Run `npm test` and `npm run build`, then fetch a sample USDZ through the running API. Record any failures before changing behavior. Confirm MIME type, attachment filename, nonzero size, and archive integrity. Use sample designs without AI calls.
- [x] **Write request-contract tests first.** Use a disposable localhost HTTP fixture following `tests/dev-proxy.test.ts`; use the real exporter for successful payloads. Capture the POST body and independently assert the initial brick placements and inventory quantities. Delay the fixture, mutate caller inputs, and assert the saved request, returned title, filename, and snapshot URL remain those originally clicked. Assert `/api/designs` POST precedes the snapshot's `model.usdz` GET. Ensure failures never yield a download result.
- [x] **Run and observe the missing behavior.** Run `node --import tsx --test tests/usdz-download.test.ts`. Distinguish an unimplemented interface from test-fixture errors; after the interface exists, regression cases must fail on behavior before their fixes.
- [x] **Implement the request flow.** Clone the design and inventory synchronously before the first await. Use the existing `/api/designs` endpoint and returned snapshot ID. Require a nonempty safe snapshot ID; do not fetch an undefined ID. Use a single **120,000 ms** deadline covering snapshot creation, export transfer, and response reading, combined with the caller's optional abort signal. Do not automatically retry snapshot creation.
- [x] **Write malformed-response regressions.** Cover JSON HTTP 503, non-JSON HTTP 502, HTTP 200 HTML/JSON, zero bytes, a ZIP header with no completed archive, and a truncated real exporter archive. Use real `Response` bodies or the disposable HTTP fixture; assert rejection and readable error messages rather than exact cosmetic wording. Preserve an API error string when valid; otherwise give a download-specific fallback.
- [x] **Implement response checks.** Accept the canonical `model/vnd.usdz+zip` type and binary `application/octet-stream`. Check the first local ZIP entry starts with a USD root layer (`.usda` or `.usdc`), is stored uncompressed, and starts on a 64-byte boundary. Check the end-of-central-directory record and its declared bounds/counts against the received blob size, including the central-directory signature. Reject incompatible, empty, malformed, or incomplete payloads. Use small `Blob.slice()` reads rather than duplicating an entire large archive in memory. Existing server archive tests remain responsible for full placement/geometry verification.
- [x] **Write interruption/cancellation regressions.** Destroy a response socket after headers and initial bytes; assert rejection. Stall a fixture and abort using the caller's signal; assert prompt termination. Perform a second successful request afterward to establish that a failure does not prevent retry. Close all fixture sockets in test cleanup.
- [x] **Verify and commit the module.** Run `node --import tsx --test tests/usdz-download.test.ts tests/native-model.test.ts tests/store.test.ts`. Commit only the module/tests with `fix: validate USDZ downloads and bound export requests`.

## Task 2: Integrate the checked request into the existing page

**File:** Modify only the USDZ path in `src/App.tsx`.

**Consumes:** `prepareUsdzDownload()` and `UsdzDownload` from Task 1.

**Produces:** Existing direct button and export-dialog button use the same checked download; existing `modelDownload` state continues to hold the HTTP fallback URL, title, and size.

- [x] **Add browser regressions before the integration.** Start the studio and inspect its rendered controls. In the browser harness, intercept only the export response to return HTTP 200 HTML, an empty file, and a delayed interrupted response. Assert an error is visible, no `.usdz` download is accepted, the model remains selected, and the direct button becomes usable again. The malformed-success cases should fail against the current page.
- [x] **Make the surgical integration.** Call the helper only for `model.usdz`; keep the other export branches intact. Use the helper's captured title/filename and HTTP URL. Preserve the existing attached-anchor click, delayed blob URL revocation, ready notice, and save-link behavior. Set busy state before starting and clear it in `finally`. Convert deadline expiration to a clear “download timed out; try again” error. Guard duplicate submissions if the browser regression demonstrates the React-state guard permits them.
- [x] **Test revision switching and duplicate clicks.** Delay the export, switch from castle to rocket, then complete the download. Assert the archive/filename/fallback still refer to castle while the viewer shows rocket. Double-click the direct button and assert one snapshot/export request. Verify the export-dialog action uses the same path.
- [x] **Test recovery and existing exports.** Inject HTTP 503, then retry successfully. Confirm the prior successful fallback remains correctly labeled if a later request fails. Smoke-check manual, CSV, LDraw, and PNG actions for unintended changes; retain existing PDF tests rather than adding duplicate PDF coverage.
- [x] **Verify and commit integration.** Run `npm test` and `npm run build`. Commit the focused `App.tsx` integration and browser harness with `fix: surface checked USDZ downloads in the studio`.

## Task 3: Verify actual saved artifacts and open the draft PR

**Files:** Append evidence to `docs/VERIFICATION.md`; generated artifacts stay in ignored `output/usdz-download/`.

- [x] **Run fresh desktop and narrow-screen verification.** Use a real Chromium browser at desktop size and 390-pixel width. Click the rendered direct button, capture the download, and save the file under ignored output. Confirm the correct filename, visible progress/ready state, usable fallback, and no horizontal overflow. Inspect screenshots. Record separately any available embedded-browser fallback check; do not claim it passed if that browser is unavailable.
- [x] **Verify downloaded bytes.** Check ZIP integrity, uncompressed entries, 64-byte alignment, and the expected root. Extend/reuse the actual-artifact assertions in `tests/native-model.test.ts` as appropriate to verify the downloaded castle has **1,345 bodies** and the sample's exact positions, studs, colors, and metric transforms. Do not compare only file size or count the request as proof of save.
- [x] **Record large-export behavior.** Export the curated castle while probing API status, record elapsed time/file size, and note any event-loop stall. Report any unresolved large-file or target-device limitation; adding export workers or caches requires a demonstrated need and revised scope.
- [x] **Complete review and evidence.** Run the full `npm test` and `npm run build` after the final product edit; report all failures and Vite's existing bundle advisory accurately. Append a focused verification section with commands, outcomes, artifact paths, browser environment, and untested phone/iMessage behavior. Review the diff against this plan and the repo instructions.
- [x] **Check teammate changes before publishing.** Fetch `origin/feat/brick-studio` and inspect its new commits/diff. If it advanced, integrate its commits into this dedicated branch without rewriting another agent's work; resolve only this change's conflicts and rerun affected checks. Inspect the final PR diff against the current target branch for unrelated changes.
- [x] **Commit and push.** Commit only planned files and push `fix/usdz-download-validation`. Verify GitHub authentication with network access; an earlier sandboxed auth check was inconclusive. If CLI access is unavailable, use the connected GitHub capability. If neither can publish, preserve the local commits and report the exact required account action.
- [x] **Open and attach the draft PR.** Base: `feat/brick-studio`; head: `fix/usdz-download-validation`. Describe the malformed/stalled-download problem, resulting user behavior, test evidence, and target-device limitations. Identify the small `App.tsx` hunk for parallel agents. Attach the created PR to this chat with `attach_artifact`. Do not merge.

## Completion report

Provide the draft PR link, concise behavior changes, full-suite/build/browser results, and any remaining device checks. Include the branch name so other agents can merge or cherry-pick the focused commits. The user approved native implementation; publication follows final review.

## Approved phone-performance follow-up

The user reported infinite loading for the castle on an iPhone 14 in iMessage. Apple's binary repackaging of the unchanged 6,118-mesh scene also failed on that phone. Combining the exact geometry into six color meshes succeeded; the user separately confirmed that the portable Three.js-packaged six-mesh file opens and rotates. The user approved making this the normal export; AR is not required for this acceptance check.

The bounded follow-up changes `server/native-model.ts` to batch canonical bodies and studs by their shared color material, bake their placements, preserve normals and triangle topology, and retain metric Y-up scale. It adds no converter, dependency, piece limit, geometry simplification, or frontend redesign. Source shapes are indexed once and cached; temporary transformed copies are released before serialization. Oversized colors split between whole components at one million triangle corners per batch, keeping each geometry layer below the runtime's string-size limit. This does not bound total export memory. Tests and the browser harness inspect the resulting actual triangle streams instead of requiring a separate USD mesh name for every component. Existing literal dimension, orientation, stud-spacing, winding, and color assertions remain.

This approved scope adjustment supersedes the earlier instruction to avoid `server/native-model.ts`. Shared geometry, generation, inventory, PDF, CSV, LDraw, and PNG implementations remain outside the change. The existing draft PR receives a separate focused exporter commit; actual Photon delivery, AR, and larger-model phone performance remain separate checks. Baking repeated geometry increases archive size and export cost, which must be recorded with the final verification evidence.
