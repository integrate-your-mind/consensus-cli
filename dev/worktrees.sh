# gwt: create a new branch off the current branch + create a new worktree + cd into it
gwt() {
  # Must be inside a git repo
  local common main wt_root branch dir path
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || {
    echo "gwt: not inside a git repository" >&2
    return 1
  }

  # The common dir is <main>/.git for all worktrees; main worktree is its parent
  main="$(cd "$common/.." && pwd -P)"
  wt_root="${main}.worktrees"

  branch="$1"
  if [ -z "$branch" ]; then
    printf "branch name: "
    IFS= read -r branch
  fi
  if [ -z "$branch" ]; then
    echo "gwt: branch name required" >&2
    return 1
  fi

  # Directory name should be filesystem-friendly AND show up clearly in tmux
  # Replace slashes so "task/123-foo" becomes "task-123-foo"
  dir="${branch//\//-}"
  path="${wt_root}/${dir}"

  mkdir -p "$wt_root" || return 1

  # Create branch from current HEAD and add worktree
  git worktree add -b "$branch" "$path" HEAD || return 1

  cd "$path" || return 1
}

# gwe: delete the current worktree (and cd back to the default worktree first)
gwe() {
  local common main cur branch
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || {
    echo "gwe: not inside a git repository" >&2
    return 1
  }
  main="$(cd "$common/.." && pwd -P)"
  cur="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1

  # Prevent nuking the default worktree
  if [ "$cur" = "$main" ]; then
    echo "gwe: refusing to remove the default worktree: $main" >&2
    return 1
  fi

  branch="$(git -C "$cur" rev-parse --abbrev-ref HEAD 2>/dev/null)"

  # Move out of the worktree before removing it
  cd "$main" || return 1

  # Remove the worktree directory
  git worktree remove --force "$cur" || return 1

  # In the demo the intent is "task is done -> delete the worktree".
  # Most teams also want to delete the local branch created for that worktree.
  # This will fail safely if the branch is checked out elsewhere.
  if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
    git branch -D "$branch" >/dev/null 2>&1 || true
  fi
}
