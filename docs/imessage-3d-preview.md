# Large LEGO Model: building from iMessage

Updated October 11, 2026. The primary experience is a mobile instruction guide reached from a Photon app card or ordinary HTTPS link. It supports normal camera-free 3D viewing, checked placement steps, a gather tray and saved device progress. AR is optional. The native model and parts list remain part of approval; PDF instructions are available on demand.

Prior native attachment delivery and touch rotation were confirmed by the user, including the approved Wilson revision. The new lightweight viewing copy, guide inside Spectrum, and AR require separate device checks. Local HTTP, artifact and mocked transport tests do not establish those phone behaviors.

## Entry point and approval

A checked preview includes a signed guide for that exact revision. `/instructions` and `/build` reopen the selected checked build. Approval pins the previewed revision and sends **guide + 3D model + parts CSV**. `/manual` prepares an optional PDF, and the guide provides the same download. `/retry` sends only unacknowledged items for the saved approved revision; switching the current selection does not change that retry. Older approval records keep their original model/PDF/parts bundle. A new approval without a configured guide URL also uses that bundle.

The transport calls Spectrum's `app(url, { layout })`, then attempts a plain HTTPS link as fallback. The recipient installs the [Spectrum iMessage launcher](https://apps.apple.com/ca/app/spectrum-apps-in-messages/id6777616651) once for app cards; a browser can open the ordinary link without it. This reuses a web guide inside Spectrum, not a custom native iMessage extension. No `live: true` hint is needed for the implemented card. Photon documents the app-card mechanism, but that does not prove our WebGL gestures work in every extension/device combination. [Photon app cards](https://photon.codes/docs/spectrum-ts/content/app)

Quick Look viewing is not approval. No reviewed generic-attachment contract reports that the user rotated or approved the model. Feedback and approval remain explicit chat messages.

## Model files: viewing copy and full exact export

| Entry | Contents and purpose |
| --- | --- |
| Instruction guide | Canonical validated parts and placements, step navigation, owned-part allocation, optional downloads |
| `/model` and normal approved model delivery | `/api/designs/:id/mobile.usdz`, a phone viewing copy with all bodies, colors, exposed studs and imported surfaces; covered ordinary stud detail is omitted |
| Full model download in the guide | `/api/designs/:id/model.usdz`, preserving the full canonical geometry |
| `/manual` | PDF derived from the exact checked assembly sequence |
| `/parts` | Exact part/color quantities, owned-stock allocation and catalog links |

The mobile file does not change the saved design, stock constraints, BOM or instructions. Both model endpoints identify the same immutable revision, have separate export caches, and use `model/vnd.usdz+zip`. Model and PDF routes support GET, HEAD and single byte ranges. The viewer copy must not be described as triangle-identical to the full export.

The full native exporter uses actual catalog geometry, Y-up orientation, 8 mm stud spacing, 3.2 mm plate spacing and 9.6 mm full-brick height. It excludes the display pedestal, UI, lights and decorative highlights. Large models share part geometry across placements. Archive tests verify canonical transforms, surfaces and colors; these are artifact checks, not mechanical simulation or a hand-build. [Three.js USDZ exporter](https://threejs.org/docs/pages/USDZExporter.html), [Apple asset guidance](https://developer.apple.com/videos/play/wwdc2023/10274/)

Photon's installed transport caps a request at 100 MiB. Files over 1 MiB try the installed OpenUSD tools to encode the layers as binary USDC while preserving shared references. This storage conversion is separate from the mobile copy's covered-stud omission. If tools are absent, the original archive remains; an oversized file gets a clear guide-download fallback. A binary conversion of the approved Wilson retained 27 shared shapes and 1,961 placements, reducing 9,156,965 to 2,619,483 bytes in the recorded local check. An accepted upload is not proof the phone opened it.

## Normal viewing and optional AR

Apple lists Messages among its built-in USDZ viewers. Tapping a compatible attachment opens a manipulable model in Quick Look; the file bubble itself is not a rotatable scene. Normal object viewing should be the first device check. A recorded turntable GIF/video cannot replace user-controlled rotation. [Apple Quick Look gallery](https://developer.apple.com/quick-look-gallery/), [Apple rotation demonstration](https://developer.apple.com/videos/play/wwdc2019/612/)

On a supported browser, the guide offers an AR anchor with `rel="ar"` and an image child. It points at the signed model endpoint. Other browsers retain a normal model download. Safari is the fallback if the Spectrum web view does not support the AR launch. A camera is unnecessary for the guide's normal building mode. [Apple AR Quick Look](https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look), [WebKit's link format](https://webkit.org/blog/8421/viewing-augmented-reality-assets-in-safari-for-ios/)

```html
<!-- Schematic: the application supplies the exact revision and signed token. -->
<a rel="ar" href="/api/designs/DESIGN_ID/model.usdz?share=SIGNED_TOKEN">
  <img src="ar-icon.svg" alt="View this build in your room" />
</a>
```

## Signed read-only sharing

`PUBLIC_BASE_URL` must identify an HTTPS origin forwarding to **`127.0.0.1:3002`**, the separate read-only listener in the API process. Never expose the private port 3001 API or Vite to make the phone guide work. Build the production web assets first. `/api/designs/:id/instructions-link` is a local API operation returning `/?build=<id>&share=<token>`; it is not publicly exposed.

The public gateway binds the token to one saved revision, allows required public assets and that revision's approved read-only endpoints, and rejects mutations, job/status/catalog routes and arbitrary paths. Public JSON omits prompt, input photos and research. Required-part allocation preserves owned quantities and provenance without exposing unrelated stock. Private responses use `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`.

Keep `data/instruction-share-key` private and persistent. A signed link grants bearer access, so its recipient can forward it. Replacing the key invalidates old links. For an authorized temporary test, `cloudflared tunnel --url http://127.0.0.1:3002` provides a random HTTPS origin. Quick Tunnels stop with the process, change hostname when recreated, and carry no production uptime guarantee. Use durable hosting or a named tunnel for persistent links; do not claim a temporary demo URL is permanent. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

## Verification still required on the recipient phone

- Open the guide from both the Spectrum card and plain link; verify gestures, gather tray, first/last placements, step jumps and resumed progress.
- Approve a revision, then change the current selection and `/retry`; confirm only missing items from the approved revision arrive.
- Open and rotate the mobile USDZ; compare its visible surfaces with the full model, and test the full exact download separately.
- Try Safari AR independently. Verify scale/orientation and keep ordinary 3D working when camera access or AR support is absent.
- Request the optional PDF and check readable diagrams, exact parts and source-set allocations on the same revision.

The implementation uses Spectrum attachment buffers with explicit filename and MIME type. Those documented API shapes and mocked transport checks are separate from live recipient evidence. Voice memos, turntable media and a custom native iMessage extension remain outside this increment. [Photon attachments](https://photon.codes/docs/spectrum-ts/content/attachments), [live test guide](live-testing.md)
