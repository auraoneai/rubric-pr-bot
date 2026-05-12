import { buildComment } from "../comment_builder.js";
import { diffRubrics, hasBlockingFindings, lintRubric } from "../rubric_review.js";
export function handlePullRequest(files, rubrics = {}) {
    const rubricFiles = files.filter((file) => file.endsWith(".rubric.json"));
    if (!rubricFiles.length)
        return null;
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
