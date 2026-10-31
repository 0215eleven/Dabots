#!/usr/bin/env bash
# Update only Relay code. Existing authentication, configuration and data stay in place.
# See ../DEPLOYMENT.md; --check performs a read-only preflight.
set -euo pipefail
exec python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/update.py" "$@"
