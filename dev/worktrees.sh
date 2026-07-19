# gwt: create a new branch off the current branch + create a new worktree + cd into it

_gwt_git_bin() {
  local bin
  for bin in /opt/homebrew/bin/git /usr/bin/git /usr/local/bin/git; do
    if [ -x "$bin" ]; then
      printf '%s\n' "$bin"
      return 0
    fi
  done
  bin="$(type -P git 2>/dev/null)"
  if [ -n "$bin" ] && [ -x "$bin" ]; then
    printf '%s\n' "$bin"
    return 0
  fi
  bin="$(command -v git 2>/dev/null)"
  if [ -n "$bin" ] && [ -x "$bin" ]; then
    printf '%s\n' "$bin"
    return 0
  fi
  return 1
}

_gwt_env_bin() {
  if [ -x /usr/bin/env ]; then
    printf '%s\n' "/usr/bin/env"
    return 0
  fi
  if [ -x /bin/env ]; then
    printf '%s\n' "/bin/env"
    return 0
  fi
  if command -v env >/dev/null 2>&1; then
    printf '%s\n' "env"
    return 0
  fi
  return 1
}

_gwt_mkdir_bin() {
  if [ -x /bin/mkdir ]; then
    printf '%s\n' "/bin/mkdir"
    return 0
  fi
  if command -v mkdir >/dev/null 2>&1; then
    printf '%s\n' "mkdir"
    return 0
  fi
  return 1
}

_gwt_sed_bin() {
  if [ -x /usr/bin/sed ]; then
    printf '%s\n' "/usr/bin/sed"
    return 0
  fi
  if [ -x /bin/sed ]; then
    printf '%s\n' "/bin/sed"
    return 0
  fi
  if command -v sed >/dev/null 2>&1; then
    printf '%s\n' "sed"
    return 0
  fi
  return 1
}

_gwt_cat_bin() {
  if [ -x /bin/cat ]; then
    printf '%s\n' "/bin/cat"
    return 0
  fi
  if [ -x /usr/bin/cat ]; then
    printf '%s\n' "/usr/bin/cat"
    return 0
  fi
  if command -v cat >/dev/null 2>&1; then
    printf '%s\n' "cat"
    return 0
  fi
  return 1
}

_gwt_pwd_bin() {
  if [ -x /bin/pwd ]; then
    printf '%s\n' "/bin/pwd"
    return 0
  fi
  if [ -x /usr/bin/pwd ]; then
    printf '%s\n' "/usr/bin/pwd"
    return 0
  fi
  printf '%s\n' "pwd"
  return 0
}

_gwt_git_common_dir() {
  local git_bin env_bin sed_bin cat_bin pwd_bin common gitdir commondir cwd
  git_bin="$(_gwt_git_bin)" || return 1
  env_bin="$(_gwt_env_bin)" || return 1
  sed_bin="$(_gwt_sed_bin)" || return 1
  cat_bin="$(_gwt_cat_bin)" || return 1
  pwd_bin="$(_gwt_pwd_bin)"
  cwd="$("$pwd_bin" -P)"

  common="$("$env_bin" -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR \
    "$git_bin" -C "$cwd" rev-parse --git-common-dir 2>/dev/null)"
  if [ -n "$common" ]; then
    case "$common" in
      /*) ;;
      *) common="$cwd/$common" ;;
    esac
    printf '%s\n' "$common"
    return 0
  fi

  if [ -e "$cwd/.git" ]; then
    if [ -d "$cwd/.git" ]; then
      printf '%s\n' "$cwd/.git"
      return 0
    fi
    gitdir="$("$sed_bin" -n 's/^gitdir: //p' "$cwd/.git" 2>/dev/null)"
    if [ -n "$gitdir" ]; then
      case "$gitdir" in
        /*) ;;
        *) gitdir="$cwd/$gitdir" ;;
      esac
      if [ -f "$gitdir/commondir" ]; then
        commondir="$("$cat_bin" "$gitdir/commondir" 2>/dev/null)"
        if [ -n "$commondir" ]; then
          printf '%s\n' "$(cd "$gitdir/$commondir" && "$pwd_bin" -P)"
          return 0
        fi
      fi
      printf '%s\n' "$gitdir"
      return 0
    fi
  fi

  return 1
}

gwt() {
  local common main wt_root branch dir path git_bin mkdir_bin pwd_bin
  common="$(_gwt_git_common_dir)" || {
    echo "gwt: not inside a git repository" >&2
    return 1
  }
  git_bin="$(_gwt_git_bin)" || {
    echo "gwt: git not found in PATH" >&2
    return 1
  }
  mkdir_bin="$(_gwt_mkdir_bin)" || {
    echo "gwt: mkdir not found in PATH" >&2
    return 1
  }
  pwd_bin="$(_gwt_pwd_bin)"

  main="$(cd "$common/.." && "$pwd_bin" -P)"
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

  dir="${branch//\//-}"
  path="${wt_root}/${dir}"

  "$mkdir_bin" -p "$wt_root" || return 1

  "$git_bin" worktree add -b "$branch" "$path" HEAD || return 1

  cd "$path" || return 1
}

gwe() {
  local common main cur branch git_bin env_bin pwd_bin cwd
  common="$(_gwt_git_common_dir)" || {
    echo "gwe: not inside a git repository" >&2
    return 1
  }
  git_bin="$(_gwt_git_bin)" || {
    echo "gwe: git not found in PATH" >&2
    return 1
  }
  env_bin="$(_gwt_env_bin)" || {
    echo "gwe: env not found in PATH" >&2
    return 1
  }
  pwd_bin="$(_gwt_pwd_bin)"

  main="$(cd "$common/.." && "$pwd_bin" -P)"
  cwd="$("$pwd_bin" -P)"
  cur="$("$env_bin" -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR \
    "$git_bin" -C "$cwd" rev-parse --show-toplevel 2>/dev/null)"
  if [ -z "$cur" ]; then
    return 1
  fi

  if [ "$cur" = "$main" ]; then
    echo "gwe: refusing to remove the default worktree: $main" >&2
    return 1
  fi

  branch="$("$env_bin" -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR \
    "$git_bin" -C "$cur" rev-parse --abbrev-ref HEAD 2>/dev/null)"

  cd "$main" || return 1

  "$git_bin" worktree remove --force "$cur" || return 1

  if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
    "$git_bin" branch -D "$branch" >/dev/null 2>&1 || true
  fi
}
