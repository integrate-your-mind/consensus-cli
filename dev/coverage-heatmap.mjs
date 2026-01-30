#!/usr/bin/env node
import fs from "fs";
import path from "path";

const argv = process.argv.slice(2);

function getArg(name, fallback) {
  const idx = argv.indexOf(name);
  if (idx === -1) return fallback;
  const val = argv[idx + 1];
  return val ?? fallback;
}

function getArgList(name, fallback) {
  const idx = argv.indexOf(name);
  if (idx === -1) return fallback;
  const val = argv[idx + 1];
  if (!val) return fallback;
  return val.split(",").map((v) => v.trim()).filter(Boolean);
}

const root = process.cwd();
const coverageDir = path.resolve(root, getArg("--coverage-dir", "coverage-v8"));
const outPath = path.resolve(root, getArg("--out", path.join("coverage", "heatmap.html")));
const includeDirs = getArgList("--include", ["src", "public"]).map((dir) =>
  path.resolve(root, dir),
);

const ignoredSegments = new Set([
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}tests${path.sep}`,
  `${path.sep}test-results${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}coverage-v8${path.sep}`,
  `${path.sep}tmp${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}dev${path.sep}`,
]);

function filePathFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  if (!url.startsWith("file://")) return null;
  const withoutScheme = url.slice("file://".length);
  const decoded = decodeURIComponent(withoutScheme);
  const noQuery = decoded.split("?")[0];
  return path.resolve(noQuery);
}

function shouldIncludeFile(filePath) {
  if (!filePath.startsWith(root + path.sep)) return false;
  for (const seg of ignoredSegments) {
    if (filePath.includes(seg)) return false;
  }
  if (includeDirs.length === 0) return true;
  return includeDirs.some((dir) => filePath.startsWith(dir + path.sep));
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getLineStarts(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineIndexForOffset(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const val = lineStarts[mid];
    if (val === offset) return mid;
    if (val < offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, hi);
}

function ensureFileEntry(map, filePath) {
  let entry = map.get(filePath);
  if (entry) return entry;
  const content = fs.readFileSync(filePath, "utf8");
  const lineStarts = getLineStarts(content);
  const lineCount = lineStarts.length;
  entry = {
    filePath,
    relPath: path.relative(root, filePath),
    content,
    lineStarts,
    lineHasRange: Array.from({ length: lineCount }, () => false),
    lineHits: Array.from({ length: lineCount }, () => 0),
  };
  map.set(filePath, entry);
  return entry;
}

function applyRange(entry, startOffset, endOffset, count) {
  const contentLength = entry.content.length;
  if (startOffset >= contentLength) return;
  const start = Math.max(0, startOffset);
  const endExclusive = Math.min(contentLength, Math.max(startOffset + 1, endOffset));
  const end = Math.max(start, endExclusive - 1);
  const startLine = lineIndexForOffset(entry.lineStarts, start);
  const endLine = lineIndexForOffset(entry.lineStarts, end);
  for (let line = startLine; line <= endLine; line += 1) {
    entry.lineHasRange[line] = true;
    if (count > entry.lineHits[line]) entry.lineHits[line] = count;
  }
}

function loadCoverageFiles(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`coverage directory not found: ${dir}`);
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}

function summarizeFile(entry) {
  let covered = 0;
  let total = 0;
  for (let i = 0; i < entry.lineHasRange.length; i += 1) {
    if (!entry.lineHasRange[i]) continue;
    total += 1;
    if (entry.lineHits[i] > 0) covered += 1;
  }
  return { covered, total, percent: total === 0 ? 100 : (covered / total) * 100 };
}

function computeMaxHit(entries) {
  let maxHit = 0;
  for (const entry of entries) {
    for (const hit of entry.lineHits) {
      if (hit > maxHit) maxHit = hit;
    }
  }
  return maxHit;
}

function renderHeatmap(entries, maxHit) {
  const overall = entries.reduce(
    (acc, entry) => {
      const { covered, total } = summarizeFile(entry);
      acc.covered += covered;
      acc.total += total;
      return acc;
    },
    { covered: 0, total: 0 },
  );

  const overallPct = overall.total === 0 ? 100 : (overall.covered / overall.total) * 100;
  const generatedAt = new Date().toISOString();

  const tocItems = entries
    .map((entry, index) => {
      const { percent } = summarizeFile(entry);
      return `<a class="toc-item" href="#file-${index}">${escapeHtml(
        entry.relPath,
      )}<span class="pct">${percent.toFixed(2)}%</span></a>`;
    })
    .join("\n");

  const fileBlocks = entries
    .map((entry, index) => {
      const summary = summarizeFile(entry);
      const lines = entry.content.split("\n");
      const lineHtml = lines
        .map((line, idx) => {
          const lineNo = idx + 1;
          const hasRange = entry.lineHasRange[idx];
          const hits = entry.lineHits[idx];
          let cls = "line";
          let style = "";
          let title = "";
          if (!hasRange) {
            cls += " na";
            title = "no coverage data";
          } else if (hits === 0) {
            cls += " miss";
            title = "hit count: 0";
          } else {
            const intensity =
              maxHit === 0
                ? 0.5
                : 0.15 + 0.85 * (Math.log(hits + 1) / Math.log(maxHit + 1));
            style = `style="background-color: rgba(46, 204, 113, ${intensity.toFixed(
              3,
            )})"`;
            title = `hit count: ${hits}`;
          }
          return `<span class="${cls}" ${style} title="${title}"><span class="ln">${lineNo}</span>${escapeHtml(
            line,
          )}</span>`;
        })
        .join("\n");
      return `<section class="file" id="file-${index}">
  <h2>${escapeHtml(entry.relPath)} <span class="file-pct">${summary.percent.toFixed(
        2,
      )}%</span></h2>
  <div class="file-meta">covered ${summary.covered} of ${summary.total} lines</div>
  <pre><code>
${lineHtml}
  </code></pre>
</section>`;
    })
    .join("\n\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coverage Heatmap</title>
  <style>
    :root {
      --bg: #0f1115;
      --panel: #151a22;
      --fg: #e6e6e6;
      --muted: #9aa0a6;
      --miss: rgba(231, 76, 60, 0.5);
      --na: rgba(60, 60, 60, 0.25);
      --border: #232a36;
      --accent: #6dd3fb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      font-family: "IBM Plex Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      line-height: 1.5;
    }
    header {
      padding: 24px 32px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(135deg, #141824 0%, #0f1115 65%);
    }
    h1 {
      margin: 0 0 8px 0;
      font-size: 22px;
    }
    .summary {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 13px;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(220px, 320px) 1fr;
      gap: 16px;
    }
    nav {
      padding: 16px;
      border-right: 1px solid var(--border);
      background: var(--panel);
      height: calc(100vh - 106px);
      overflow: auto;
      position: sticky;
      top: 0;
      align-self: start;
    }
    .toc-item {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 8px;
      border-radius: 6px;
      color: var(--fg);
      text-decoration: none;
      font-size: 12px;
    }
    .toc-item:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    .pct {
      color: var(--accent);
    }
    main {
      padding: 16px 24px 48px 0;
    }
    section.file {
      margin-bottom: 36px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }
    section.file h2 {
      margin: 0;
      padding: 12px 16px;
      font-size: 14px;
      background: #101521;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .file-pct {
      color: var(--accent);
      font-size: 12px;
    }
    .file-meta {
      padding: 6px 16px 10px 16px;
      font-size: 12px;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
    }
    pre {
      margin: 0;
      padding: 12px 0;
      overflow: auto;
    }
    code {
      display: block;
      font-size: 12px;
    }
    .line {
      display: block;
      white-space: pre;
      padding-left: 4.5rem;
      position: relative;
    }
    .line .ln {
      position: absolute;
      left: 0;
      width: 3.6rem;
      text-align: right;
      color: var(--muted);
      padding-right: 0.6rem;
      user-select: none;
    }
    .line.miss { background: var(--miss); }
    .line.na { background: var(--na); }
    @media (max-width: 980px) {
      .layout { grid-template-columns: 1fr; }
      nav { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--border); }
      main { padding: 16px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Coverage Heatmap</h1>
    <div class="summary">
      <div>Generated: ${generatedAt}</div>
      <div>Total lines covered: ${overall.covered} / ${overall.total} (${overallPct.toFixed(
        2,
      )}%)</div>
      <div>Coverage source: ${escapeHtml(path.relative(root, coverageDir))}</div>
    </div>
  </header>
  <div class="layout">
    <nav>
      ${tocItems}
    </nav>
    <main>
      ${fileBlocks}
    </main>
  </div>
</body>
</html>`;
}

function main() {
  const coverageFiles = loadCoverageFiles(coverageDir);
  const fileMap = new Map();

  for (const file of coverageFiles) {
    const raw = fs.readFileSync(file, "utf8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      continue;
    }
    for (const entry of data.result || []) {
      const filePath = filePathFromUrl(entry.url);
      if (!filePath || !shouldIncludeFile(filePath)) continue;
      let fileEntry;
      try {
        fileEntry = ensureFileEntry(fileMap, filePath);
      } catch (err) {
        continue;
      }
      for (const func of entry.functions || []) {
        for (const range of func.ranges || []) {
          applyRange(fileEntry, range.startOffset, range.endOffset, range.count);
        }
      }
    }
  }

  const entries = Array.from(fileMap.values()).sort((a, b) =>
    a.relPath.localeCompare(b.relPath),
  );

  if (entries.length === 0) {
    throw new Error("no coverage data matched the include filters");
  }

  const maxHit = computeMaxHit(entries);
  const html = renderHeatmap(entries, maxHit);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf8");

  const summary = {
    generatedAt: new Date().toISOString(),
    coverageDir: path.relative(root, coverageDir),
    files: entries.map((entry) => {
      const stats = summarizeFile(entry);
      return {
        file: entry.relPath,
        covered: stats.covered,
        total: stats.total,
        percent: Number(stats.percent.toFixed(2)),
      };
    }),
  };
  fs.writeFileSync(
    outPath.replace(/\.html?$/, ".json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
}

try {
  main();
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
}
