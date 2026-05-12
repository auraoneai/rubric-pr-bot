import { buildComment } from "../comment_builder.js";
import { diffRubrics, lintRubric, type Rubric } from "../rubric_review.js";

export type ChangedRubrics = Record<string, { base?: Rubric; head: Rubric }>;

export function handlePullRequest(files: string[], rubrics: ChangedRubrics = {}) {
  const rubricFiles = files.filter((file) => file.endsWith(".rubric.json"));
  if (!rubricFiles.length) return "";
  const diffs = rubricFiles.map((file) => ({ file, ...diffRubrics(rubrics[file]?.base, rubrics[file]?.head ?? {}) }));
  const findings = rubricFiles.flatMap((file) => lintRubric(rubrics[file]?.head ?? {}));
  return buildComment({ files: rubricFiles, diffs }, findings);
}
