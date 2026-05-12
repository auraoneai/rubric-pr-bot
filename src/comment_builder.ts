import type { Finding } from "./rubric_review.js";

export function buildComment(diff: unknown, findings: Finding[]): string {
  return [
    `## Rubric Review`,
    ``,
    `### Diff`,
    "```json",
    JSON.stringify(diff, null, 2),
    "```",
    ``,
    `### Lint Findings`,
    ...(findings.length ? findings.map((f) => `- ${f.severity}: ${f.rule} ${f.path ?? ""} ${f.message}`) : ["No lint findings."]),
    ``,
    `Spec docs: https://github.com/auraoneai/rubric-spec`,
  ].join("\n");
}
