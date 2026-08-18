#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { approveSessionRun, ensureRun, timeSnapshot } from './run-state.mjs';
import { prepareGraphify } from './graphify.mjs';
import { PRIVATE_SKILL_CATALOG } from '../worker-skills/catalog.mjs';

const MARKER = /^(?:\$(?<dollar>forge)|\/(?:(?<slash>forge)|forge:(?<skill>forge)))(?:\s+(?<task>[\s\S]*))?$/i;
const PLUGIN_ATTACHMENT = /^\[\$forge:(?<skill>forge)\]\([^\r\n)]*\)\s*(?<task>[\s\S]*)$/i;
const MAX_GRAPHIFY_CONTEXT_BYTES = 2_048;
const MAX_TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;
const APPROVAL = /^(?:s[ií]|yes|approved|approve|adelante|ejecuta|ejecutar|execute|go ahead)(?:[,.!;:]?\s+(?:el\s+plan|the\s+plan|ahora|now|por\s+favor|please|todo))*[.!]?$/i;
const FORGE_PLAN = /^#{1,3}\s+Forge plan\s*$/im;

function boundUtf8(value, maxBytes) {
  const text = String(value || '').trim();
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const marker = '\n[Graphify evidence truncated by Forge]';
  const limit = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
  let end = Math.min(text.length, limit);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > limit) end -= 1;
  return text.slice(0, end).trimEnd() + marker;
}

function hostName(payload = {}) {
  const value = String(payload.host || process.env.FORGE_HOST || 'codex').toLowerCase();
  if (value.includes('claude')) return 'claude';
  if (value.includes('codex')) return 'codex';
  return 'generic';
}

function readProjectContext(repo, fileName) {
  let directory = path.resolve(repo);
  while (true) {
    const contextPath = path.join(directory, fileName);
    try {
      const body = fs.readFileSync(contextPath, 'utf8').trim();
      return { file: fileName, path: contextPath, present: true, body };
    } catch { /* Continue to the nearest applicable parent context. */ }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return { file: fileName, path: path.join(repo, fileName), present: false, body: '' };
}

function writeTelemetry(event) {
  const dataRoot = process.env.PLUGIN_DATA;
  try {
    const observed = timeSnapshot();
    const record = { at: observed.epoch_ms, at_local: observed.local, at_utc: observed.utc, ...event };
    if (dataRoot) {
      fs.mkdirSync(dataRoot, { recursive: true });
      fs.writeFileSync(path.join(dataRoot, 'last-event.json'), `${JSON.stringify(record, null, 2)}\n`);
    }
    const traceFile = process.env.FORGE_TELEMETRY_FILE;
    if (traceFile) {
      fs.mkdirSync(path.dirname(traceFile), { recursive: true });
      fs.appendFileSync(traceFile, `${JSON.stringify(record)}\n`);
    }
  } catch { /* Telemetry must never affect the host. */ }
}

function messageText(message) {
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .map((part) => part?.text || part?.input_text || part?.output_text || '')
    .join('')
    .trim();
}

function recentTranscriptMessages(payload = {}) {
  const sessionId = payload.session_id ? String(payload.session_id) : '';
  const transcriptPath = payload.transcript_path ? path.resolve(String(payload.transcript_path)) : '';
  if (!sessionId || !transcriptPath || !path.basename(transcriptPath).includes(sessionId)) return [];
  try {
    const stat = fs.statSync(transcriptPath);
    const start = Math.max(0, stat.size - MAX_TRANSCRIPT_TAIL_BYTES);
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    const file = fs.openSync(transcriptPath, 'r');
    try { fs.readSync(file, buffer, 0, length, start); } finally { fs.closeSync(file); }
    let body = buffer.toString('utf8');
    if (start > 0) body = body.slice(body.indexOf('\n') + 1);
    return body.split(/\r?\n/).flatMap((line) => {
      try {
        const record = JSON.parse(line);
        const message = record?.type === 'response_item' && record?.payload?.type === 'message'
          ? record.payload
          : null;
        const text = messageText(message);
        return message && text ? [{ role: message.role, text }] : [];
      } catch { return []; }
    });
  } catch { return []; }
}

function approvedPlanContinuation(payload, prompt) {
  if (!APPROVAL.test(prompt)) return null;
  const messages = recentTranscriptMessages(payload);
  let currentUser = messages.length;
  if (messages.at(-1)?.role === 'user' && messages.at(-1)?.text.trim() === prompt) currentUser -= 1;
  for (let index = currentUser - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    if (!FORGE_PLAN.test(message.text)) return null;
    for (let taskIndex = index - 1; taskIndex >= 0; taskIndex -= 1) {
      if (messages[taskIndex].role !== 'user') continue;
      const task = messages[taskIndex].text
        .replace(/^\[\$forge:forge\]\([^\r\n)]*\)\s*/i, '')
        .replace(/^(?:\$forge|\/forge(?::forge)?)(?:\s+|$)/i, '')
        .trim();
      return { task: task || 'Approved Forge plan' };
    }
    return { task: 'Approved Forge plan' };
  }
  return null;
}

