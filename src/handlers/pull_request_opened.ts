import { buildComment } from "../comment_builder.js";
export function handlePullRequest(files: string[]) { return files.some(f => f.endsWith(".rubric.json")) ? buildComment({ files }, []) : ""; }
