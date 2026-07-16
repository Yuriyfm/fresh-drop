#!/bin/sh
set -eu

if [ "$#" -lt 2 ]; then
  echo "Usage: run-cron-command.sh <lock-name> <command> [args...]" >&2
  exit 2
fi

LOCK_NAME="$1"
shift

LOCK_ROOT="${FRESH_DROP_CRON_LOCK_ROOT:-/tmp/fresh-drop-cron-locks}"

case "$LOCK_NAME" in
  ''|*[!A-Za-z0-9_.-]*)
    echo "Invalid cron lock name: ${LOCK_NAME}" >&2
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
"$@"
STATUS="$?"
set -e
echo "Fresh Drop cron finished: name=${LOCK_NAME} status=${STATUS}"
exit "$STATUS"
