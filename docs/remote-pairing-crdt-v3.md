# Remote Pairing CRDT v3 Draft

This document defines the next-generation pairing/chat protocol for OpenClaw.

It intentionally does **not** preserve backward compatibility with the current
pair-chat message format or stored message data.

The goal is to move from:

- point-to-point pair chat with ad hoc repair

to:

- multi-device
- multi-writer
- group-capable
- offline-tolerant
- server-light

The server remains a short-lived control plane only. Durable chat truth lives on
trusted clients.

## Goals

- Support more than 2 devices per conversation.
- Support future groups, not only `PC <-> mobile`.
- Preserve causality under concurrent sends.
- Allow at-least-once transport and exactly-once UI rendering.
- Recover from dropped realtime deliveries through anti-entropy sync.
- Keep the server out of durable message storage.

## Non-Goals

- No compatibility with old pair-chat payloads.
- No server-side durable message history.
- No generic rich-text CRDT. This is a chat/log CRDT, not a document editor.

## Architecture

### Server Responsibilities

The server only keeps short-lived control-plane state:

- challenge/login
- pair session bootstrap
- presence announce/heartbeat
- signal relay
- short TTL relay queues / cluster coordination

The server is **not**:

- channel authority
- group authority
- message authority
- durable message history

### Client Responsibilities

Trusted clients jointly own:

- channel/group membership state
- trusted device set
- durable operation log
- message materialization
- anti-entropy repair

## Core Model

The protocol becomes an **op-based causal CRDT**.

Every change is an operation appended to a local durable log and merged by set union.

### Operation Envelope

```json
{
  "opId": "op_desktopA_184_01HZZZZZZZZZZZZZZZZZZZZZZZ",
  "conversationId": "conv_01HZZZZZZZZZZZZZZZZZZZZZZZ",
  "authorDeviceId": "desktopA",
  "authorEntityType": "desktop",
  "authorSeq": 184,
  "hlc": "2026-04-14T16:30:11.123Z#desktopA#000184",
  "parents": [
    "op_mobileB_92_01HYYYYYYYYYYYYYYYYYYYYYYY",
    "op_desktopA_183_01HXXXXXXXXXXXXXXX"
  ],
  "kind": "message.create",
  "payload": {},
  "signedAt": 1776155411123,
  "signature": "base64url-ed25519-signature"
}
```

### Required Fields

- `opId`
  Global immutable operation id.
- `conversationId`
  Stable conversation/group id.
- `authorDeviceId`
  Concrete device writer id, not abstract user id.
- `authorSeq`
  Strictly monotonic per device within a conversation.
- `hlc`
  Hybrid logical clock string or equivalent structured HLC object.
- `parents`
  Current known frontier when this op is authored.
- `kind`
  Operation type.
- `payload`
  Operation body.
- `signature`
  Signed by the author device key.

## Why This Beats `after[]` Alone

`parents` (the old `after[]` idea) is still useful, but by itself it is not enough.

It solves:

- causal links
- branching / merging
- detecting missing predecessors

It does **not** solve well:

- silent loss of the newest leaf op
- efficient repair
- multi-writer cursor exchange
- group anti-entropy

So v3 uses:

- `parents` for graph structure
- `authorSeq` for repair
- `hlc` for stable tie-breaking
- anti-entropy sync for eventual convergence

## Operation Types

### Conversation / Trust Plane

- `conversation.create`
- `member.add`
- `member.remove`
- `device.trust.add`
- `device.trust.remove`
- `channel.revoke`

These are also CRDT operations, not server-owned records.

### Message Plane

- `message.create`
- `message.edit`
- `message.delete`
- `reaction.add`
- `reaction.remove`
- `read.cursor`

Initial implementation can start with only:

- `conversation.create`
- `member.add`
- `channel.revoke`
- `message.create`

## Message Create Payload

```json
{
  "kind": "message.create",
  "payload": {
    "messageId": "msg_01HZZZZZZZZZZZZZZZZZZZZZZZ",
    "body": {
      "text": "hello"
    },
    "clientNonce": "local_01HZZZZZZZZZZZZZZZZZZZZZZZ"
  }
}
```

Rules:

- `messageId` is immutable and globally unique.
- `messageId` can equal `opId` for a create-only first version.
- UI dedupe is by `messageId` / `opId`, never by text.

## Merge Semantics

