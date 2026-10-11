# Public repository preparation

Reviewed October 11, 2026. Making source public is separate from exposing the private generation API or changing the live demo.

- Original code has the owner-selected MIT license. Bundled geometry and connector data retain their own notices and source records.
- README, contribution instructions, environment example and security policy describe a fresh setup and the signed public gateway boundary.
- Node.js 24 is selected for CI. Official GitHub Actions are pinned to commit IDs and have read-only repository permission. Tests need no service credentials.
- A separate checkout without `.env` or runtime data passed a clean `npm ci`, all 752 pre-attribution tests and the production build. Runtime dependency audit reported zero known vulnerabilities at the time of review; that is not a permanent security guarantee.
- The credential audit covered the then-reachable 31 commits and 582 historical blobs, plus tracked working files. No configured secret matches, high-confidence credential patterns or signed build links were found. The scan does not prove that arbitrary unknown secrets can never exist.
- Current source/docs contain no matched live runtime IDs or personal absolute paths. Private credentials, jobs, conversations, photos, generated outputs and signing material remain ignored.
- Exact and mobile USDZ exports now retain used imported-part attribution in USD metadata. Compaction preserves the credits and geometry; the focused export tests and OpenUSD AR package validation pass.
- Git history was preserved. Earlier commits still include obsolete local filesystem paths and runtime IDs, and normal commit metadata includes contributor email addresses. These are not authentication credentials. An owner who wants a different public history must choose that explicitly before publication; no force-push or history rewrite was performed.

Repository visibility remains private until the owner explicitly chooses to publish it. Project limitations and physical/device verification boundaries remain documented; public source does not imply production readiness or guaranteed generation success.
