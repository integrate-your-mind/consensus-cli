import { createHash } from "node:crypto";
import type { HarnessId } from "./harnesses.js";

function opaqueHarnessKey(scope: string, value: string): string {
  return createHash("sha256")
    .update(scope)
    .update("\0")
    .update(value)
    .digest("hex")
    .slice(0, 24);
}

export function harnessSessionKey(harnessId: HarnessId, sessionId: string): string {
  return opaqueHarnessKey(`session:${harnessId}`, sessionId);
}

export function harnessCwdKey(harnessId: HarnessId, cwd: string): string {
  return opaqueHarnessKey(`cwd:${harnessId}`, cwd);
}

export function harnessTurnKey(
  harnessId: HarnessId,
  sessionId: string,
  turnId: string
): string {
  return opaqueHarnessKey(`turn:${harnessId}`, `${sessionId}\0${turnId}`);
}
