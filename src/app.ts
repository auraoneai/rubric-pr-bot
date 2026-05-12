import { handlePullRequest } from "./handlers/pull_request_opened.js";
import type { ChangedRubrics } from "./handlers/pull_request_opened.js";

export function route(event: string, files: string[], rubrics?: ChangedRubrics) {
  return event === "pull_request" || event === "pull_request.opened" || event === "pull_request.synchronize"
    ? handlePullRequest(files, rubrics)
    : null;
}
