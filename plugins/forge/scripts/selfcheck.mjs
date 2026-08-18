#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { handle } from './hook.mjs';
import { handle as handleSessionEnd } from './session-end.mjs';
import { prepareGraphify } from './graphify.mjs';
import { installClient, resolveInstall } from './install-client.mjs';
import {
  inspectCodexPluginHooks,
  inspectManagedBundle,
  pruneCodexInstallation,
  renderCodexRequirements,
  stageManagedBundle,
} from './host-manager.mjs';
import { PRIVATE_SKILL_CATALOG } from '../worker-skills/catalog.mjs';
import { ensureRun, writeRunSummary } from './run-state.mjs';
import { estimateCost, formatTelemetry, telemetryFromTrace } from './telemetry.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-plugin-'));
const missingGraphify = path.join(tmp, 'missing-graphify');
const previousGraphifyExecutable = process.env.FORGE_GRAPHIFY_EXECUTABLE;
process.env.FORGE_GRAPHIFY_EXECUTABLE = missingGraphify;
const skill = fs.readFileSync(new URL('../skills/forge/SKILL.md', import.meta.url), 'utf8');
const commitSkill = fs.readFileSync(new URL('../skills/forge-commit/SKILL.md', import.meta.url), 'utf8');
const commitInterface = fs.readFileSync(new URL('../skills/forge-commit/agents/openai.yaml', import.meta.url), 'utf8');
const publicSkillRoot = new URL('../skills/', import.meta.url);
const privateSkillRoot = new URL('../worker-skills/', import.meta.url);
const specialistSkills = [
  'agent-design', 'angular', 'dotnet', 'error-contracts', 'fastapi', 'html-css',
  'java', 'javascript', 'langchain', 'langgraph', 'llm-apps', 'llm-evals',
  'mcp', 'nextjs', 'node', 'postgres', 'python', 'rag', 'react', 'typescript',
];
assert.deepEqual(PRIVATE_SKILL_CATALOG.map(({ name }) => name), specialistSkills);
assert.ok(PRIVATE_SKILL_CATALOG.every(({ name, description }) => name && description));
for (const name of specialistSkills) {
  const skillUrl = new URL(`../worker-skills/${name}/SKILL.md`, import.meta.url);
  assert.equal(fs.existsSync(skillUrl), true, `missing packaged skill: ${name}`);
  const body = fs.readFileSync(skillUrl, 'utf8');
  assert.match(body, new RegExp(`^---\\s+name: ${name}\\s+description:`));
}
assert.deepEqual(
  fs.readdirSync(publicSkillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(),
  ['forge', 'forge-commit'],
);
assert.deepEqual(
  fs.readdirSync(privateSkillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(),
  specialistSkills.slice().sort(),
);
const portableManifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'));
const codexManifest = JSON.parse(fs.readFileSync(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8'));
const claudeManifest = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
const claudeMarketplaceUrl = new URL('../../../.claude-plugin/marketplace.json', import.meta.url);
const claudeMarketplace = fs.existsSync(claudeMarketplaceUrl)
  ? JSON.parse(fs.readFileSync(claudeMarketplaceUrl, 'utf8'))
  : null;
assert.equal(portableManifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
assert.equal(portableManifest.name, 'forge');
assert.match(portableManifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(codexManifest.name, portableManifest.name);
assert.equal(codexManifest.version.split('+')[0], portableManifest.version);
assert.equal(codexManifest.skills, './skills/');
assert.equal(codexManifest.hooks, './hooks/hooks.json');
assert.equal(claudeManifest.name, portableManifest.name);
assert.equal(claudeManifest.version, portableManifest.version);
assert.equal(claudeManifest.skills, './skills/');
assert.equal(claudeManifest.hooks, './claude/hooks.json');
if (claudeMarketplace) {
  assert.equal(claudeMarketplace.name, 'forge');
  assert.equal(claudeMarketplace.plugins[0].source, './plugins/forge');
  assert.equal(claudeMarketplace.plugins[0].version, portableManifest.version);
}

function codexHookRunner(hooks) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  let input = '';
  child.stdin.on('data', (chunk) => {
    input += chunk;
    let newline;
    while ((newline = input.indexOf('\n')) !== -1) {
      const line = input.slice(0, newline).trim();
      input = input.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id === 1) child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
      if (message.id === 2) {
        child.stdout.write(`${JSON.stringify({
          id: 2,
          result: { data: [{ cwd: tmp, hooks, warnings: [], errors: [] }] },
        })}\n`);
      }
    }
  });
  return child;
}

const automaticCodexHooks = await inspectCodexPluginHooks({
  cwd: tmp,
  pluginId: 'forge@forge',
  runner: () => codexHookRunner([
    {
      key: 'forge@forge:hooks/hooks.json:user_prompt_submit:0:0',
      eventName: 'userPromptSubmit',
      enabled: true,
      trustStatus: 'trusted',
      currentHash: 'sha256:test',
      sourcePath: 'hooks/hooks.json',
      pluginId: 'forge@forge',
    },
  ]),
});
assert.equal(automaticCodexHooks.automatic, true);
assert.equal(automaticCodexHooks.hooks[0].enabled, true);
assert.equal(automaticCodexHooks.hooks[0].trust, 'trusted');
assert.match(commitSkill, /^---\s+name: forge-commit\s+description:/);
assert.match(commitSkill, /Generic agents and Codex use only the nearest applicable `AGENTS\.md`/);
assert.match(commitSkill, /Claude Code uses only the nearest applicable `CLAUDE\.md`/);
assert.match(commitSkill, /FORGE_PROJECT_CONTEXT/);
assert.match(commitSkill, /stage only\s+those files or hunks/i);
assert.match(commitSkill, /By default, whenever this skill creates or edits[\s\S]*every prose section it authors or rewrites in that\s+file must be in\s+English only/);
assert.match(commitSkill, /If the user explicitly requests another language[\s\S]*follow that request/);
assert.match(commitSkill, /authored or rewritten prose section in `AGENTS\.md`[\s\S]*`CLAUDE\.md` in English only/);
assert.match(commitSkill, /authored or rewritten prose section in the\s+canonical `README\.md` in English only/);
assert.match(commitSkill, /Write project context as durable guidance for a future agent/);
assert.match(commitSkill, /Do not list specialist skill\s+names/);
assert.match(commitSkill, /Check the canonical `README\.md` before staging, every time/);
assert.match(commitSkill, /If the README is stale for any of those changes, update it before staging/);
assert.match(commitSkill, /preserve unrelated user edits/);
assert.match(commitSkill, /brief, descriptive English subject/);
assert.match(commitInterface, /display_name: "Forge Commit"/);
assert.match(commitInterface, /review README/);
assert.match(commitInterface, /default_prompt: .*commit/);
assert.doesNotMatch(commitInterface, /allow_implicit_invocation:\s*false/);
assert.doesNotMatch(skill, /## Commit context/);
assert.match(skill, /public `forge-commit` skill/);
assert.deepEqual(handle({ prompt: 'ordinary prompt', cwd: tmp }), {});
assert.equal(fs.existsSync(path.join(tmp, '.forge')), false);

const continuationTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-continuation-'));
const continuationSession = 'session-continuation';
const continuationTrace = path.join(continuationTmp, `rollout-${continuationSession}.jsonl`);
const traceMessage = (role, text) => JSON.stringify({
  type: 'response_item',
  payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] },
});
fs.writeFileSync(continuationTrace, [
  traceMessage('user', 'fix the streaming failure'),
  traceMessage('assistant', '## Forge plan\n\n1. Fix it.\n\nApprove this plan?'),
  traceMessage('user', 'si'),
].join('\n'), 'utf8');
const continued = handle({
  prompt: 'si',
  cwd: continuationTmp,
  session_id: continuationSession,
  transcript_path: continuationTrace,
}, { graphify: { attempted: false, status: 'unavailable', fallback_reason: 'test' } });
const continuedContext = continued.hookSpecificOutput.additionalContext;
const continuedFacts = JSON.parse(continuedContext.split('FORGE_FACTS\n')[1]);
assert.equal(continuedFacts.activation, 'plan_approval');
assert.equal(continuedFacts.approval_confirmed, true);
assert.equal(continuedFacts.run_state.status, 'approved');
assert.equal(continuedFacts.task, 'fix the streaming failure');
assert.match(continuedContext, /approved the plan in this turn/);

const manualRecovery = spawnSync(process.execPath, [
  fileURLToPath(new URL('./hook.mjs', import.meta.url)),
  '--manual-approved',
  '--cwd',
  continuationTmp,
], { encoding: 'utf8', env: process.env, windowsHide: true });
assert.equal(manualRecovery.status, 0, manualRecovery.stderr);
const manualOutput = JSON.parse(manualRecovery.stdout);
const manualContext = manualOutput.hookSpecificOutput.additionalContext;
const manualFacts = JSON.parse(manualContext.split('FORGE_FACTS\n')[1]);
assert.equal(manualFacts.activation, 'manual_context_recovery');
assert.equal(manualFacts.approval_confirmed, true);
assert.equal(manualFacts.run_state.status, 'approved');
assert.match(manualContext, /FORGE_PROJECT_CONTEXT/);
assert.match(manualContext, /FORGE_SKILL_DISCOVERY/);

const explicitSession = 'session-explicit-continuation';
const explicitTrace = path.join(continuationTmp, `rollout-${explicitSession}.jsonl`);
const explicitActivation = handle({
  prompt: '$forge fix explicit activation',
  cwd: continuationTmp,
  session_id: explicitSession,
  transcript_path: explicitTrace,
}, { graphify: { attempted: false, status: 'unavailable', fallback_reason: 'test' } });
const explicitFacts = JSON.parse(explicitActivation.hookSpecificOutput.additionalContext.split('FORGE_FACTS\n')[1]);
fs.writeFileSync(explicitTrace, [
  traceMessage('user', '$forge fix explicit activation'),
  traceMessage('assistant', '# Forge plan\n\n1. Fix it.\n\nApprove this plan?'),
  traceMessage('user', 'yes'),
].join('\n'), 'utf8');
const explicitContinued = handle({
  prompt: 'yes',
  cwd: continuationTmp,
  session_id: explicitSession,
  transcript_path: explicitTrace,
}, { graphify: { attempted: false, status: 'unavailable', fallback_reason: 'test' } });
const explicitContinuedFacts = JSON.parse(explicitContinued.hookSpecificOutput.additionalContext.split('FORGE_FACTS\n')[1]);
assert.equal(explicitContinuedFacts.run_state.run_id, explicitFacts.run_state.run_id);
assert.equal(explicitContinuedFacts.run_state.status, 'approved');
assert.deepEqual(handle({
  prompt: 'si',
  cwd: continuationTmp,
  session_id: 'unrelated-session',
  transcript_path: continuationTrace,
}), {});

const active = handle({ prompt: '$forge verify this tiny fixture', cwd: tmp });
const context = active.hookSpecificOutput.additionalContext;
assert.equal(active.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
assert.match(context, /FORGE_PLUGIN_CONTEXT/);
assert.match(context, new RegExp(`"forge_plugin":"${portableManifest.version.replaceAll('.', '\\.')}`));
assert.match(context, /selected `forge` skill is the public workflow source/);
assert.match(context, /FORGE_PROJECT_CONTEXT/);
assert.match(context, /This codex session uses only AGENTS\.md/);
assert.match(context, /FORGE_SKILL_DISCOVERY/);
assert.match(context, /FORGE_PRIVATE_SKILL_CATALOG/);
assert.match(context, /PRIVATE_SKILL_CATALOG_AVAILABLE: true/);
assert.match(context, /PRIVATE_SKILL_CATALOG_COUNT: 20/);
assert.match(context, /PRIVATE_SKILL_CATALOG_SHA256: [0-9a-f]{64}/);
assert.match(context, /- python: /);
assert.match(context, /PRIVATE_SKILL_ROOT:/);
assert.match(context, /llm_plan_execution/);
assert.doesNotMatch(context, /FORGE_INTERNAL_SKILLS/);
assert.doesNotMatch(context, /BEGIN PRIVATE SPECIALIST SKILL/);
assert.doesNotMatch(context, /CLAUDE\.md/);
assert.match(context, /FORGE_FACTS/);
assert.match(context, /"host_sessions":1/);
assert.match(context, /"model_judges":0/);
assert.match(context, /"summary":"\.forge\/runs\/[^\"]+\/summary\.md"/);
assert.doesNotMatch(context, /"finalizer"/);
assert.match(context, /"persistent":true/);
assert.match(context, /"approval_required":true/);
const activeFacts = JSON.parse(context.split('FORGE_FACTS\n')[1]);
assert.equal(activeFacts.skill_catalog.available, true);
assert.equal(activeFacts.skill_catalog.count, PRIVATE_SKILL_CATALOG.length);
assert.match(activeFacts.skill_catalog.sha256, /^[0-9a-f]{64}$/);
assert.equal(activeFacts.skill_catalog.source, 'bundled_metadata');
assert.doesNotMatch(context, /normal assistant message headed `Forge plan`/);
assert.doesNotMatch(context, /\n# Forge\n/);
assert.match(skill, /normal message headed `Forge plan`/);
assert.match(skill, /explicit approval in a later user turn/);
assert.match(skill, /original task request is never\s+plan approval/);
assert.match(skill, /Do not edit, verify, review, commit, or otherwise execute/);
assert.doesNotMatch(skill, /unless the request already authorizes the change/);
assert.match(skill, /injected\s+failed\s+summary/);
assert.match(skill, /status: failed/);
assert.match(skill, /write exactly\s+one concise summary/);
assert.match(skill, /private specialist skills/);
assert.match(skill, /write exactly\s+one concise summary directly/);
assert.doesNotMatch(skill, /run_state\.finalizer/);
assert.match(skill, /## Telemetry/);
assert.match(skill, /two distinct outputs[\s\S]*normal user-facing answer/);
assert.match(skill, /answer the user normally[\s\S]*conclusions/);
assert.match(skill, /Do not paste the `# Forge summary` document/);
assert.match(skill, /Summary: \[open the Forge run summary\]/);
assert.match(skill, /host owns that section/);
assert.match(skill, /do not deliver, quote, or open the[\s\S]*context file again/i);
assert.match(skill, /Mention selected\s+specialists/);
assert.match(skill, /mandatory execution[\s\S]*AGENTS\.md/);
assert.match(skill, /do not\s+open, read, or load any[\s\S]*?private `SKILL\.md` body while\s+selecting/i);
assert.match(skill, /After the names are selected, read and apply only those selected private/);
assert.match(skill, /hook_context_unavailable/);
assert.match(skill, /catalog_delivery_incomplete/);
assert.match(skill, /not process\s+environment variables/i);
assert.match(skill, /SessionEnd/);
assert.equal(fs.existsSync(path.join(tmp, '.forge')), true);
assert.equal(fs.existsSync(path.join(tmp, '.forge', 'runs')), true);
assert.equal(fs.existsSync(path.join(tmp, '.forge', 'runs', JSON.parse(context.split('FORGE_FACTS\n')[1]).run_state.run_id, 'run.json')), true);
assert.equal(fs.existsSync(path.join(tmp, '.gitignore')), false);

const genericContextTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-context-generic-'));
fs.writeFileSync(path.join(genericContextTmp, 'AGENTS.md'), '# Application context\nCONTEXT_ONCE_AGENTS\n', 'utf8');
fs.writeFileSync(path.join(genericContextTmp, 'CLAUDE.md'), 'CONTEXT_MUST_NOT_BE_READ_BY_GENERIC\n', 'utf8');
const genericContext = handle({
  prompt: '$forge reuse the supplied context',
  cwd: genericContextTmp,
  host: 'generic',
}, {
  graphify: { attempted: true, status: 'ready', fallback_reason: null, evidence: 'context fixture' },
}).hookSpecificOutput.additionalContext;
assert.match(genericContext, /"host":"generic"/);
assert.match(genericContext, /This generic session uses only AGENTS\.md/);
assert.match(genericContext, /CONTEXT_ONCE_AGENTS/);
assert.equal((genericContext.match(/CONTEXT_ONCE_AGENTS/g) || []).length, 1);
assert.doesNotMatch(genericContext, /CONTEXT_MUST_NOT_BE_READ_BY_GENERIC/);
assert.doesNotMatch(genericContext, /CLAUDE\.md/);

const claudeContextTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-context-claude-'));
fs.writeFileSync(path.join(claudeContextTmp, 'CLAUDE.md'), '# Application context\nCONTEXT_ONCE_CLAUDE\n', 'utf8');
fs.writeFileSync(path.join(claudeContextTmp, 'AGENTS.md'), 'CONTEXT_MUST_NOT_BE_READ_BY_CLAUDE\n', 'utf8');
const claudeContext = handle({
  prompt: '$forge reuse the Claude context',
  cwd: claudeContextTmp,
  host: 'claude',
}, {
  graphify: { attempted: true, status: 'ready', fallback_reason: null, evidence: 'context fixture' },
}).hookSpecificOutput.additionalContext;
assert.match(claudeContext, /"host":"claude"/);
assert.match(claudeContext, /This claude session uses only CLAUDE\.md/);
assert.match(claudeContext, /CONTEXT_ONCE_CLAUDE/);
assert.equal((claudeContext.match(/CONTEXT_ONCE_CLAUDE/g) || []).length, 1);
assert.doesNotMatch(claudeContext, /CONTEXT_MUST_NOT_BE_READ_BY_CLAUDE/);
assert.doesNotMatch(claudeContext, /AGENTS\.md/);

function fakeGraphify({ mode = 'ready', evidence = 'plugin graph evidence', writeGraph = true } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git') return { status: 1, stdout: '', stderr: '' };
    if (args[0] === '--version') {
      if (mode === 'unavailable') return { status: null, error: { code: 'ENOENT' } };
      return mode === 'timeout-version'
        ? { status: null, error: { code: 'ETIMEDOUT' } }
        : { status: 0, stdout: 'graphify 1.0.0', stderr: '' };
    }
    if (mode === 'timeout' && ['extract', 'update', 'query'].includes(args[0])) {
      return { status: null, error: { code: 'ETIMEDOUT' } };
    }
    if (args[0] === 'extract' || args[0] === 'update') {
      if (mode === 'error') return { status: 7, stdout: '', stderr: 'fixture error' };
      if (writeGraph) {
        fs.mkdirSync(path.join(tmp, 'graphify-out'), { recursive: true });
        if (mode === 'invalid') fs.writeFileSync(path.join(tmp, 'graphify-out', 'graph.json'), '{invalid');
        else fs.writeFileSync(path.join(tmp, 'graphify-out', 'graph.json'), JSON.stringify({ nodes: [], edges: [] }));
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'query') {
      if (mode === 'query-error') return { status: 9, stdout: '', stderr: 'query error' };
      return { status: 0, stdout: evidence, stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  return { calls, spawn };
}

const graphifyEnv = { ...process.env, FORGE_GRAPHIFY_EXECUTABLE: 'fake-graphify' };
fs.rmSync(path.join(tmp, 'graphify-out'), { recursive: true, force: true });
const readyFixture = fakeGraphify();
const ready = handle({ prompt: '$forge plugin graph evidence', cwd: tmp }, {
  env: graphifyEnv,
  spawn: readyFixture.spawn,
}).hookSpecificOutput.additionalContext;
assert.match(ready, /GRAPHIFY_STATUS\n\{"attempted":true,"status":"ready","fallback_reason":null\}/);
assert.match(ready, /GRAPHIFY_EVIDENCE\nplugin graph evidence/);
assert.ok(ready.indexOf('GRAPHIFY_EVIDENCE') < ready.indexOf('FORGE_PLUGIN_CONTEXT'));
assert.deepEqual(readyFixture.calls.map(({ args }) => args[0]), ['rev-parse', '--version', 'extract', 'query']);
assert.equal(readyFixture.calls[1].options.shell, false);
assert.ok(readyFixture.calls[1].options.timeout > 0 && readyFixture.calls[1].options.timeout <= 60_000);
assert.equal(readyFixture.calls[1].options.maxBuffer, 256 * 1024);

// One deadline covers version, preparation and query. A timeout also triggers
// best-effort cleanup for the Graphify process tree.
fs.rmSync(path.join(tmp, 'graphify-out'), { recursive: true, force: true });
const deadlineFixture = fakeGraphify();
const phaseTimeouts = [];
const cleanedPids = [];
let clock = 0;
const deadlineSpawn = (command, args, options) => {
  const result = deadlineFixture.spawn(command, args, options);
  if (command === 'git') return result;
  phaseTimeouts.push(options.timeout);
  if (args[0] === '--version') clock += 20_000;
  else if (args[0] === 'extract') clock += 30_000;
  else if (args[0] === 'query') return { status: null, error: { code: 'ETIMEDOUT' }, pid: 4242 };
  return result;
};
const deadlineResult = prepareGraphify(tmp, 'shared deadline', {
  env: graphifyEnv,
  spawn: deadlineSpawn,
  timeout: 60_000,
  now: () => clock,
  cleanup: (pid) => cleanedPids.push(pid),
});
assert.equal(deadlineResult.status, 'timeout');
assert.deepEqual(phaseTimeouts, [60_000, 40_000, 10_000]);
assert.deepEqual(cleanedPids, [4242]);

// Graphify keeps its own process output contract; the hook separately bounds
// the evidence that reaches the model context.
fs.rmSync(path.join(tmp, 'graphify-out'), { recursive: true, force: true });
const longEvidence = 'e'.repeat(12_000);
const unboundedEvidence = prepareGraphify(tmp, 'long evidence', {
  env: graphifyEnv,
  spawn: fakeGraphify({ evidence: longEvidence }).spawn,
});
assert.equal(unboundedEvidence.evidence, longEvidence);
const boundedContext = handle({ prompt: '$forge long context', cwd: tmp }, {
  graphify: { attempted: true, status: 'ready', fallback_reason: null, evidence: longEvidence },
}).hookSpecificOutput.additionalContext;
const evidenceStart = boundedContext.indexOf('GRAPHIFY_EVIDENCE\n') + 'GRAPHIFY_EVIDENCE\n'.length;
const evidenceEnd = boundedContext.indexOf('\n\nFORGE_PLUGIN_CONTEXT', evidenceStart);
const boundedEvidence = boundedContext.slice(evidenceStart, evidenceEnd);
assert.ok(Buffer.byteLength(boundedEvidence, 'utf8') <= 2_048);
assert.match(boundedEvidence, /Graphify evidence truncated by Forge/);

fs.rmSync(path.join(tmp, 'graphify-out'), { recursive: true, force: true });
const unavailable = prepareGraphify(tmp, 'missing executable', { env: graphifyEnv, spawn: fakeGraphify({ mode: 'unavailable' }).spawn });
assert.equal(unavailable.status, 'unavailable');
assert.equal(unavailable.attempted, true);

fs.rmSync(path.join(tmp, 'graphify-out'), { recursive: true, force: true });
const failed = prepareGraphify(tmp, 'failing graphify', { env: graphifyEnv, spawn: fakeGraphify({ mode: 'error' }).spawn });
assert.equal(failed.status, 'failed');
assert.match(failed.fallback_reason, /status 7/);

fs.rmSync(path.join(tmp, 'graphify-out'), { recursive: true, force: true });
const timedOut = prepareGraphify(tmp, 'hanging graphify', { env: graphifyEnv, spawn: fakeGraphify({ mode: 'timeout' }).spawn });
assert.equal(timedOut.status, 'timeout');

fs.rmSync(path.join(tmp, 'graphify-out'), { recursive: true, force: true });
const missingIndex = prepareGraphify(tmp, 'missing index', {
  env: graphifyEnv,
  spawn: fakeGraphify({ writeGraph: false }).spawn,
});
assert.equal(missingIndex.status, 'failed');
assert.match(missingIndex.fallback_reason, /missing or invalid/);

fs.mkdirSync(path.join(tmp, 'graphify-out'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'graphify-out', 'graph.json'), '{invalid');
const invalidIndex = prepareGraphify(tmp, 'invalid index', { env: graphifyEnv, spawn: fakeGraphify({ mode: 'invalid' }).spawn });
assert.equal(invalidIndex.status, 'failed');
assert.match(invalidIndex.fallback_reason, /missing or invalid/);

fs.rmSync(path.join(tmp, 'graphify-out'), { recursive: true, force: true });
const noResults = handle({ prompt: '$forge no graph results', cwd: tmp }, {
  env: graphifyEnv,
  spawn: fakeGraphify({ evidence: '' }).spawn,
}).hookSpecificOutput.additionalContext;
assert.match(noResults, /"status":"ready"/);
assert.match(noResults, /GRAPHIFY_EVIDENCE\n\(no results\)/);

fs.rmSync(path.join(tmp, 'graphify-out'), { recursive: true, force: true });
const hookUrl = new URL('./hook.mjs', import.meta.url).href;
const concurrentChild = `
  import fs from 'node:fs';
  import path from 'node:path';
  import { handle } from ${JSON.stringify(hookUrl)};
  const repo = process.argv[1];
  const task = process.argv[2];
  const fakeSpawn = (command, args) => {
    if (command === 'git') return { status: 1, stdout: '', stderr: '' };
    if (args[0] === '--version') return { status: 0, stdout: 'graphify fixture', stderr: '' };
    if (args[0] === 'extract' || args[0] === 'update') {
      fs.mkdirSync(path.join(repo, 'graphify-out'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'graphify-out', 'graph.json'), '{}');
      return { status: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'query') return { status: 0, stdout: task, stderr: '' };
    return { status: 1, stdout: '', stderr: '' };
  };
  const result = handle({ prompt: '$forge ' + task, cwd: repo }, {
    env: { ...process.env, FORGE_GRAPHIFY_EXECUTABLE: 'fake-graphify' },
    spawn: fakeSpawn,
  });
  process.stdout.write(JSON.stringify(result));
`;
function concurrentActivation(task) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', concurrentChild, tmp, task], {
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || `concurrent child exited ${code}`));
      else resolve(JSON.parse(stdout));
    });
  });
}
const concurrent = await Promise.all([
  concurrentActivation('concurrent one'),
  concurrentActivation('concurrent two'),
]);
assert.equal(concurrent.length, 2);
assert.ok(concurrent.every((result) => /GRAPHIFY_STATUS/.test(result.hookSpecificOutput.additionalContext)));
assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(tmp, 'graphify-out', 'graph.json'), 'utf8')));
fs.rmSync(path.join(tmp, 'graphify-out'), { recursive: true, force: true });

