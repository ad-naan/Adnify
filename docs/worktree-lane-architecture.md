# Worktree execution lanes

## Decision rule

Worktrees are selected by execution concurrency and write intent, not by UI mode.
The unit of isolation is an execution node: a top-level Agent run, a write-capable
sub-agent, or a Plan task. Conversation messages are not isolation units.

| Execution case | Lane policy |
| --- | --- |
| One foreground Agent, no concurrent writer | Shared workspace |
| Multiple top-level Agent tasks that may write | One lane per execution node |
| Read-only Agent sub-task | Shared workspace |
| Parallel write-capable Agent sub-task | Required lane |
| Conversation response branch | Inherit the execution node lane |
| Handoff/continuation | Inherit the task lineage lane |
| Sequential Plan task | Shared workspace by default |
| Parallel Plan task that writes files | Required lane |
| Parallel Plan analysis/read task | Shared workspace |

## Shared ownership

`WorktreeLaneService` owns Git lifecycle operations for both Agent and Plan:

```text
execution intent
  -> lane coordinator
      -> create worktree + branch
      -> run Agent with lane path as workspacePath
      -> stage and commit lane result
      -> serialized merge queue
      -> remove merged worktree
```

Lane directories live under `.adnify/worktrees/`, inside the authorized
workspace security scope. The root is added to the repository-local
`.git/info/exclude`; Adnify never modifies the project's `.gitignore` for
machine-local execution state.

Callers may persist a projection of the lane state for UI, but must not issue
their own worktree commands. Plan stores that projection on `PlanTask`;
lightweight Agent tasks return it in tool metadata.

## State and safety

```text
pending -> active -> ready -> merged
                    \-> conflict
                    \-> failed
```

- Lane creation is based on the current `HEAD`.
- A dirty base workspace is not equivalent to that `HEAD`. Parallel writers
  must therefore be blocked or explicitly fall back to exclusive shared-mode;
  they must never silently run against a stale snapshot.
- Merges are serialized across Agent and Plan.
- A failed merge is aborted in the base workspace. The lane is retained with
  its branch, commit, and conflict list so resolution is recoverable.
- Read-only work never pays the worktree cost.
- Message branches do not create Git branches. Only concurrently executable
  nodes do; this keeps conversation history separate from repository history.

## Rollout

1. Shared service, parallel sub-agents, and parallel Plan write tasks.
2. Top-level Agent execution-node reservations and handoff inheritance.
3. Task Center controls for resolving, retrying, or discarding retained lanes.
