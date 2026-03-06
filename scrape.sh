#!/bin/bash
# Load environment variables from .env if present
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/.env"
  set +a
fi

node "${SCRIPT_DIR}/scrapeAmazon.js" && node "${SCRIPT_DIR}/updateHA.js"
