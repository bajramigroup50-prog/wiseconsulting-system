#!/bin/sh
# Update the VPS to origin/main and restart the stack (migrations run via the migrate service).
# Run by GitHub Actions through a forced-command SSH key:
#   command="/opt/wise/app/docker/deploy.sh",restrict ssh-ed25519 AAAA... github-deploy
# with three lines on stdin – registry token, user, commit: the images built on GitHub (ghcr.io) are PULLED, nothing is
# built here (a build on the VPS took the CPU from the running program). Run by hand without stdin (`< /dev/null`) it
# builds on the VPS as before (fallback when GitHub cannot build).
# Wrapped in main() so the whole script is read before git replaces this file.
set -eu

REG=ghcr.io/bajramigroup50-prog
COMPOSE="docker compose -f docker/compose.yml --env-file /opt/wise/.env"

main() {
	cd /opt/wise/app
	exec 9>/tmp/wise-deploy.lock
	flock 9

	git fetch --quiet origin main
	git merge --ff-only origin/main
	echo "deploying $(git log --oneline -1)"

	TOKEN='' USER_='' SHA=''
	if [ ! -t 0 ]; then
		read -r TOKEN || true
		read -r USER_ || true
		read -r SHA || true
	fi
	if [ -n "$TOKEN" ] && [ -n "$SHA" ]; then
		printf '%s\n' "$TOKEN" | docker login ghcr.io -u "$USER_" --password-stdin >/dev/null
		ok=1
		for s in web worker; do
			# a short network drop to the registry (connection reset) must not stop the deploy: 3 tries
			got=0
			for try in 1 2 3; do
				if docker pull -q "$REG/wise-$s:$SHA" >/dev/null; then got=1; break; fi
				echo "pull wise-$s failed (try $try)"; sleep 15
			done
			[ "$got" = 1 ] && docker tag "$REG/wise-$s:$SHA" "wise-$s:latest" || ok=0
		done
		docker logout ghcr.io >/dev/null 2>&1 || true
		[ "$ok" = 1 ] || { echo "pull failed – nothing changed"; exit 1; }
		echo "images of $SHA pulled"
		GIT_SHA=$SHA $COMPOSE up -d --no-build --remove-orphans
		# older pulled images (other commits) – the disk would fill up
		docker images --format '{{.Repository}}:{{.Tag}}' | grep "^$REG/" | grep -v ":$SHA\$" | xargs -r docker rmi >/dev/null 2>&1 || true
	else
		GIT_SHA=$(git rev-parse HEAD) $COMPOSE up -d --build --remove-orphans
	fi
	docker image prune -f >/dev/null
	$COMPOSE ps --format '{{.Service}}: {{.Status}}'
	exit 0
}

main "$@"
