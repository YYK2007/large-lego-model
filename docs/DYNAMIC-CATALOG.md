# Dynamic part catalog

A fresh checkout includes 80 usable part types: 36 built-in definitions and 44 imported definitions in `server/catalog-seed.json`. The seed also contains 176 nontransparent colors with mapped LDraw IDs and evidence of produced part/color combinations. It includes flower parts 24866 and 33291, and petal part 93604.

The seed works without a developer's local cache. Additional verified imports are stored under ignored `data/catalog/`. Catalog records describe parts and historic colors; they don't establish current stock, price, or whether a particular seller has the piece.

## Setup and discovery

Configure `REBRICKABLE_API_KEY` in your local `.env` before resolving more parts. The public bulk index needs no key, but exact part identity and produced colors use the Rebrickable API. The commands below don't call Gemini or print credentials.

From the repository root, resolve a bounded set of candidates:

```sh
node --import tsx scripts/check-catalog.ts --budget-ms 45000 --limit 48
```

You can supply search terms separated by `|`, explicit part IDs, or both:

```sh
node --import tsx scripts/check-catalog.ts --budget-ms 45000 --limit 48 --query 'Wedge Plate|Brick Arch' --parts 3021,54200
```

Explicit IDs supplement the search. `--limit` accepts 1–500 and controls the search candidate count, not the total number of usable parts. `--budget-ms` must be a positive integer. The script reports supported, unsupported and unresolved candidates, with reasons and warnings.

An uncached import may first download the official LDraw library and shared color records. This can use most of the first allowance. The initial library download measured about 146 MB during the October 10 warm-up; its size can change.

If targeted discovery runs out of time, it retains verified cached and partial results and reports a warning. Unresolved candidates remain pending. Run the command again to continue. An explicit caller cancellation aborts the operation; other setup or source failures can still make the command fail.

The running API also exposes catalog search:

```text
GET /api/catalog/search?q=flower&offset=0&limit=40
```

The response includes paginated records, the match count and whether each record is already supported for assembly. Search covers the full downloaded index. Exact IDs rank first, plural flower queries find singular catalog names, and compatible unprinted shapes rank ahead of printed or non-System matches at equal relevance. A search result alone is not an admitted part.

## Scan the full index

```sh
npm run catalog:sync -- --budget-ms 45000
```

This script passes `--all` to the catalog checker. It walks the index with ordinary rectangular bricks and plates first, then checkpoints each examined record in `data/catalog/expansion.json`. Rerunning resumes from that checkpoint.

```sh
npm run catalog:sync -- --budget-ms 45000 --restart
npm run catalog:sync -- --budget-ms 45000 --refresh
```

`--restart` starts the scan again while retaining resolved assets. `--refresh` downloads the current public index and starts over if its IDs or ordering changed. Source failures leave the current record pending for the next run.

The allowance limits each run, not the total catalog size. A completed scan means every indexed record was considered. Parts with unsupported geometry or connections still cannot be used.

## How parts reach a build

A saved design carries its used definitions in `catalog: CatalogManifest`: flattened LDraw meshes, verified upright stud and underside sites, produced colors, and source URLs, hashes, licenses and authors. Collections retain the definitions and color metadata they need too.

`resolveCatalog(manifest)` combines that snapshot with the built-in definitions. Eligible imports don't need a new source-code entry or mutable global registration. Conflicting snapshots for the same part ID are rejected.

At the API boundary, `verifyCatalogManifest` compares submitted definitions with trusted seed, resolved or retained historical snapshots. A hash supplied by a client does not establish that its geometry is verified. Older trusted snapshots remain admissible after the numerical envelope correction.

Active generation and the archived Quick implementation both load the seed and trusted local cache before planning. Detailed generation can resolve additional candidates within a 15-second allowance when a Rebrickable key is configured. Archived Quick uses the already verified palette without that discovery step.

Both paths can place real specialty pieces explicitly. The compiler packs ordinary filled volume with rectangular parts; it doesn't substitute an arbitrary curved part into that filler. The planner receives actual dimensions, connector sites and produced colors for explicit placements. After repeated construction failures, a new build can fall back to simpler bricks and plates, so access to specialty parts doesn't guarantee their use in every result.

Seed and cached parts are also available to set import and the loose-part selector. Saved builds retain their own catalog snapshot as the shared cache grows.

## Admission rules

Geometry comes from the official LDraw library. The importer flattens its source faces and actual stud meshes, while LDCad Shadow Library metadata supplies candidate connection sites. The shadow source is pinned to a repository revision.

