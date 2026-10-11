# Verification

Reviewed October 11, 2026. This page records the latest evidence and remaining checks. Detailed measurements, failed attempts and superseded limits are preserved in [verification history](archive/verification-history.md).

## Automated checks

The release merged in [PR #1](https://github.com/YYK2007/large-lego-model/pull/1) passed all 755 local tests and the production build. A clean Ubuntu / Node.js 24 [GitHub run](https://github.com/YYK2007/large-lego-model/actions/runs/38135795150) passed install, tests and build. Optional OpenUSD checks skip on hosts without those tools; they passed locally.

The first CI run exposed a test whose 500 ms allowance could expire during cache loading. The test now triggers deadline expiry at the mocked pending request. Production deadlines are unchanged. A separate checkout without `.env` or runtime data also passed installation, the then-current 752 tests and the build.

Coverage includes geometry and insertion checks, revisions, inventory limits, generation deadlines, Stop, duplicate messages, restart recovery, approval binding, partial delivery, public gateway restrictions and matching exports. Passing those tests doesn't guarantee that Gemini will generate an accurate subject.

## Documentation cleanup

The October 11 documentation pass separated current instructions from historical records, added a source-file map and rewrote setup and live testing around the approval flow. All 755 tests and the production build passed again. Local Markdown file links and heading anchors were checked; active guides were checked against the source. The only application change was removing stale copy about two selectable modes.

## Recent fixes

A saved 1,889-piece Bell Tower had a connected structure but failed placement ordering. A bounded additional schedule now places the required anchors and their lower support chain earlier. The original geometry and parts list pass with all mating, collision and insertion checks retained. A reduced regression fixture reproduces the failure; closed cavities and unrelated collisions remain rejected.

Repair feedback now identifies blocked positions and editable plan sections. A malformed patch doesn't replace the complete plan used for the next repair. Failed requests retain the previous checked preview and its own prompt/photo context. The recovered tower was returned as an unapproved revision without another Gemini request.

Final files require approval of the selected preview. Feedback starts from saved placements, and a new revision can't inherit its parent's approval. Stop cancels pending work and late delivery; messages already handed to Photon may still arrive. Unfinished attempts stay private.

Exact and phone-viewing USDZ exports retain imported-part source URLs, hashes, authors, licenses and modification notes in USD metadata. Tests check that lossless compaction preserves both attribution and geometry. OpenUSD's AR package checker accepted the fixture locally.

## Phone and browser evidence

| Check | Observed result | Limit |
| --- | --- | --- |
| Ordinary iMessage conversation | User confirmed a natural reply without generation | One reported exchange, not every phrasing |
| USDZ delivery | User confirmed rose, garden and Wilson attachments arrived and rotated | File opening doesn't establish subject likeness |
| PDF delivery | User confirmed the manual arrived and opened | Doesn't establish a successful physical build |
| Interactive guide | User confirmed opening, rotation and placement controls | Latest approval and Stop changes need another phone pass |
| Resume and AR | User reported that both seemed to work well | Qualified report, not a frame-rate measurement |
| Phone layout | Browser inspection at 320- and 390-pixel widths and landscape found no horizontal overflow | Responsive-browser evidence, not every device |
| Public PDF preparation | Cold preparation completed through bounded polling; download and byte ranges passed | Requires the host and tunnel to remain available |

The [instruction checkpoint](INSTRUCTION-DELIVERY-CHECKPOINT.md) retains measured model sizes and PDF reductions. Private screenshots, logs and generated models live in ignored `output/`; they aren't included in a fresh clone.

## Checks still open

1. On a phone, request a targeted edit, inspect the revised preview and approve it. Confirm that no final guide or file is delivered before approval and all final files match that preview.
2. Send Stop during generation and during pending final delivery. Confirm the acknowledgement and that no later work is started for that request.
3. Run a varied evaluation across organic forms, buildings, natural wonders and everyday objects. Keep every outcome and inspect distinct views against references.
4. Test a counted physical inventory, including an unavailable requested color, and hand-build a small generated model from its instructions.
5. Benchmark phone rendering and repeat the AR check after model or UI changes.

Use [the live test guide](live-testing.md) for reproducible steps. Geometry, resemblance, physical assembly and device delivery need separate results.

## Repository checks

The release audit found no configured secrets, high-confidence credential patterns or signed build links in the scanned Git history. Runtime data and credentials remain ignored. Historical local paths and contributor email metadata remain in earlier commits; history wasn't rewritten. Scope and limitations are recorded in [public-release preparation](PUBLIC-RELEASE.md).
