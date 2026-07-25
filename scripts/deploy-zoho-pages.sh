#!/usr/bin/env bash
# deploy-zoho-pages.sh
# Builds the static dist/ output and pushes it to the `pages` branch
# on the Zoho remote, which Zoho Pages serves at:
#   https://repository.zohocorpcloud.in/pages/sridhar-ravi-2917/Design-Token-Forge
#
# Usage:
#   bash scripts/deploy-zoho-pages.sh
#   bash scripts/deploy-zoho-pages.sh --dry-run   # build only, no push

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

cd "$REPO_ROOT"

echo "==> Cleaning dist/"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

echo "==> Building project token bundles..."
for dir in projects/*/; do
  proj=$(basename "$dir")
  echo "    Building: $proj"
  node packages/sync-server/build-static.js --project "$proj" --out-dir ./dist
done

echo "==> Copying demo pages..."
cp -r demo dist/demo

echo "==> Copying plugin UI to root..."
mkdir -p dist/plugin
cp demo/plugin/ui.html dist/plugin/ui.html

echo "==> Build complete ($(find dist -type f | wc -l | tr -d ' ') files)"

if $DRY_RUN; then
  echo "==> Dry run — skipping push."
  exit 0
fi

echo "==> Pushing to 'pages' branch on origin (Zoho)..."
# Create an orphan pages branch from the dist/ contents only
TMPDIR_PAGES=$(mktemp -d)
trap 'rm -rf "$TMPDIR_PAGES"' EXIT

# Copy dist contents to temp dir
cp -r "$DIST_DIR/." "$TMPDIR_PAGES/"

# Set up a bare git repo in the temp dir pointing at origin
cd "$TMPDIR_PAGES"
git init -q
git checkout -q -b pages
git add -A
git -c user.name="Deploy Bot" -c user.email="deploy@dtf" \
    commit -q -m "Deploy $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Force-push to origin pages branch (replaces previous deploy)
git remote add origin "$(cd "$REPO_ROOT" && git remote get-url origin)"
git push -q --force origin pages

echo "==> Deployed. Live at:"
echo "    https://repository.zohocorpcloud.in/pages/sridhar-ravi-2917/Design-Token-Forge/demo/index.html"
