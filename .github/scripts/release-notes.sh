#!/usr/bin/env bash
# Writes the release notes of a tag to stdout: the conventional commits since the previous tag, grouped by type.
# Usage: release-notes.sh <tag> <image>   (needs the full history: actions/checkout with fetch-depth: 0)
set -euo pipefail

tag="$1"
image="$2"
version="${tag#v}"

git rev-parse --verify --quiet "${tag}^{commit}" >/dev/null || { echo "Unknown tag or commit: ${tag}" >&2; exit 1; }

# Previous tag reachable from this one; none for the first release (whole history).
previous="$(git describe --tags --abbrev=0 --match 'v*' "${tag}^" 2>/dev/null || true)"
range="${previous:+${previous}..}${tag}"

# One "- subject (sha)" line per commit of the given types, merge commits left out.
section() {
  local title="$1" pattern="$2" lines
  lines="$(git log --no-merges --format='%s|%h' "$range" | grep -E "^(${pattern})(\([^)]*\))?!?: " | sed -E 's/^[a-z]+(\(([^)]*)\))?!?: (.*)\|(.*)$/- \2|\3 (\4)/; s/^- \|/- /; s/^- ([^|]+)\|/- **\1:** /' || true)"
  if [ -n "$lines" ]; then
    printf '### %s\n\n%s\n\n' "$title" "$lines"
  fi
}

breaking="$(git log --no-merges --format='%s|%b' "$range" | grep -E '^[a-z]+(\([^)]*\))?!: |BREAKING CHANGE' || true)"
if [ -n "$breaking" ]; then
  printf '> [!WARNING]\n> This release contains breaking changes: read the commits below before upgrading.\n\n'
fi

section "Features" "feat"
section "Fixes" "fix"
section "Performance" "perf"
section "Other changes" "refactor|build|ci|revert"

cat <<NOTES
### Docker image

\`\`\`bash
docker pull ${image}:${version}
\`\`\`

NOTES

if [ -n "$previous" ]; then
  echo "**Full changelog:** https://github.com/${GITHUB_REPOSITORY:-jboucly/discoverr}/compare/${previous}...${tag}"
fi
