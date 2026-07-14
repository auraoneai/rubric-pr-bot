import { handlePullRequest, type ChangedRubrics } from "./handlers/pull_request_opened.js";
import { escapeMarkdown } from "./comment_builder.js";
import type { Finding, ReviewResult, Rubric } from "./rubric_review.js";

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

export type GitHubReviewResult = {
  state: "pass" | "review" | "fail" | "blocked" | "skipped";
  conclusion: "success" | "neutral" | "failure" | "action_required";
  files: string[];
  findings: Finding[];
  comment: string;
  commentUrl?: string;
  checkUrl?: string;
};

const DEFAULT_MARKER = "<!-- auraone-rubric-pr-bot -->";
const CHECK_NAME = "AuraOne rubric review";

export async function handlePullRequestWebhook(
  eventName: string,
  payload: PullRequestPayload,
  options: GitHubOptions,
): Promise<GitHubReviewResult | null> {
  if (eventName !== "pull_request" || !["opened", "reopened", "synchronize"].includes(payload.action ?? "")) return null;
  const context = parseContext(payload);
  const request = githubRequest(options);
  const externalId = `rubric-pr-bot:${context.number}:${context.headSha}`;
  const check =
    options.createCheck === false ? undefined : await createOrReuseCheckRun(request, context, externalId);
  if (check) await updateCheckRun(request, context, check.id, { status: "in_progress", started_at: new Date().toISOString() });

  try {
    const files = await request<Array<{ filename: string }>>(
      `/repos/${context.owner}/${context.repo}/pulls/${context.number}/files?per_page=100`,
    );
    const paths = files.map((file) => file.filename);
    const rubricPaths = paths.filter((path) => path.endsWith(".rubric.json"));
    if (rubricPaths.length === 0) {
      const skipped = skippedResult();
      if (check) await completeCheckRun(request, context, check.id, skipped);
      return { ...skipped, checkUrl: check?.htmlUrl };
    }

    const rubrics = await loadRubrics(request, context, rubricPaths);
    const review = handlePullRequest(paths, rubrics);
    if (!review) throw new Error("rubric review did not produce a result");
    const marker = options.commentMarker ?? DEFAULT_MARKER;
    const body = `${marker}\n${review.comment}`;
    const commentUrl = await upsertComment(request, context, body, marker);
    const result: GitHubReviewResult = { ...review, commentUrl, checkUrl: check?.htmlUrl };
    if (check) await completeCheckRun(request, context, check.id, result);
    return result;
  } catch (error) {
    const blocked = blockedResult(error);
    if (check) await completeCheckRun(request, context, check.id, blocked);
    const marker = options.commentMarker ?? DEFAULT_MARKER;
    try {
      blocked.commentUrl = await upsertComment(request, context, `${marker}\n${blocked.comment}`, marker);
    } catch {
      // The Check Run remains the authoritative failure surface.
    }
    blocked.checkUrl = check?.htmlUrl;
    return blocked;
  }
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
    if (response.status === 204) return undefined as T;
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
  const comments = await request<Array<{ id: number; body?: string; user?: { type?: string; login?: string } }>>(
    `/repos/${context.owner}/${context.repo}/issues/${context.number}/comments?per_page=100`,
  );
  const existing = comments.find(
    (comment) =>
      (comment.user?.type === "Bot" || comment.user?.login?.endsWith("[bot]")) &&
      comment.body?.includes(marker),
  );
  const payload = { body: limitText(body, 60_000) };
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

async function createOrReuseCheckRun(
  request: ReturnType<typeof githubRequest>,
  context: ReturnType<typeof parseContext>,
  externalId: string,
): Promise<{ id: number; htmlUrl?: string }> {
  const existing = await request<{ check_runs?: Array<{ id: number; external_id?: string; html_url?: string }> }>(
    `/repos/${context.owner}/${context.repo}/commits/${context.headSha}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}&filter=latest`,
  );
  const match = existing.check_runs?.find((check) => check.external_id === externalId);
  if (match) return { id: match.id, htmlUrl: match.html_url };
  const created = await request<{ id: number; html_url?: string }>(
    `/repos/${context.owner}/${context.repo}/check-runs`,
    {
      method: "POST",
      body: JSON.stringify({
        name: CHECK_NAME,
        head_sha: context.headSha,
        external_id: externalId,
        status: "queued",
        output: {
          title: "Rubric review queued",
          summary: "AuraOne is loading changed rubric files and preparing evidence.",
        },
      }),
    },
  );
  return { id: created.id, htmlUrl: created.html_url };
}

async function updateCheckRun(
  request: ReturnType<typeof githubRequest>,
  context: ReturnType<typeof parseContext>,
  checkId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  await request(`/repos/${context.owner}/${context.repo}/check-runs/${checkId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

async function completeCheckRun(
  request: ReturnType<typeof githubRequest>,
  context: ReturnType<typeof parseContext>,
  checkId: number,
  result: GitHubReviewResult,
): Promise<void> {
  await updateCheckRun(request, context, checkId, {
    status: "completed",
    completed_at: new Date().toISOString(),
    conclusion: result.conclusion,
    output: {
      title: checkTitle(result.state),
      summary: limitText(result.comment, 60_000),
      annotations: annotations(result.findings),
    },
  });
}

function annotations(findings: Finding[]): Array<Record<string, unknown>> {
  return findings.slice(0, 50).map((finding) => ({
    path: finding.file ?? "rubric.rubric.json",
    start_line: 1,
    end_line: 1,
    annotation_level: finding.severity === "error" ? "failure" : "warning",
    title: limitText(`${finding.rule}: ${finding.severity === "error" ? "blocking" : "review"}`, 255),
    message: limitText(cleanText(finding.message), 64_000),
    raw_details: finding.path ? `Rubric source path: ${cleanText(finding.path)}` : undefined,
  }));
}

function skippedResult(): GitHubReviewResult {
  return {
    state: "skipped",
    conclusion: "neutral",
    files: [],
    findings: [],
    comment: [
      "## AuraOne Rubric Review",
      "",
      "**Decision:** Skipped",
      "",
      "No changed `*.rubric.json` files were found in this pull request.",
      "",
      "### Next action",
      "",
      "No action is required. The review will run when a rubric file changes.",
      "",
      "Generated by AuraOne Rubric PR Bot 0.2.0.",
    ].join("\n"),
  };
}

function blockedResult(error: unknown): GitHubReviewResult {
  const message = cleanText(error instanceof Error ? error.message : String(error));
  return {
    state: "blocked",
    conclusion: "action_required",
    files: [],
    findings: [],
    comment: [
      "## AuraOne Rubric Review",
      "",
      "**Decision:** Blocked",
      "",
      "### Evidence",
      "",
      escapeMarkdown(message),
      "",
      "### Next action",
      "",
      "Correct the malformed rubric, repository permissions, or GitHub App configuration, then synchronize the pull request.",
      "",
      "Generated by AuraOne Rubric PR Bot 0.2.0.",
    ].join("\n"),
  };
}

function checkTitle(state: GitHubReviewResult["state"]): string {
  return {
    pass: "Rubric review passed",
    review: "Rubric review needs attention",
    fail: "Rubric review found blocking issues",
    blocked: "Rubric review could not complete",
    skipped: "Rubric review skipped",
  }[state];
}

function encodeURIComponentPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function limitText(value: string, max: number): string {
  const cleaned = cleanText(value);
  return cleaned.length > max ? `${cleaned.slice(0, max - 20)}\n\n_Output truncated._` : cleaned;
}
