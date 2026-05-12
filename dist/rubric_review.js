export function diffRubrics(base, head) {
    const baseCriteria = new Map((base?.criteria ?? []).map((criterion) => [criterion.criterion_id, criterion]));
    const headCriteria = new Map((head.criteria ?? []).map((criterion) => [criterion.criterion_id, criterion]));
    const added = [...headCriteria.keys()].filter((id) => Boolean(id) && !baseCriteria.has(id));
    const removed = [...baseCriteria.keys()].filter((id) => Boolean(id) && !headCriteria.has(id));
    const changed = [...headCriteria.entries()]
        .filter(([id, criterion]) => {
        const previous = id ? baseCriteria.get(id) : undefined;
        return previous && JSON.stringify(previous) !== JSON.stringify(criterion);
    })
        .map(([id, criterion]) => {
        const previous = baseCriteria.get(id);
        return {
            criterion_id: id,
            weight_delta: typeof criterion.weight === "number" && typeof previous?.weight === "number"
                ? Number((criterion.weight - previous.weight).toFixed(6))
                : undefined,
            label_changed: criterion.label !== previous?.label,
            description_changed: criterion.description !== previous?.description,
        };
    });
    return { added, removed, changed };
}
export function lintRubric(rubric) {
    const findings = [];
    for (const [index, criterion] of (rubric.criteria ?? []).entries()) {
        const path = `/criteria/${index}`;
        if (!criterion.criterion_id) {
            findings.push({ severity: "error", rule: "R_ID", message: "criterion_id is required", path });
        }
        if (!criterion.examples?.length) {
            findings.push({ severity: "warning", rule: "R_EXAMPLES", message: "criterion should include reviewer examples", path });
        }
        if (!criterion.anchors?.length) {
            findings.push({ severity: "warning", rule: "R_ANCHORS", message: "criterion should link score anchors or boundary guidance", path });
        }
        const description = criterion.description?.toLowerCase() ?? "";
        if (/\b(good|useful|high quality)\b/.test(description)) {
            findings.push({ severity: "warning", rule: "R_VAGUE", message: "description uses vague quality language", path });
        }
        if (/\s(and|or)\s/.test(description)) {
            findings.push({ severity: "warning", rule: "R_COMPOUND", message: "description may combine multiple checks", path });
        }
    }
    return findings;
}
export function hasBlockingFindings(findings) {
    return findings.some((finding) => finding.severity === "error");
}
