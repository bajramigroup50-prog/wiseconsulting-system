#!/bin/sh
# Nightly backup (host cron, e.g. `30 2 * * * /opt/wise/app/docker/backup.sh >> /var/log/wise-backup.log 2>&1`):
# pg_dump + a sync of the document bucket into $BACKUP_DIR, keeping 30 days of database dumps.
set -eu
umask 077  # dumps contain all accounting data: owner-only
cd "$(dirname "$0")"
ENV_FILE=${ENV_FILE:-/opt/wise/.env}
. "$ENV_FILE"
BACKUP_DIR=${BACKUP_DIR:-/var/backups/wise}
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/files"

docker compose -f compose.yml --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$BACKUP_DIR/db/wise_$STAMP.dump"

docker run --rm --network wise_default -v "$BACKUP_DIR/files:/backup" \
  -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" -e AWS_DEFAULT_REGION=us-east-1 \
  amazon/aws-cli:2.31.0 --endpoint-url http://s3:8333 s3 sync "s3://${S3_BUCKET:-wise-docs}" /backup --only-show-errors

find "$BACKUP_DIR/db" -name 'wise_*.dump' -mtime +30 -delete

# Status for the app („Податоци и резервна копија“ reads app_settings `backup.last`); a failure here never fails the backup.
SIZE=$(wc -c < "$BACKUP_DIR/db/wise_$STAMP.dump" | tr -d ' ')
KEPT=$(find "$BACKUP_DIR/db" -name 'wise_*.dump' | wc -l | tr -d ' ')
docker compose -f compose.yml --env-file "$ENV_FILE" exec -T postgres \
  psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "insert into app_settings (key, value, updated_at) values ('backup.last', jsonb_build_object('at', now(), 'file', 'wise_$STAMP.dump', 'size', $SIZE, 'kept', $KEPT), now()) on conflict (key) do update set value = excluded.value, updated_at = now();" \
  || echo "backup status not recorded"
echo "backup ok: $STAMP"