const attachment = handle({
  prompt: '[$forge:forge](C:\\Users\\test\\.codex\\plugins\\forge\\skills\\forge\\SKILL.md) implement attachment task',
  cwd: tmp,
}).hookSpecificOutput.additionalContext;
assert.match(attachment, /"activation":"plugin_attachment"/);
assert.match(attachment, /"task":"implement attachment task"/);

const claudeInvocation = handle({ prompt: '/forge:forge verify Claude support', cwd: tmp, host: 'claude_code' })
  .hookSpecificOutput.additionalContext;
assert.match(claudeInvocation, /"task":"verify Claude support"/);

const bare = handle({ prompt: '/forge', cwd: tmp }).hookSpecificOutput.additionalContext;
assert.match(bare, /"task":"Forge invocation"/);
assert.equal(fs.existsSync(path.join(tmp, '.forge')), true);

const resumed = handle({ prompt: '/forge resume', cwd: tmp }).hookSpecificOutput.additionalContext;
assert.match(resumed, /Forge found no failed summary; resume is unavailable/);
assert.equal(fs.existsSync(path.join(tmp, '.forge')), true);

const state = ensureRun(tmp, 'final summary test');
assert.equal(state.finalizer, undefined);
assert.equal(state.persistent, true);
assert.equal(fs.existsSync(path.join(tmp, state.directory, 'run.json')), true);
const failedSummary = [
  '# Forge summary',
  'status: failed',
  'resume: true',
  '',
  '## Completed work',
  'fixture changes',
  '',
  '## Failure',
  'failed_command: npm test',
  'error: fixture test failure',
  '',
  '## Next resume step',
  'next_step: rerun the failing test',
].join('\n');
const summaryPath = path.join(tmp, state.summary);
fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
fs.writeFileSync(summaryPath, failedSummary + '\n', 'utf8');
assert.deepEqual(
  fs.readdirSync(path.join(tmp, '.forge', 'runs', state.run_id)).sort(),
  ['run.json', 'summary.md'],
);
const resumedState = handle({ prompt: '/forge resume', cwd: tmp }).hookSpecificOutput.additionalContext;
assert.match(resumedState, /"resumed":true/);
assert.match(resumedState, /failed_command: npm test/);
const modelOwnedSummary = [
  '# Forge summary',
  'status: completed',
  'resume: false',
  '',
  '## Changes',
  'model-authored conclusions',
  '',
  '## Verification',
  'fixture passed',
  '',
  '## Review',
  'no defects found',
  '',
  '## Limitations',
  'none',
  '',
  '## Verdict',
  'complete',
].join('\n');
const modelOwnedInput = `${modelOwnedSummary}\n\n## Telemetry\n- fake host metrics from the model`;
assert.equal(writeRunSummary({ repo: tmp, runId: state.run_id, summary: modelOwnedInput }), true);
assert.equal(fs.readFileSync(summaryPath, 'utf8'), modelOwnedSummary);
const telemetry = {
  platform: 'codex_subscription',
  model: 'gpt-5.6-luna',
  reasoning_effort: 'max',
  usage: {
    input_tokens: 1_000_000,
    cached_input_tokens: 200_000,
    output_tokens: 100_000,
    reasoning_output_tokens: 40_000,
    total_tokens: 1_100_000,
  },
  duration_ms: 12_345,
  turns: 3,
  model_calls: 4,
  tools: { shell_command: 6, apply_patch: 2 },
  skills: ['forge', 'openai-docs'],
  activation: 'explicit_marker',
  graphify_status: 'ready',
};
assert.equal(fs.existsSync(path.join(tmp, state.summary)), true);
assert.equal(estimateCost({
  platform: 'openai_api',
  model: 'gpt-5.6-luna',
  usage: telemetry.usage,
}).estimated_usd, 0.284);
assert.equal(estimateCost({
  platform: 'anthropic_api',
  model: 'custom-model',
  usage: { input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 0 },
  pricing: { input: 3, output: 15, source: 'vendor rate card', as_of: '2026-08-01' },
}).estimated_usd, 3);
assert.match(formatTelemetry({ model: 'unknown-model' }), /Cost: unavailable \(pricing unavailable for this exact model\)/);
assert.match(formatTelemetry({ model: 'gpt-5.6', usage: telemetry.usage }), /Cost: unavailable \(pricing unavailable for this exact model\)/);
assert.match(formatTelemetry({ model: 'gpt-5.6-luna', usage: { input_tokens: 3, cached_input_tokens: 1, output_tokens: 2 } }), /total unavailable/);
assert.match(formatTelemetry({ model: 'gpt-5.6-luna', usage: { input_tokens: 3, output_tokens: 2 } }), /cached input usage unavailable/);
assert.match(formatTelemetry({}), /Skills used: forge x1/);
assert.match(formatTelemetry({ skills: ['forge'], internal_skills: ['node'] }), /Skills used: forge x1, node x1/);
assert.match(formatTelemetry({ skills: ['forge'], internal_skills: ['node'] }), /Internal specialist skills: node/);
assert.match(formatTelemetry({}), /Loaded skills: 1 \(forge\)/);

