# Graphs and loops

Consensus treats an agent loop as a cycle inside an execution graph.

The graph answers two different questions:

- **Graph:** What agents and work phases exist, and which transitions have been observed?
- **Loop:** Which observed transitions return to an earlier phase?

This keeps the runtime model useful for both fixed workflows and agent-created task paths. Consensus remains an observability tool: it reports what ran but does not start, stop, retry, or route work.

## Preview command

Build a graph from the current local snapshot:

```bash
npx consensus-cli graph
```

Print the full graph payload:

```bash
npx consensus-cli graph --json
```

Analyze a saved snapshot:

```bash
npm run scan > snapshot.json
npx consensus-cli graph --snapshot snapshot.json
```

Read a snapshot from stdin:

```bash
cat snapshot.json | npx consensus-cli graph --snapshot -
```

## Graph model

The version 1 graph uses the retained events already present in a Consensus snapshot.

### Nodes

- `agent`: one node for each observed Codex, OpenCode, or Claude Code session or process.
- `step`: one provider-neutral work phase for an agent.

The first normalized phases are:

- `prompt`
- `model`
- `tool`
- `command`
- `edit`

Unknown event types remain visible as their own phases instead of being dropped.

### Edges

- `contains`: connects an agent to its observed phases.
- `transition`: connects one phase to the next phase seen for the same agent.

Repeated adjacent stream fragments collapse into one phase visit. This prevents token or message deltas from creating false self-loops. Repeated transitions still increase the edge observation count.

### Loops

Consensus finds strongly connected components in the transition graph:

- A self-edge is a `self` loop.
- Two or more mutually reachable phases form a `cycle` loop.

Loop state follows the strongest current signal from its member phases: `error`, then `active`, then `idle`.

## Output limits

Version 1 has explicit limits:

- It analyzes only the events retained in the current snapshot.
- Provider event normalization is best effort.
- It does not infer causal links between separate agents.
- It does not yet represent parent, subagent, delegation, approval, or retry edges.
- It reports an observed phase-transition graph, not a complete workflow definition.

These limits appear in the data model through `source: "observed-events"` and the retained event window.

## Next graph slices

1. Add explicit parent, subagent, delegation, approval, and retry edges from provider and harness data.
2. Stream graph deltas through the server and render them in the isometric UI.
3. Support declared workflow graphs alongside runtime-created task graphs.
4. Add loop budgets, stop-rule signals, stuck-loop detection, and run comparisons.
