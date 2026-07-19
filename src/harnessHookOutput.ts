import type { HookHarnessId } from "./harnessHookModel.js";

const JSON_ACK_HARNESSES = new Set<HookHarnessId>(["gemini", "copilot"]);

export function harnessHookAcknowledgement(
  harnessId: HookHarnessId
): string {
  return JSON_ACK_HARNESSES.has(harnessId) ? "{}\n" : "";
}
