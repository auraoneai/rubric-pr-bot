export type Criterion = {
  criterion_id?: string;
  label?: string;
  description?: string;
  weight?: number;
  examples?: unknown[];
};

export type Rubric = {
  criteria?: Criterion[];
};

export type Finding = {
  severity: "warning" | "error";
  rule: string;
  message: string;
  path?: string;
};

export function diffRubrics(base: Rubric | undefined, head: Rubric) {
  const baseCriteria = new Map((base?.criteria ?? []).map((criterion) => [criterion.criterion_id, criterion]));
  const headCriteria = new Map((head.criteria ?? []).map((criterion) => [criterion.criterion_id, criterion]));
  const added = [...headCriteria.keys()].filter((id): id is string => Boolean(id) && !baseCriteria.has(id));
  const removed = [...baseCriteria.keys()].filter((id): id is string => Boolean(id) && !headCriteria.has(id));
  const changed = [...headCriteria.entries()]
    .filter(([id, criterion]) => {
      const previous = id ? baseCriteria.get(id) : undefined;
      return previous && JSON.stringify(previous) !== JSON.stringify(criterion);
    })
    .map(([id, criterion]) => {
      const previous = baseCriteria.get(id);
      return {
        criterion_id: id,
        weight_delta:
          typeof criterion.weight === "number" && typeof previous?.weight === "number"
            ? Number((criterion.weight - previous.weight).toFixed(6))
            : undefined,
        label_changed: criterion.label !== previous?.label,
        description_changed: criterion.description !== previous?.description,
      };
    });
  return { added, removed, changed };
}

export function lintRubric(rubric: Rubric): Finding[] {
  const findings: Finding[] = [];
  for (const [index, criterion] of (rubric.criteria ?? []).entries()) {
    const path = `/criteria/${index}`;
    if (!criterion.criterion_id) {
      findings.push({ severity: "error", rule: "R_ID", message: "criterion_id is required", path });
    }
    if (!criterion.examples?.length) {
      findings.push({ severity: "warning", rule: "R_EXAMPLES", message: "criterion should include reviewer examples", path });
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
