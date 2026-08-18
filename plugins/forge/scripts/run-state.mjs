import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { replaceTelemetry, stripTelemetry, telemetryFromTrace } from './telemetry.mjs';

const RUNS_DIR = path.join('.forge', 'runs');
const RUN_METADATA = 'run.json';
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const MAX_RESUME_SUMMARY = 12_000;
const FAILED_STATUS = /^\s*status\s*:\s*(?:failed|incomplete|blocked)\s*$/im;
const COMPLETED_STATUS = /^\s*status\s*:\s*(?:completed|success|passed)\s*$/im;

function safeRunId(value) {
  return typeof value === 'string' && RUN_ID.test(value) ? value : null;
}

function summaryStatus(text) {
  const value = String(text || '');
  if (COMPLETED_STATUS.test(value)) return 'completed';
  if (FAILED_STATUS.test(value)) return 'failed';
  return null;
}

function boundedSummary(text) {
  const value = String(text || '');
  return value.length <= MAX_RESUME_SUMMARY
    ? value
    : `${value.slice(0, MAX_RESUME_SUMMARY)}\n[summary truncated by Forge]`;
}

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function localOffset(date) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function timeSnapshot(date = new Date()) {
  let timezone = 'local';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone; } catch { /* local is enough */ }
  const local = [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
    localOffset(date),
  ].join('');
  return { local, utc: date.toISOString(), timezone, offset: localOffset(date), epoch_ms: date.getTime() };
}

