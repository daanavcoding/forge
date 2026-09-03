#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { enrichRunSummary, writeRunSummary } from './run-state.mjs';
import { codexTraceContext } from './codex-trace.mjs';

// This adapter persists text already authored by the model, then makes one
// optional, fail-open pass that copies observed host telemetry into it.
async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  return JSON.parse(raw);
}

export async function main() {
  try {
    const { values } = parseArgs({
      options: {
        existing: { type: 'boolean', default: false },
        repo: { type: 'string' },
        'run-id': { type: 'string' },
      },
      strict: false,
    });
    if (values.existing) {
      const repo = path.resolve(values.repo || process.cwd());
      const context = codexTraceContext();
      const enrichment = enrichRunSummary({
        repo,
        runId: values['run-id'],
        traceFile: context.transcript_path,
      });
      process.stdout.write(`${JSON.stringify({
        written: enrichment.enriched,
        run_id: values['run-id'] || null,
        telemetry_enriched: enrichment.enriched,
        telemetry_reason: enrichment.reason,
      })}\n`);
      return;
    }
    const payload = await readInput();
    const repo = path.resolve(payload?.repo || process.cwd());
    const written = writeRunSummary({
      repo,
      runId: payload?.run_id,
      summary: payload?.summary,
    });
    let enrichment = { enriched: false, reason: 'summary-not-written' };
    if (written) {
      let trace = payload?.trace ?? null;
      const traceFile = payload?.trace_file ? path.resolve(repo, String(payload.trace_file)) : null;
      if (trace === null && traceFile) {
        try { trace = fs.readFileSync(traceFile, 'utf8'); } catch { trace = null; }
      }
      enrichment = enrichRunSummary({
        repo,
        runId: payload?.run_id,
        trace,
        traceFile,
        telemetry: payload?.telemetry || null,
      });
    }
    process.stdout.write(`${JSON.stringify({
      written,
      run_id: payload?.run_id || null,
      telemetry_enriched: enrichment.enriched,
      telemetry_reason: enrichment.reason,
    })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      written: false,
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
