import { handlePullRequest } from "./handlers/pull_request_opened.js";
export function route(event: string, files: string[]) { return event === "pull_request" ? handlePullRequest(files) : ""; }
