import {
  createCrdtConversationSummary,
  normalizeCrdtId,
  normalizeCrdtParents,
  normalizeCrdtVersionVector,
  type CrdtConversationSummary,
  type CrdtOpEnvelope,
  type CrdtVersionVector,
  CRDT_OP_KINDS
} from "./crdt.js";

export interface CrdtGraphAnalysis {
  ops: CrdtOpEnvelope[];
  orderedOps: CrdtOpEnvelope[];
  leafOpIds: string[];
  missingParentOpIds: string[];
  versionVector: CrdtVersionVector;
  observedVersionVector: CrdtVersionVector;
  childrenByOpId: Record<string, string[]>;
}

export interface CrdtMaterializedMessage {
  messageId: string;
  opId: string;
  conversationId: string;
  authorDeviceId: string;
  authorEntityType: string;
  authorSeq: number;
  hlc: string;
  text: string;
  parts: Array<Record<string, unknown>>;
  clientNonce?: string;
  parents: string[];
  signedAt: number;
}

function compareCrdtOpOrder(left: CrdtOpEnvelope, right: CrdtOpEnvelope) {
  const leftHlc = String(left.hlc || "");
  const rightHlc = String(right.hlc || "");
  if (leftHlc !== rightHlc) {
    return leftHlc.localeCompare(rightHlc);
  }

  const leftAuthor = String(left.authorDeviceId || "");
  const rightAuthor = String(right.authorDeviceId || "");
  if (leftAuthor !== rightAuthor) {
    return leftAuthor.localeCompare(rightAuthor);
  }

  const leftSeq = Math.max(0, Math.trunc(Number(left.authorSeq || 0)));
  const rightSeq = Math.max(0, Math.trunc(Number(right.authorSeq || 0)));
  if (leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }

  return String(left.opId || "").localeCompare(String(right.opId || ""));
}

function dedupeCrdtOps(ops: CrdtOpEnvelope[]) {
  const byId = new Map<string, CrdtOpEnvelope>();
  for (const op of Array.isArray(ops) ? ops : []) {
    const opId = normalizeCrdtId(op?.opId);
    if (!opId || byId.has(opId)) {
      continue;
    }
    byId.set(opId, {
      ...op,
      opId,
      conversationId: normalizeCrdtId(op.conversationId),
      authorDeviceId: normalizeCrdtId(op.authorDeviceId),
      authorEntityType: normalizeCrdtId(op.authorEntityType),
      authorSeq: Math.max(0, Math.trunc(Number(op.authorSeq || 0))),
      hlc: String(op.hlc || ""),
      parents: normalizeCrdtParents(op.parents),
      signedAt: Math.max(0, Math.trunc(Number(op.signedAt || 0))),
      signature: normalizeCrdtId(op.signature)
    });
  }
  return Array.from(byId.values());
}

function buildObservedVersionVector(ops: CrdtOpEnvelope[]) {
  const observed: CrdtVersionVector = {};
  for (const op of ops) {
    const authorDeviceId = normalizeCrdtId(op.authorDeviceId);
    const authorSeq = Math.max(0, Math.trunc(Number(op.authorSeq || 0)));
    if (!authorDeviceId || authorSeq <= 0) {
      continue;
    }
    observed[authorDeviceId] = Math.max(observed[authorDeviceId] || 0, authorSeq);
  }
  return observed;
}

function buildContiguousVersionVector(ops: CrdtOpEnvelope[]) {
  const seqsByAuthor = new Map<string, Set<number>>();
  for (const op of ops) {
    const authorDeviceId = normalizeCrdtId(op.authorDeviceId);
    const authorSeq = Math.max(0, Math.trunc(Number(op.authorSeq || 0)));
    if (!authorDeviceId || authorSeq <= 0) {
      continue;
    }
    const seqs = seqsByAuthor.get(authorDeviceId) || new Set<number>();
    seqs.add(authorSeq);
    seqsByAuthor.set(authorDeviceId, seqs);
  }

  const vector: CrdtVersionVector = {};
  for (const [authorDeviceId, seqs] of seqsByAuthor.entries()) {
    const ordered = Array.from(seqs).sort((left, right) => left - right);
    let expected = 1;
    for (const seq of ordered) {
      if (seq !== expected) {
        break;
      }
      expected += 1;
    }
    vector[authorDeviceId] = expected - 1;
  }
  return vector;
}

