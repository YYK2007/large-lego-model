# Parts, geometry, and instruction research

Verified 2026-10-10 against primary documentation. The current product is a limited upright-brick MVP, not a general LEGO CAD or structural simulation system.

## Current implementation

- `shared/model.ts` owns catalog IDs, exact placements, BOM, source allocation, and step grouping.
- `shared/illustration.ts` renders deterministic vector brick bodies and studs at the same coordinates. It uses the whole model's extent for every step, preventing camera jumps. These are procedural rectangular-brick illustrations, not imported LDraw meshes.
- `server/manual.ts` uses PDFKit and svg-to-pdfkit to produce a cover, BOM, optional source-set allocation and shortages, reading guide, and cumulative layer instructions. Every layer has a numbered top-down map and exact coordinate/footprint/orientation list. Dense placement lists continue on extra pages rather than clipping.
- Product generation remains JavaScript/TypeScript. Poppler is used only during development to visually inspect sample PDFs.
- Coordinates: X/Y are the minimum footprint corner in studs; Z is the bottom in full-brick layers, positive upward. Rotation 0 uses catalog width along X and depth along Y; 90 swaps them. All studs point upward. The seven-part MVP is all standard-height rectangular bricks.
- Frutiger Aero treatment is limited to sky-blue/green accents, pale panels, and gentle gradients. Brick colors and placement contrast remain functional.

## Inventory source

[Rebrickable v3 documentation](https://rebrickable.com/api/v3/docs/) provides official set/part inventories and account collection access. It requires an API key, documents approximately one request per second, and requires following pagination. The public catalog endpoint used is `/api/v3/lego/sets/{set_num}/parts/`; `inc_part_details=1` expands mapping fields, and minifig part expansion is optional. Bulk catalog ingestion should use [CSV downloads](https://rebrickable.com/downloads/), not repeated API calls. Generic MOC inventories and pricing are not available through v3.

The [live Swagger schema](https://rebrickable.com/api/v3/swagger/?format=openapi) confirms routes and options but does not supply response-object schemas. Validate actual response payloads at the adapter boundary. Preserve part IDs as strings and retain set suffixes such as `10696-1`.

Exact availability means `(part ID, color ID, quantity)`. A printed variant, alternate mold, or similar RGB color is not automatically interchangeable. Inventory versions are alternative snapshots and must not be summed. Spare parts and minifig disassembly should be opt-in. Duplicate set ownership needs an explicit quantity or separate source lots. Freeze an inventory snapshot with the accepted design. The current allocation ledger groups quantities by source string; distinct physical copies require distinct source labels if users need that distinction.

Rebrickable downloads and terms returned access errors during this research. The current redistribution license was therefore **not verified**. Do not infer redistribution rights from API availability or bundle Rebrickable photography without checking terms. The MVP generates its own part illustrations.

## Geometry and IDs

[LDraw's file-format specification](https://www.ldraw.org/article/218.html) defines 20 LDraw units per stud spacing, 24 per brick height, 8 per plate height, and negative Y upward. Approximate scale is 0.4 mm/LDU. Its type-1 record stores color, translation, a 3x3 transform, and a referenced part filename.

[LDraw part-number rules](https://www.ldraw.org/part-number-spec.html) distinguish design IDs from element IDs. Element IDs represent shape plus color and must not be used as geometry filenames. Keep Rebrickable part/color IDs and LDraw filenames/color codes as separate namespaces, with verified mappings. Part origins, aliases, and subparts need explicit treatment under the [official library specification](https://www.ldraw.org/article/512.html).

[Three.js LDrawLoader](https://threejs.org/docs/pages/LDrawLoader.html) can load models and official part assets. Its documentation recommends packed MPD files to avoid dependent-file request waterfalls. Its [official example](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/webgl_loader_ldraw.html) includes flat instruction colors, line visibility, a building-step slider, and coordinate conversion. Pin the library version; current development source calls its step metadata `buildingStep` and `numBuildingSteps`.

LDraw geometry is a suitable later replacement for procedural MVP shapes when expanding the supported catalog. Vendor only verified parts and their complete dependency closure. Missing geometry must be reported, not silently represented as a different exact part.

## Instructions and later presentation

[LPub3D](https://github.com/trevorsandy/lpub3d) is a mature GPLv3 desktop editor for LEGO-style instructions, useful for LDraw interoperability. The web MVP avoids a desktop rendering dependency and generates original diagrams directly from its canonical model.

For future AR, [Three.js GLTFExporter](https://threejs.org/docs/pages/GLTFExporter.html) can create a mesh asset. [model-viewer](https://modelviewer.dev/examples/augmentedreality/) provides WebXR, Scene Viewer, and Quick Look presentation paths. Scale to meters explicitly and verify a known brick dimension on-device. A GLB is a presentation output, not the source of BOM or assembly semantics. Multiplayer can share design revision, step IDs, and completion state without changing the model contract.

## LDraw licensing

The [current contributor agreement](https://ldraw.org/ldraw-org-contributor-agreement) permits CC BY 4.0 or CC0, while the [header specification](https://www.ldraw.org/article/398.html) describes legacy license variants. Preserve each vendored asset's header/license and distribute attribution and applicable license text. [Published legal guidance](https://www.ldraw.org/legal-info) distinguishes rendered instruction images from redistributed part geometry. The current MVP procedural renderer does not redistribute LDraw part geometry.

## Accuracy boundary

The MVP rejects unsupported parts/colors, invalid coordinates, overlapping brick bodies, unsupported elevated bricks, and disconnected final assemblies. It does not evaluate clutch strength, torque, center of mass, tipping, part wear, or real-world handling. Bottom-up layer instructions are valid only for this upright rectangular-brick palette; arbitrary hinges, Technic parts, sideways construction, subassemblies, or plates require a richer connection and assembly model.
