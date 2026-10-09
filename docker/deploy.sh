#!/bin/sh
# Update the VPS to origin/main and rebuild the stack (migrations run via the migrate service).
# Run by hand as the wise user, or by GitHub Actions through a forced-command SSH key:
#   command="/opt/wise/app/docker/deploy.sh",restrict ssh-ed25519 AAAA... github-deploy
# Wrapped in main() so the whole script is read before git replaces this file.
set -eu

main() {
	cd /opt/wise/app
	exec 9>/tmp/wise-deploy.lock
	flock 9

	git fetch --quiet origin main
	git merge --ff-only origin/main
	echo "deploying $(git log --oneline -1)"

	docker compose -f docker/compose.yml --env-file /opt/wise/.env up -d --build --remove-orphans
	docker image prune -f >/dev/null
	docker compose -f docker/compose.yml --env-file /opt/wise/.env ps --format '{{.Service}}: {{.Status}}'
	exit 0
}

main "$@"
