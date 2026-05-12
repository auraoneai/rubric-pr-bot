export function buildComment(diff, findings) {
    const changedCriteria = collectChangedCriteria(diff.diffs);
    return [
        `## Rubric Review`,
        ``,
        `Files: ${diff.files.join(", ")}`,
        `Blocking status: ${findings.some((finding) => finding.severity === "error") ? "failure" : "success"}`,
        ``,
        `### Diff`,
        "```json",
        JSON.stringify(diff, null, 2),
        "```",
        ``,
        `### Changed Criteria`,
        ...(changedCriteria.length
            ? changedCriteria.map((criterionId) => `- \`${criterionId}\` - https://github.com/auraoneai/rubric-spec#criteria`)
            : ["No criterion-level changes detected."]),
        ``,
        `### Lint Findings`,
        ...(findings.length ? findings.map((f) => `- ${f.severity}: ${f.rule} ${f.path ?? ""} ${f.message}`) : ["No lint findings."]),
        ``,
        `Spec docs: https://github.com/auraoneai/rubric-spec`,
    ].join("\n");
}
function collectChangedCriteria(diffs) {
    const ids = new Set();
    for (const diff of diffs) {
        for (const id of diff.added)
            ids.add(id);
        for (const id of diff.removed)
            ids.add(id);
        for (const item of diff.changed) {
            if (item.criterion_id)
                ids.add(item.criterion_id);
        }
    }
    return [...ids].sort();
}