export function handle(payload = {}, dependencies = {}) {
  const prompt = String(payload.prompt || payload.user_prompt || payload.message || payload.input || payload.text || '').trim();
  const marker = MARKER.exec(prompt);
  const attachment = PLUGIN_ATTACHMENT.exec(prompt);
  const manualApproval = payload.manual_approval === true;
  const continuation = manualApproval
    ? { task: String(payload.task || 'Approved Forge plan').trim() || 'Approved Forge plan' }
    : !marker && !attachment ? approvedPlanContinuation(payload, prompt) : null;
  if (!marker && !attachment && !continuation) return {};

  const repo = path.resolve(payload.cwd || process.cwd());
  const host = hostName(payload);
  const projectContextFile = host === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const privateSkillRoot = path.join(pluginRoot, 'worker-skills');
  const projectContext = readProjectContext(repo, projectContextFile);
  const skillName = 'forge';
  const activation = manualApproval ? 'manual_context_recovery' : continuation ? 'plan_approval' : attachment ? 'plugin_attachment' : 'explicit_marker';
  const approvalConfirmed = Boolean(continuation);
  const defaultTask = 'Forge invocation';
  const task = String(continuation?.task || (attachment || marker)?.groups?.task || defaultTask).trim() || defaultTask;
  let runState = null;
  let stateError = null;
  try {
    const runArgs = {
      repo,
      task,
      activation,
      sessionId: payload.session_id || null,
      transcriptPath: payload.transcript_path || null,
      host,
      model: payload.model || null,
    };
    runState = approvalConfirmed
      ? approveSessionRun(runArgs)
      : ensureRun({ ...runArgs, runId: process.env.FORGE_RUN_ID || null });
    if (!runState && /^resume(?:\s+|$)/i.test(task)) stateError = 'Forge found no failed summary; resume is unavailable';
  } catch (error) { stateError = error instanceof Error ? error.message : String(error); }
  let graphify = dependencies.graphify || null;
  if (!graphify) {
    try {
      graphify = prepareGraphify(repo, task, {
        ...(dependencies.env ? { env: dependencies.env } : {}),
        ...(dependencies.spawn ? { spawn: dependencies.spawn } : {}),
      });
    } catch {
      graphify = {
        attempted: true,
        status: 'failed',
        fallback_reason: 'Graphify hook execution failed safely',
        evidence: '',
      };
    }
  }
  const graphifyStatus = graphify?.attempted === true
    && ['ready', 'failed', 'unavailable', 'timeout'].includes(graphify.status)
    ? {
      attempted: true,
      status: graphify.status,
      fallback_reason: graphify.fallback_reason ?? null,
    }
    : {
      attempted: false,
      status: 'unavailable',
      fallback_reason: 'Graphify was not executed for this context',
    };
  const graphifyEvidence = graphifyStatus.status === 'ready'
    ? boundUtf8(String(graphify?.evidence || '').trim() || '(no results)', MAX_GRAPHIFY_CONTEXT_BYTES)
    : '(Graphify evidence unavailable; continue with native host tools.)';
  const skills = [skillName];
  const skillCatalog = PRIVATE_SKILL_CATALOG
    .map(({ name, description }) => `- ${name}: ${description}`)
    .join('\n');
  const skillCatalogStatus = {
    available: PRIVATE_SKILL_CATALOG.length > 0,
    count: PRIVATE_SKILL_CATALOG.length,
    sha256: crypto.createHash('sha256').update(skillCatalog, 'utf8').digest('hex'),
    source: 'bundled_metadata',
  };
  const skillDiscoveryContext = [
    `Host: ${host}.`,
    approvalConfirmed
      ? 'The user approved the Forge plan in this turn. Complete specialist discovery now, before the first source edit.'
      : 'Do not discover or load private specialist skills while preparing or validating the plan. Do that only after explicit approval in a later user turn, at the start of plan execution.',
    `The hook already supplied the applicable ${projectContextFile} in FORGE_PROJECT_CONTEXT. Reuse that block; do not open ${projectContextFile} again with a file or shell tool.`,
    'At execution start, use the contents of that application context to select every clearly necessary specialist from the metadata-only list below. Do not open, read, or load any private SKILL.md body while selecting; the list is sufficient for discovery.',
    'Do not enumerate or inspect private skill directories, do not register or expose the private catalogue as host skills, do not select unrelated entries, and do not invent names outside this list.',
    'FORGE_PRIVATE_SKILL_CATALOG',
    `PRIVATE_SKILL_CATALOG_AVAILABLE: ${skillCatalogStatus.available}`,
    `PRIVATE_SKILL_CATALOG_COUNT: ${skillCatalogStatus.count}`,
    `PRIVATE_SKILL_CATALOG_SHA256: ${skillCatalogStatus.sha256}`,
    skillCatalog,
    `After selection, read and apply only the selected SKILL.md bodies once from PRIVATE_SKILL_ROOT: ${privateSkillRoot}. Do not read bodies for unselected skills or reread a selected body.`,
    `The project context file describes the application and architecture; it must not be a list of skill names. If the supplied ${projectContextFile} block says the file is missing, continue discovery from the repository and create it during the requested commit step.`,
    'Record the selected skill names and short evidence in the Forge summary telemetry.',
  ].join('\n');
  const facts = {
    forge_plugin: '1.0.0',
    host,
    activation,
    task,
    graphify: graphifyStatus,
    run_state: runState,
    project_context_file: {
      file: projectContext.file,
      path: projectContext.path,
      present: projectContext.present,
    },
    skill_discovery: 'llm_plan_execution',
    skill_catalog: skillCatalogStatus,
    approval_required: true,
    approval_confirmed: approvalConfirmed,
    ...(stateError ? { state_error: stateError } : {}),
    constraints: {
      host_sessions: 1,
      model_judges: 0,
      reviews_max: 2,
      subagents_default: 0,
      sensitive_files: ['.env', 'appsettings.json']
    }
  };
  const graphifyContext = [
    'GRAPHIFY_STATUS',
    JSON.stringify(graphifyStatus),
    'GRAPHIFY_EVIDENCE',
    graphifyEvidence,
  ];
  const context = [
    ...graphifyContext,
    '',
    'FORGE_PLUGIN_CONTEXT',
    approvalConfirmed
      ? `Forge is active and the user approved the plan in this turn. The selected \`${skillName}\` skill is the public workflow source. Complete the execution gate and proceed with the approved plan.`
      : `Forge is active. The selected \`${skillName}\` skill is the public workflow source. The activation request is not plan approval: present the plan, stop, and wait for explicit confirmation in a later user turn before execution. Private specialist skills are discovered by Forge after that approval during plan execution from the project context and repository evidence.`,
    'Use FORGE_FACTS only for activation, constraints, run state, and ephemeral Graphify metadata.',
    '',
    'FORGE_PROJECT_CONTEXT',
    [
      `This ${host} session uses only ${projectContextFile}. The hook supplied this block once; reuse it and do not reread the file manually.`,
      `PROJECT_CONTEXT_PATH: ${projectContext.path}`,
      projectContext.present
        ? projectContext.body || `(The supplied ${projectContextFile} is empty.)`
        : `(No ${projectContextFile} exists at the supplied path. Inspect the repository as needed and create it during the requested commit step.)`,
    ].join('\n'),
    '',
    'FORGE_SKILL_DISCOVERY',
    skillDiscoveryContext,
    '',
    'FORGE_FACTS',
    JSON.stringify(facts)
  ].join('\n');
  const bytes = Buffer.byteLength(context, 'utf8');
  writeTelemetry({
    event: 'injected',
    bytes,
    sha256: crypto.createHash('sha256').update(context).digest('hex'),
    run_id: runState?.run_id || null,
    skills,
    skill_usage: Object.fromEntries(skills.map((skill) => [skill, 1])),
    project_context_file: projectContextFile,
    skill_discovery: 'llm_plan_execution',
    skill_catalog: skillCatalogStatus,
  });
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } };
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload = {};
  try { payload = JSON.parse(raw); } catch { /* Fail open on non-JSON input. */ }
  if (process.argv.includes('--manual-approved')) {
    const cwdIndex = process.argv.indexOf('--cwd');
    payload = {
      ...payload,
      manual_approval: true,
      cwd: cwdIndex >= 0 && process.argv[cwdIndex + 1] ? process.argv[cwdIndex + 1] : process.cwd(),
    };
  }
  process.stdout.write(JSON.stringify(handle(payload)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => process.stdout.write('{}'));
}