Conversation state is materialized from the union of valid operations.

### Validity

An op is accepted only if:

- signature verifies against the author device public key
- author device is currently trusted for the conversation
- `authorSeq` is monotonic for that device
- payload matches schema for `kind`

### Causal Graph

The message graph is formed by `parents`.

Materialization uses:

1. causal order first
2. `hlc` second
3. `authorDeviceId` third
4. `opId` last

That gives deterministic ordering across devices.

## Anti-Entropy Sync

Realtime delivery is best-effort. Correctness comes from repeated state exchange.

### Per-Conversation Summary

Each client keeps:

- `versionVector[authorDeviceId] = max contiguous authorSeq received`
- `frontier = ops with no known child`

Example:

```json
{
  "conversationId": "conv_01HZZZZZZZZZZZZZZZZZZZZZZZ",
  "versionVector": {
    "desktopA": 184,
    "mobileB": 92,
    "tabletC": 17
  },
  "frontier": [
    "op_desktopA_184_01HZZZZZZZZZZZZZZZZZZZZZZZ",
    "op_mobileB_92_01HYYYYYYYYYYYYYYYYYYYYYYY"
  ]
}
```

### Sync Flow

1. Client A sends `sync.state`.
2. Client B compares version vectors.
3. Client B replies with missing op ranges / batches.
4. Client A merges.
5. If frontier still disagrees, repeat until converged.

### Trigger Points

Clients should sync on:

- app start
- app foreground
- peer reconnect
- signal reconnect
- periodic timer, e.g. every 60 seconds
- explicit “repair now” action

## Transport Semantics

The transport should be treated as:

- **at-least-once** for operations
- **exactly-once** in UI by `opId`

This means duplicate sends are acceptable.

Clients must:

- store op before announcing success locally
- accept duplicate op deliveries harmlessly
- re-send known ops during repair

## Local Persistence

Because the server does not persist messages, every trusted client must persist:

- durable op log
- per-conversation version vector
- trusted device metadata
- pending local ops not yet observed back from peers

Minimum requirement:

- `PC` must always persist
- mobile should also persist for offline recovery

## Groups

Groups are just conversations with more than 2 trusted writers.

The model does not change. Only:

- membership ops grow
- version vectors have more authors
- anti-entropy ranges span more devices

This is why the design uses `authorDeviceId + authorSeq`, not `host/mobile` booleans.

## Security

### Device Identity

- Every device has a long-lived Ed25519 identity key.
- Trust is conversation-scoped.

### Signed Ops

Every op is signed by the author device.

Signature preimage should include at minimum:

```text
openclaw-crdt-v3-op
{conversationId}
{opId}
{authorDeviceId}
{authorSeq}
{hlc}
{kind}
{canonical-json-payload}
{sorted-parent-op-ids}
```

### Revocation

Revocation is also an op:

- `device.trust.remove`
- `channel.revoke`

Clients must stop accepting new ops from revoked devices after causal application of the revoke op.

## Suggested Wire Messages

System namespace:

- `sys.crdt.sync-state`
- `sys.crdt.sync-request`
- `sys.crdt.sync-batch`
- `sys.crdt.ping`
- `sys.crdt.pong`

Application namespace:

- `app.openclaw.conv.op`

The wire plane should carry opaque signed ops, not high-level chat-only payloads.

## Migration Decision

This draft assumes a clean break:

- old `app.openclaw.chat.message`
- old `ack`
- old `sync-request`
- old `sync-state`

can all be replaced rather than layered forever.

That keeps the implementation smaller and much easier to reason about.

## Recommended Implementation Phases

### Phase 1

- Introduce new op envelope
- Replace `host/mobile` chat message format with signed `message.create` ops
- Replace per-side cursors with version vectors
- Keep conversations limited to 2 members

### Phase 2

- Move channel trust and revoke fully into conversation ops
- Add durable local op log on both desktop and mobile
- Add anti-entropy batch sync

### Phase 3

- Add group membership ops
- Support 3+ devices / members per conversation

### Phase 4

- Add edit/delete/reaction/read cursor ops

## Recommended Next Code Step

Before full implementation, the shared protocol package should define:

- canonical `OpEnvelope`
- `ConversationSummary`
- `VersionVector`
- `SyncState`
- `SyncBatch`
- operation schemas for `message.create` and membership ops

That lets desktop, mobile, and future clients share one source of truth.
