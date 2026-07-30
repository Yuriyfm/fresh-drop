#!/bin/sh
set -eu

CRAWLER_CRON_SCHEDULE="${CRAWLER_CRON_SCHEDULE:-*/10 * * * *}"
CLEANUP_CRON_SCHEDULE="${CLEANUP_CRON_SCHEDULE:-30 3 * * *}"
ENRICH_MUSICBRAINZ_CRON_SCHEDULE="${ENRICH_MUSICBRAINZ_CRON_SCHEDULE:-2-52/10 * * * *}"
ENRICH_MUSICBRAINZ_LIMIT="${ENRICH_MUSICBRAINZ_LIMIT:-100}"
CRAWLER_CRON_TIMEOUT_SECONDS="${CRAWLER_CRON_TIMEOUT_SECONDS:-540}"
CLEANUP_CRON_TIMEOUT_SECONDS="${CLEANUP_CRON_TIMEOUT_SECONDS:-900}"
ENRICH_MUSICBRAINZ_CRON_TIMEOUT_SECONDS="${ENRICH_MUSICBRAINZ_CRON_TIMEOUT_SECONDS:-240}"
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
${CRAWLER_CRON_SCHEDULE} cd /app && TMPDIR=/tmp FRESH_DROP_CRON_TIMEOUT_SECONDS=${CRAWLER_CRON_TIMEOUT_SECONDS} /bin/sh /app/docker/run-cron-command.sh crawler node /app/dist-scheduler/crawlReleases.js >> /proc/1/fd/1 2>> /proc/1/fd/2
${CLEANUP_CRON_SCHEDULE} cd /app && TMPDIR=/tmp FRESH_DROP_CRON_TIMEOUT_SECONDS=${CLEANUP_CRON_TIMEOUT_SECONDS} /bin/sh /app/docker/run-cron-command.sh cleanup node /app/dist-scheduler/cleanupReleases.js >> /proc/1/fd/1 2>> /proc/1/fd/2
EOF

if [ "${MUSICBRAINZ_ENABLED}" = "true" ]; then
  cat >> /tmp/fresh-drop-crontab <<EOF
${ENRICH_MUSICBRAINZ_CRON_SCHEDULE} cd /app && TMPDIR=/tmp FRESH_DROP_CRON_TIMEOUT_SECONDS=${ENRICH_MUSICBRAINZ_CRON_TIMEOUT_SECONDS} FRESH_DROP_CRON_BLOCKED_BY=crawler /bin/sh /app/docker/run-cron-command.sh musicbrainz-enrichment node /app/dist-scheduler/enrichMusicBrainzArtists.js --skip-if-locked --limit=${ENRICH_MUSICBRAINZ_LIMIT} >> /proc/1/fd/1 2>> /proc/1/fd/2
EOF
fi

crontab /tmp/fresh-drop-crontab

echo "Fresh Drop scheduler installed: crawler=${CRAWLER_CRON_SCHEDULE} crawler_timeout=${CRAWLER_CRON_TIMEOUT_SECONDS}s cleanup=${CLEANUP_CRON_SCHEDULE} cleanup_timeout=${CLEANUP_CRON_TIMEOUT_SECONDS}s musicbrainz_enabled=${MUSICBRAINZ_ENABLED} musicbrainz_enrich=${ENRICH_MUSICBRAINZ_CRON_SCHEDULE} musicbrainz_limit=${ENRICH_MUSICBRAINZ_LIMIT} musicbrainz_timeout=${ENRICH_MUSICBRAINZ_CRON_TIMEOUT_SECONDS}s"
exec crond -f -l 8
