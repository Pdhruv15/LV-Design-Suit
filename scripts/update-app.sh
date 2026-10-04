#!/bin/bash
# Update LV Design Studio on this Mac from GitHub: pull main, build the
# Apple-silicon app and replace the copy in /Applications.
# Usage: npm run update-app   (add --force to rebuild even if nothing changed)
set -euo pipefail
cd "$(dirname "$0")/.."

APP="LV Design Studio"
DEST="/Applications/$APP.app"
BUILT="release/mac-arm64/$APP.app"
# The version built into the installed app (written after each install) — compared with GitHub,
# so code already pulled into this folder but not yet built still gets installed.
STAMP="$HOME/Library/Application Support/LV Design Studio/installed-commit"

if [ "$(git branch --show-current)" != "main" ]; then
  echo "You're on branch '$(git branch --show-current)'. Switch to main first:  git checkout main"; exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "There are unsaved code changes here — not updating, so nothing is lost:"; git status --short --untracked-files=no; exit 1
fi

echo "Checking GitHub for updates…"
git fetch -q origin main
BEFORE=$(git rev-parse HEAD); REMOTE=$(git rev-parse origin/main)
INSTALLED=$(cat "$STAMP" 2>/dev/null || true)
if [ "$INSTALLED" = "$REMOTE" ] && [ -d "$DEST" ] && [ "${1:-}" != "--force" ]; then
  echo "Already up to date — the installed app is $(git log -1 --format='%h %s' "$REMOTE")."; exit 0
fi
git merge -q --ff-only origin/main
echo "Updated to: $(git log -1 --format='%h %s')"

if ! git diff --quiet "$BEFORE" HEAD -- package-lock.json || [ ! -d node_modules ]; then
  echo "Installing packages…"; npm ci --no-audit --no-fund
fi

echo "Building the app (a few minutes)…"
npm run build >/dev/null
npx electron-builder --mac dir --arm64 >/dev/null

if pgrep -xq "$APP"; then
  echo "Closing $APP — save your work first. Press Enter to continue, or Ctrl+C to stop."; read -r
  osascript -e "quit app \"$APP\"" || true; sleep 2
fi
rm -rf "$DEST"
ditto "$BUILT" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
mkdir -p "$(dirname "$STAMP")" && git rev-parse HEAD > "$STAMP"
VERSION=$(node -p "require('./package.json').version.split('.').slice(0,2).join('.')")
echo "Done — $APP v$VERSION is updated in Applications ($(git log -1 --format='%h %s'))."
