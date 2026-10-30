#!/usr/bin/env bash
# Updates an installed ds-bot-relay (systemd, see ../DEPLOYMENT.md) to this folder's version and
# turns on open registration, so a computer needs no registration secret: install the plugin,
# scan, done. Run as root on the relay server from the uploaded copy of plugin/tools/relay:
#   sudo bash /tmp/ds-bot-relay-update/deploy/update.sh
# It backs up the installed files first and restores them if the new version does not come up.
# It never prints the registration secret, passwords or tokens.
set -euo pipefail

SERVICE="${RELAY_SERVICE:-ds-bot-relay}"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DROPIN="/etc/systemd/system/${SERVICE}.service.d/open-registration.conf"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Run as root (sudo)."
for file in bin.mjs server.mjs accounts.mjs package.json package-lock.json; do
  [ -f "$SOURCE/$file" ] || die "Missing $SOURCE/$file. Upload the whole plugin/tools/relay folder."
done

say "Checking the installation"
if ! systemctl cat "$SERVICE.service" >/dev/null 2>&1; then
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qi relay; then
    docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep -i relay
    die "The relay runs in Docker, not as the systemd service $SERVICE. Send this output to the developer; this script only updates the systemd installation."
  fi
  die "No systemd service $SERVICE was found. Set RELAY_SERVICE=<name> if it has another name."
fi
INSTALL="$(systemctl show -p WorkingDirectory --value "$SERVICE")"
[ -n "$INSTALL" ] && [ -f "$INSTALL/server.mjs" ] || die "The service working directory ($INSTALL) does not hold server.mjs."
NODE="$(command -v node)" || die "node is not installed."
"$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' \
  || die "Node.js $("$NODE" -v) is too old; 22.12 or newer is required."
RUN_USER="$(systemctl show -p User --value "$SERVICE")"
PORT="$(systemctl show -p Environment --value "$SERVICE" | tr ' ' '\n' | sed -n 's/^RELAY_PORT=//p' | tail -1)"
PORT="${PORT:-8790}"
HOST="$(systemctl show -p Environment --value "$SERVICE" | tr ' ' '\n' | sed -n 's/^RELAY_HOST=//p' | tail -1)"
HOST="${HOST:-127.0.0.1}"
echo "service: $SERVICE  directory: $INSTALL  user: ${RUN_USER:-root}  listener: $HOST:$PORT  node: $("$NODE" -v)"
echo "installed version: $("$NODE" -p "require('$INSTALL/package.json').version" 2>/dev/null || echo unknown)  new version: $("$NODE" -p "require('$SOURCE/package.json').version")"

BACKUP="$INSTALL.backup-$(date +%Y%m%d-%H%M%S)"
say "Backing up $INSTALL to $BACKUP"
cp -a "$INSTALL" "$BACKUP"

restore() {
  say "Restoring the previous version from $BACKUP"
  rm -rf "$INSTALL" && cp -a "$BACKUP" "$INSTALL"
  [ -f "$DROPIN.new" ] && rm -f "$DROPIN" "$DROPIN.new"
  systemctl daemon-reload
  systemctl restart "$SERVICE" || true
  die "The update was rolled back. Send the output above and 'journalctl -u $SERVICE -n 50 --no-pager' to the developer."
}

say "Installing the new files"
cp "$SOURCE"/{bin.mjs,server.mjs,accounts.mjs,package.json,package-lock.json} "$INSTALL/"
(cd "$INSTALL" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund) || restore
chown -R root:root "$INSTALL"

if [ -f "$DROPIN" ]; then
  say "Keeping the existing $DROPIN"
else
  say "Turning on open registration ($DROPIN)"
  mkdir -p "$(dirname "$DROPIN")"
  # Computers register without the shared secret; the secret file, if any, keeps working too.
  cat > "$DROPIN" <<EOF
[Service]
Environment=RELAY_OPEN_REGISTRATION=1
EOF
  touch "$DROPIN.new"
fi

say "Restarting $SERVICE"
systemctl daemon-reload
systemctl restart "$SERVICE"
ok=""
for _ in $(seq 1 20); do
  if curl -fsS "http://$HOST:$PORT/healthz" >/dev/null 2>&1 && systemctl is-active --quiet "$SERVICE"; then ok=1; break; fi
  sleep 1
done
[ -n "$ok" ] || restore
rm -f "$DROPIN.new"
echo "health: $(curl -fsS "http://$HOST:$PORT/healthz")"
journalctl -u "$SERVICE" -n 3 --no-pager -o cat | grep -m1 'listening' || true

say "Done"
echo "Backup kept at $BACKUP (delete it once everything works)."
echo "Check from anywhere: curl -s https://<relay domain>/healthz"
