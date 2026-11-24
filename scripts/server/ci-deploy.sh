#!/bin/bash
# The only thing the GitHub Actions deploy key may run on the server.
# authorized_keys entry (one line):
#   command="bash /root/bookOn/scripts/server/ci-deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... github-actions-deploy
# The workflow sends "backend" or "frontend" as the SSH command; anything else is refused.
set -euo pipefail

exec 9>/tmp/bookon-deploy.lock
flock -w 600 9 || { echo "another deploy is still running"; exit 1; }

case "${SSH_ORIGINAL_COMMAND:-}" in
  backend)  exec bash /root/bookOn/deploy.sh ;;
  frontend) exec bash /root/bookon-react1/deploy.sh ;;
  *)        echo "refused: '${SSH_ORIGINAL_COMMAND:-}' (allowed: backend, frontend)"; exit 2 ;;
esac
