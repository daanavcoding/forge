#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { enrichRunSummary, listRuns } from './run-state.mjs';

function samePath(left, right) {
  if (!left || !right) return false;
  return path.resolve(String(left)).toLowerCase() === path.resolve(String(right)).toLowerCase();
}

function readTrace(file) {
  if (!file) return null;
  try { return fs.readFileSync(path.resolve(String(file)), 'utf8'); } catch { return null; }
}

export function handle(payload = {}) {
  try {
    const repo = path.resolve(payload.cwd || process.cwd());
    const sessionId = payload.session_id ? String(payload.session_id) : null;
    const transcriptPath = payload.transcript_path ? path.resolve(String(payload.transcript_path)) : null;
    const payloadTrace = readTrace(transcriptPath);
    const candidates = listRuns(repo).filter((run) => {
      const sameSession = sessionId && run.session_id === sessionId;
      const sameTranscript = transcriptPath && samePath(run.transcript_path, transcriptPath);
      // Manual context recovery cannot see host-only session identifiers. The
      // model must link the exact run summary in its final response, so the
      // random run_id in the host transcript is an equally precise join key.
      const referencedByTrace = payloadTrace && run.run_id && payloadTrace.includes(run.run_id);
      return Boolean(run.run_id && run.summary && (sameSession || sameTranscript || referencedByTrace));
    });
    let enriched = 0;
    for (const run of candidates) {
      const traceFile = transcriptPath || run.transcript_path;
      const trace = samePath(traceFile, transcriptPath) ? payloadTrace : readTrace(traceFile);
      if (!trace) continue;
      const result = enrichRunSummary({
        repo,
        runId: run.run_id,
        state: run,
        trace,
        traceFile,
      });
      if (result.enriched) enriched += 1;
    }
    return { processed: candidates.length, enriched };
  } catch {
    return { processed: 0, enriched: 0 };
  }
}

async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return {}; }
}

async function main() {
  if (process.argv.includes('--worker')) {
    handle(await readInput());
    return;
  }
  try {
    const payload = await readInput();
    const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
    worker.stdin.end(JSON.stringify(payload));
    worker.unref();
  } catch { /* SessionEnd telemetry is always fail-open. */ }
  process.stdout.write('{}');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => process.stdout.write('{}'));
}
