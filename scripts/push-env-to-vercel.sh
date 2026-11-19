#!/usr/bin/env bash
#
# Copy the configuration in .env.local up to Vercel, then redeploy.
#
#   ./scripts/push-env-to-vercel.sh
#
# Values are read from the file and piped straight to the Vercel CLI. Nothing is
# printed, echoed, or placed in a shell argument (where `ps` would expose it) —
# only variable names appear in the output.
#
# The redeploy at the end is required, not optional: NEXT_PUBLIC_* variables are
# inlined into the bundle at build time, so setting them changes nothing until
# the project is rebuilt.

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
ENVIRONMENTS=(production preview development)

# Only for while the portal is still hosted on Vercel. From Vercel the
# database is reached over TCP (TLS always on), hence DATABASE_HOST.
REQUIRED=(
  DATABASE_HOST
  DATABASE_USER
  DATABASE_PASSWORD
  ADMIN_EMAIL
  ADMIN_PASSWORD_HASH
  ADMIN_SESSION_SECRET
)

[ -f "$ENV_FILE" ] || {
  echo
  echo "  ✗ $ENV_FILE not found."
  echo "    Copy .env.example to .env.local, then run: npm run set-admin-password"
  echo
  exit 1
}

# Read one value without printing it. Handles `KEY=value` with optional quotes.
read_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

echo
echo "  Checking $ENV_FILE..."
missing=()
for key in "${REQUIRED[@]}"; do
  [ -n "$(read_value "$key")" ] || missing+=("$key")
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "  ✗ Missing locally: ${missing[*]}"
  echo
  echo "    For the ADMIN_* values run:  npm run set-admin-password"
  echo "    For the DATABASE_* values see: .env.example"
  echo
  exit 1
fi
echo "  ✓ All ${#REQUIRED[@]} variables present"

echo
echo "  Signing in to Vercel if needed..."
npx --yes vercel whoami >/dev/null 2>&1 || npx --yes vercel login

echo
echo "  Linking the project..."
# --yes accepts the git-detected project rather than showing a picker that
# would stall the script waiting for a keypress.
npx --yes vercel link --yes

echo
echo "  Uploading..."
for key in "${REQUIRED[@]}"; do
  value="$(read_value "$key")"
  for env in "${ENVIRONMENTS[@]}"; do
    # Remove any existing value first, so re-running is safe.
    npx --yes vercel env rm "$key" "$env" --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | npx --yes vercel env add "$key" "$env" >/dev/null 2>&1
  done
  unset value
  echo "    ✓ $key"
done

echo
echo "  Redeploying (required — NEXT_PUBLIC_* is baked in at build time)..."
npx --yes vercel --prod --force --yes

echo
echo "  Done. Verify with:"
echo "    curl -s https://<your-admin-domain>/api/health?check=config"
echo "  You want \"status\":\"ready\"."
echo
