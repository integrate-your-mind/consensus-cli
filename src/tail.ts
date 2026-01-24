import { summarizeTail, updateTail } from "./codexLogs.js";

const target = process.argv[2];
if (!target) {
  console.error("usage: npm run tail -- <session.jsonl>");
  process.exit(1);
}

let running = false;
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const state = await updateTail(target);
    if (state) {
      const summary = summarizeTail(state);
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
  } finally {
    running = false;
  }
}

setInterval(tick, 1000);
tick().catch((err) => {
  console.error(err);
  process.exit(1);
});
