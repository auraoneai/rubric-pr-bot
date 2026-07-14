# Rubric PR Bot Architecture

`rubric-pr-bot` is a GitHub App that reviews rubric changes. It is designed to make rubric diffs and lint findings visible during code review without requiring maintainers to run tools locally.

## Event Flow

1. Receive pull request open or synchronize events.
2. Identify changed rubric files by suffix or configured path.
3. Verify the GitHub webhook signature and exchange the app JWT for an installation token.
4. Fetch changed file names and base/head versions of each rubric from the GitHub API.
5. Build a structured diff and run the package's deterministic, `rubric-spec`-aligned TypeScript lint checks.
6. Post or update a marked PR comment with changed criteria, weight deltas, anchor changes, rubric-spec links, and lint findings.
7. Create or reuse the `AuraOne rubric review` Check Run so deployments can map severity `error` findings to required-check failures.

## Design Decisions

- The app manifest asks for read access to pull requests and contents, write access to PR conversation comments, and write access to check runs.
- Merge blocking is optional because teams may want advisory rubric reviews while they tune rules.
- The webhook server uses only Node built-ins so deployments do not need an additional web framework.
- The comment builder keeps output deterministic so repeated events update predictable review content.
- The pure route/handler layer is tested without GitHub credentials; the GitHub helper and app-auth utilities are tested with mocked API transports for token creation, file loading, comment upserts, and check-run creation.
- Tests use synthetic rubric JSON and do not require real repositories or customer data.
- The implementation does not execute the Python `rubric-spec` package; rule alignment is maintained in TypeScript and must be reviewed when either rule set changes.

## Runtime and Data Boundary

- The hosted service receives GitHub webhook payloads and verifies their HMAC signature.
- It exchanges a GitHub App JWT for an installation token, fetches changed file names and base/head rubric content, and writes Check Run and issue-comment evidence through the GitHub API.
- Rubric content is processed by the deployed service. Self-hosters control that deployment boundary; users of the public app rely on the public service boundary.
- No model-provider or AuraOne platform API is required.

## Publication Boundary

Source metadata is `0.2.0`, the latest public repository tag is `v0.1.1`, and the npm package is not published. The hosted endpoint does not expose its deployed source version.