An admitted ordinary male stud must be upright, have radius 6 LDU and depth 4 LDU, and sit on the supported lattice. A compound underside socket can be used when its entrance is an upright ordinary-stud seat with radius 6 LDU and depth at least 4 LDU. Centered, sliding, grouped or blocked-entry behavior is excluded. Deeper socket sections don't become bar or pin connections.

Parts may retain unsupported connector metadata while remaining usable through their verified upright mates. Recessed or off-grid studs can remain visible as body geometry when their entire mesh fits inside the reserved body envelope. Those studs are excluded from usable top connections. This allows an upright bottom-mounted decorative piece without inventing an offset mate.

The importer still rejects `SNAP_CLEAR`, nested or scaled snap includes, fixed-color or printed subparts, unavailable exact LDraw mappings, geometry that cannot fit the supported integer-stud/plate reservation, and required mates away from the supported lattice. A single supported snap include can be resolved; nested inheritance cannot. Pin-mounted blossoms and angled stems remain unusable when their required attachment cannot be checked.

Collision and insertion checks use a conservative upright body envelope. The 1e-4-stud tolerance (0.8 micrometers) handles numerical tessellation noise without moving mesh vertices. Larger protrusions round the reservation outward, including petals that extend beyond a part's nominal 1×1 catalog name.

These checks don't perform exact concave mesh collision or allow another piece to pass through an imported arch's reserved envelope. Parts use four yaw rotations, a grounded connection graph and checked insertion ordering. Arbitrary rotations, sideways, hinge, clip, bar and axle mates, and load-bearing physics remain unimplemented.

Colors use catalog RGB. Transparent colors are excluded, and metallic or pearlescent surface finishes are not simulated. Every placement still needs a verified produced part/color pair.

## Exports and licenses

The web viewer, assembly diagrams, PDF, full USDZ and LDraw export use the design's pinned geometry and connection sites. Imported definitions are embedded in the LDraw MPD, so a later library update cannot change that file.

The lightweight phone USDZ keeps all bodies and imported geometry but omits covered ordinary studs, including their small visible bands in cosmetic layer gaps. The full model remains available separately. Both USDZ versions carry used-part source URLs, hashes, authors, licenses and modification notes in USD stage metadata, preserved through binary compaction.

LDraw geometry retains its authors' CC BY attribution. LDCad connector metadata retains CC BY-SA 4.0. These assets keep their own licenses, separate from the project's MIT license. See the [bundled attribution and license texts](catalog-licenses/README.md).

Sources: [Rebrickable API](https://rebrickable.com/api/), [Rebrickable downloads](https://rebrickable.com/downloads/), [LDraw library](https://library.ldraw.org/) and [LDCad Shadow Library](https://github.com/RolandMelkert/LDCadShadowLibrary).

## Recorded development checks, October 10, 2026

These counts describe earlier warm-ups, not the current seed. The first recorded run found 64,796 discoverable IDs and 58 usable types (36 built-ins plus 22 imports), with 176 mapped nontransparent colors. Of 65 sampled candidates, 27 were supported, including built-ins, and 38 were rejected with recorded reasons. A later local cache reached 30 imports, or 66 total types, through the same importer.

The initial dynamic-catalog and resolver suites passed 13 tests. They covered all-yaw geometry, USDZ triangles and normals, MPD transforms, PDF credits, receiver rejection, stored revisions, produced colors, forged manifests, partial discovery and cancellation. A later 64-test renderer/model/manual/native group and build passed; 42 relevant tests were repeated after PDF layout corrections. These are historical runs, not fresh results from this documentation edit.

Local evidence under ignored `output/catalog-import/` includes `varied-design.json`, `varied.png`, `varied-parts.png`, `varied-step.png`, `varied.pdf`, `varied.usdz`, `varied.mpd` and `varied.csv`. The connected fixture used 64 pieces from six imported families and seven assembly steps. Its 11-page PDF was rendered and inspected.

The fixture's 4,936,148-byte batched USDZ was checked against the canonical renderer: 3 material meshes retained 64 bodies, 610 stud meshes and 50,868 triangles. That was a local export check, not a phone test or a subject-likeness result.

Later starter-catalog tests checked all 44 imports mounted at a source-backed underside in all four yaws. Flower tests covered produced colors, owned inventory, BOM, assembly order and archived geometry. Mocked generation tests confirmed that archived Quick receives real flower parts and can use a cached curved piece. Those tests establish data flow and geometric consistency; they don't establish better live Gemini likeness or physical strength.
