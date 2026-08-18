#!/usr/bin/env node
// Build the canonical v5 result after a fail-fast repair run. Source result
// files remain untouched, including any invalid attempt kept for auditability.
import fs from 'node:fs';
import path from 'node:path';

const [firstFile, secondFile, outputFile = 'bench/results/v5-codex-complete-2026-08-10.json'] = process.argv.slice(2);
if (!firstFile || !secondFile) throw new Error('usage: node bench/merge-v5.mjs <initial-result> <repair-result> [output]');

function read(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function healthy(row) {
  const phaseOk = !row.phase || row.phase.known === false || row.phase.pass === true;
  return row.mode === 'live' && row.completed === true && row.verify_passed === true
    && row.activation?.pass === true && phaseOk;
}

const first = read(firstFile);
const second = read(secondFile);
const allRows = [...(first.rows || []), ...(second.rows || [])];
const replacedScenarios = new Set(second.options?.scenarios || []);
const candidateRows = [
  ...(first.rows || []).filter((row) => !replacedScenarios.has(row.scenario)),
  ...(second.rows || []),
];
const rows = candidateRows.filter(healthy);
const judgments = [...(first.judgments || []), ...(second.judgments || [])].filter((judgment) => judgment.ok === true);
const scenarios = ['small', 'medium', 'large'];
const arms = ['solo', 'forge'];
for (const scenario of scenarios) {
  for (const arm of arms) {
    const count = rows.filter((row) => row.scenario === scenario && row.arm === arm).length;
    if (count !== 5) throw new Error(`Expected 5 healthy rows for ${scenario}/${arm}, got ${count}`);
  }
}
if (judgments.length !== 15) throw new Error(`Expected 15 valid judgments, got ${judgments.length}`);

const output = path.resolve(outputFile);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({
  schema: 3,
  status: 'complete',
  created_at: new Date().toISOString(),
  benchmark: first.benchmark,
  judge: first.judge,
  options: { host: 'codex', scenarios, arm: 'both', runs: 5, confirm: true, judge: true },
  source_results: [path.relative(process.cwd(), path.resolve(firstFile)), path.relative(process.cwd(), path.resolve(secondFile))],
  excluded_attempts: allRows.filter((row) => row.mode === 'live' && (!candidateRows.includes(row) || !healthy(row))).map((row) => ({
    scenario: row.scenario, run: row.run, arm: row.arm, phase: row.phase,
    trace_file: row.trace_file, trace_sha256: row.trace_sha256,
  })),
  rows,
  judgments,
}, null, 2)}\n`, 'utf8');
console.log(output);
