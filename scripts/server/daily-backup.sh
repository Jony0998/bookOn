#!/bin/bash
# Daily backup of the production database and uploaded images (run by cron on the server):
#   15 3 * * * bash /root/bookOn/scripts/server/daily-backup.sh >> /var/log/bookon-backup.log 2>&1
# Result: /root/backups/db/bookon-<UTC time>.tar.gz with db/<collection>.json (Extended JSON,
# restorable with scripts/restore-db.js) and uploads/. Archives older than KEEP_DAYS are removed.
set -euo pipefail

DEST=/root/backups/db
KEEP_DAYS=14
CONTAINER=bookon-api
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$DEST/.tmp-$stamp"

echo "[$(date -u +%FT%TZ)] backup start"
mkdir -p "$work"
trap 'rm -rf "$work"; docker exec "$CONTAINER" rm -rf /tmp/dbdump >/dev/null 2>&1 || true' EXIT

# 1) database, read-only dump through the app's own connection
docker exec "$CONTAINER" sh -c "rm -rf /tmp/dbdump && node scripts/backup-db.js /tmp/dbdump" | sed 's/^/  /'
docker cp "$CONTAINER:/tmp/dbdump" "$work/db" >/dev/null

# 2) uploaded images (book covers, avatars, article covers)
docker cp "$CONTAINER:/app/uploads" "$work/uploads" >/dev/null

# 3) sanity checks: the dump is not empty and the shop still has its library account
for c in members products orders; do
  [ -s "$work/db/$c.json" ] || { echo "  ERROR: $c.json missing or empty"; exit 1; }
done
if ! grep -q '"memberType": "LIBRARY"' "$work/db/members.json"; then
  echo "  WARNING: no LIBRARY account in the database!"
fi

tar -czf "$DEST/bookon-$stamp.tar.gz" -C "$work" .
echo "  saved $DEST/bookon-$stamp.tar.gz ($(du -h "$DEST/bookon-$stamp.tar.gz" | cut -f1))"

find "$DEST" -maxdepth 1 -name 'bookon-*.tar.gz' -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/  removed old /'
echo "[$(date -u +%FT%TZ)] backup done, $(ls "$DEST"/bookon-*.tar.gz | wc -l) archives kept"
