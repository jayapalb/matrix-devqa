#!/usr/bin/env bash
#
# git-pushall.sh — status / commit / push across the matrixplus polyrepo.
#
# The matrixplus workspace is a set of SIBLING git repos (matrix-shell,
# matrix-planner, matrix-device-agents, …). This script lives in matrix-devqa
# and walks its siblings, reporting and (on request) committing + pushing each.
#
# SAFE BY DEFAULT:
#   ./git-pushall.sh                 → status only. Reads nothing but git; pushes nothing.
#   ./git-pushall.sh --push          → push repos that have local commits ahead of upstream.
#   ./git-pushall.sh --commit "msg"  → `git add -A && git commit -m msg` in each DIRTY repo (respects .gitignore).
#   ./git-pushall.sh --commit "msg" --push   → commit the dirty repos, then push everything ahead.
#   ./git-pushall.sh … --yes         → skip the confirmation prompt (for automation).
#
# It NEVER force-pushes, never touches a repo that is behind its upstream
# (warns: pull first), pushes only the current branch to its own upstream, and
# skips non-git dirs (matrix-devqa itself — which now also holds docs/) with a note.
#
# Exit non-zero if any requested push/commit failed.

set -uo pipefail

# ── args ────────────────────────────────────────────────────────────────────
DO_COMMIT=0; DO_PUSH=0; ASSUME_YES=0; COMMIT_MSG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --commit) DO_COMMIT=1; COMMIT_MSG="${2:-}"; shift 2 ;;
    --push)   DO_PUSH=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1 (see --help)"; exit 2 ;;
  esac
done
if [ "$DO_COMMIT" = 1 ] && [ -z "$COMMIT_MSG" ]; then
  echo "error: --commit requires a message, e.g. --commit \"chore: sync\"" >&2; exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # parent of matrix-devqa == matrixplus
cd "$ROOT"

C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_RED=$'\033[31m'; C_BLD=$'\033[1m'

# ── pass 1: survey ──────────────────────────────────────────────────────────
declare -a REPOS ACTIONABLE
echo "${C_BLD}Repos under $ROOT${C_RESET}"
printf "%-24s %-8s %-8s %-14s %s\n" "REPO" "BRANCH" "DIRTY" "VS UPSTREAM" "NOTE"
for dir in matrix-*/; do
  d="${dir%/}"
  if [ ! -d "$d/.git" ]; then
    printf "%-24s ${C_DIM}%s${C_RESET}\n" "$d" "— not a git repo (skipped)"
    continue
  fi
  REPOS+=("$d")
  branch=$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
  dirtyN=$(git -C "$d" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  dirty=$([ "$dirtyN" -gt 0 ] && echo "${C_YEL}${dirtyN} files${C_RESET}" || echo "${C_GRN}clean${C_RESET}")
  note=""
  if git -C "$d" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    ahead=$(git -C "$d" rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
    behind=$(git -C "$d" rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)
    vs="↑${ahead} ↓${behind}"
    [ "$behind" -gt 0 ] && note="${C_RED}behind — pull first${C_RESET}"
    { [ "$ahead" -gt 0 ] || { [ "$DO_COMMIT" = 1 ] && [ "$dirtyN" -gt 0 ]; }; } && ACTIONABLE+=("$d")
  else
    vs="${C_DIM}no upstream${C_RESET}"; note="${C_DIM}set: git push -u origin $branch${C_RESET}"
  fi
  printf "%-24s %-8s %-19b %-25b %b\n" "$d" "$branch" "$dirty" "$vs" "$note"
done

# ── read-only? stop here ────────────────────────────────────────────────────
if [ "$DO_COMMIT" = 0 ] && [ "$DO_PUSH" = 0 ]; then
  echo; echo "${C_DIM}Status only. To act: --push (push ahead) / --commit \"msg\" (commit dirty) / both.${C_RESET}"
  exit 0
fi

if [ "${#ACTIONABLE[@]}" -eq 0 ]; then
  echo; echo "${C_GRN}Nothing to do${C_RESET} — no repo is ahead of upstream$([ "$DO_COMMIT" = 1 ] && echo " or dirty")."
  exit 0
fi

# ── confirm ─────────────────────────────────────────────────────────────────
echo
echo "${C_BLD}Will ${DO_COMMIT:+commit (add -A) }${DO_PUSH:+${DO_COMMIT:+then }push }the following:${C_RESET} ${ACTIONABLE[*]}"
[ "$DO_COMMIT" = 1 ] && echo "  commit message: ${C_BLD}$COMMIT_MSG${C_RESET}"
if [ "$ASSUME_YES" = 0 ]; then
  read -r -p "Proceed? [y/N] " ans
  [ "$ans" = y ] || [ "$ans" = Y ] || { echo "aborted."; exit 1; }
fi

# ── pass 2: act ─────────────────────────────────────────────────────────────
fail=0; committed=0; pushed=0
for d in "${ACTIONABLE[@]}"; do
  echo; echo "${C_BLD}▸ $d${C_RESET}"
  if [ "$DO_COMMIT" = 1 ] && [ -n "$(git -C "$d" status --porcelain)" ]; then
    if git -C "$d" add -A && git -C "$d" commit -m "$COMMIT_MSG" >/dev/null; then
      echo "  ${C_GRN}committed${C_RESET} $(git -C "$d" rev-parse --short HEAD)"
      committed=$((committed+1))
    else
      echo "  ${C_RED}commit failed${C_RESET}"; fail=$((fail+1)); continue
    fi
  fi
  if [ "$DO_PUSH" = 1 ]; then
    behind=$(git -C "$d" rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)
    if [ "$behind" -gt 0 ]; then
      echo "  ${C_RED}skip push — behind upstream by $behind (pull/rebase first)${C_RESET}"; fail=$((fail+1)); continue
    fi
    ahead=$(git -C "$d" rev-list --count '@{u}..HEAD' 2>/dev/null || echo "-")
    if [ "$ahead" = "-" ]; then
      echo "  ${C_DIM}no upstream — run: git -C $d push -u origin $(git -C "$d" rev-parse --abbrev-ref HEAD)${C_RESET}"
    elif [ "$ahead" -eq 0 ]; then
      echo "  ${C_DIM}nothing ahead — skip${C_RESET}"
    elif git -C "$d" push; then
      echo "  ${C_GRN}pushed${C_RESET} ($ahead commit(s))"; pushed=$((pushed+1))
    else
      echo "  ${C_RED}push failed${C_RESET}"; fail=$((fail+1))
    fi
  fi
done

echo; echo "${C_BLD}Done:${C_RESET} committed $committed · pushed $pushed · errors $fail"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
