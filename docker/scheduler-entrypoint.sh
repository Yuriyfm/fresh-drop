#!/bin/sh
set -eu

CRAWLER_CRON_SCHEDULE="${CRAWLER_CRON_SCHEDULE:-*/10 * * * *}"
CLEANUP_CRON_SCHEDULE="${CLEANUP_CRON_SCHEDULE:-30 3 * * *}"
ENRICH_MUSICBRAINZ_CRON_SCHEDULE="${ENRICH_MUSICBRAINZ_CRON_SCHEDULE:-*/5 * * * *}"
ENRICH_MUSICBRAINZ_LIMIT="${ENRICH_MUSICBRAINZ_LIMIT:-20}"
MUSICBRAINZ_ENABLED="${MUSICBRAINZ_ENABLED:-false}"

if [ -z "${SPOTIFY_CLIENT_ID:-}" ] || [ -z "${SPOTIFY_CLIENT_SECRET:-}" ]; then
  echo "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required for the scheduler." >&2
  exit 1
fi

if [ "${MUSICBRAINZ_ENABLED}" = "true" ] && [ -z "${MUSICBRAINZ_USER_AGENT:-}" ]; then
  echo "MUSICBRAINZ_USER_AGENT is required when MUSICBRAINZ_ENABLED=true." >&2
  exit 1
fi

cat > /tmp/fresh-drop-crontab <<EOF
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${CRAWLER_CRON_SCHEDULE} cd /app && TMPDIR=/tmp /bin/sh /app/docker/run-cron-command.sh crawler yarn crawl:scheduled >> /proc/1/fd/1 2>> /proc/1/fd/2
${CLEANUP_CRON_SCHEDULE} cd /app && TMPDIR=/tmp /bin/sh /app/docker/run-cron-command.sh cleanup yarn cleanup:releases >> /proc/1/fd/1 2>> /proc/1/fd/2
EOF

if [ "${MUSICBRAINZ_ENABLED}" = "true" ]; then
  cat >> /tmp/fresh-drop-crontab <<EOF
${ENRICH_MUSICBRAINZ_CRON_SCHEDULE} cd /app && TMPDIR=/tmp /bin/sh /app/docker/run-cron-command.sh musicbrainz-enrichment yarn enrich:musicbrainz:artists --skip-if-locked --limit=${ENRICH_MUSICBRAINZ_LIMIT} >> /proc/1/fd/1 2>> /proc/1/fd/2
EOF
fi

crontab /tmp/fresh-drop-crontab

echo "Fresh Drop scheduler installed: crawler=${CRAWLER_CRON_SCHEDULE} cleanup=${CLEANUP_CRON_SCHEDULE} musicbrainz_enabled=${MUSICBRAINZ_ENABLED} musicbrainz_enrich=${ENRICH_MUSICBRAINZ_CRON_SCHEDULE} musicbrainz_limit=${ENRICH_MUSICBRAINZ_LIMIT}"
exec crond -f -l 8
