# rubric-pr-bot

A GitHub App that watches PRs touching `*.rubric.json`, runs rubric-spec diff/lint, comments with downstream impact, and can expose required-check failures for error findings. Public install target: `github.com/apps/auraone-rubric-pr-bot`.

## What This Is Not

No customer rubrics are included; examples are synthetic.

## Review Behavior

- Handles pull request open and synchronize events for changed `*.rubric.json` files.
- Summarizes added, removed, and changed criteria with links back to `rubric-spec` criteria docs.
- Reports lint findings in the PR comment.
- Returns a `failure` conclusion when lint findings include severity `error`, allowing teams to wire the app as a required check.
