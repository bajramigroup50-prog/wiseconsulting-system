#!/bin/sh
# 🔐 Creates the device CA for mutual TLS (docs/INSTALIM-UREDI.md). Run ONCE on the VPS as root (or with sudo):
#   sh /opt/wise/app/docker/device-ca.sh            # → /opt/wise/ca/{private/ca.key, public/ca.crt}
#   sh /opt/wise/app/docker/device-ca.sh /some/dir  # another directory (then set DEVICE_CA_HOST_DIR in /opt/wise/.env)
# The private key never leaves the server and is never committed: only the app container (uid 1001) can read it.
# Caddy gets only public/ca.crt. Re-running refuses to overwrite an existing CA (every enrolled computer depends on it).
set -eu

DIR="${1:-/opt/wise/ca}"
APP_UID="${APP_UID:-1001}"

if [ -e "$DIR/private/ca.key" ] || [ -e "$DIR/public/ca.crt" ]; then
	echo "CA already exists in $DIR — not touching it." >&2
	openssl x509 -in "$DIR/public/ca.crt" -noout -subject -enddate 2>/dev/null || true
	exit 1
fi

umask 077
mkdir -p "$DIR/private" "$DIR/public"
openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes \
	-keyout "$DIR/private/ca.key" -out "$DIR/public/ca.crt" \
	-subj "/O=WISE CONSULTING/CN=WISE CONSULTING Device CA" \
	-addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
	-addext "keyUsage=critical,keyCertSign,cRLSign" \
	-addext "subjectKeyIdentifier=hash"

# app container user (uid 1001) reads the key; Caddy (root in its container) reads the public certificate
chown -R "$APP_UID" "$DIR"
chmod 700 "$DIR/private"
chmod 400 "$DIR/private/ca.key"
chmod 755 "$DIR" "$DIR/public"
chmod 444 "$DIR/public/ca.crt"

echo "Device CA created in $DIR:"
openssl x509 -in "$DIR/public/ca.crt" -noout -subject -enddate -fingerprint -sha256
echo "Back up $DIR/private/ca.key OFFLINE (USB in the safe). Losing it means re-enrolling every computer."
