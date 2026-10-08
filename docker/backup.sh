#!/bin/sh
# Nightly backup (run from the host's cron, e.g. `30 2 * * * /opt/wise/docker/backup.sh`):
# pg_dump + MinIO mirror into $BACKUP_DIR, keeping 30 days (same retention as the legacy backups).
set -eu
cd "$(dirname "$0")"
. ./.env
BACKUP_DIR=${BACKUP_DIR:-/var/backups/wise}
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/files"

docker compose -f compose.yml --env-file .env exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$BACKUP_DIR/db/wise_$STAMP.dump"

docker run --rm --network wise_default -v "$BACKUP_DIR/files:/backup" \
  -e MC_HOST_w="http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@minio:9000" \
  quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z mirror --overwrite --preserve "w/${S3_BUCKET:-wise-docs}" /backup

find "$BACKUP_DIR/db" -name 'wise_*.dump' -mtime +30 -delete
echo "backup ok: $STAMP"
