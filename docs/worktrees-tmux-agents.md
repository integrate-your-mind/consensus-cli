# Worktrees + tmux agents

This doc standardizes the tmux + worktree workflow used in the demo: one tmux window per agent, one worktree per window, and lazygit in a split pane for diffs.

## Standardized layout

Convention:
- The default worktree is the main checkout ("scout directory" in the demo).
- Additional worktrees live in a sibling directory named after the main checkout.

Example:

```
~/code/scout
~/code/scout.worktrees/
~/code/scout.worktrees/feat-x
~/code/scout.worktrees/bug-123
```

Why this layout:
- Worktrees stay grouped and predictable.
- The directory name becomes the worktree label that tmux displays.

## gwt/gwe helpers

The functions live in `dev/worktrees.sh` and are sourced into your shell (typically via direnv).

Behavior:
- `gwt [branch]`: creates a new branch from the current HEAD, adds a worktree under `<main>.worktrees/<branch>`, and `cd`s into it. If no branch name is provided, it prompts.
- `gwe`: removes the current worktree after hopping back to the default checkout and deletes the local branch when possible. It refuses to remove the default worktree.

These must be shell functions (not standalone executables) because they `cd` into/out of the worktree.

## tmux window naming

`dev/tmux.conf` enables automatic window renaming so Ctrl+B W shows `command:path`:

```
setw -g automatic-rename on
setw -g automatic-rename-format '#{pane_current_command}:#{b:pane_current_path}'
bind c new-window -c "#{env:SCOUT_DIR}"
```

## Start tmux the same way every time

From inside the default worktree, run:

```
SCOUT_DIR="$PWD" tmux -f ./dev/tmux.conf new -A -s scout
```

Or use the wrapper:

```
./dev/tmux-start.sh
```

## Repo integration

Recommended in-repo files:
- `dev/worktrees.sh` (gwt/gwe functions)
- `dev/tmux.conf` (window naming + default worktree)
- `dev/tmux-start.sh` (wrapper)
- `.envrc` (sources `dev/worktrees.sh`)

If using direnv, run `direnv allow` once after pulling.

## Day-to-day workflow (Step 6)

This is the "playbook" your team follows verbatim.

A. Root / default window
1. Open Ghostty (or whatever terminal you standardize on).
2. cd into the default worktree (the "scout directory").
3. Start tmux session (Step 4).
4. In the first window, run your primary agent (demo uses Claude Code).

Result: window shows claude:scout (or similar).

B. Create a new task worktree + agent window
1. Press Ctrl+B then C to create a new tmux window.
- It starts in the default worktree (by config).
2. Run:

```
gwt my-branch-name
```

3. Start an agent in that window (demo shows Codex as an example).

Result: agent is now running in a clean, isolated worktree.

C. See all agents/worktrees
- Press Ctrl+B then W.
- You see a list showing each window's agent + worktree.

D. Review diffs (Capy-like "chat + diffs")

Inside an agent window:
- Split a pane (tmux default: Ctrl+B % for vertical split).
- In the new pane:

```
lazygit
```

Now you have:
- one side: agent UI ("chat")
- other side: lazygit diffs

E. Finish and delete the worktree

When a task is done:
1. Exit the agent process in that window.
2. Run:

```
gwe
```

This jumps you back to the default worktree and removes the task worktree directory (and deletes the local branch if possible).

## Stack-level implications

Must-haves:
- Tooling must be path-agnostic (no hard-coded repo paths).
- Build output should live inside each worktree directory, not globally.
- Document how to avoid port collisions when running servers across worktrees.

Nice-to-haves:
- Standard branch naming like `task-<ticket>-<slug>` for readable worktree directories.
- Periodic cleanup: `git worktree prune` for stale metadata.

## Onboarding

Install requirements:
- tmux
- lazygit
- direnv (if using `.envrc`)

## Team convention

Default operating rule: one tmux window per agent per worktree.