export function makeRunId(date = new Date()) {
  const stamp = [
    date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate()),
    pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds()),
  ].join('');
  return `${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function pathsFor(repo, runId) {
  const directory = path.resolve(repo, RUNS_DIR, runId);
  return {
    directory,
    metadata: path.join(directory, RUN_METADATA),
    summary: path.join(directory, 'summary.md'),
  };
}

function relative(repo, file) {
  return path.relative(path.resolve(repo), file).replaceAll('\\', '/');
}

function persistRunState(repo, state) {
  const paths = pathsFor(repo, state.run_id);
  try {
    fs.mkdirSync(paths.directory, { recursive: true });
    const metadata = { ...state, persistent: true };
    delete metadata.resume_summary;
    fs.writeFileSync(paths.metadata, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function readRunState(repo, runId) {
  const safe = safeRunId(runId);
  if (!safe) return null;
  try {
    return JSON.parse(fs.readFileSync(pathsFor(repo, safe).metadata, 'utf8'));
  } catch {
    return null;
  }
}

function readSummary(repo, runId) {
  const safe = safeRunId(runId);
  if (!safe) return null;
  const file = pathsFor(repo, safe).summary;
  try {
    const content = fs.readFileSync(file, 'utf8');
    const stat = fs.statSync(file);
    return {
      run_id: safe,
      directory: relative(repo, path.dirname(file)),
      summary: relative(repo, file),
      status: summaryStatus(content),
      content,
      mtime_ms: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

function summaries(repo) {
  const root = path.resolve(repo, RUNS_DIR);
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => entry.isDirectory() && safeRunId(entry.name))
    .map((entry) => readSummary(repo, entry.name))
    .filter(Boolean)
    .sort((left, right) => right.mtime_ms - left.mtime_ms);
}

function latestFailedSummary(repo, requestedRunId = null) {
  const requested = safeRunId(requestedRunId) ? readSummary(repo, requestedRunId) : null;
  if (requested?.status === 'failed') return requested;
  return summaries(repo).find((entry) => entry.status === 'failed') || null;
}

function stateFor({
  repo,
  task,
  activation = 'explicit_marker',
  autoApproved = false,
  runId = null,
  resumed = false,
  resumeSummary = '',
  sessionId = null,
  transcriptPath = null,
  host = null,
  model = null,
}) {
  const id = safeRunId(runId) || makeRunId();
  const paths = pathsFor(repo, id);
  const state = {
    run_id: id,
    task: String(task || ''),
    activation,
    directory: relative(repo, paths.directory),
    summary: relative(repo, paths.summary),
    status: resumed ? 'resuming' : autoApproved ? 'approved' : 'awaiting_approval',
    approval_required: true,
    resumed,
    resume_supported: true,
    ...(resumed ? { resume_summary: boundedSummary(resumeSummary) } : {}),
  };
  const persistedState = {
    ...state,
    started_at: timeSnapshot().utc,
    started_epoch_ms: Date.now(),
    ...(sessionId ? { session_id: String(sessionId) } : {}),
    ...(transcriptPath ? { transcript_path: path.resolve(String(transcriptPath)) } : {}),
    ...(host ? { host: String(host) } : {}),
    ...(model ? { model: String(model) } : {}),
  };
  const persistent = persistRunState(repo, persistedState);
  return { ...state, persistent };
}

export function createRun(args = {}) {
  return stateFor(args);
}

export function ensureRun(repoOrOptions, task, activation = 'explicit_marker', options = {}) {
  const objectForm = repoOrOptions && typeof repoOrOptions === 'object' && !Array.isArray(repoOrOptions);
  const args = objectForm
    ? { ...repoOrOptions }
    : { repo: repoOrOptions, task, activation, ...options };
  if (/^resume(?:\s+|$)/i.test(String(args.task || '').trim())) return resumeRun(args.repo, args.runId, args);
  return createRun(args);
}

export function approveSessionRun({
  repo,
  sessionId,
  task,
  transcriptPath = null,
  host = null,
  model = null,
} = {}) {
  const session = sessionId ? String(sessionId) : null;
  const pending = session
    ? listRuns(repo)
      .filter((entry) => entry.session_id === session && entry.status === 'awaiting_approval')
      .sort((left, right) => Number(right.started_epoch_ms || 0) - Number(left.started_epoch_ms || 0))[0]
    : null;
  if (!pending) {
    return stateFor({
      repo,
      task,
      activation: 'plan_approval',
      autoApproved: true,
      sessionId: session,
      transcriptPath,
      host,
      model,
    });
  }
  const approved = {
    ...pending,
    task: String(pending.task || task || ''),
    status: 'approved',
    approved_at: timeSnapshot().utc,
    approved_epoch_ms: Date.now(),
    ...(transcriptPath ? { transcript_path: path.resolve(String(transcriptPath)) } : {}),
    ...(host ? { host: String(host) } : {}),
    ...(model ? { model: String(model) } : {}),
  };
  const persistent = persistRunState(repo, approved);
  return { ...approved, persistent };
}

export function resumeRun(repo, requestedRunId = null, options = {}) {
  const previous = latestFailedSummary(repo, requestedRunId);
  if (!previous) return null;
  return stateFor({
    repo,
    task: 'resume',
    activation: 'resume',
    runId: previous.run_id,
    resumed: true,
    resumeSummary: previous.content,
    sessionId: options.sessionId || null,
    transcriptPath: options.transcriptPath || null,
    host: options.host || null,
    model: options.model || null,
  });
}

export function listRuns(repo) {
  const root = path.resolve(repo, RUNS_DIR);
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => entry.isDirectory() && safeRunId(entry.name))
    .map((entry) => {
      const state = readRunState(repo, entry.name);
      const summary = readSummary(repo, entry.name);
      if (state) return summary?.status ? { ...state, status: summary.status } : state;
      if (!summary) return null;
      const { content, mtime_ms, ...entryState } = summary;
      return entryState;
    })
    .filter(Boolean);
}

export function latestIncompleteRun(repo) {
  const entry = summaries(repo).find((candidate) => candidate.status === 'failed');
  if (!entry) return null;
  const { content, mtime_ms, ...state } = entry;
  return state;
}

export function firstIncompleteTask() {
  return null;
}

// Kept as an explicit no-op: Forge does not maintain a progress store.
export function recordRunObservation() {
  return null;
}

// The model owns the handoff text. Host measurements are never accepted from
// the model-authored telemetry block; SessionEnd writes that block later from
// the host transcript when one is available.
export function writeRunSummary({ repo, runId, summary } = {}) {
  const safe = safeRunId(runId);
  const text = stripTelemetry(summary);
  if (!safe || !text.trim()) return false;
  try {
    const file = pathsFor(repo, safe).summary;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function enrichRunSummary({ repo, runId, trace, traceFile = null, telemetry = null, state = null } = {}) {
  const safe = safeRunId(runId);
  if (!safe) return { enriched: false, reason: 'invalid-run-id' };
  try {
    const paths = pathsFor(repo, safe);
    const current = fs.readFileSync(paths.summary, 'utf8');
    const observed = telemetry && typeof telemetry === 'object' && Object.keys(telemetry).length
      ? telemetry
      : telemetryFromTrace(trace, {
        state: state || readRunState(repo, safe) || {},
        source: traceFile ? `host trace: ${traceFile}` : 'host trace',
      });
    if (!observed) return { enriched: false, reason: 'trace-unavailable' };
    const enriched = replaceTelemetry(current, observed);
    if (enriched !== current) fs.writeFileSync(paths.summary, enriched, 'utf8');
    const metadata = readRunState(repo, safe);
    if (metadata) {
      persistRunState(repo, {
        ...metadata,
        telemetry_enriched: true,
        telemetry_source: observed.source || (traceFile ? `host trace: ${traceFile}` : 'host trace'),
        ...(traceFile ? { transcript_path: path.resolve(String(traceFile)) } : {}),
        telemetry_finished_at: timeSnapshot().utc,
      });
    }
    return { enriched: true, reason: enriched === current ? 'already-enriched' : 'telemetry-copied' };
  } catch {
    return { enriched: false, reason: 'enrichment-failed' };
  }
}