export function analyzeCrdtOps(ops: CrdtOpEnvelope[]): CrdtGraphAnalysis {
  const dedupedOps = dedupeCrdtOps(ops);
  const knownOpIds = new Set(dedupedOps.map((op) => op.opId));
  const childrenByOpId = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  const missingParentOpIds = new Set<string>();

  for (const op of dedupedOps) {
    const knownParents = normalizeCrdtParents(op.parents).filter((parentOpId) => {
      if (!knownOpIds.has(parentOpId)) {
        missingParentOpIds.add(parentOpId);
        return false;
      }
      return true;
    });

    inDegree.set(op.opId, knownParents.length);
    for (const parentOpId of knownParents) {
      const children = childrenByOpId.get(parentOpId) || new Set<string>();
      children.add(op.opId);
      childrenByOpId.set(parentOpId, children);
    }
  }

  const ready = dedupedOps
    .filter((op) => (inDegree.get(op.opId) || 0) === 0)
    .sort(compareCrdtOpOrder);
  const orderedOps: CrdtOpEnvelope[] = [];

  while (ready.length > 0) {
    const current = ready.shift()!;
    orderedOps.push(current);
    const children = Array.from(childrenByOpId.get(current.opId) || []);
    for (const childOpId of children) {
      const nextDegree = Math.max(0, (inDegree.get(childOpId) || 0) - 1);
      inDegree.set(childOpId, nextDegree);
      if (nextDegree === 0) {
        const child = dedupedOps.find((op) => op.opId === childOpId);
        if (child) {
          ready.push(child);
        }
      }
    }
    ready.sort(compareCrdtOpOrder);
  }

  const seen = new Set(orderedOps.map((op) => op.opId));
  const remaining = dedupedOps.filter((op) => !seen.has(op.opId)).sort(compareCrdtOpOrder);
  if (remaining.length > 0) {
    orderedOps.push(...remaining);
  }

  const referenced = new Set<string>();
  for (const op of dedupedOps) {
    for (const parentOpId of normalizeCrdtParents(op.parents)) {
      if (knownOpIds.has(parentOpId)) {
        referenced.add(parentOpId);
      }
    }
  }

  const serializedChildren = Object.fromEntries(
    Array.from(childrenByOpId.entries())
      .map(([opId, children]) => [opId, Array.from(children).sort()] as const)
      .sort(([left], [right]) => left.localeCompare(right))
  );

  return {
    ops: dedupedOps,
    orderedOps,
    leafOpIds: orderedOps.map((op) => op.opId).filter((opId) => !referenced.has(opId)),
    missingParentOpIds: Array.from(missingParentOpIds).sort(),
    versionVector: buildContiguousVersionVector(dedupedOps),
    observedVersionVector: buildObservedVersionVector(dedupedOps),
    childrenByOpId: serializedChildren
  };
}

export function summarizeCrdtConversation(
  conversationId: string,
  ops: CrdtOpEnvelope[]
): CrdtConversationSummary {
  const analysis = analyzeCrdtOps(
    dedupeCrdtOps(ops).filter(
      (op) => normalizeCrdtId(op.conversationId) === normalizeCrdtId(conversationId)
    )
  );

  return createCrdtConversationSummary({
    conversationId,
    versionVector: analysis.versionVector,
    frontier: analysis.leafOpIds
  });
}

export function selectCrdtOpsForSync(
  ops: CrdtOpEnvelope[],
  wantFrom: CrdtVersionVector,
  limit?: number
) {
  const analysis = analyzeCrdtOps(ops);
  const normalizedWantFrom = normalizeCrdtVersionVector(wantFrom);
  const filtered = analysis.orderedOps.filter((op) => {
    const authorDeviceId = normalizeCrdtId(op.authorDeviceId);
    const authorSeq = Math.max(0, Math.trunc(Number(op.authorSeq || 0)));
    return authorSeq > (normalizedWantFrom[authorDeviceId] || 0);
  });
  if (limit == null) {
    return filtered;
  }
  return filtered.slice(0, Math.max(1, Math.trunc(Number(limit))));
}

export function materializeCrdtMessages(ops: CrdtOpEnvelope[]) {
  const analysis = analyzeCrdtOps(ops);
  const messages = new Map<string, CrdtMaterializedMessage>();

  for (const op of analysis.orderedOps) {
    if (op.kind !== CRDT_OP_KINDS.MESSAGE_CREATE) {
      continue;
    }

    const payload = op.payload as {
      messageId?: unknown;
      body?: { text?: unknown; parts?: unknown };
      clientNonce?: unknown;
    };
    const messageId = normalizeCrdtId(payload.messageId);
    if (!messageId || messages.has(messageId)) {
      continue;
    }

    messages.set(messageId, {
      messageId,
      opId: op.opId,
      conversationId: op.conversationId,
      authorDeviceId: op.authorDeviceId,
      authorEntityType: op.authorEntityType,
      authorSeq: Math.max(0, Math.trunc(Number(op.authorSeq || 0))),
      hlc: String(op.hlc || ""),
      text: typeof payload.body?.text === "string" ? payload.body.text : "",
      parts: Array.isArray(payload.body?.parts)
        ? payload.body.parts.filter((part) => part && typeof part === "object") as Array<
            Record<string, unknown>
          >
        : [],
      clientNonce: normalizeCrdtId(payload.clientNonce) || undefined,
      parents: normalizeCrdtParents(op.parents),
      signedAt: Math.max(0, Math.trunc(Number(op.signedAt || 0)))
    });
  }

  return Array.from(messages.values()).sort((left, right) => {
    const leftOp = analysis.orderedOps.find((op) => op.opId === left.opId);
    const rightOp = analysis.orderedOps.find((op) => op.opId === right.opId);
    if (leftOp && rightOp) {
      return compareCrdtOpOrder(leftOp, rightOp);
    }
    return left.messageId.localeCompare(right.messageId);
  });
}
