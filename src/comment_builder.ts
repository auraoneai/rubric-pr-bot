export type Finding = { severity: string; message: string; path?: string };
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
    ...findings.map((f) => `- ${f.severity}: ${f.message}`),
    ``,
    `Spec docs: https://github.com/auraoneai/rubric-spec`,
  ].join("\n");
}
