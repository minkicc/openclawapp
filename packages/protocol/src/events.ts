export const MESSAGE_TYPES = {
  PAIR_READY: "pair.ready",
  PAIR_CLAIMED: "pair.claimed",
  PAIR_REVOKED: "pair.revoked",
  TASK_CREATE: "task.create",
  TASK_ACCEPTED: "task.accepted",
  TASK_PROGRESS: "task.progress",
  TASK_RESULT: "task.result",
  TASK_ERROR: "task.error",
  ACK: "ack",
  HEARTBEAT: "heartbeat"
} as const;
export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

export const WS_CHANNELS = {
  PC: "pc",
  MOBILE: "mobile"
} as const;
export type WsChannel = (typeof WS_CHANNELS)[keyof typeof WS_CHANNELS];

export const PAIR_STATUS = {
  PENDING: "pending",
  CLAIMED: "claimed",
  EXPIRED: "expired",
  REVOKED: "revoked"
} as const;
export type PairStatus = (typeof PAIR_STATUS)[keyof typeof PAIR_STATUS];

export const DEFAULT_PAIR_TTL_SECONDS = 120;
