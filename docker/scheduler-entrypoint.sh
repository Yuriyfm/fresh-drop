#!/bin/sh
set -eu

SYNC_CRON_SCHEDULE="${SYNC_CRON_SCHEDULE:-0 3 * * *}"
CRAWLER_CRON_SCHEDULE="${CRAWLER_CRON_SCHEDULE:-*/30 * * * *}"
CLEANUP_CRON_SCHEDULE="${CLEANUP_CRON_SCHEDULE:-30 3 * * *}"

if [ -z "${SPOTIFY_CLIENT_ID:-}" ] || [ -z "${SPOTIFY_CLIENT_SECRET:-}" ]; then
  echo "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required for the scheduler." >&2
  exit 1
fi

cat > /tmp/fresh-drop-crontab <<EOF
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${SYNC_CRON_SCHEDULE} cd /app && TMPDIR=/tmp yarn sync:scheduled >> /proc/1/fd/1 2>> /proc/1/fd/2
${CRAWLER_CRON_SCHEDULE} cd /app && TMPDIR=/tmp yarn crawl:scheduled >> /proc/1/fd/1 2>> /proc/1/fd/2
${CLEANUP_CRON_SCHEDULE} cd /app && TMPDIR=/tmp yarn cleanup:releases >> /proc/1/fd/1 2>> /proc/1/fd/2
EOF

crontab /tmp/fresh-drop-crontab

echo "Fresh Drop scheduler installed: sync=${SYNC_CRON_SCHEDULE} crawler=${CRAWLER_CRON_SCHEDULE} cleanup=${CLEANUP_CRON_SCHEDULE}"
exec crond -f -l 8
