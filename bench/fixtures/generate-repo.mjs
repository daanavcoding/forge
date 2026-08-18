import fs from 'node:fs';
import path from 'node:path';

// ponytail: generate deterministic fixture bytes at materialization time instead
// of committing thousands of repetitive files to the repository.
function write(root, relative, body) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, 'utf8');
}

function modulePath(index, groupSize = 32) {
  const group = String(Math.floor(index / groupSize)).padStart(3, '0');
  const name = String(index).padStart(4, '0');
  return `src/modules/group-${group}/module-${name}.mjs`;
}

function fillerLines(label, count) {
  return Array.from({ length: count }, (_, index) => (
    `// ${label} generated route metadata line ${String(index + 1).padStart(2, '0')} remains stable for discovery.`
  )).join('\n');
}

function packageJson(name) {
  return `${JSON.stringify({ name, private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`;
}

function generateLarge(root, moduleCount) {
  write(root, 'package.json', packageJson('forge-bench-large-repository'));
  write(root, 'src/core/export-policy.mjs', `export function resolveExportPolicy(options = {}) {
  return { format: options.format || "json", release: false };
}
`);
  write(root, 'src/reports/export.mjs', `import { resolveExportPolicy } from "../core/export-policy.mjs";

export function exportReport(options = {}) {
  return { ...resolveExportPolicy(options), kind: "report" };
}
`);
  write(root, 'src/index.mjs', `import { exportReport } from "./reports/export.mjs";
import { module0000 } from "./modules/group-000/module-0000.mjs";

export function buildReleaseReport(options = {}) {
  return { report: exportReport(options), sample: module0000(options) };
}
`);
  const filler = fillerLines('large-repository', 32);
  for (let index = 0; index < moduleCount; index += 1) {
    const name = String(index).padStart(4, '0');
    write(root, modulePath(index), `import { exportReport } from "../../reports/export.mjs";
import { resolveExportPolicy } from "../../core/export-policy.mjs";

const MODULE_ID = "module-${name}";

export function module${name}(options = {}) {
  const policy = resolveExportPolicy(options);
  return { id: MODULE_ID, policy, report: exportReport(options) };
}

${filler}
`);
  }
  write(root, 'test/export-policy.test.mjs', `import assert from "node:assert/strict";
import test from "node:test";
import { exportReport } from "../src/reports/export.mjs";

test("release export reports preserve the release option", () => {
  assert.deepEqual(exportReport({ release: true }), { format: "json", release: true, kind: "report" });
});
`);
}

function generateLong(root, moduleCount) {
  write(root, 'package.json', packageJson('forge-bench-long-task'));
  write(root, 'src/core/report-policy.mjs', `export function normalizeReportOptions(options = {}) {
  return {
    format: options.format || "json",
    includeMetadata: false,
    sort: "id",
    redact: false,
  };
}
`);
  write(root, 'src/reports/json.mjs', `import { normalizeReportOptions } from "../core/report-policy.mjs";

export function renderJson(records, options = {}) {
  const policy = normalizeReportOptions(options);
  const values = policy.sort === "id" ? [...records].sort((a, b) => String(a.id).localeCompare(String(b.id))) : records;
  return JSON.stringify(values);
}
`);
  write(root, 'src/reports/csv.mjs', `import { normalizeReportOptions } from "../core/report-policy.mjs";

export function renderCsv(records, options = {}) {
  const policy = normalizeReportOptions(options);
  const values = policy.sort === "id" ? [...records].sort((a, b) => String(a.id).localeCompare(String(b.id))) : records;
  return values.map((record) => String(record.id) + "," + String(record.value)).join("\\n");
}
`);
  write(root, 'src/reports/summary.mjs', `import { normalizeReportOptions } from "../core/report-policy.mjs";

export function summarize(records, options = {}) {
  const policy = normalizeReportOptions(options);
  return { count: records.length, format: policy.format, metadata: null };
}
`);
  write(root, 'src/index.mjs', `import { renderCsv } from "./reports/csv.mjs";
import { renderJson } from "./reports/json.mjs";
import { summarize } from "./reports/summary.mjs";

export function reportBundle(records, options = {}) {
  return { json: renderJson(records, options), csv: renderCsv(records, options), summary: summarize(records, options) };
}
`);
  const filler = fillerLines('long-task', 44);
  for (let index = 0; index < moduleCount; index += 1) {
    const name = String(index).padStart(4, '0');
    write(root, modulePath(index, 16), `import { reportBundle } from "../../index.mjs";

export function handler${name}(records, options = {}) {
  return reportBundle(records, options);
}

${filler}
`);
  }
  write(root, 'test/report-v2.test.mjs', `import assert from "node:assert/strict";
import test from "node:test";
import { reportBundle } from "../src/index.mjs";
import { handler2047 } from "../src/modules/group-127/module-2047.mjs";

const records = [{ id: "b", value: 2 }, { id: "a", value: 1 }];

test("report v2 includes metadata and stable ordering", () => {
  const bundle = reportBundle(records, { includeMetadata: true, format: "json" });
  assert.deepEqual(JSON.parse(bundle.json), [records[1], records[0]]);
  assert.match(bundle.csv, /^a,1\\nb,2$/);
  assert.equal(bundle.summary.metadata, "included");
});

test("report v2 can redact values without changing counts", () => {
  const bundle = reportBundle(records, { redact: true });
  assert.match(bundle.json, /REDACTED/);
  assert.equal(bundle.summary.count, 2);
});

test("generated customer integrations produce the same compliant bundle", () => {
  const options = { includeMetadata: true, format: "csv", sort: "input", redact: true };
  const direct = reportBundle(records, options);
  const generated = handler2047(records, options);
  assert.deepEqual(generated, direct);
  assert.equal(generated.csv, "b,REDACTED\\na,REDACTED");
  assert.deepEqual(generated.summary, { count: 2, format: "csv", metadata: "included" });
  assert.deepEqual(records, [{ id: "b", value: 2 }, { id: "a", value: 1 }]);
});
`);
}

export function generateRepository(root, { kind, moduleCount }) {
  fs.mkdirSync(root, { recursive: true });
  if (kind === 'large') generateLarge(root, moduleCount);
  else if (kind === 'long') generateLong(root, moduleCount);
  else throw new Error(`Unknown generated fixture kind: ${kind}`);
}
