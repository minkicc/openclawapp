# @openclaw/protocol

Shared protocol package for desktop/mobile/server.

## Includes

- Message type constants
- Pair status constants
- WebSocket channel constants
- Envelope helpers (`createEnvelope`, `parseEnvelope`)
- CRDT v3 wire constants and helpers
- CRDT graph/store helpers for ordering, frontier, and repair
- CRDT op/sync/ping parsers and constructors
- JSON schema registry for shared validation

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

## CRDT v3

The package now also exposes a clean-break CRDT protocol foundation for the next
pair/group sync model:

- `CRDT_WIRE_TYPES`
- `CRDT_OP_KINDS`
- `createCrdtOpEnvelope`
- `parseCrdtOpEnvelope`
- `createCrdtSyncState`
- `parseCrdtSyncState`
- `createCrdtSyncRequest`
- `parseCrdtSyncRequest`
- `createCrdtSyncBatch`
- `parseCrdtSyncBatch`
- `mergeCrdtVersionVectors`
- `diffCrdtVersionVectors`
- `analyzeCrdtOps`
- `materializeCrdtMessages`
- `selectCrdtOpsForSync`

Example:

```ts
import {
  CRDT_OP_KINDS,
  createCrdtConversationId,
  createCrdtMessageId,
  createCrdtOpEnvelope
} from "@openclaw/protocol";

const conversationId = createCrdtConversationId();
const op = createCrdtOpEnvelope({
  conversationId,
  authorDeviceId: "desktop_main",
  authorEntityType: "desktop",
  authorSeq: 1,
  kind: CRDT_OP_KINDS.MESSAGE_CREATE,
  parents: [],
  payload: {
    messageId: createCrdtMessageId(),
    body: { text: "hello from crdt" }
  },
  signature: "placeholder-signature"
});
```

Graph helper example:

```ts
import {
  analyzeCrdtOps,
  materializeCrdtMessages,
  selectCrdtOpsForSync
} from "@openclaw/protocol";

const analysis = analyzeCrdtOps(opLog);
const messages = materializeCrdtMessages(opLog);
const batch = selectCrdtOpsForSync(opLog, {
  desktop_main: 12,
  mobile_rqz: 4
});
```

## Schema Registry

`src/index.mjs` exposes JSON schemas for both legacy payloads and new CRDT wire
messages:

- `app.openclaw.conv.op`
- `sys.crdt.sync-state`
- `sys.crdt.sync-request`
- `sys.crdt.sync-batch`
- `sys.crdt.ping`
- `sys.crdt.pong`
