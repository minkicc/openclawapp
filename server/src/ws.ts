import { createHash } from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

export function acceptWebSocket({ request, socket, head, context, onMessage, onClose, onPong }) {
  const key = request.headers["sec-websocket-key"];
  if (!key || typeof key !== "string") {
    rejectUpgrade(socket, "Missing Sec-WebSocket-Key");
    return null;
  }

  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n"
  );

  const ws = {
    OPEN: 1,
    CLOSED: 3,
    readyState: 1,
    context,
    isAlive: true,
    send(data) {
      if (ws.readyState !== ws.OPEN) {
        return;
      }
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
      socket.write(encodeFrame(OP_TEXT, payload));
    },
    ping() {
      if (ws.readyState !== ws.OPEN) {
        return;
      }
      socket.write(encodeFrame(OP_PING, Buffer.alloc(0)));
    },
    terminate() {
      if (ws.readyState !== ws.OPEN) {
        return;
      }
      ws.readyState = ws.CLOSED;
      socket.destroy();
      onClose?.(ws);
    },
    close() {
      if (ws.readyState !== ws.OPEN) {
        return;
      }
      ws.readyState = ws.CLOSED;
      socket.write(encodeFrame(OP_CLOSE, Buffer.alloc(0)));
      socket.end();
      onClose?.(ws);
    }
  };

  let buffer = Buffer.alloc(0);
  if (head && head.length > 0) {
    buffer = Buffer.concat([buffer, head]);
  }

  socket.on("data", (chunk) => {
    if (ws.readyState !== ws.OPEN) {
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    try {
      const decoded = decodeFrames(buffer);
      buffer = decoded.remaining;

      for (const frame of decoded.frames) {
        if (frame.opcode === OP_TEXT) {
          onMessage?.(ws, frame.payload.toString("utf8"));
        } else if (frame.opcode === OP_PING) {
          socket.write(encodeFrame(OP_PONG, frame.payload));
        } else if (frame.opcode === OP_PONG) {
          ws.isAlive = true;
          onPong?.(ws);
        } else if (frame.opcode === OP_CLOSE) {
          ws.readyState = ws.CLOSED;
          socket.end();
          onClose?.(ws);
        }
      }
    } catch (_error) {
      ws.terminate();
    }
  });

  socket.on("close", () => {
    if (ws.readyState !== ws.CLOSED) {
      ws.readyState = ws.CLOSED;
      onClose?.(ws);
    }
  });

  socket.on("error", () => {
    if (ws.readyState !== ws.CLOSED) {
      ws.readyState = ws.CLOSED;
      onClose?.(ws);
    }
  });

  return ws;
}

export function rejectUpgrade(socket, message) {
  socket.write(
    "HTTP/1.1 400 Bad Request\r\n" +
      "Connection: close\r\n" +
      "Content-Type: application/json\r\n" +
      "\r\n" +
      JSON.stringify({ ok: false, error: message })
  );
  socket.destroy();
}

function encodeFrame(opcode, payload) {
  const size = payload.length;
  if (size < 126) {
    const frame = Buffer.alloc(2 + size);
    frame[0] = 0x80 | (opcode & 0x0f);
    frame[1] = size;
    payload.copy(frame, 2);
    return frame;
  }

  if (size < 65536) {
    const frame = Buffer.alloc(4 + size);
    frame[0] = 0x80 | (opcode & 0x0f);
    frame[1] = 126;
    frame.writeUInt16BE(size, 2);
    payload.copy(frame, 4);
    return frame;
  }

  const frame = Buffer.alloc(10 + size);
  frame[0] = 0x80 | (opcode & 0x0f);
  frame[1] = 127;
  frame.writeBigUInt64BE(BigInt(size), 2);
  payload.copy(frame, 10);
  return frame;
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const byte1 = buffer[offset];
    const byte2 = buffer[offset + 1];
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) !== 0;
    let payloadLength = byte2 & 0x7f;
    let cursor = offset + 2;

    if (payloadLength === 126) {
      if (cursor + 2 > buffer.length) {
        break;
      }
      payloadLength = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (payloadLength === 127) {
      if (cursor + 8 > buffer.length) {
        break;
      }
      const big = buffer.readBigUInt64BE(cursor);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("Frame too large");
      }
      payloadLength = Number(big);
      cursor += 8;
    }

    let maskingKey = null;
    if (masked) {
      if (cursor + 4 > buffer.length) {
        break;
      }
      maskingKey = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }

    if (cursor + payloadLength > buffer.length) {
      break;
    }

    const payload = Buffer.from(buffer.subarray(cursor, cursor + payloadLength));
    if (masked && maskingKey) {
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= maskingKey[i % 4];
      }
    }

    frames.push({ opcode, payload });
    offset = cursor + payloadLength;
  }

  return {
    frames,
    remaining: buffer.subarray(offset)
  };
}
