import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handlePullRequestWebhook } from "./github.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

type WebhookPayload = {
  action?: string;
  installation?: { id?: number };
  repository?: { name?: string; owner?: { login?: string; name?: string } };
  pull_request?: {
    number?: number;
    head?: { sha?: string };
    base?: { sha?: string };
  };
};

export type ServerEnv = {
  RUBRIC_PR_BOT_APP_ID?: string;
  RUBRIC_PR_BOT_PRIVATE_KEY?: string;
  RUBRIC_PR_BOT_WEBHOOK_SECRET?: string;
  GITHUB_API_URL?: string;
  PORT?: string;
};

export function verifySignature(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return timingSafeEqualString(expected, signature);
}

export function createAppJwt(appId: string, privateKey: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(normalizePrivateKey(privateKey), "base64url");
  return `${unsigned}.${signature}`;
}

export async function createInstallationToken(
  appId: string,
  privateKey: string,
  installationId: number,
  apiUrl = "https://api.github.com",
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const response = await fetchImpl(`${apiUrl.replace(/\/$/, "")}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${createAppJwt(appId, privateKey)}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`failed to create GitHub App installation token: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { token?: string };
  if (!payload.token) throw new Error("GitHub App installation token response did not include token");
  return payload.token;
}

export function startServer(env: ServerEnv = process.env as ServerEnv, fetchImpl: FetchLike = fetch) {
  const appId = required(env.RUBRIC_PR_BOT_APP_ID, "RUBRIC_PR_BOT_APP_ID");
  const privateKey = required(env.RUBRIC_PR_BOT_PRIVATE_KEY, "RUBRIC_PR_BOT_PRIVATE_KEY");
  const webhookSecret = required(env.RUBRIC_PR_BOT_WEBHOOK_SECRET, "RUBRIC_PR_BOT_WEBHOOK_SECRET");
  const apiUrl = env.GITHUB_API_URL ?? "https://api.github.com";
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be a positive integer");

  const server = createServer(async (req, res) => {
    try {
      const body = await readBody(req);
      const result = await handleWebhookRequest(
        req.method,
        req.url,
        req.headers,
        body,
        {
          RUBRIC_PR_BOT_APP_ID: appId,
          RUBRIC_PR_BOT_PRIVATE_KEY: privateKey,
          RUBRIC_PR_BOT_WEBHOOK_SECRET: webhookSecret,
          GITHUB_API_URL: apiUrl,
        },
        fetchImpl,
      );
      return sendJson(res, result.status, result.payload);
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  server.listen(port);
  return server;
}

export async function handleWebhookRequest(
  method: string | undefined,
  url: string | undefined,
  headers: Record<string, string | string[] | undefined>,
  body: string,
  env: ServerEnv = process.env as ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<{ status: number; payload: unknown }> {
  if (method !== "POST" || !isWebhookPath(url)) return { status: 404, payload: { ok: false, error: "not found" } };

  const appId = required(env.RUBRIC_PR_BOT_APP_ID, "RUBRIC_PR_BOT_APP_ID");
  const privateKey = required(env.RUBRIC_PR_BOT_PRIVATE_KEY, "RUBRIC_PR_BOT_PRIVATE_KEY");
  const webhookSecret = required(env.RUBRIC_PR_BOT_WEBHOOK_SECRET, "RUBRIC_PR_BOT_WEBHOOK_SECRET");
  const apiUrl = env.GITHUB_API_URL ?? "https://api.github.com";
  const signature = headers["x-hub-signature-256"];
  if (!verifySignature(webhookSecret, body, Array.isArray(signature) ? signature[0] : signature)) {
    return { status: 401, payload: { ok: false, error: "invalid signature" } };
  }

  const eventName = String(headers["x-github-event"] ?? "");
  const payload = JSON.parse(body) as WebhookPayload;
  const installationId = payload.installation?.id;
  if (!installationId) return { status: 202, payload: { ok: true, status: "ignored", reason: "missing installation id" } };

  const token = await createInstallationToken(appId, privateKey, installationId, apiUrl, fetchImpl);
  const result = await handlePullRequestWebhook(eventName, payload, { token, apiUrl, fetchImpl });
  return { status: 200, payload: { ok: true, status: result ? "reviewed" : "ignored", result } };
}

function isWebhookPath(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split("?")[0];
  return path === "/webhook" || path === "/api/webhook";
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(`${JSON.stringify(payload)}\n`);
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

if (process.argv[1]?.endsWith("server.js")) {
  startServer();
}
