#!/bin/sh
# Host keys kept in the `bankinkeys` volume (the bank pins the server's key); the bank's user and password from the
# environment (/opt/wise/.env → HALK_SFTP_PASS, never in the repository).
set -eu
[ -n "${HALK_SFTP_PASS:-}" ] || { echo "HALK_SFTP_PASS is not set – the bank SFTP stays off"; exit 1; }
mkdir -p /keys
[ -f /keys/ssh_host_ed25519_key ] || ssh-keygen -q -t ed25519 -N '' -f /keys/ssh_host_ed25519_key
[ -f /keys/ssh_host_rsa_key ] || ssh-keygen -q -t rsa -b 3072 -N '' -f /keys/ssh_host_rsa_key
id halk >/dev/null 2>&1 || adduser -D -H -h /in -u 1001 -s /sbin/nologin halk
printf 'halk:%s\n' "$HALK_SFTP_PASS" | chpasswd >/dev/null
# the chroot must belong to root; the bank writes into /in (read by the worker, uid 1001)
mkdir -p /data/halk/in
chown root:root /data /data/halk && chmod 755 /data /data/halk
chown 1001:1001 /data/halk/in && chmod 755 /data/halk/in
exec /usr/sbin/sshd -D -e
