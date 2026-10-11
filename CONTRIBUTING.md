# Contributing

Start from `main` on Node.js 24 LTS, run `npm ci`, and create a feature branch. Copy `.env.example` to `.env` only when you need live integrations; samples and tests work without service keys.

Keep changes focused and run:

```sh
npm test
npm run build
```

For rendering, guide or manual changes, also inspect the result. Tests alone cannot verify visual quality. Preserve exact placements, colors, quantities and inventory through every export. Keep automatic checks, physical hand-building and phone tests distinct in reports.

Use mocked providers in tests. Do not submit credentials, runtime data, signed links, private messages or screenshots containing them. Follow [the security policy](SECURITY.md) for sensitive reports. Retain [third-party attribution](THIRD_PARTY_NOTICES.md) when changing catalog assets.

Describe the problem, resulting behavior and relevant validation in your pull request. Contributions to original project code use the repository's MIT license; third-party additions must retain a compatible source license and attribution.
