import { handleWebhookRequest } from "../dist/server.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method === "GET" || req.method === "HEAD") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    if (req.method === "HEAD") return res.end();
    return res.end(`${JSON.stringify({ ok: true, service: "rubric-pr-bot", webhook: "/webhook" })}\n`);
  }

  try {
    const body = await readBody(req);
    const result = await handleWebhookRequest(req.method, req.url, req.headers, body);
    res.statusCode = result.status;
    res.setHeader("content-type", "application/json");
    return res.end(`${JSON.stringify(result.payload)}\n`);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    return res.end(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  }
}

function readBody(req) {
  if (typeof req.body === "string") return Promise.resolve(req.body);
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString("utf8"));
  if (req.body && typeof req.body === "object") return Promise.resolve(JSON.stringify(req.body));

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
