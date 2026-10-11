# Building from iMessage

The phone guide is the main instruction view. After approval, it opens from a Spectrum app card or an ordinary HTTPS link. It has rotatable 3D, part trays, checked placement steps and progress saved on that device. Normal building needs no camera. AR and the PDF are optional.

This document was checked against the source on October 11, 2026. Follow [Photon setup](photon-setup.md) for credentials, startup and public sharing.

## Preview, approval and delivery

A checked draft arrives as a PNG with a request for feedback. It doesn't include the building guide or downloadable files. Reply with a change, or approve it when ready. `/use N` selects a particular checked attempt; unfinished attempts cannot be selected or exported.

Approval pins the exact previewed revision and sends its guide, phone viewing USDZ and parts CSV. `/instructions` or `/build` reopens the approved guide. `/manual` prepares a PDF; the guide also offers that download. File commands ask for approval when the selected revision is still a draft.

If no signed guide URL is available, approval sends model/PDF/parts instead. Existing approvals keep their original bundle. `/retry` sends only its unacknowledged items, even if a newer preview is selected. It doesn't regenerate the build.

The transport attempts `app(url, { layout })`, then a plain link. Photon documents that app cards open through its [Spectrum iMessage launcher](https://apps.apple.com/ca/app/spectrum-apps-in-messages/id6777616651), installed once by the recipient. The plain link works in a browser without that extension. We don't request live rendering in the message bubble. Gestures inside the extension still need device testing. [Photon app cards](https://photon.codes/docs/spectrum-ts/content/app)

Opening or rotating a model doesn't approve it. Approval remains an explicit chat reply.

## Files from the same revision

| Entry | What it provides |
| --- | --- |
| Phone guide | Canonical placements, part trays, checked assembly sequence and owned-part allocation |
| `/model` and approval | `/api/designs/:id/mobile.usdz`, a viewing copy with bodies, colors, exposed studs and imported surfaces; covered ordinary stud detail is omitted |
| Full-detail download | `/api/designs/:id/model.usdz`, with full canonical geometry |
| `/manual` | PDF from the checked assembly sequence, with large placement diagrams and exact repeat groups |
| `/parts` | CSV with part/color quantities, owned allocations and catalog links |

The viewing copy doesn't change the saved design, stock constraints, BOM or instructions. It isn't triangle-identical to the full export. Both USDZ files use `model/vnd.usdz+zip`, identify the same revision and have separate caches. Model and PDF downloads support GET, HEAD and single byte ranges.

The exporter uses Y-up orientation, 8 mm stud pitch, 3.2 mm plate pitch and 9.6 mm full-brick height. It excludes the display pedestal, lights and UI. Repeated parts share geometry. Imported-part attribution stays in the native package. Tests check surfaces, transforms, colors and placements; they don't simulate mechanical strength. See the [Three.js exporter](https://threejs.org/docs/pages/USDZExporter.html) and [Apple asset guidance](https://developer.apple.com/videos/play/wwdc2023/10274/).

Spectrum receives attachment buffers with explicit filenames and MIME types. The installed transport has a 100 MiB request limit; our guard reserves another 64 KiB for the envelope. This limits delivery, not the number of bricks. [Photon attachments](https://photon.codes/docs/spectrum-ts/content/attachments)

USDZ files over 1 MiB try `usdcat` and `usdzip` when available. They convert layer storage to binary USDC without flattening shared references. This is separate from omitting covered studs in the viewing copy. Missing tools or failed conversion leave the original archive available; if it still exceeds the send limit, the reply directs the user to the approved guide's download when configured. Without a public guide, the saved build remains available in the local app.

A recorded Wilson export retained 27 shared shapes and 1,961 placements while shrinking from 9,156,965 to 2,619,483 bytes. That is one measured archive conversion, not a size or speed promise for other models. See [verification](VERIFICATION.md).

## Normal viewing and AR

Apple lists Messages among the apps that support USDZ Quick Look. A compatible attachment opens a manipulable model in a viewer; the file bubble itself isn't a rotatable scene. Test object viewing first. A prerecorded turntable doesn't establish touch rotation. [Apple Quick Look gallery](https://developer.apple.com/quick-look-gallery/), [rotation demonstration](https://developer.apple.com/videos/play/wwdc2019/612/)

The guide checks browser AR support. Its AR link uses `rel="ar"`, an image child and the signed mobile model endpoint. Other browsers keep a normal model download. Try Safari if the Spectrum web view can't launch AR. Camera access isn't needed for ordinary 3D instructions. [Apple AR Quick Look](https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look), [WebKit link format](https://webkit.org/blog/8421/viewing-augmented-reality-assets-in-safari-for-ios/)

```html
<!-- Schematic: the application supplies the revision and signed token. -->
<a rel="ar" href="/api/designs/DESIGN_ID/mobile.usdz?share=SIGNED_TOKEN">
  <img src="ar-icon.svg" alt="View this build in your room" />
</a>
```

## Sharing boundary

`PUBLIC_BASE_URL` must be an HTTPS origin forwarding only to `127.0.0.1:3002`. That listener accepts signed per-revision guide URLs and read-only downloads, plus static app assets. It rejects mutations, jobs, status/catalog routes, unrelated designs and arbitrary paths. The private API on port 3001 and Vite should stay private.

The local `/api/designs/:id/instructions-link` route creates `/?build=<id>&share=<token>`. It isn't exposed through the public gateway. Public design JSON omits the request, source photos and research. Owned allocations include only required parts, with their source labels. Protected responses use `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`.

Keep saved designs and `data/instruction-share-key` persistent. A signed link can be forwarded by anyone holding it; changing the key invalidates all existing links. For hosting commands and the project tunnel, use [Photon setup](photon-setup.md#share-the-phone-guide). Temporary tunnels change hostname when recreated and don't provide an uptime guarantee. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

## Device checks

The user confirmed native attachment rotation, PDF opening and guide navigation. They reported that resume and AR seemed to work well. The latest Stop and approval fixes still need final phone confirmation. Repeat the checks below after changing the viewer or exports; local HTTP success and mocked transport tests don't establish device behavior.

1. Approve a preview. Open both its Spectrum card and plain link. Rotate and zoom, inspect the gather tray, follow the first and last placements, jump between steps, then reload to test saved progress.
2. Select another draft and use `/retry`. Confirm only missing items from the earlier approved bundle arrive.
3. Open and rotate the mobile USDZ. Compare visible surfaces with the full-detail download, then test that download separately.
4. Test Safari AR for scale and orientation. Check that normal 3D building still works without camera permission or AR support.
5. Request `/manual` and inspect the diagrams, repeat counts, BOM and owned allocations for the same revision. While it prepares, test `/status` and `/stop`.

Voice memos, turntable media and a custom native iMessage extension remain outside this implementation. The broader generation checks are in [live testing](live-testing.md).
