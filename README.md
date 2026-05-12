# rubric-pr-bot

A GitHub App that watches PRs touching `*.rubric.json`, runs rubric-spec diff/lint, comments with downstream impact, and can expose required-check failures for error findings. Public install target: `github.com/apps/auraone-rubric-pr-bot`.

## What This Is Not

No customer rubrics are included; examples are synthetic.

## Review Behavior

- Handles pull request open and synchronize events for changed `*.rubric.json` files.
- The GitHub webhook helper fetches changed files and base/head rubric contents from the GitHub API.
- `npm start` runs a deployable `/webhook` server with GitHub webhook HMAC verification and GitHub App installation-token exchange.
- Summarizes added, removed, and changed criteria with links back to `rubric-spec` criteria docs.
- Posts or updates a marked PR comment with diff and lint findings.
- Creates a `rubric-pr-bot` check run and returns a `failure` conclusion when lint findings include severity `error`, allowing teams to wire the app as a required check.

## Deployment

```bash
npm install
npm run build
RUBRIC_PR_BOT_APP_ID=123 \
RUBRIC_PR_BOT_PRIVATE_KEY="$(cat private-key.pem)" \
RUBRIC_PR_BOT_WEBHOOK_SECRET=change-me \
npm start
```

The server listens on `PORT` or `3000` and expects GitHub webhooks at `/webhook`.

## App Permissions

The manifest requests `contents: read`, `pull_requests: read`, `issues: write`, and `checks: write`. `issues: write` is used for PR conversation comments, and `checks: write` is used for optional merge-blocking check runs.
