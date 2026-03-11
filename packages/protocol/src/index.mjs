import envelope from "../schemas/envelope.schema.json" assert { type: "json" };
import chatPayload from "../schemas/payload-chat-message.schema.json" assert { type: "json" };
import taskCreatePayload from "../schemas/payload-task-create.schema.json" assert { type: "json" };
import taskProgressPayload from "../schemas/payload-task-progress.schema.json" assert { type: "json" };
import taskResultPayload from "../schemas/payload-task-result.schema.json" assert { type: "json" };
import signalPayload from "../schemas/payload-signal.schema.json" assert { type: "json" };

export const schemaRegistry = {
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
