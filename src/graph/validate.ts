import { analyzeGraph } from "./analyze.js";
import type {
  ConsensusGraph,
  GraphBudget,
  GraphEdge,
  GraphEdgeCondition,
  GraphNode,
  GraphParseResult,
  GraphValidationIssue,
} from "./types.js";

export const DEFAULT_GRAPH_BUDGET: GraphBudget = {
  maxSteps: 50,
  maxDurationMs: 30 * 60 * 1000,
};

const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EDGE_CONDITIONS = new Set<GraphEdgeCondition>(["success", "failure", "always"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  issues: GraphValidationIssue[],
  severity: GraphValidationIssue["severity"],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ severity, code, path, message });
}

function parsePositiveInteger(
  value: unknown,
  path: string,
  issues: GraphValidationIssue[],
  fallback?: number,
): number | undefined {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    issue(issues, "error", "invalid_positive_integer", path, "Expected a positive integer.");
    return undefined;
  }
  return value as number;
}

function parseNode(value: unknown, index: number, issues: GraphValidationIssue[]): GraphNode | undefined {
  const basePath = `nodes[${index}]`;
  if (!isRecord(value)) {
    issue(issues, "error", "invalid_node", basePath, "Expected an object.");
    return undefined;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) {
    issue(issues, "error", "missing_node_id", `${basePath}.id`, "Expected a non-empty string.");
  } else if (!NODE_ID_PATTERN.test(id)) {
    issue(
      issues,
      "error",
      "invalid_node_id",
      `${basePath}.id`,
      "Use letters, numbers, dots, underscores, and dashes; start with a letter or number.",
    );
  }

  let label: string | undefined;
  if (value.label !== undefined) {
    if (typeof value.label !== "string" || !value.label.trim()) {
      issue(issues, "error", "invalid_node_label", `${basePath}.label`, "Expected a non-empty string.");
    } else {
      label = value.label.trim();
    }
  }

  let command: [string, ...string[]] | undefined;
  if (!Array.isArray(value.command) || value.command.length === 0) {
    issue(
      issues,
      "error",
      "invalid_node_command",
      `${basePath}.command`,
      "Expected a non-empty string array: [executable, ...args].",
    );
  } else if (!value.command.every((part) => typeof part === "string")) {
    issue(
      issues,
      "error",
      "invalid_node_command_part",
      `${basePath}.command`,
      "Every command item must be a string.",
    );
  } else if (!(value.command[0] as string).trim()) {
    issue(
      issues,
      "error",
      "empty_node_executable",
      `${basePath}.command[0]`,
      "The executable must not be empty.",
    );
  } else {
    command = [...(value.command as string[])] as [string, ...string[]];
  }

  let cwd: string | undefined;
  if (value.cwd !== undefined) {
    if (typeof value.cwd !== "string" || !value.cwd.trim()) {
      issue(issues, "error", "invalid_node_cwd", `${basePath}.cwd`, "Expected a non-empty string.");
    } else {
      cwd = value.cwd;
    }
  }

  let env: Record<string, string> | undefined;
  if (value.env !== undefined) {
    if (!isRecord(value.env)) {
      issue(issues, "error", "invalid_node_env", `${basePath}.env`, "Expected an object of string values.");
    } else {
      env = {};
      for (const [key, envValue] of Object.entries(value.env)) {
        if (typeof envValue !== "string") {
          issue(
            issues,
            "error",
            "invalid_node_env_value",
            `${basePath}.env.${key}`,
            "Expected a string value.",
          );
        } else {
          env[key] = envValue;
        }
      }
    }
  }

  let timeoutMs: number | undefined;
  if (value.timeoutMs !== undefined) {
    timeoutMs = parsePositiveInteger(value.timeoutMs, `${basePath}.timeoutMs`, issues);
  }

  if (!id || !command) return undefined;

  return {
    id,
    ...(label ? { label } : {}),
    command,
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  };
}

function parseEdge(value: unknown, index: number, issues: GraphValidationIssue[]): GraphEdge | undefined {
  const basePath = `edges[${index}]`;
  if (!isRecord(value)) {
    issue(issues, "error", "invalid_edge", basePath, "Expected an object.");
    return undefined;
  }

  const from = typeof value.from === "string" ? value.from.trim() : "";
  const to = typeof value.to === "string" ? value.to.trim() : "";
  if (!from) {
    issue(issues, "error", "missing_edge_from", `${basePath}.from`, "Expected a node id.");
  }
  if (!to) {
    issue(issues, "error", "missing_edge_to", `${basePath}.to`, "Expected a node id.");
  }

  const rawCondition = value.on ?? "success";
  let on: GraphEdgeCondition | undefined;
  if (typeof rawCondition !== "string" || !EDGE_CONDITIONS.has(rawCondition as GraphEdgeCondition)) {
    issue(
      issues,
      "error",
      "invalid_edge_condition",
      `${basePath}.on`,
      'Expected "success", "failure", or "always".',
    );
  } else {
    on = rawCondition as GraphEdgeCondition;
  }

  let maxTraversals: number | undefined;
  if (value.maxTraversals !== undefined) {
    maxTraversals = parsePositiveInteger(value.maxTraversals, `${basePath}.maxTraversals`, issues);
  }

  if (!from || !to || !on) return undefined;
  return {
    from,
    to,
    on,
    ...(maxTraversals ? { maxTraversals } : {}),
  };
}

