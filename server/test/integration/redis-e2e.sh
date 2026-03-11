#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

TMP_DIR="$(mktemp -d)"
REDIS_CONTAINER="openclaw-redis-itest-$(date +%s)-$$"
REDIS_URL=""
REDIS_PREFIX="openclaw:itest:$(date +%s):$$"
CURL_OPTS=(--fail --silent --show-error --max-time 10)

SERVER1_PID=""
SERVER2_PID=""
SSE_PID=""
STARTED_PID=""

cleanup() {
  if [[ -n "${SSE_PID}" ]]; then
    kill "${SSE_PID}" >/dev/null 2>&1 || true
    wait "${SSE_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${SERVER2_PID}" ]]; then
    kill "${SERVER2_PID}" >/dev/null 2>&1 || true
    wait "${SERVER2_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${SERVER1_PID}" ]]; then
    kill "${SERVER1_PID}" >/dev/null 2>&1 || true
    wait "${SERVER1_PID}" >/dev/null 2>&1 || true
  fi
  docker rm -f "${REDIS_CONTAINER}" >/dev/null 2>&1 || true
  if [[ "${KEEP_ITEST_TMP:-0}" == "1" ]]; then
    echo "[itest] keep tmp dir: ${TMP_DIR}"
  else
    rm -rf "${TMP_DIR}"
  fi
}
trap cleanup EXIT

pick_port() {
  node -e "const net=require('net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close();});"
}

start_server() {
  local name="$1"
  local port="$2"
  local log_file="${TMP_DIR}/${name}.log"

  (
    cd "${SERVER_DIR}"
    HOST=127.0.0.1 \
    PORT="${port}" \
    STORE_BACKEND=redis \
    REDIS_URL="${REDIS_URL}" \
    REDIS_KEY_PREFIX="${REDIS_PREFIX}" \
    go run . >"${log_file}" 2>&1
  ) &

  STARTED_PID="$!"
}

