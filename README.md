# AuraOne Rubric PR Bot

Review changed `*.rubric.json` files through a GitHub App Check Run and pull request summary.

Rubric PR Bot is for teams that version evaluation rubrics in Git. It applies deterministic, `rubric-spec`-aligned TypeScript diff and lint rules, then publishes added, removed, and changed criteria, weight deltas, missing ids/examples/anchors, vague or compound wording, annotations, and an exact next action.

## Inspectable Proof

For pull request `opened`, `reopened`, and `synchronize` events, the app:

- Reuses a Check Run keyed by pull request number and head SHA.
- Publishes queued, in-progress, pass, review, fail, blocked, or skipped state through `AuraOne rubric review`.
- Adds file annotations for up to 50 lint findings.
- Creates or updates one bot-authored pull request comment without overwriting a user-authored marker comment.
- Returns `success` for pass, `neutral` for review or skipped, `failure` for blocking findings, and `action_required` when the review cannot complete.

The app implements its own current diff/lint rules; it does not shell out to the Python `rubric-spec` package.

## Runtime, Data, and Network Boundary

The hosted app receives signed GitHub webhooks, exchanges its app JWT for an installation token, calls the GitHub API, and fetches base/head contents for changed rubric files. Rubric content is therefore processed by the deployed Rubric PR Bot service and review evidence is written back to GitHub Check Runs and pull request comments.

The app does not require model-provider APIs. The source repository bundles no customer rubrics, installation credentials, or webhook secrets.

## Install

Hosted GitHub App:

```text
https://github.com/apps/auraone-rubric-pr-bot
```

The requested manifest permissions are `contents: read`, `pull_requests: read`, `issues: write`, and `checks: write`.

Self-hosted source deployment:

```bash
npm ci
npm run build
RUBRIC_PR_BOT_APP_ID=123 \
RUBRIC_PR_BOT_PRIVATE_KEY="$(cat private-key.pem)" \
RUBRIC_PR_BOT_WEBHOOK_SECRET=change-me \
npm start
```

The server listens on `PORT` or `3000` and accepts signed webhooks at `/webhook` and `/api/webhook`.

## Quickstart

For the hosted path, install the app on a test repository and open a pull request that changes a `*.rubric.json` file. Inspect the `AuraOne rubric review` Check Run, resolve blocking `R_ID` findings first, then review examples, anchors, and wording warnings.

For source verification:

```bash
npm ci
npm test
npm run release:preflight -- v0.2.0
```

## Release Status

Registry, tag, and endpoint status verified July 13, 2026:

- The public GitHub App install page and configured service endpoint respond.
- Current source/package metadata is `0.2.0`.
- The latest public repository tag is `v0.1.1`; `v0.2.0` is not published.
- `@auraone/rubric-pr-bot` is not published on npm.
- The live app does not expose a verifiable deployed source version, so this README does not claim that the hosted deployment is running the current `0.2.0` source.

No repository-count, review-volume, or adoption claim is made.

## Limits

The rules are deterministic review aids, not semantic validation, policy approval, or proof that a rubric is scientifically sound. Only files ending in `*.rubric.json` are reviewed.

## Next Action

Install the public app on a test repository, open a pull request that changes one `*.rubric.json` file, review the Check Run and comment evidence, and make the check required only after the rule behavior matches your rubric policy.
