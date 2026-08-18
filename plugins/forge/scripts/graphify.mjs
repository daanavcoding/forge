#!/usr/bin/env node
// Bounded, fail-open Graphify preparation and query for Forge activations.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const GRAPHIFY_QUERY_BUDGET = 2_000;
export const GRAPHIFY_TIMEOUT_MS = 60_000;
const GRAPHIFY_MAX_PROCESS_OUTPUT_BYTES = 256 * 1024;

function timeoutMs(env, override) {
  const value = Number(override ?? env.FORGE_GRAPHIFY_TIMEOUT_MS);
  if (!Number.isFinite(value) || value <= 0) return GRAPHIFY_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(value), 1), 300_000);
}

function safeSpawn(spawn, command, args, options) {
  try {
    return spawn(command, args, options) || { status: null };
  } catch (error) {
    return { status: null, error };
  }
}

function terminateProcessTree(pid, { spawn = spawnSync, platform = process.platform } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        encoding: 'utf8', windowsHide: true, shell: false, timeout: 5_000,
        maxBuffer: 16 * 1024,
      });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
    return true;
  } catch {
    return false;
  }
}

function commandResult(result) {
  const code = result?.error?.code;
  if (code === 'ENOENT') return { kind: 'unavailable', result };
  if (code === 'ETIMEDOUT' || result?.timedOut) return { kind: 'timeout', result };
  if (code) return { kind: 'failed', result, reason: `Graphify process error: ${code}` };
  if (result?.status !== 0) {
    return { kind: 'failed', result, reason: `Graphify exited with status ${result?.status ?? 1}` };
  }
  return { kind: 'ok', result };
}

function runCommand({ spawn, command, args, cwd, env, timeout, cleanup }) {
  const result = safeSpawn(spawn, command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    detached: process.platform !== 'win32',
    timeout,
    maxBuffer: GRAPHIFY_MAX_PROCESS_OUTPUT_BYTES,
  });
  const outcome = commandResult(result);
  if (outcome.kind === 'timeout') cleanup(result?.pid);
  return outcome;
}

function runBeforeDeadline(args, deadline, now) {
  const remaining = Math.floor(deadline - now());
  if (remaining <= 0) return { kind: 'timeout', result: null };
  return runCommand({ ...args, timeout: remaining });
}

function validGraph(fsApi, graph) {
  try {
    const stat = fsApi.statSync(graph);
    if (!stat.isFile() || stat.size === 0) return false;
    JSON.parse(fsApi.readFileSync(graph, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

function canonicalEvidence(value) {
  const lines = String(value ?? '').replaceAll('\r\n', '\n').split('\n');
  const first = lines[0]?.startsWith('NODE ') || lines[0]?.startsWith('EDGE ')
    ? ''
    : lines.shift()?.trim() || '';
  const nodes = lines.filter((line) => line.startsWith('NODE ')).sort();
  const edges = lines.filter((line) => line.startsWith('EDGE ')).sort();
  const other = lines
    .filter((line) => line.trim() && !line.startsWith('NODE ') && !line.startsWith('EDGE '))
    .map((line) => line.trim())
    .sort();
  return [first, nodes.length ? nodes.join('\n') : '', edges.length ? edges.join('\n') : '', other.join('\n')]
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function fallback(status, reason, extra = {}) {
  return {
    attempted: true,
    status,
    fallback_reason: reason,
    evidence: '',
    ...extra,
  };
}

export function excludeGraphify(repo, { spawn = spawnSync, fsApi = fs } = {}) {
  const result = safeSpawn(spawn, 'git', ['rev-parse', '--git-path', 'info/exclude'], {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 5_000,
    maxBuffer: 16 * 1024,
  });
  if (result?.status !== 0 || result?.error || !String(result.stdout || '').trim()) return;
  const exclude = path.resolve(repo, String(result.stdout).trim());
  let contents = '';
  try { contents = fsApi.readFileSync(exclude, 'utf8'); } catch { /* new exclude */ }
  if (!contents.split(/\r?\n/).includes('graphify-out/')) {
    fsApi.mkdirSync(path.dirname(exclude), { recursive: true });
    fsApi.appendFileSync(exclude, `${contents && !contents.endsWith('\n') ? '\n' : ''}graphify-out/\n`, 'utf8');
  }
}

export function prepareGraphify(repo, task = '', {
  env = process.env,
  spawn = spawnSync,
  fsApi = fs,
  executable = undefined,
  timeout = undefined,
  queryBudget = GRAPHIFY_QUERY_BUDGET,
  now = Date.now,
  cleanup = terminateProcessTree,
} = {}) {
  const root = path.resolve(repo);
  const graph = path.join(root, 'graphify-out', 'graph.json');
  const limit = timeoutMs(env, timeout);
  const deadline = now() + limit;
  try { excludeGraphify(root, { spawn, fsApi }); } catch { /* local Git hygiene is observational */ }

  const command = executable || env.FORGE_GRAPHIFY_EXECUTABLE || 'graphify';
  const version = runBeforeDeadline({
    spawn, command, args: ['--version'], cwd: root, env, cleanup,
  }, deadline, now);
  if (version.kind === 'unavailable') return fallback('unavailable', 'Graphify executable is unavailable');
  if (version.kind === 'timeout') return fallback('timeout', 'Graphify executable check timed out');
  if (version.kind !== 'ok') return fallback('failed', version.reason || 'Graphify executable check failed');

  let indexed;
  try { indexed = fsApi.existsSync(graph); } catch { indexed = false; }
  const preparationArgs = indexed
    ? ['update', root, '--no-cluster']
    : ['extract', root, '--code-only', '--no-cluster', '--out', root];
  const preparation = runBeforeDeadline({
    spawn, command, args: preparationArgs, cwd: root, env, cleanup,
  }, deadline, now);
  if (preparation.kind === 'unavailable') return fallback('unavailable', 'Graphify disappeared before index preparation');
  if (preparation.kind === 'timeout') return fallback('timeout', 'Graphify index preparation timed out');
  if (preparation.kind !== 'ok') return fallback('failed', preparation.reason || 'Graphify index preparation failed');
  if (!validGraph(fsApi, graph)) return fallback('failed', 'Graphify index is missing or invalid after preparation');

  const query = runBeforeDeadline({
    spawn,
    command,
    args: ['query', String(task || 'Forge task'), '--graph', graph, '--budget', String(queryBudget)],
    cwd: root,
    env,
    cleanup,
  }, deadline, now);
  if (query.kind === 'unavailable') return fallback('unavailable', 'Graphify disappeared before querying');
  if (query.kind === 'timeout') return fallback('timeout', 'Graphify query timed out');
  if (query.kind !== 'ok') return fallback('failed', query.reason || 'Graphify query failed');

  return {
    attempted: true,
    status: 'ready',
    fallback_reason: null,
    evidence: canonicalEvidence(query.result?.stdout),
    graph,
    preparation: indexed ? 'update' : 'extract',
  };
}
