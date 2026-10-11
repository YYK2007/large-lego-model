# Third-party notices

The root MIT license covers this project's original code. It does not relicense third-party geometry, connector metadata, fonts, packages or source photographs.

- **Bundled part catalog:** `server/catalog-seed.json` contains transformed LDraw geometry and LDCad Shadow Library connector metadata. Retain the per-asset source URLs, authors, SHA-256 hashes and license fields. [Catalog notices and license texts](docs/catalog-licenses/README.md) identify the applicable Creative Commons licenses. The transformed LDCad metadata remains CC BY-SA 4.0.
- **Rebrickable:** catalog identity, produced-color and color-mapping facts retain source attribution. Product photos and account inventories are not included in the repository.
- **Runtime references:** downloaded photographs and external model references keep their source and license metadata with each build. They are not covered by the project's MIT license. Source links do not imply permission for unrelated reuse.
- **Dependencies and fonts:** packages installed by `npm ci`, and fonts obtained by the application, retain their respective licenses. `package-lock.json` records exact package versions; installed packages carry their notices.
- **Project artwork:** the Aero symbol was generated for this project and is included under the root MIT license; see [its source note](assets/brand/README.md).

LEGO is a trademark of the LEGO Group. This independent project is not affiliated with or endorsed by the LEGO Group, LDraw, LDCad, Rebrickable, Google or Photon.
