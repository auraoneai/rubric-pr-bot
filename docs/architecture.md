# Rubric PR Bot Architecture

`rubric-pr-bot` is a GitHub App that reviews rubric changes. It is designed to make rubric diffs and lint findings visible during code review without requiring maintainers to run tools locally.

## Event Flow

1. Receive pull request open or synchronize events.
2. Identify changed rubric files by suffix or configured path.
3. Fetch base and head versions of each rubric.
4. Build a structured diff and run lint checks.
5. Post a concise PR comment with changed criteria, weight deltas, anchor changes, and lint findings.

## Design Decisions

- The app manifest asks for read access to pull requests and contents plus write access to PR comments.
- Merge blocking is optional because teams may want advisory rubric reviews while they tune rules.
- The comment builder keeps output deterministic so repeated events update predictable review content.
- Tests use synthetic rubric JSON and do not require real repositories or customer data.
