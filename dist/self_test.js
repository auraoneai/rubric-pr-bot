import { strict as assert } from "node:assert";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { route } from "./app.js";
import { handlePullRequestWebhook } from "./github.js";
import { createAppJwt, createInstallationToken, verifySignature } from "./server.js";
const comment = route("pull_request", ["quality.rubric.json"], {
    "quality.rubric.json": {
        base: {
            criteria: [{ criterion_id: "accuracy", label: "Accuracy", description: "Correct answer", weight: 1, examples: [{}] }],
        },
        head: {
            criteria: [
                { criterion_id: "accuracy", label: "Accuracy", description: "Good and useful answer", weight: 0.5 },
                { criterion_id: "safety", label: "Safety", description: "Avoids unsafe advice", weight: 0.5, examples: [{}] },
            ],
        },
    },
});
assert.ok(comment);
assert.equal(comment.conclusion, "success");
assert.match(comment.comment, /Rubric Review/);
assert.match(comment.comment, /safety/);
assert.match(comment.comment, /R_EXAMPLES/);
assert.match(comment.comment, /R_ANCHORS/);
assert.match(comment.comment, /rubric-spec#criteria/);
const blocking = route("pull_request.synchronize", ["quality.rubric.json"], {
    "quality.rubric.json": {
        head: {
            criteria: [{ label: "No stable id", description: "Specific behavior", examples: [{}], anchors: [{}] }],
        },
    },
});
assert.ok(blocking);
assert.equal(blocking.conclusion, "failure");
assert.match(blocking.comment, /R_ID/);
assert.equal(route("push", ["quality.rubric.json"]), null);
const calls = [];
const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");
const mockFetch = async (url, init) => {
    calls.push({ url, init });
    const method = init?.method ?? "GET";
    if (url.endsWith("/repos/auraoneai/open/pulls/42/files")) {
        return jsonResponse([{ filename: "quality.rubric.json" }]);
    }
    if (url.includes("/contents/quality.rubric.json?ref=base-sha")) {
        return jsonResponse({
            encoding: "base64",
            content: encode({ criteria: [{ criterion_id: "accuracy", description: "Correct answer", examples: [{}], anchors: [{}] }] }),
        });
    }
    if (url.includes("/contents/quality.rubric.json?ref=head-sha")) {
        return jsonResponse({
            encoding: "base64",
            content: encode({ criteria: [{ description: "Missing id", examples: [{}], anchors: [{}] }] }),
        });
    }
    if (url.endsWith("/repos/auraoneai/open/issues/42/comments?per_page=100")) {
        return jsonResponse([]);
    }
    if (method === "POST" && url.endsWith("/repos/auraoneai/open/issues/42/comments")) {
        return jsonResponse({ html_url: "https://github.com/auraoneai/open/pull/42#issuecomment-1" });
    }
    if (method === "POST" && url.endsWith("/repos/auraoneai/open/check-runs")) {
        return jsonResponse({ html_url: "https://github.com/auraoneai/open/runs/1" });
    }
    throw new Error(`unexpected mock fetch call: ${method} ${url}`);
};
const webhookResult = await handlePullRequestWebhook("pull_request", {
    action: "synchronize",
    repository: { name: "open", owner: { login: "auraoneai" } },
    pull_request: { number: 42, base: { sha: "base-sha" }, head: { sha: "head-sha" } },
}, { token: "test-token", fetchImpl: mockFetch });
assert.ok(webhookResult);
assert.equal(webhookResult.conclusion, "failure");
assert.equal(webhookResult.commentUrl, "https://github.com/auraoneai/open/pull/42#issuecomment-1");
assert.equal(webhookResult.checkUrl, "https://github.com/auraoneai/open/runs/1");
assert.ok(calls.some((call) => call.url.endsWith("/issues/42/comments") && call.init?.method === "POST"));
assert.ok(calls.some((call) => call.url.endsWith("/check-runs") && call.init?.method === "POST"));
assert.equal((calls[0].init?.headers).authorization, "Bearer test-token");
const body = JSON.stringify({ action: "opened" });
const signature = `sha256=${createHmac("sha256", "webhook-secret").update(body).digest("hex")}`;
assert.equal(verifySignature("webhook-secret", body, signature), true);
assert.equal(verifySignature("webhook-secret", body, "sha256=bad"), false);
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const jwt = createAppJwt("12345", privateKeyPem, 1_700_000_000);
assert.equal(jwt.split(".").length, 3);
const tokenCalls = [];
const token = await createInstallationToken("12345", privateKeyPem, 99, "https://api.github.test", async (url, init) => {
    tokenCalls.push({ url, init });
    return jsonResponse({ token: "installation-token" });
});
assert.equal(token, "installation-token");
assert.equal(tokenCalls[0].url, "https://api.github.test/app/installations/99/access_tokens");
assert.match((tokenCalls[0].init?.headers).authorization, /^Bearer /);
function jsonResponse(payload) {
    return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
    };
}
