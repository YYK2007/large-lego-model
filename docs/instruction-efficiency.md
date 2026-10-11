# Instruction and delivery efficiency

The primary guide is ordinary interactive 3D, with whole-model inspection and checked assembly steps. AR is optional. PDF generation is deferred until requested; approval need not wait for hundreds of printed diagrams. This follows the interaction priorities observed in [LEGO Builder](https://www.lego.com/en-us/builder-app): rotate/zoom, pictured part trays and progress. Our mini-app uses [Photon app cards](https://photon.codes/docs/spectrum-ts/content/app), with a Safari link and one-time Spectrum launcher installation. These are documented platform capabilities; new phone behavior remains an acceptance check.

## File and rendering work completed

- Shared binary USD layers preserve exact geometry without flattening every placement. The approved Wilson file fell from 9.16 MB to 2.62 MB.
- A separate viewing copy removes only conventional covered studs, retains all piece bodies/exposed studs/imported shapes and merges by color. Wilson is 7.06 MB with 7 meshes and 263,708 triangles instead of 1,961 meshes and 6,709,948 triangles. It sacrifices tiny stud bands visible in cosmetic seams, and is labeled accordingly. Exact files and all assembly/inventory data remain available. Byte size and rendering cost are different measurements.
- Both exports have bounded content-keyed caches and duplicate-request suppression. Optional binary converter failures keep a valid portable archive. No part-count cap was added.
- Landscape PDF spreads combine two diagram panels and exact repeated steps. Cached pictured parts and 96 dpi PNG for dense diagrams preserve vector text while reducing repeated rendering work. The 3,135-piece Bell Tower measured 199 pages, 14.69 MB and 53.16 seconds, versus 395 pages, 18.87 MB and 309 seconds. See `VERIFICATION.md` for exact evidence and scope.

Apple's [Quick Look documentation](https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look) and [2023 optimization session](https://developer.apple.com/videos/play/wwdc2023/10274/) informed the native viewing path. A successful archive check is not a phone performance measurement.

## Generation and part economy audit

Current construction already tries mixed bricks first, compares valid candidate packings by piece count, bounds optional optimization to two seconds and retains a valid candidate. Prompts favor economical scale, useful larger parts and necessary support; reference/catalog lookups have caches. More pieces do not establish better resemblance.

The approved Wilson job `2062a96a-c414-4479-b16e-de5055ace88a` took 149.1 seconds, six provider calls and four construction attempts with visual review disabled. Its 1,961-piece result has 1,960 plates and one tile. It predates the latest economy strategy. An in-memory audit of saved copy `a786f304-2cec-4519-a733-e39e9ce09a98` (brick array byte-for-byte identical to approved `24a4987f-6588-4f09-8646-aaa27c80e762`) replaced 238 disjoint, same-color, same-footprint three-plate stacks with verified bricks. The resulting 1,485 pieces passed full geometry/assembly validation in 92 ms. The fixed tile stayed unchanged; this build had no owned inventory. Nothing was saved or delivered, and this experiment is not a released optimizer.

A future exact-stack compactor must preserve fixed pieces, produced colors, occupied volume and owned stock, then revalidate the complete assembly and keep the original on failure. Arbitrary same-volume retiling can change seams, connectivity and assembly order. Do not replace an approved revision in place.

The next useful latency measurements are per-provider-call stage/attempt, duration, input/image sizes and usage; painting/packing/validation/repair times and resulting piece counts; and separate checked-draft, saved, preview-rendered and Photon-acknowledged timestamps. Current aggregate usage and stage events cannot establish which dominates every slow request. No fresh paid generation batch was run for this instruction increment.
