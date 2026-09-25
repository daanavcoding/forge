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

function linkedRunIds(trace) {
  const ids = new Set();
  if (!trace) return ids;
  for (const line of trace.split(/\r?\n/)) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const payload = record?.payload || record;
    const message = payload?.type === 'message' ? payload : record?.message;
    if (String(message?.role || record?.type || '').toLowerCase() !== 'assistant') continue;
    const blocks = Array.isArray(message?.content) ? message.content : [];
    for (const block of blocks) {
      const content = typeof block === 'string' ? block : block?.text;
      if (typeof content !== 'string' || !content.includes('Summary:')) continue;
      for (const match of content.matchAll(/Summary:[^\r\n]*?\.forge[/\\]runs[/\\]([a-z0-9-]+)[/\\]summary\.md/gi)) {
        ids.add(match[1]);
      }
    }
  }
  return ids;
}

export function handle(payload = {}) {
  try {
    const repo = path.resolve(payload.cwd || process.cwd());
    const sessionId = payload.session_id ? String(payload.session_id) : null;
    const transcriptPath = payload.transcript_path ? path.resolve(String(payload.transcript_path)) : null;
    const payloadTrace = readTrace(transcriptPath);
    const linkedIds = linkedRunIds(payloadTrace);
    const candidates = listRuns(repo).filter((run) => {
      const sameSession = sessionId && run.session_id === sessionId;
      const sameTranscript = transcriptPath && samePath(run.transcript_path, transcriptPath)
        && (!sessionId || run.session_id === sessionId);
      // Manual recovery may lack session identifiers. Only an assistant's
      // final Forge summary link identifies its run; arbitrary mentions in
      // tool output or earlier conversation do not.
      const referencedByTrace = linkedIds.has(run.run_id);
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
  const claudeOnlyHost = process.env.CLAUDE_PLUGIN_ROOT && !process.env.PLUGIN_ROOT;
  if (process.argv.includes('--codex-only') && claudeOnlyHost) {
    process.stdout.write('{}');
    return;
  }
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
