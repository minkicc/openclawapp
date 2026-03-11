const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};

export function withHeaders(extra = {}) {
  return {
    ...CORS_HEADERS,
    ...extra,
  };
}

export function json(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(
    statusCode,
    withHeaders({
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      ...extraHeaders,
    })
  );
  res.end(body);
}

export function noContent(res, statusCode = 204, extraHeaders = {}) {
  res.writeHead(statusCode, withHeaders(extraHeaders));
  res.end();
}

export function sseHeaders() {
  return withHeaders({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
}

export async function readJsonBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const asBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += asBuffer.length;
    if (total > maxBytes) {
      const error = new Error("Request body too large");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(asBuffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON body");
    error.code = "INVALID_JSON";
    throw error;
  }
}
