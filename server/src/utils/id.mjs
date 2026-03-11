import { randomBytes, randomUUID } from "node:crypto";

export function makeId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function makePairToken() {
  return `pt_${randomBytes(18).toString("base64url")}`;
}

export function makePairCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}
