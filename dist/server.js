import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { handlePullRequestWebhook } from "./github.js";
export function verifySignature(secret, body, signature) {
    if (!signature?.startsWith("sha256="))
        return false;
    const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    return timingSafeEqualString(expected, signature);
}
export function createAppJwt(appId, privateKey, nowSeconds = Math.floor(Date.now() / 1000)) {
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }));
    const unsigned = `${header}.${payload}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(normalizePrivateKey(privateKey), "base64url");
    return `${unsigned}.${signature}`;
}
export async function createInstallationToken(appId, privateKey, installationId, apiUrl = "https://api.github.com", fetchImpl = fetch) {
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
    const payload = (await response.json());
    if (!payload.token)
        throw new Error("GitHub App installation token response did not include token");
    return payload.token;
}
export function startServer(env = process.env, fetchImpl = fetch) {
    const appId = required(env.RUBRIC_PR_BOT_APP_ID, "RUBRIC_PR_BOT_APP_ID");
    const privateKey = required(env.RUBRIC_PR_BOT_PRIVATE_KEY, "RUBRIC_PR_BOT_PRIVATE_KEY");
    const webhookSecret = required(env.RUBRIC_PR_BOT_WEBHOOK_SECRET, "RUBRIC_PR_BOT_WEBHOOK_SECRET");
    const apiUrl = env.GITHUB_API_URL ?? "https://api.github.com";
    const port = Number(env.PORT ?? "3000");
    if (!Number.isInteger(port) || port <= 0)
        throw new Error("PORT must be a positive integer");
    const server = createServer(async (req, res) => {
        try {
            const body = await readBody(req);
            const result = await handleWebhookRequest(req.method, req.url, req.headers, body, {
                RUBRIC_PR_BOT_APP_ID: appId,
                RUBRIC_PR_BOT_PRIVATE_KEY: privateKey,
                RUBRIC_PR_BOT_WEBHOOK_SECRET: webhookSecret,
                GITHUB_API_URL: apiUrl,
            }, fetchImpl);
            return sendJson(res, result.status, result.payload);
        }
        catch (error) {
            return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    });
    server.listen(port);
    return server;
}
export async function handleWebhookRequest(method, url, headers, body, env = process.env, fetchImpl = fetch) {
    if (method !== "POST" || !isWebhookPath(url))
        return { status: 404, payload: { ok: false, error: "not found" } };
    const appId = required(env.RUBRIC_PR_BOT_APP_ID, "RUBRIC_PR_BOT_APP_ID");
    const privateKey = required(env.RUBRIC_PR_BOT_PRIVATE_KEY, "RUBRIC_PR_BOT_PRIVATE_KEY");
    const webhookSecret = required(env.RUBRIC_PR_BOT_WEBHOOK_SECRET, "RUBRIC_PR_BOT_WEBHOOK_SECRET");
    const apiUrl = env.GITHUB_API_URL ?? "https://api.github.com";
    const signature = headers["x-hub-signature-256"];
    if (!verifySignature(webhookSecret, body, Array.isArray(signature) ? signature[0] : signature)) {
        return { status: 401, payload: { ok: false, error: "invalid signature" } };
    }
    const eventName = String(headers["x-github-event"] ?? "");
    const payload = JSON.parse(body);
    const installationId = payload.installation?.id;
    if (!installationId)
        return { status: 202, payload: { ok: true, status: "ignored", reason: "missing installation id" } };
    const token = await createInstallationToken(appId, privateKey, installationId, apiUrl, fetchImpl);
    const result = await handlePullRequestWebhook(eventName, payload, { token, apiUrl, fetchImpl });
    return { status: 200, payload: { ok: true, status: result ? "reviewed" : "ignored", result } };
}
function isWebhookPath(url) {
    if (!url)
        return false;
    const path = url.split("?")[0];
    return path === "/webhook" || path === "/api/webhook";
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("error", reject);
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
}
function sendJson(res, status, payload) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(`${JSON.stringify(payload)}\n`);
}
function required(value, name) {
    if (!value)
        throw new Error(`${name} is required`);
    return value;
}
function normalizePrivateKey(privateKey) {
    return privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey;
}
function base64Url(value) {
    return Buffer.from(value).toString("base64url");
}
function timingSafeEqualString(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
if (process.argv[1]?.endsWith("server.js")) {
    startServer();
}
