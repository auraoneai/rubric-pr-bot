import { strict as assert } from "node:assert";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { route } from "./app.js";
import { escapeMarkdown } from "./comment_builder.js";
import { handlePullRequestWebhook } from "./github.js";
import { createAppJwt, createInstallationToken, verifySignature } from "./server.js";

const review = route("pull_request", ["quality.rubric.json"], {
  "quality.rubric.json": {
    base: {
      criteria: [
        {
          criterion_id: "accuracy",
          label: "Accuracy",
          description: "Correct answer",
          weight: 1,
          examples: [{}],
          anchors: [{}],
        },
      ],
    },
    head: {
      criteria: [
        { criterion_id: "accuracy", label: "Accuracy", description: "Good and useful answer", weight: 0.5 },
        {
          criterion_id: "safety",
          label: "Safety",
          description: "Avoids unsafe advice",
          weight: 0.5,
          examples: [{}],
          anchors: [{}],
        },
      ],
    },
  },
});

assert.ok(review);
assert.equal(review.state, "review");
assert.equal(review.conclusion, "neutral");
assert.match(review.comment, /AuraOne Rubric Review/);
assert.match(review.comment, /Review recommended/);
assert.match(review.comment, /R_EXAMPLES/);
assert.match(review.comment, /### Next action/);

const blocking = route("pull_request.synchronize", ["quality.rubric.json"], {
  "quality.rubric.json": {
    head: {
      criteria: [{ label: "No stable id", description: "Specific behavior", examples: [{}], anchors: [{}] }],
    },
  },
});
assert.ok(blocking);
assert.equal(blocking.state, "fail");
assert.equal(blocking.conclusion, "failure");
assert.match(blocking.comment, /Action required/);
assert.match(blocking.comment, /R_ID/);
assert.equal(route("push", ["quality.rubric.json"]), null);
assert.match(escapeMarkdown("[unsafe](javascript:alert(1))"), /\\\[/);

const calls: Array<{ url: string; init?: RequestInit }> = [];
const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");
let checkCreated = false;
const mockFetch = async (url: string, init?: RequestInit) => {
  calls.push({ url, init });
  const method = init?.method ?? "GET";
  if (url.includes("/commits/head-sha/check-runs?")) {
    return jsonResponse(
      checkCreated
        ? { check_runs: [{ id: 77, external_id: "rubric-pr-bot:42:head-sha", html_url: "https://github.test/runs/77" }] }
        : { check_runs: [] },
    );
  }
  if (method === "POST" && url.endsWith("/repos/auraoneai/open/check-runs")) {
    checkCreated = true;
    return jsonResponse({ id: 77, html_url: "https://github.test/runs/77" });
  }
  if (method === "PATCH" && url.endsWith("/repos/auraoneai/open/check-runs/77")) return jsonResponse({});
  if (url.endsWith("/repos/auraoneai/open/pulls/42/files?per_page=100")) {
    return jsonResponse([{ filename: "quality.rubric.json" }]);
  }
  if (url.includes("/contents/quality.rubric.json?ref=base-sha")) {
    return jsonResponse({
      encoding: "base64",
      content: encode({
        criteria: [{ criterion_id: "accuracy", description: "Correct answer", examples: [{}], anchors: [{}] }],
      }),
    });
  }
  if (url.includes("/contents/quality.rubric.json?ref=head-sha")) {
    return jsonResponse({
      encoding: "base64",
      content: encode({
        criteria: [{ description: "Missing id | injected", examples: [{}], anchors: [{}] }],
      }),
    });
  }
  if (url.endsWith("/repos/auraoneai/open/issues/42/comments?per_page=100")) {
    return jsonResponse([
      { id: 1, body: "<!-- auraone-rubric-pr-bot --> user", user: { type: "User", login: "attacker" } },
      { id: 2, body: "<!-- auraone-rubric-pr-bot --> old", user: { type: "Bot", login: "auraone[bot]" } },
    ]);
  }
  if (method === "PATCH" && url.endsWith("/repos/auraoneai/open/issues/comments/2")) {
    return jsonResponse({ html_url: "https://github.test/pull/42#issuecomment-2" });
  }
  throw new Error(`unexpected mock fetch call: ${method} ${url}`);
};

const payload = {
  action: "synchronize",
  repository: { name: "open", owner: { login: "auraoneai" } },
  pull_request: { number: 42, base: { sha: "base-sha" }, head: { sha: "head-sha" } },
};
const webhookResult = await handlePullRequestWebhook("pull_request", payload, {
  token: "test-token",
  fetchImpl: mockFetch,
});
assert.ok(webhookResult);
assert.equal(webhookResult.state, "fail");
assert.equal(webhookResult.commentUrl, "https://github.test/pull/42#issuecomment-2");
assert.equal(webhookResult.checkUrl, "https://github.test/runs/77");
assert.equal(calls.filter((call) => call.url.endsWith("/check-runs") && call.init?.method === "POST").length, 1);
assert.equal(calls.filter((call) => call.url.endsWith("/check-runs/77") && call.init?.method === "PATCH").length, 2);
assert.ok(calls.some((call) => call.url.endsWith("/issues/comments/2") && call.init?.method === "PATCH"));
assert.equal((calls[0].init?.headers as Record<string, string>).authorization, "Bearer test-token");

const secondResult = await handlePullRequestWebhook("pull_request", payload, {
  token: "test-token",
  fetchImpl: mockFetch,
});
assert.ok(secondResult);
assert.equal(calls.filter((call) => call.url.endsWith("/check-runs") && call.init?.method === "POST").length, 1);

const skippedCalls: Array<{ url: string; init?: RequestInit }> = [];
const skippedFetch = async (url: string, init?: RequestInit) => {
  skippedCalls.push({ url, init });
  const method = init?.method ?? "GET";
  if (url.includes("/check-runs?")) return jsonResponse({ check_runs: [] });
  if (method === "POST" && url.endsWith("/check-runs")) return jsonResponse({ id: 88, html_url: "https://github.test/runs/88" });
  if (method === "PATCH" && url.endsWith("/check-runs/88")) return jsonResponse({});
  if (url.endsWith("/pulls/42/files?per_page=100")) return jsonResponse([{ filename: "README.md" }]);
  throw new Error(`unexpected skipped fetch call: ${method} ${url}`);
};
const skipped = await handlePullRequestWebhook("pull_request", payload, { token: "test-token", fetchImpl: skippedFetch });
assert.equal(skipped?.state, "skipped");
assert.equal(skipped?.conclusion, "neutral");

const body = JSON.stringify({ action: "opened" });
const signature = `sha256=${createHmac("sha256", "webhook-secret").update(body).digest("hex")}`;
assert.equal(verifySignature("webhook-secret", body, signature), true);
assert.equal(verifySignature("webhook-secret", body, "sha256=bad"), false);

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const jwt = createAppJwt("12345", privateKeyPem, 1_700_000_000);
assert.equal(jwt.split(".").length, 3);

const tokenCalls: Array<{ url: string; init?: RequestInit }> = [];
const token = await createInstallationToken("12345", privateKeyPem, 99, "https://api.github.test", async (url, init) => {
  tokenCalls.push({ url, init });
  return jsonResponse({ token: "installation-token" });
});
assert.equal(token, "installation-token");
assert.equal(tokenCalls[0].url, "https://api.github.test/app/installations/99/access_tokens");
assert.match((tokenCalls[0].init?.headers as Record<string, string>).authorization, /^Bearer /);

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}
