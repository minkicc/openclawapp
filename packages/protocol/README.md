# @openclaw/protocol

Shared protocol package for desktop/mobile/server.

## Includes

- Message type constants
- Pair status constants
- WebSocket channel constants
- Envelope helpers (`createEnvelope`, `parseEnvelope`)

## Usage

```js
import { MESSAGE_TYPES, createEnvelope, parseEnvelope } from "@openclaw/protocol";

const message = createEnvelope({
  type: MESSAGE_TYPES.TASK_CREATE,
  userId: "user_1",
  targetDeviceId: "pc_1",
  payload: { prompt: "run task" }
});

const parsed = parseEnvelope(JSON.stringify(message));
```
