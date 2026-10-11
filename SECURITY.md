# Security

This repository is a local-first hackathon prototype, not an authenticated multi-tenant generation service.

## Report a problem

Use GitHub's **Security → Report a vulnerability** if private reporting is enabled. If it is unavailable, open an issue requesting a private contact channel without including exploit details, credentials, private photos or conversation data. Do not post live tokens or signed build links in public issues.

## Deployment boundary

- Keep the development website and private API on loopback. They provide generation, inventory and administrative functionality without public-user authentication.
- Publish only the separate signed read-only gateway at `127.0.0.1:3002`. Never point a public tunnel at port 3001 or Vite.
- Signed build links are bearer access to that revision and its allowed files. Anyone holding the link can forward it. Keep `data/instruction-share-key` private; replacing it invalidates existing links.
- Store service credentials only in local `.env` or your deployment's secret store. Never use `VITE_` variables for secrets. `.env`, `data/`, `output/` and private-key files are excluded from Git.
- Keep user photographs, prompts, conversations, owned inventories, generated models and diagnostic output out of commits and public bug reports. Review screenshots before sharing them.
- Paid generation can incur provider charges. Configure limits in your own provider account; do not reuse another team's keys.

If a credential is exposed, revoke or rotate it with its provider. Removing it from the latest commit does not remove it from Git history or existing clones.
