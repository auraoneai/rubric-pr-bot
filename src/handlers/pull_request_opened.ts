import { buildComment } from "../comment_builder.js";
import { diffRubrics, hasBlockingFindings, lintRubric, type ReviewResult, type Rubric } from "../rubric_review.js";

export type ChangedRubrics = Record<string, { base?: Rubric; head: Rubric }>;

export function handlePullRequest(files: string[], rubrics: ChangedRubrics = {}): ReviewResult | null {
  const rubricFiles = files.filter((file) => file.endsWith(".rubric.json"));
  if (!rubricFiles.length) return null;
  const diffs = rubricFiles.map((file) => ({ file, ...diffRubrics(rubrics[file]?.base, rubrics[file]?.head ?? {}) }));
  const findings = rubricFiles.flatMap((file) => lintRubric(rubrics[file]?.head ?? {}));
  const comment = buildComment({ files: rubricFiles, diffs }, findings);
  return {
    files: rubricFiles,
    diffs,
    findings,
    comment,
    conclusion: hasBlockingFindings(findings) ? "failure" : "success",
  };
}
