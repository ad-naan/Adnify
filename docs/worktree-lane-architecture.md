# Worktree execution lanes

## Decision rule

Worktrees are selected by execution concurrency and write intent, not by UI mode.
The unit of isolation is an execution node: a top-level Agent run, a write-capable
sub-agent, or a Plan task. Conversation messages are not isolation units.

| Execution case | Lane policy |
| --- | --- |
| One foreground Agent, no concurrent writer | Shared workspace |
| Multiple top-level Agent tasks that may write | Lane per execution node, shared-workspace fallback allowed |
| Read-only Agent sub-task | Shared workspace |
| Parallel write-capable Agent sub-task | Required lane |
| Conversation response branch | Inherit the execution node lane |
| Handoff/continuation | Inherit the task lineage lane |
| Sequential Plan task | Shared workspace by default |
| Parallel Plan task, unless explicitly read-only | Required lane |
| Parallel Plan analysis/read task (`analysis-read-heavy`) | Shared workspace |

Write intent for Plan tasks fails safe toward isolation: only an explicit
`analysis-read-heavy` classification opts out. Role-name heuristics are too weak
to gate isolation on — guessing wrong means two writers overwrite each other,
while an unnecessary lane only costs one `worktree add`.

A top-level Agent run is the one case allowed to degrade: sending a second chat
message is not a declaration of parallel writing, so when a lane is unavailable
(no repository, no commits, dirty base) the run continues in the shared workspace
and posts a visible warning. Sub-agents and Plan tasks are real parallel writers,
so for them an unavailable lane is a hard error.

## Shared ownership

`WorktreeLaneService` owns Git lifecycle operations for both Agent and Plan:

```text
execution intent
  -> lane coordinator
      -> sweep stale lanes (once per workspace per session)
      -> create worktree + branch (records baseBranch + baseCommit)
      -> run Agent with lane path as workspacePath
      -> stage and commit lane result
      -> serialized merge queue (verifies clean base + unchanged base branch)
      -> archive: remove the worktree folder, prune the registration
      -> delete the branch only after a successful merge
```

Lane directories live under `.adnify/worktrees/`, inside the authorized
workspace security scope. The whole `.adnify/` directory is added to the
repository-local `.git/info/exclude`; Adnify never modifies the project's
`.gitignore` for machine-local execution state. Excluding only
`.adnify/worktrees/` is not enough: Adnify itself writes `.adnify/plan/*.md` and
agent scratch state, which would keep the base workspace permanently dirty (so
no lane could ever be created) and would be committed into merges by the lane's
`git add -A`.

Callers may persist a projection of the lane state for UI, but must not issue
their own worktree commands. Plan stores that projection on `PlanTask`;
lightweight Agent tasks return it in tool metadata.

## Git access

`git worktree` is deliberately absent from the trusted subcommand list, so lane
commands do not go through `git:execSecure` — one approval prompt per lane, for
an operation the user has no context to judge, raised by a background execution
node. Widening the global allowlist is the other extreme: it would also permit
`git worktree add <any path>`, i.e. a full checkout written outside the
workspace.

Instead there is one narrow IPC channel, `git:worktreeLane`, admitted by
`assessWorktreeLaneCommand` ([src/main/security/worktreeLanePolicy.ts](../src/main/security/worktreeLanePolicy.ts)):

- only `add` / `remove` / `list` / `prune`;
- `add` must be exactly `worktree add -b <adnify/lane-*> <path> <HEAD|hash>`;
- `add`/`remove` targets must resolve inside `<root>/.adnify/worktrees/`;
- the cwd must resolve inside an authorized workspace root.

Everything else a lane needs (`add -A`, `commit`, `merge`, `branch -d`,
`status`) is already a trusted subcommand and still goes through
`git:execSecure`.

## Lifecycle, archiving, and recovery

```text
active -> merged      (merged into the base branch; folder and branch removed)
      \-> ready       (archived: folder removed, commits kept on the lane branch)
      \-> conflict    (archived after `merge --abort`, conflict list retained)
      \-> discarded   (no commits beyond the base: folder and branch removed)
      \-> failed      (a lane Git operation itself failed; needs inspection)
```

- Lane creation is based on the current `HEAD`, and records `baseBranch` plus
  `baseCommit`.
- A dirty base workspace is not equivalent to that `HEAD`, so a lane is never
  created from one.
- Merges are serialized across Agent and Plan, and refuse to run when the base
  workspace is dirty or has moved to a different branch than `baseBranch` —
  merging onto the wrong branch is worse than retaining the lane.
- A failed merge is aborted in the base workspace.
- **Archiving is the default terminal action for anything not merged.** The
  worktree folder is reproducible; the commits are not. Keeping the folder makes
  every `git status`, index refresh, and file watcher carry a second full
  checkout, so it is removed (with `worktree prune` afterwards, otherwise the
  stale registration blocks a future lane of the same name) while the branch and
  commit stay.
- A lane with no commits beyond `baseCommit` is discarded entirely — folder and
  branch — so failures do not litter the repository with empty branches.
- Failure, abort, and timeout paths all release the lane. Uncommitted work in
  the lane is committed as WIP first, then archived; an abort is never merged
  automatically, because the user stopped the run mid-edit on purpose.
- On the first lane creation per workspace per session, leftovers from a crashed
  session are swept: clean lane worktrees are archived (branches kept), dirty
  ones are left untouched and reported — deleting someone else's unsaved work is
  worse than leaving a stale folder.
- Read-only work never pays the worktree cost.
- Message branches do not create Git branches. Only concurrently executable
  nodes do; this keeps conversation history separate from repository history.

Retained lanes are recoverable from the Plan task panel
([WorktreeLanePanel](../src/renderer/components/plan/WorktreeLanePanel.tsx)):
`retryMerge` re-enters the same serialized merge queue, and `dropLane` deletes
folder and branch after an explicit confirmation. `listLanes` enumerates both
lane worktrees and archived `adnify/lane-*` branches, so nothing is only
discoverable by typing `git branch --list` by hand.

## Rollout

1. Shared service, parallel sub-agents, and parallel Plan write tasks.
2. Top-level Agent execution-node reservations and handoff inheritance.
3. Archive/GC lifecycle, dedicated lane Git channel, and Plan-panel controls for
   retrying or discarding retained lanes.
