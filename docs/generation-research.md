# Large Lego Model: generation research and implementation boundary

Research checked October 10, 2026. “Large Lego Model” names our application architecture; the MVP does not train a new foundation model.

## Decision

Use a hosted multimodal model to interpret inspiration and propose a compact, colored shape specification. Compile that specification into real catalog bricks, then independently validate it. The preview, inventory comparison, instruction steps, PDF, CSV, and LDraw export must use the same accepted brick list. A visual model judgment is useful for appearance, but cannot certify geometry or strength.

The MVP supports upright, single-height rectangular bricks on integer stud coordinates. It does not promise arbitrary Technic connections, slopes, plates, moving mechanisms, or reverse-engineering hidden pieces from one image. Curated examples are labeled as samples. A failed AI generation must remain a failure, not silently become a sample presented as generated work.

## What BrickGPT provides

The supplied [alvin-chang/legogpt repository](https://github.com/alvin-chang/legogpt) is an older fork. Current upstream is [AvaLovelace1/BrickGPT](https://github.com/AvaLovelace1/BrickGPT), renamed from LegoGPT.

The [model card](https://huggingface.co/AvaLovelace/BrickGPT) describes a Llama 3.2 1B fine-tune restricted to one-unit-high cuboid bricks on a 20×20×20 grid and trained on 21 object categories. Flower and rocket are outside that documented taxonomy. It currently lists no Hugging Face inference provider deployment.

The [paper](https://arxiv.org/html/2505.05469v1) uses eight brick sizes: 1×1, 1×2, 1×4, 1×6, 1×8, 2×2, 2×4, and 2×6. Its reported evaluation reaches 98.8% stable structures with median generation time 40.8 seconds. These are benchmark results, not a guarantee for unseen prompts or laptop latency. Its structure assumption includes a baseplate. The paper separately plans assembly order because final stability does not imply that all intermediate structures are stable.

The [current model code](https://github.com/AvaLovelace1/BrickGPT/blob/main/src/brickgpt/models/brickgpt.py) supports CUDA, Apple MPS, and CPU. A minimum inference VRAM requirement was not established in this research. A material integration issue: after exhausting regeneration attempts, it logs a warning and returns the last brick list without a stability success flag. An adapter must validate the final output rather than treating a returned object as success.

The [upstream README](https://github.com/AvaLovelace1/BrickGPT) calls for access to the gated Llama base model and a Hugging Face token. Gurobi licensing is needed for its force-based stability solver. Disabling Gurobi substitutes a weaker connectivity check. Most code, the model, and dataset are MIT; submodules have separate licenses. Installing it is a useful later experiment, but should not block the website and shared brick representation.

## Why not begin with arbitrary mesh generation

Upstream now includes [mesh2brick](https://github.com/AvaLovelace1/BrickGPT/tree/main/src/mesh2brick), accepting formats such as OBJ and GLB and outputting brick JSON, text, or LDraw. It is a practical starting point for a future mesh route. Mesh conversion still needs inventory and physical checks. Thin details can disappear at low resolution, and a visually plausible mesh does not establish a usable brick assembly.

Hosted vision plus structured output is useful for concept interpretation and revisions. [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding) accepts image inputs, and [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output) provide JSON-schema-constrained responses. The application remains responsible for semantic and physical validation.

## Implemented core contract

`shared/model.ts` represents each brick by actual part ID, Rebrickable color ID, integer minimum X/Y footprint coordinates, bottom Z layer, and 0°/90° rotation. The supported parts are 3005, 3004, 3622, 3010, 3003, 3002, and 3001. Color definitions carry explicit LDraw IDs rather than assuming interchangeable color numbering generally.

Validation rejects malformed metadata or bricks, unknown parts/colors, repeated IDs, collisions, coordinates outside 24×24×24, and more than 160 bricks. An upper brick must overlap at least one stud directly below. The final graph of vertical stud connections must be connected. Side contact alone does not join bricks. First-layer bricks may be separate while being positioned, provided later layers connect them. Every result warns that strength and tipping have not been verified.

All four samples are volumetric prototypes, not two-stud reliefs. Their foundations are modeled and included in the BOM; there is no invisible baseplate. The potted flower contains 118 bricks, with a 10×10-stud radial blossom, leaves, soil, and a raised pot rim. The rocket contains 97 bricks, with a six-stud body, four fins, four windows, and a stepped nose. The evergreen contains 119 bricks, with a trunk, exposed roots, canopy tiers, and ornaments across different faces. The duck contains 91 bricks, with an 8×6-stud body, wings on both sides, a tail, two eyes, and a projecting beak. These pass software geometry and connectivity checks, but have not been physically built during this implementation.

These static fixtures are curated examples, not evidence that the live generator reliably creates designs of the same complexity. They were compiled offline; a small number of unsupported edge layouts were repaired with a bounded, support-constrained exact-cover search before validation. That offline repair is not part of the production generator. The live compiler still uses its documented packing heuristic and may reject feasible shapes or inventories.

The user’s intended product goes further than these prototypes: complex, recognizable three-dimensional models using a much wider real-parts catalog. Supporting plates, slopes, hinges, curved pieces, unusual stud connections, mechanically sound overhangs, and reliable assembly planning requires additional geometry and constraint work. The current seven-brick catalog and 160-brick cap are prototype boundaries, not a claim that the final product is complete.

Inventory allocation is exact by part and color, retains source provenance, and caps allocated ownership at the model requirement. A source cannot satisfy a different color. Missing pieces remain visible. Instruction layers preserve every brick exactly once; all exports derive from that list.

## Export verification

The [LDraw specification](https://www.ldraw.org/article/218.html) defines 20 LDU per stud pitch, 24 per brick height, and negative Y as up. Official [3001.dat](https://library.ldraw.org/library/official/parts/3001.dat) and [3004.dat](https://library.ldraw.org/library/official/parts/3004.dat) verify that those DAT models use the long dimension along X and a top-centered origin. The exporter compensates for our short-X catalog convention and uses the footprint center, negative top height, and `0 STEP` boundaries. Tests cover orientation, units, and brick counts.

## Before claiming a physically buildable result

Hand-build at least one demonstration model from the actual generated instruction PDF. Check each intermediate step and the final structure. Keep that evidence separate from software checks. Broad base geometry and a connected stud graph help, but are not a force model or proof that a tall or cantilevered structure will hold.
