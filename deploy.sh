#!/bin/bash
# Production deploy (server: /root/bookOn, Docker container bookon-api on :3005)
# Rollback: docker tag bookon-bookon-api:rollback bookon-bookon-api:latest && docker compose up -d bookon-api
set -e
cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree has local changes, aborting (commit or stash them first)."
  git status --short
  exit 1
fi

git fetch origin
git checkout -B master origin/master
echo "Deploying $(git log --oneline -1)"

# Keep the current image so we can roll back quickly
docker tag bookon-bookon-api:latest bookon-bookon-api:rollback 2>/dev/null || true

docker compose build bookon-api
docker compose up -d bookon-api

for i in $(seq 1 30); do
  if docker logs bookon-api 2>&1 | tail -20 | grep -q "Server running"; then break; fi
  sleep 2
done
docker logs --tail 10 bookon-api

if command -v node >/dev/null; then
  node scripts/smoke-test.js http://127.0.0.1:3005
fi