function parseBudget(value: unknown, issues: GraphValidationIssue[]): GraphBudget | undefined {
  if (value === undefined) return { ...DEFAULT_GRAPH_BUDGET };
  if (!isRecord(value)) {
    issue(issues, "error", "invalid_budget", "budget", "Expected an object.");
    return undefined;
  }

  const maxSteps = parsePositiveInteger(
    value.maxSteps,
    "budget.maxSteps",
    issues,
    DEFAULT_GRAPH_BUDGET.maxSteps,
  );
  const maxDurationMs = parsePositiveInteger(
    value.maxDurationMs,
    "budget.maxDurationMs",
    issues,
    DEFAULT_GRAPH_BUDGET.maxDurationMs,
  );

  if (!maxSteps || !maxDurationMs) return undefined;
  return { maxSteps, maxDurationMs };
}

function validateTransitions(graph: ConsensusGraph, issues: GraphValidationIssue[]): void {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const seenNodeIds = new Set<string>();

  graph.nodes.forEach((node, index) => {
    if (seenNodeIds.has(node.id)) {
      issue(
        issues,
        "error",
        "duplicate_node_id",
        `nodes[${index}].id`,
        `Node id "${node.id}" is already defined.`,
      );
    }
    seenNodeIds.add(node.id);
  });

  if (!nodeIds.has(graph.entry)) {
    issue(
      issues,
      "error",
      "unknown_entry_node",
      "entry",
      `Entry node "${graph.entry}" does not exist.`,
    );
  }

  const transitionCounts = new Map<string, Record<GraphEdgeCondition, number>>();
  graph.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.from)) {
      issue(
        issues,
        "error",
        "unknown_edge_source",
        `edges[${index}].from`,
        `Node "${edge.from}" does not exist.`,
      );
    }
    if (!nodeIds.has(edge.to)) {
      issue(
        issues,
        "error",
        "unknown_edge_target",
        `edges[${index}].to`,
        `Node "${edge.to}" does not exist.`,
      );
    }

    const counts = transitionCounts.get(edge.from) ?? { success: 0, failure: 0, always: 0 };
    counts[edge.on] += 1;
    transitionCounts.set(edge.from, counts);
  });

  for (const [nodeId, counts] of transitionCounts) {
    for (const condition of ["success", "failure", "always"] as const) {
      if (counts[condition] > 1) {
        issue(
          issues,
          "error",
          "ambiguous_transition",
          "edges",
          `Node "${nodeId}" has ${counts[condition]} outgoing "${condition}" edges; only one is allowed in v1.`,
        );
      }
    }
  }
}

export function parseGraph(value: unknown): GraphParseResult {
  const issues: GraphValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      issues: [
        {
          severity: "error",
          code: "invalid_graph",
          path: "$",
          message: "Expected a JSON object.",
        },
      ],
    };
  }

  if (value.version !== 1) {
    issue(issues, "error", "unsupported_graph_version", "version", "Expected graph version 1.");
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) {
    issue(issues, "error", "missing_graph_id", "id", "Expected a non-empty string.");
  } else if (!NODE_ID_PATTERN.test(id)) {
    issue(
      issues,
      "error",
      "invalid_graph_id",
      "id",
      "Use letters, numbers, dots, underscores, and dashes; start with a letter or number.",
    );
  }

  const entry = typeof value.entry === "string" ? value.entry.trim() : "";
  if (!entry) {
    issue(issues, "error", "missing_entry", "entry", "Expected a node id.");
  }

  let nodes: GraphNode[] = [];
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    issue(issues, "error", "invalid_nodes", "nodes", "Expected a non-empty array.");
  } else {
    nodes = value.nodes.flatMap((node, index) => {
      const parsed = parseNode(node, index, issues);
      return parsed ? [parsed] : [];
    });
  }

  let edges: GraphEdge[] = [];
  if (value.edges === undefined) {
    edges = [];
  } else if (!Array.isArray(value.edges)) {
    issue(issues, "error", "invalid_edges", "edges", "Expected an array.");
  } else {
    edges = value.edges.flatMap((edge, index) => {
      const parsed = parseEdge(edge, index, issues);
      return parsed ? [parsed] : [];
    });
  }

  const budget = parseBudget(value.budget, issues);
  const graph: ConsensusGraph | undefined =
    value.version === 1 && id && entry && nodes.length > 0 && budget
      ? { version: 1, id, entry, nodes, edges, budget }
      : undefined;

  if (!graph) return { issues };

  validateTransitions(graph, issues);

  const structuralErrors = issues.some((entryIssue) => entryIssue.severity === "error");
  if (structuralErrors) return { graph, issues };

  const analysis = analyzeGraph(graph);
  for (const cyclicEdge of analysis.cyclicEdges) {
    if (!cyclicEdge.maxTraversals) {
      issue(
        issues,
        "error",
        "unbounded_cycle_edge",
        `edges[${cyclicEdge.index}].maxTraversals`,
        `Cycle edge "${cyclicEdge.from}" -> "${cyclicEdge.to}" must set maxTraversals.`,
      );
    }
  }

  for (const nodeId of analysis.unreachableNodeIds) {
    issue(
      issues,
      "warning",
      "unreachable_node",
      "nodes",
      `Node "${nodeId}" cannot be reached from entry "${graph.entry}".`,
    );
  }

  if (analysis.terminalNodeIds.length === 0) {
    issue(
      issues,
      "warning",
      "no_terminal_node",
      "nodes",
      "No node has zero outgoing edges. The run can still stop when an outcome has no matching edge or a budget is reached.",
    );
  }

  return { graph, issues, analysis };
}

export function hasGraphErrors(result: GraphParseResult): boolean {
  return result.issues.some((entryIssue) => entryIssue.severity === "error");
}