const sessionTrace = path.join(tmp, 'session-transcript.jsonl');
const sessionId = 'session-telemetry-fixture';
const sessionContext = handle({
  prompt: '$forge capture trace telemetry',
  cwd: tmp,
  session_id: sessionId,
  transcript_path: sessionTrace,
  model: 'gpt-5.6-luna',
}, {
  graphify: { attempted: true, status: 'ready', fallback_reason: null, evidence: 'trace fixture' },
}).hookSpecificOutput.additionalContext;
const sessionRunId = JSON.parse(sessionContext.split('FORGE_FACTS\n')[1]).run_state.run_id;
const sessionSummary = [
  '# Forge summary',
  'status: completed',
  'resume: false',
  '',
  '## Changes',
  'fixture changes',
  '',
  '## Verification',
  'fixture passed',
  '',
  '## Review',
  'no defects found',
  '',
  '## Limitations',
  'none',
  '',
  '## Verdict',
  'complete',
].join('\n');
assert.equal(writeRunSummary({ repo: tmp, runId: sessionRunId, summary: sessionSummary }), true);
assert.doesNotMatch(fs.readFileSync(path.join(tmp, '.forge', 'runs', sessionRunId, 'summary.md'), 'utf8'), /## Telemetry/);
fs.writeFileSync(sessionTrace, [
  JSON.stringify({
    timestamp: '2026-08-13T09:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'thread_settings_applied',
      thread_settings: { model: 'gpt-5.6-luna', reasoning_effort: 'max' },
    },
  }),
  JSON.stringify({
    timestamp: '2026-08-13T09:00:00.000Z',
    type: 'response_item',
    payload: {
      type: 'custom_tool_call',
      name: 'exec',
      input: 'const root = "C:\\\\plugin\\\\worker-skills"; const names = ["node", "rag"]; Get-Content `${root}\\\\${name}\\\\SKILL.md`',
    },
  }),
  JSON.stringify({
    timestamp: '2026-08-13T09:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 40,
          output_tokens: 20,
          reasoning_output_tokens: 5,
          total_tokens: 120,
        },
      },
    },
  }),
  JSON.stringify({ timestamp: '2026-08-13T09:00:02.000Z', type: 'event_msg', payload: { type: 'turn_completed' } }),
].join('\n') + '\n', 'utf8');
const parsedTraceTelemetry = telemetryFromTrace(fs.readFileSync(sessionTrace, 'utf8'), {
  state: { model: 'gpt-5.6-luna', host: 'codex' },
});
assert.equal(parsedTraceTelemetry.usage.total_tokens, 120);
assert.equal(parsedTraceTelemetry.token_count, 120);
assert.equal(parsedTraceTelemetry.duration_ms, 2_000);
assert.equal(parsedTraceTelemetry.model, 'gpt-5.6-luna');
assert.equal(parsedTraceTelemetry.reasoning_effort, 'max');
assert.deepEqual(parsedTraceTelemetry.tools, { exec: 1 });
assert.deepEqual(parsedTraceTelemetry.internal_skills, ['node', 'rag']);
const sessionEndResult = handleSessionEnd({ cwd: tmp, session_id: sessionId, transcript_path: sessionTrace });
assert.deepEqual(sessionEndResult, { processed: 1, enriched: 1 });
const enrichedSummary = fs.readFileSync(path.join(tmp, '.forge', 'runs', sessionRunId, 'summary.md'), 'utf8');
assert.match(enrichedSummary, /Token count: 120/);
assert.match(enrichedSummary, /input 100; cached 40; output 20/);
assert.match(enrichedSummary, /Latency: end-to-end 2000 ms/);
assert.match(enrichedSummary, /Credits: unavailable/);
assert.doesNotMatch(enrichedSummary, /Tokens: unavailable/);
assert.match(enrichedSummary, /Skills used: forge x1/);
assert.match(enrichedSummary, /Internal specialist skills: node/);
assert.match(enrichedSummary, /Tools: exec x1/);
assert.equal((enrichedSummary.match(/## Telemetry/g) || []).length, 1);
const replacedSummary = enrichedSummary.replace('Tools: exec x1', 'Tools: stale x99');
fs.writeFileSync(path.join(tmp, '.forge', 'runs', sessionRunId, 'summary.md'), replacedSummary, 'utf8');
assert.deepEqual(handleSessionEnd({ cwd: tmp, session_id: sessionId, transcript_path: sessionTrace }), { processed: 1, enriched: 1 });
assert.match(fs.readFileSync(path.join(tmp, '.forge', 'runs', sessionRunId, 'summary.md'), 'utf8'), /Tools: exec x1/);
const missingTraceResult = handleSessionEnd({ cwd: tmp, session_id: sessionId, transcript_path: path.join(tmp, 'missing.jsonl') });
assert.deepEqual(missingTraceResult, { processed: 1, enriched: 0 });

const manualSummary = [
  '# Forge summary',
  'status: completed',
  'resume: false',
  '',
  '## Changes',
  'manual recovery fixture',
  '',
  '## Verification',
  'passed',
  '',
  '## Review',
  'passed',
  '',
  '## Limitations',
  'none',
  '',
  '## Verdict',
  'passed',
].join('\n');
assert.equal(writeRunSummary({
  repo: continuationTmp,
  runId: manualFacts.run_state.run_id,
  summary: manualSummary,
}), true);
const manualSessionTrace = path.join(continuationTmp, 'manual-session-trace.jsonl');
fs.writeFileSync(manualSessionTrace, [
  JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', started_at: 100 } }),
  JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Summary: .forge/runs/${manualFacts.run_state.run_id}/summary.md` }] } }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 9, cached_input_tokens: 3, output_tokens: 2, reasoning_output_tokens: 1, total_tokens: 11 } } } }),
  JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', started_at: 100, completed_at: 102 } }),
].join('\n'), 'utf8');
const manualSessionEnd = handleSessionEnd({
  cwd: continuationTmp,
  session_id: 'host-session-unavailable-to-manual-recovery',
  transcript_path: manualSessionTrace,
});
assert.deepEqual(manualSessionEnd, { processed: 1, enriched: 1 });
assert.match(
  fs.readFileSync(path.join(continuationTmp, manualFacts.run_state.summary), 'utf8'),
  /## Telemetry/,
);

const pluginHooks = JSON.parse(fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8')).hooks;
assert.equal(pluginHooks.PreToolUse, undefined);
assert.equal(pluginHooks.SessionEnd.length, 1);
assert.match(pluginHooks.SessionEnd[0].hooks[0].command, /session-end\.mjs/);
const pluginMatcher = new RegExp(pluginHooks.UserPromptSubmit[0].matcher);
assert.equal(pluginMatcher.test('$forge task'), true);
assert.equal(pluginMatcher.test('/forge:forge task'), true);
assert.equal(pluginMatcher.test('[$forge:forge](skill-path) task'), true);
assert.equal(pluginMatcher.test('ordinary prompt'), true);
const claudeHooks = JSON.parse(fs.readFileSync(new URL('../claude/hooks.json', import.meta.url), 'utf8')).hooks;
assert.equal(claudeHooks.PreToolUse, undefined);
assert.match(claudeHooks.UserPromptSubmit[0].hooks[0].command, /CLAUDE_PLUGIN_ROOT/);
assert.match(claudeHooks.UserPromptSubmit[0].hooks[0].command, /claude-hook\.mjs/);

const clientHome = path.join(tmp, 'client-home');
const clientProject = path.join(tmp, 'client-project');
for (const client of ['claude', 'opencode', 'cursor', 'antigravity']) {
  const preview = resolveInstall(client, { home: clientHome });
  assert.equal(path.basename(preview.target), 'forge');
  const installed = installClient(client, { home: clientHome });
  assert.equal(installed.installed, true);
  assert.equal(fs.existsSync(path.join(installed.target, installed.kind === 'plugin' ? 'skills/forge/SKILL.md' : 'SKILL.md')), true);
  const installedCommit = installed.kind === 'plugin'
    ? path.join(installed.target, 'skills', 'forge-commit', 'SKILL.md')
    : path.join(path.dirname(installed.target), 'forge-commit', 'SKILL.md');
  assert.equal(fs.existsSync(installedCommit), true);
  if (client === 'cursor' && process.env.FORGE_INSTALLED_SELFCHECK !== '1') {
    const installedCheck = spawnSync(process.execPath, [path.join(installed.target, 'scripts/selfcheck.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, FORGE_INSTALLED_SELFCHECK: '1' },
    });
    assert.equal(installedCheck.status, 0, installedCheck.stderr);
    assert.match(installedCheck.stdout, /forge agent plugin selfcheck: ok/);
  }
  assert.throws(() => installClient(client, { home: clientHome }), /Target already exists/);
  assert.equal(installClient(client, { home: clientHome, force: true }).installed, true);

  const projectInstall = installClient(client, { scope: 'project', project: clientProject });
  assert.equal(projectInstall.installed, true);
  assert.equal(fs.existsSync(path.join(projectInstall.target, projectInstall.kind === 'plugin' ? 'skills/forge/SKILL.md' : 'SKILL.md')), true);
  const projectCommit = projectInstall.kind === 'plugin'
    ? path.join(projectInstall.target, 'skills', 'forge-commit', 'SKILL.md')
    : path.join(path.dirname(projectInstall.target), 'forge-commit', 'SKILL.md');
  assert.equal(fs.existsSync(projectCommit), true);
}
const dryRun = installClient('opencode', { home: path.join(tmp, 'dry-home'), dryRun: true });
assert.equal(dryRun.installed, false);
assert.equal(fs.existsSync(dryRun.target), false);

const managedHome = path.join(tmp, 'managed-home');
const managed = stageManagedBundle({ managedDir: managedHome });
assert.equal(fs.existsSync(managed.dispatcher), true);
assert.equal(fs.existsSync(managed.current_file), true);
assert.equal(fs.existsSync(path.join(managed.version_root, 'scripts', 'hook.mjs')), true);
assert.equal(fs.existsSync(path.join(managed.version_root, '.claude-plugin')), false);
assert.equal(fs.existsSync(path.join(managed.version_root, 'claude')), false);
assert.equal(fs.existsSync(path.join(managed.version_root, 'scripts', 'claude-hook.mjs')), false);
assert.deepEqual(inspectManagedBundle(managedHome), {
  mode: 'managed',
  managed_dir: path.resolve(managedHome),
  bundle_root: path.resolve(managed.bundle_root),
  current_file: path.resolve(managed.current_file),
  version: portableManifest.version,
  root: path.resolve(managed.version_root),
  root_exists: true,
  dispatcher_sha256: managed.dispatcher_sha256,
  integrity: true,
});
assert.equal(stageManagedBundle({ managedDir: managedHome }).version_root, managed.version_root);
const managedRequirements = renderCodexRequirements({
  managedDir: managed.bundle_root,
  managedOnly: true,
  platform: 'win32',
});
assert.match(managedRequirements, /allow_managed_hooks_only = true/);
assert.match(managedRequirements, /windows_managed_dir/);
assert.match(managedRequirements, /command_windows/);
assert.match(managedRequirements, /\[\[hooks\.UserPromptSubmit\]\]/);
const managedDispatcher = spawnSync(process.execPath, [managed.dispatcher], {
  cwd: tmp,
  input: JSON.stringify({ prompt: 'ordinary prompt', cwd: tmp, hook_event_name: 'UserPromptSubmit' }),
  encoding: 'utf8',
  env: process.env,
  windowsHide: true,
});
assert.equal(managedDispatcher.status, 0, managedDispatcher.stderr);
assert.deepEqual(JSON.parse(managedDispatcher.stdout), {});

const codexInstallFixture = path.join(tmp, 'codex-install-fixture');
fs.mkdirSync(path.join(codexInstallFixture, '.codex-plugin'), { recursive: true });
fs.mkdirSync(path.join(codexInstallFixture, '.claude-plugin'), { recursive: true });
fs.mkdirSync(path.join(codexInstallFixture, 'claude'), { recursive: true });
fs.mkdirSync(path.join(codexInstallFixture, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(codexInstallFixture, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'forge' }), 'utf8');
fs.writeFileSync(path.join(codexInstallFixture, '.claude-plugin', 'plugin.json'), '{}', 'utf8');
fs.writeFileSync(path.join(codexInstallFixture, 'claude', 'hooks.json'), '{}', 'utf8');
fs.writeFileSync(path.join(codexInstallFixture, 'scripts', 'claude-hook.mjs'), '', 'utf8');
fs.writeFileSync(path.join(codexInstallFixture, 'scripts', 'hook.mjs'), '', 'utf8');
assert.deepEqual(pruneCodexInstallation(codexInstallFixture), [
  '.claude-plugin',
  'claude',
  'scripts/claude-hook.mjs',
]);
assert.equal(fs.existsSync(path.join(codexInstallFixture, '.claude-plugin')), false);
assert.equal(fs.existsSync(path.join(codexInstallFixture, 'claude')), false);
assert.equal(fs.existsSync(path.join(codexInstallFixture, 'scripts', 'claude-hook.mjs')), false);
assert.equal(fs.existsSync(path.join(codexInstallFixture, 'scripts', 'hook.mjs')), true);

if (previousGraphifyExecutable === undefined) delete process.env.FORGE_GRAPHIFY_EXECUTABLE;
else process.env.FORGE_GRAPHIFY_EXECUTABLE = previousGraphifyExecutable;
fs.rmSync(genericContextTmp, { recursive: true, force: true });
fs.rmSync(claudeContextTmp, { recursive: true, force: true });
fs.rmSync(continuationTmp, { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });
console.log('forge agent plugin selfcheck: ok');
