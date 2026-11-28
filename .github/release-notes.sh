#!/usr/bin/env bash
# Release notes for one plugin or tool: the commits that touched its own
# folder since its previous tag (`<name>-vX.Y.Z` reachable from this one), or
# since the start of the history for its first release. Squash merges keep the
# `(#N)` of their pull request in the subject, which GitHub links.
#
#   .github/release-notes.sh <tag> <name> <folder> <owner/repo>
set -euo pipefail

TAG="$1" NAME="$2" SOURCE="$3" REPO="$4"

PREV="$(git describe --tags --abbrev=0 --match "${NAME}-v[0-9]*" --exclude "$TAG" "${TAG}^{commit}" 2>/dev/null || true)"
RANGE="$TAG"
[[ -n "$PREV" ]] && RANGE="${PREV}..${TAG}"

echo "## What's changed in \`${SOURCE}\`"
echo
CHANGES="$(git log --no-merges --format='* %s' "$RANGE" -- "$SOURCE")"
if [[ -n "$CHANGES" ]]; then
  echo "$CHANGES"
else
  echo "No changes in \`${SOURCE}\`."
fi
echo
if [[ -n "$PREV" ]]; then
  echo "**Full changelog**: https://github.com/${REPO}/compare/${PREV}...${TAG}"
else
  echo "**First release.** History: https://github.com/${REPO}/commits/${TAG}/${SOURCE}"
fi
