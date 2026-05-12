import { handlePullRequest } from "./handlers/pull_request_opened.js";
export function route(event, files, rubrics) {
    return event === "pull_request" || event === "pull_request.opened" || event === "pull_request.synchronize"
        ? handlePullRequest(files, rubrics)
        : null;
}
