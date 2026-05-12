import { handlePullRequest, type ChangedRubrics } from "./handlers/pull_request_opened.js";
import type { ReviewResult, Rubric } from "./rubric_review.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

type GitHubOptions = {
  token: string;
  apiUrl?: string;
  commentMarker?: string;
  createCheck?: boolean;
  fetchImpl?: FetchLike;
};

type PullRequestPayload = {
  action?: string;
  repository?: { name?: string; owner?: { login?: string; name?: string } };
  pull_request?: {
    number?: number;
    head?: { sha?: string };
    base?: { sha?: string };
  };
};

export type GitHubReviewResult = ReviewResult & {
  commentUrl?: string;
  checkUrl?: string;
};

const DEFAULT_MARKER = "<!-- auraone-rubric-pr-bot -->";

export async function handlePullRequestWebhook(
  eventName: string,
  payload: PullRequestPayload,
  options: GitHubOptions,
): Promise<GitHubReviewResult | null> {
  if (eventName !== "pull_request" || !["opened", "synchronize"].includes(payload.action ?? "")) return null;
  const context = parseContext(payload);
  const request = githubRequest(options);
  const files = await request<Array<{ filename: string }>>(`/repos/${context.owner}/${context.repo}/pulls/${context.number}/files`);
  const paths = files.map((file) => file.filename);
  const rubrics = await loadRubrics(request, context, paths.filter((path) => path.endsWith(".rubric.json")));
  const review = handlePullRequest(paths, rubrics);
  if (!review) return null;
  const body = `${options.commentMarker ?? DEFAULT_MARKER}\n${review.comment}`;
  const commentUrl = await upsertComment(request, context, body, options.commentMarker ?? DEFAULT_MARKER);
  const checkUrl =
    options.createCheck === false ? undefined : await createCheckRun(request, context, review.conclusion, body.slice(0, 65000));
  return { ...review, commentUrl, checkUrl };
}

function parseContext(payload: PullRequestPayload) {
  const owner = payload.repository?.owner?.login ?? payload.repository?.owner?.name;
  const repo = payload.repository?.name;
  const number = payload.pull_request?.number;
  const headSha = payload.pull_request?.head?.sha;
  const baseSha = payload.pull_request?.base?.sha;
  if (!owner || !repo || !number || !headSha || !baseSha) {
    throw new Error("pull_request webhook payload is missing repository, number, base SHA, or head SHA");
  }
  return { owner, repo, number, headSha, baseSha };
}

function githubRequest(options: GitHubOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${init.method ?? "GET"} ${path} failed with ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  };
}

async function loadRubrics(
  request: ReturnType<typeof githubRequest>,
  context: ReturnType<typeof parseContext>,
  paths: string[],
): Promise<ChangedRubrics> {
  const rubrics: ChangedRubrics = {};
  for (const path of paths) {
    const base = await readRubric(request, context, path, context.baseSha, true);
    const head = await readRubric(request, context, path, context.headSha, false);
    if (!head) throw new Error(`head rubric content is missing for ${path}`);
    rubrics[path] = base ? { base, head } : { head };
  }
  return rubrics;
}

async function readRubric(
  request: ReturnType<typeof githubRequest>,
  context: ReturnType<typeof parseContext>,
  path: string,
  ref: string,
  optional: boolean,
): Promise<Rubric | undefined> {
  try {
    const payload = await request<{ content?: string; encoding?: string }>(
      `/repos/${context.owner}/${context.repo}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(ref)}`,
    );
    if (payload.encoding !== "base64" || !payload.content) throw new Error(`unexpected content encoding for ${path}`);
    return JSON.parse(Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8")) as Rubric;
  } catch (error) {
    if (optional && String(error).includes("failed with 404")) return undefined;
    throw error;
  }
}

async function upsertComment(
  request: ReturnType<typeof githubRequest>,
  context: ReturnType<typeof parseContext>,
  body: string,
  marker: string,
): Promise<string | undefined> {
  const comments = await request<Array<{ id: number; body?: string }>>(
    `/repos/${context.owner}/${context.repo}/issues/${context.number}/comments?per_page=100`,
  );
  const existing = comments.find((comment) => comment.body?.includes(marker));
  const payload = { body };
  const response = existing
    ? await request<{ html_url?: string }>(`/repos/${context.owner}/${context.repo}/issues/comments/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })
    : await request<{ html_url?: string }>(`/repos/${context.owner}/${context.repo}/issues/${context.number}/comments`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
  return response.html_url;
}

async function createCheckRun(
  request: ReturnType<typeof githubRequest>,
  context: ReturnType<typeof parseContext>,
  conclusion: ReviewResult["conclusion"],
  summary: string,
): Promise<string | undefined> {
  const response = await request<{ html_url?: string }>(`/repos/${context.owner}/${context.repo}/check-runs`, {
    method: "POST",
    body: JSON.stringify({
      name: "rubric-pr-bot",
      head_sha: context.headSha,
      status: "completed",
      conclusion,
      output: {
        title: conclusion === "success" ? "Rubric review passed" : "Rubric review found blocking issues",
        summary,
      },
    }),
  });
  return response.html_url;
}

function encodeURIComponentPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
