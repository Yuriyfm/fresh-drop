#!/bin/sh
set -eu

if [ "$#" -lt 2 ]; then
  echo "Usage: run-cron-command.sh <lock-name> <command> [args...]" >&2
  exit 2
fi

LOCK_NAME="$1"
shift

LOCK_ROOT="${FRESH_DROP_CRON_LOCK_ROOT:-/tmp/fresh-drop-cron-locks}"
TIMEOUT_SECONDS="${FRESH_DROP_CRON_TIMEOUT_SECONDS:-0}"
TIMEOUT_KILL_SECONDS="${FRESH_DROP_CRON_TIMEOUT_KILL_SECONDS:-30}"
BLOCKED_BY="${FRESH_DROP_CRON_BLOCKED_BY:-}"

case "$LOCK_NAME" in
  ''|*[!A-Za-z0-9_.-]*)
    echo "Invalid cron lock name: ${LOCK_NAME}" >&2
    exit 2
    ;;
esac

case "$TIMEOUT_SECONDS" in
  ''|*[!0-9]*)
    echo "Invalid cron timeout seconds: ${TIMEOUT_SECONDS}" >&2
    exit 2
    ;;
esac

case "$TIMEOUT_KILL_SECONDS" in
  ''|*[!0-9]*)
    echo "Invalid cron timeout kill seconds: ${TIMEOUT_KILL_SECONDS}" >&2
    exit 2
    ;;
esac

if [ -z "$LOCK_ROOT" ] || [ "$LOCK_ROOT" = "/" ]; then
  echo "Invalid cron lock root: ${LOCK_ROOT}" >&2
  exit 2
fi

LOCK_DIR="${LOCK_ROOT}/${LOCK_NAME}.lock"
PID_FILE="${LOCK_DIR}/pid"

mkdir -p "$LOCK_ROOT"

for BLOCKING_LOCK_NAME in $BLOCKED_BY; do
  BLOCKING_LOCK_DIR="${LOCK_ROOT}/${BLOCKING_LOCK_NAME}.lock"
  BLOCKING_PID_FILE="${BLOCKING_LOCK_DIR}/pid"
  BLOCKING_PID=""

  if [ -f "$BLOCKING_PID_FILE" ]; then
    BLOCKING_PID="$(cat "$BLOCKING_PID_FILE" 2>/dev/null || true)"
  fi

  if [ -n "$BLOCKING_PID" ] && kill -0 "$BLOCKING_PID" 2>/dev/null; then
    echo "Fresh Drop cron skipped: name=${LOCK_NAME} reason=blocked_by_${BLOCKING_LOCK_NAME} pid=${BLOCKING_PID}"
    exit 0
  fi
done

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_PID=""

  if [ -f "$PID_FILE" ]; then
    LOCK_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  fi

  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "Fresh Drop cron skipped: name=${LOCK_NAME} reason=already_running pid=${LOCK_PID}"
    exit 0
  fi

  echo "Fresh Drop cron stale lock removed: name=${LOCK_NAME} pid=${LOCK_PID:-unknown}"
  rm -rf "$LOCK_DIR"

  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "Fresh Drop cron skipped: name=${LOCK_NAME} reason=lock_busy"
    exit 0
  fi
fi

cleanup_lock() {
  rm -rf "$LOCK_DIR"
}

trap cleanup_lock EXIT INT TERM

printf '%s\n' "$$" > "$PID_FILE"

echo "Fresh Drop cron started: name=${LOCK_NAME} command=$*"
set +e
if [ "$TIMEOUT_SECONDS" -gt 0 ]; then
  timeout -s TERM -k "${TIMEOUT_KILL_SECONDS}" "${TIMEOUT_SECONDS}" "$@"
else
  "$@"
fi
STATUS="$?"
set -e
if [ "$STATUS" -eq 124 ] || [ "$STATUS" -eq 137 ] || [ "$STATUS" -eq 143 ]; then
  echo "Fresh Drop cron timed out: name=${LOCK_NAME} status=${STATUS} timeoutSeconds=${TIMEOUT_SECONDS}"
fi
echo "Fresh Drop cron finished: name=${LOCK_NAME} status=${STATUS}"
exit "$STATUS"
