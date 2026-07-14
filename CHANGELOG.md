# Changelog

## 0.2.0 - 2026-07-12

- Add an idempotent Check Run lifecycle with queued, in-progress, pass, review,
  fail, blocked, and skipped states.
- Add safely escaped annotations and a bot-owned actionable PR evidence
  summary.
- Reuse checks by pull-request number and head SHA during webhook retries.
- Add immutable-tag release verification and separately gated major-tag
  promotion.

## 0.1.1

- Prepare hardened source-side release after CI, validation, documentation, and packaging fixes.
- Add the GitHub API webhook helper for changed-file loading, PR comment upserts, and required-check creation.
- Add a deployable GitHub App webhook server with HMAC verification and installation-token exchange.

## 0.1.0

- Initial open-source implementation.
