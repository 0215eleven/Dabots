#!/usr/bin/env bash
# Updates an installed ds-bot-relay (systemd, see ../DEPLOYMENT.md) to this folder's version and
# turns on accounts. Run as root on the relay server from the uploaded copy of plugin/tools/relay:
#   sudo bash /tmp/ds-bot-relay-update/deploy/update.sh
# It backs up the installed files first and restores them if the new version does not come up.
# It never prints the registration secret, passwords or tokens.
set -euo pipefail

SERVICE="${RELAY_SERVICE:-ds-bot-relay}"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE=/var/lib/ds-bot-relay
DROPIN="/etc/systemd/system/${SERVICE}.service.d/accounts.conf"

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
  say "Turning on accounts ($DROPIN)"
  mkdir -p "$(dirname "$DROPIN")"
  # StateDirectory gives the service user its own writable /var/lib/ds-bot-relay under ProtectSystem=strict.
  cat > "$DROPIN" <<EOF
[Service]
StateDirectory=ds-bot-relay
StateDirectoryMode=0700
Environment=RELAY_DATA_FILE=$STATE/accounts.json
Environment=RELAY_REGISTRATION=invite
EOF
  touch "$DROPIN.new"
fi

say "Restarting $SERVICE"
systemctl daemon-reload
systemctl restart "$SERVICE"
ok=""
for _ in $(seq 1 20); do
  if curl -fsS "http://$HOST:$PORT/healthz" >/dev/null 2>&1 && curl -fsS "http://$HOST:$PORT/v1/account/info" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ -n "$ok" ] || restore
rm -f "$DROPIN.new"
echo "health: $(curl -fsS "http://$HOST:$PORT/healthz")"
echo "accounts: $(curl -fsS "http://$HOST:$PORT/v1/account/info")"

if [ -f "$STATE/bootstrap-code" ]; then
  say "Create the admin account"
  echo "No account exists yet. The first account becomes the admin; it uses the one-time code in $STATE/bootstrap-code."
  read -r -p "Admin username (3-32 letters, digits, . _ -): " USERNAME
  read -r -p "Email (optional, Enter to skip): " EMAIL
  read -r -s -p "Password (at least 8 characters): " PASSWORD; echo
  read -r -s -p "Password again: " AGAIN; echo
  [ "$PASSWORD" = "$AGAIN" ] || die "The passwords differ. Run this script again to create the admin; the update itself is done."
  BODY="$("$NODE" -e 'const [u,e,p,c]=process.argv.slice(1);process.stdout.write(JSON.stringify({username:u,...(e?{email:e}:{}),password:p,invite:c}))' \
    "$USERNAME" "$EMAIL" "$PASSWORD" "$(cat "$STATE/bootstrap-code")")"
  unset PASSWORD AGAIN
  RESULT="$(curl -sS -H 'content-type: application/json' --data-binary @- "http://$HOST:$PORT/v1/account/register" <<<"$BODY")"
  unset BODY
  if printf '%s' "$RESULT" | grep -q '"admin":true'; then
    echo "Admin account created: $USERNAME"
  else
    die "The admin was not created: $(printf '%s' "$RESULT" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).code)}catch{console.log("unexpected answer")}})'). Run this script again to retry."
  fi
fi

say "Done"
echo "Backup kept at $BACKUP (delete it once everything works)."
echo "Check from anywhere: curl -s https://<relay domain>/v1/account/info"
