#!/bin/bash
# Production deploy (server: /root/bookOn, Docker container bookon-api on 127.0.0.1:3005)
# Builds origin/master, starts it, waits for /health and rolls back by itself
# when the new version doesn't come up healthy.
# Manual rollback: docker tag bookon-bookon-api:rollback bookon-bookon-api:latest && docker compose up -d bookon-api
set -e
cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree has local changes, aborting (commit or stash them first)."
  git status --short
  exit 1
fi

git fetch origin
git checkout -B master origin/master
export APP_VERSION="$(git rev-parse --short HEAD)"
echo "Deploying $(git log --oneline -1)"

# Keep the current image so we can roll back quickly
docker tag bookon-bookon-api:latest bookon-bookon-api:rollback 2>/dev/null || true

docker compose build bookon-api
docker compose up -d bookon-api

healthy() {
  curl -fsS --max-time 5 http://127.0.0.1:3005/health 2>/dev/null | grep -q '"status":"ok"'
}

for i in $(seq 1 30); do
  if healthy; then break; fi
  sleep 2
done

if ! healthy; then
  echo "New version is NOT healthy after 60 s — rolling back."
  docker logs --tail 30 bookon-api || true
  if docker image inspect bookon-bookon-api:rollback >/dev/null 2>&1; then
    docker tag bookon-bookon-api:rollback bookon-bookon-api:latest
    APP_VERSION="rollback" docker compose up -d --no-build bookon-api
  fi
  exit 1
fi

echo "Healthy: $(curl -fsS http://127.0.0.1:3005/health)"
docker logs --tail 6 bookon-api

if command -v node >/dev/null; then
  node scripts/smoke-test.js http://127.0.0.1:3005
fi