wait_for_health() {
  local port="$1"
  local out_file="$2"

  for _ in $(seq 1 80); do
    if curl "${CURL_OPTS[@]}" "http://127.0.0.1:${port}/healthz" >"${out_file}" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done

  echo "health check failed on port ${port}" >&2
  for file in "${TMP_DIR}"/*.log; do
    if [[ -f "${file}" ]]; then
      echo "--- ${file} ---" >&2
      sed -n '1,120p' "${file}" >&2 || true
    fi
  done
  return 1
}

assert_health_redis() {
  local file="$1"
  node -e '
const fs = require("fs");
const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!(obj && obj.ok && obj.persistence && obj.persistence.backend === "redis" && obj.persistence.connected === true)) {
  console.error("expected redis backend health payload", obj);
  process.exit(1);
}
' "${file}"
}

assert_contains_event_type() {
  local file="$1"
  local event_type="$2"
  node -e '
const fs = require("fs");
const file = process.argv[1];
const type = process.argv[2];
const obj = JSON.parse(fs.readFileSync(file, "utf8"));
if (!(obj && obj.ok && Array.isArray(obj.events) && obj.events.some((e) => e && e.type === type))) {
  console.error("expected event type", type, "in", obj);
  process.exit(1);
}
' "${file}" "${event_type}"
}

assert_empty_events() {
  local file="$1"
  node -e '
const fs = require("fs");
const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!(obj && obj.ok && Array.isArray(obj.events) && obj.events.length === 0)) {
  console.error("expected empty events", obj);
  process.exit(1);
}
' "${file}"
}

echo "[itest] checking docker daemon"
docker info >/dev/null 2>/dev/null

echo "[itest] starting redis container: ${REDIS_CONTAINER}"
docker run -d --name "${REDIS_CONTAINER}" -p 127.0.0.1::6379 redis:7-alpine >/dev/null

REDIS_PORT="$(docker port "${REDIS_CONTAINER}" 6379/tcp | head -n1 | sed -E 's/.*:([0-9]+)$/\1/')"
if [[ -z "${REDIS_PORT}" ]]; then
  echo "failed to resolve mapped redis port" >&2
  exit 1
fi
REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
echo "[itest] redis url: ${REDIS_URL}"

for _ in $(seq 1 40); do
  if docker exec "${REDIS_CONTAINER}" redis-cli ping | rg -q '^PONG$'; then
    break
  fi
  sleep 0.25
done

docker exec "${REDIS_CONTAINER}" redis-cli ping | rg -q '^PONG$'

PORT1="$(pick_port)"
PORT2="$(pick_port)"
if [[ "${PORT1}" == "${PORT2}" ]]; then
  PORT2="$(pick_port)"
fi

echo "[itest] test-1 restart recovery on port ${PORT1}"
start_server server1 "${PORT1}"
SERVER1_PID="${STARTED_PID}"
wait_for_health "${PORT1}" "${TMP_DIR}/health1.json"
assert_health_redis "${TMP_DIR}/health1.json"

curl "${CURL_OPTS[@]}" -X POST "http://127.0.0.1:${PORT1}/v1/devices/register" \
  -H 'content-type: application/json' \
  -d '{"deviceId":"pc-itest-1","platform":"linux","appVersion":"0.1.0"}' >"${TMP_DIR}/register1.json"

curl "${CURL_OPTS[@]}" -X POST "http://127.0.0.1:${PORT1}/v1/pair/sessions" \
  -H 'content-type: application/json' \
  -d '{"deviceId":"pc-itest-1","ttlSeconds":180}' >"${TMP_DIR}/session1.json"

PAIR_TOKEN="$(node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(j.session.pairToken);' "${TMP_DIR}/session1.json")"

curl "${CURL_OPTS[@]}" -X POST "http://127.0.0.1:${PORT1}/v1/pair/claim" \
  -H 'content-type: application/json' \
  -d "{\"pairToken\":\"${PAIR_TOKEN}\",\"userId\":\"user-itest-1\",\"mobileId\":\"mobile-itest-1\"}" >"${TMP_DIR}/claim1.json"

curl "${CURL_OPTS[@]}" -X POST "http://127.0.0.1:${PORT1}/v1/signal/send" \
  -H 'content-type: application/json' \
  -d '{"fromType":"mobile","fromId":"mobile-itest-1","toType":"desktop","toId":"pc-itest-1","type":"task.recovery","payload":{"prompt":"persist-across-restart"}}' >"${TMP_DIR}/send1.json"

kill "${SERVER1_PID}" >/dev/null 2>&1 || true
wait "${SERVER1_PID}" >/dev/null 2>&1 || true
SERVER1_PID=""

start_server server1-restart "${PORT1}"
SERVER1_PID="${STARTED_PID}"
wait_for_health "${PORT1}" "${TMP_DIR}/health1-restart.json"
assert_health_redis "${TMP_DIR}/health1-restart.json"

curl "${CURL_OPTS[@]}" "http://127.0.0.1:${PORT1}/v1/signal/inbox?clientType=desktop&clientId=pc-itest-1" >"${TMP_DIR}/inbox1.json"
assert_contains_event_type "${TMP_DIR}/inbox1.json" "task.recovery"

curl "${CURL_OPTS[@]}" "http://127.0.0.1:${PORT1}/v1/signal/inbox?clientType=desktop&clientId=pc-itest-1" >"${TMP_DIR}/inbox1-empty.json"
assert_empty_events "${TMP_DIR}/inbox1-empty.json"

echo "[itest] test-2 cross-instance pub/sub on ports ${PORT1}, ${PORT2}"
start_server server2 "${PORT2}"
SERVER2_PID="${STARTED_PID}"
wait_for_health "${PORT2}" "${TMP_DIR}/health2.json"
assert_health_redis "${TMP_DIR}/health2.json"

curl -N -sS "http://127.0.0.1:${PORT2}/v1/signal/stream?clientType=mobile&clientId=mobile-pubsub" >"${TMP_DIR}/sse-mobile.log" &
SSE_PID="$!"
sleep 1

curl "${CURL_OPTS[@]}" -X POST "http://127.0.0.1:${PORT1}/v1/signal/send" \
  -H 'content-type: application/json' \
  -d '{"fromType":"desktop","fromId":"pc-itest-1","toType":"mobile","toId":"mobile-pubsub","type":"task.cross","payload":{"prompt":"cross-instance-pubsub"}}' >"${TMP_DIR}/send-cross.json"

FOUND=0
for _ in $(seq 1 60); do
  if rg -q '"type":"task.cross"' "${TMP_DIR}/sse-mobile.log"; then
    FOUND=1
    break
  fi
  sleep 0.25
done

if [[ "${FOUND}" != "1" ]]; then
  echo "did not receive cross-instance pub/sub SSE event" >&2
  echo "--- server1 log ---" >&2
  sed -n '1,120p' "${TMP_DIR}/server1-restart.log" >&2 || true
  echo "--- server2 log ---" >&2
  sed -n '1,120p' "${TMP_DIR}/server2.log" >&2 || true
  echo "--- sse log ---" >&2
  sed -n '1,120p' "${TMP_DIR}/sse-mobile.log" >&2 || true
  exit 1
fi

kill "${SSE_PID}" >/dev/null 2>&1 || true
wait "${SSE_PID}" >/dev/null 2>&1 || true
SSE_PID=""

curl "${CURL_OPTS[@]}" "http://127.0.0.1:${PORT2}/v1/signal/inbox?clientType=mobile&clientId=mobile-pubsub" >"${TMP_DIR}/inbox-cross.json"
assert_contains_event_type "${TMP_DIR}/inbox-cross.json" "task.cross"

curl "${CURL_OPTS[@]}" "http://127.0.0.1:${PORT2}/v1/signal/inbox?clientType=mobile&clientId=mobile-pubsub" >"${TMP_DIR}/inbox-cross-empty.json"
assert_empty_events "${TMP_DIR}/inbox-cross-empty.json"

echo "[itest] redis integration passed"
if [[ "${KEEP_ITEST_TMP:-0}" == "1" ]]; then
  echo "[itest] logs dir: ${TMP_DIR}"
fi
