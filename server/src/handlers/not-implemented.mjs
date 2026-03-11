export function json(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function notImplemented(res, endpointName) {
  json(res, 501, {
    ok: false,
    code: "NOT_IMPLEMENTED",
    message: `${endpointName} is not implemented yet.`,
  });
}
