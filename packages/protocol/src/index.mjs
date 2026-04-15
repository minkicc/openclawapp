import envelope from "../schemas/envelope.schema.json" assert { type: "json" };
import crdtOpEnvelope from "../schemas/crdt-op-envelope.schema.json" assert { type: "json" };
import crdtPing from "../schemas/crdt-ping.schema.json" assert { type: "json" };
import crdtPong from "../schemas/crdt-pong.schema.json" assert { type: "json" };
import crdtSyncBatch from "../schemas/crdt-sync-batch.schema.json" assert { type: "json" };
import crdtSyncRequest from "../schemas/crdt-sync-request.schema.json" assert { type: "json" };
import crdtSyncState from "../schemas/crdt-sync-state.schema.json" assert { type: "json" };
import chatPayload from "../schemas/payload-chat-message.schema.json" assert { type: "json" };
import taskCreatePayload from "../schemas/payload-task-create.schema.json" assert { type: "json" };
import taskProgressPayload from "../schemas/payload-task-progress.schema.json" assert { type: "json" };
import taskResultPayload from "../schemas/payload-task-result.schema.json" assert { type: "json" };
import signalPayload from "../schemas/payload-signal.schema.json" assert { type: "json" };

export const schemaRegistry = {
  "app.openclaw.conv.op": crdtOpEnvelope,
  "sys.crdt.ping": crdtPing,
  "sys.crdt.pong": crdtPong,
  "sys.crdt.sync-batch": crdtSyncBatch,
  "sys.crdt.sync-request": crdtSyncRequest,
  "sys.crdt.sync-state": crdtSyncState,
  envelope,
  "payload.chat.message": chatPayload,
  "payload.task.create": taskCreatePayload,
  "payload.task.progress": taskProgressPayload,
  "payload.task.result": taskResultPayload,
  "payload.signal": signalPayload,
};

export function getSchema(name) {
  return schemaRegistry[name] ?? null;
}
