#!/usr/bin/env node
// Forge v5 benchmark: three genuinely different scenarios (small / medium /
// large repository), two arms (solo / forge), one runner.
//
// It measures four things the old harness conflated:
//   1. quota: weighted token cost per host price card, and per-turn breakdown
//   2. context + cache: injected bytes, cache-read share, per-turn profile
//   3. activation: did the Forge hook actually run, when, and what it decided
//   4. routing correctness: injects on Forge tasks, stays silent on
//      trivial ones and on solo arms
//
// Without --confirm-subscription-usage it runs in dry mode: the hook is
// exercised directly (zero quota) and every activation/routing/bootstrap
// expectation is checked. Live mode adds the paid host sessions on top.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { traceStats, diffStats, phaseCheck } from './trace.mjs';
import { handle as forgeHook } from '../plugins/forge/scripts/hook.mjs';
import { estimateCost } from '../plugins/forge/scripts/telemetry.mjs';

const BENCH = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(BENCH, 'results');
const BASELINE_FILE = path.join(RESULTS, 'v5-codex-solo-baseline.json');
const CODEX_MODEL = 'gpt-5.6-luna';
const CODEX_EFFORT = 'max';
const JUDGE_MODEL = 'gpt-5.6-terra';
const JUDGE_EFFORT = 'medium';
const WEIGHTS = {
  codex: { input: 1, cache_write: 0, cache_read: 0.1, output: 6 },
  claude: { input: 1, cache_write: 1.25, cache_read: 0.1, output: 5 },
};
const FORGE_ARMS = new Set(['forge']);

const SCENARIOS = {
  small: {
    fixture: 'A',
    // Trivial task naming a file: Forge still runs (invoking $forge is the
    // user's decision) — this measures the control premium at its worst case.
    task: 'Add optional per-entry TTL support to the cache in src/cache.mjs. createCache must accept a now() clock option, and set(key, value, { ttlMs }) must expire entries after ttlMs. An expired entry must not be returned, must not count towards size, must never consume capacity, and must never be counted as an eviction. A ttlMs that is null or absent means the entry never expires. Existing behaviour must not change. Make node --test pass.',
    verify: { command: 'node', args: ['--test'], timeout_ms: 120_000 },
    expect: { injection: true, skills: ['forge'] },
  },
  medium: {
    fixture: 'B',
    // Exploratory: no file named, the model must locate pricing/invoice/order.
    task: 'Add an optional percentage discount to order pricing. Pricing an order with a discountPercent option must keep the subtotal unchanged, expose the discount in whole cents rounded half up, and subtract it from the total. The rendered invoice must report discount_cents alongside the existing fields. Make node --test pass.',
    verify: { command: 'node', args: ['--test'], timeout_ms: 300_000 },
    expect: { injection: true, skills: ['forge'] },
  },
  large: {
    generate: path.join(BENCH, 'fixtures', 'I-large', 'generate.mjs'),
    task: 'In this large repository, trace the report export policy through the module graph, make release:true reach report exports without changing ordinary exports, add the regression test, and run the project tests. Avoid editing generated modules.',
    // The generated repository exposes `test: node --test`; Forge correctly
    // detects and runs the package-level command, so phase checking must use
    // the command that is actually visible in the host trace.
    verify: { command: 'npm', args: ['test'], timeout_ms: 180_000 },
    expect: { injection: true },
  },
  'large-wide': {
    generate: path.join(BENCH, 'fixtures', 'J-large-wide', 'generate.mjs'),
    task: 'User story: as a compliance operations lead, I need to publish deterministic, redacted audit bundles from any of our generated customer integrations without leaking values or changing the existing internal-export defaults. Trace the request from a generated handler through the public report bundle and every adapter; make includeMetadata, format, sort, and redact propagate consistently to JSON, CSV, and summary output, preserve the caller records, and prove one generated handler behaves exactly like the public API. Add focused regression coverage, run the project tests, and do not edit generated modules.',
    verify: { command: 'npm', args: ['test'], timeout_ms: 180_000 },
    expect: { injection: true },
    persisted_baseline: false,
  },
};

function parseArgs(argv) {
  const options = {
    host: 'codex', runs: 1, scenarios: Object.keys(SCENARIOS), confirm: false,
    arm: 'both', baseline: false, judge: false,
    judgeModel: JUDGE_MODEL, judgeEffort: JUDGE_EFFORT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--host') options.host = argv[++i];
    else if (arg === '--runs') options.runs = Number(argv[++i]) || 1;
    else if (arg === '--scenario') options.scenarios = [argv[++i]];
    else if (arg === '--confirm-subscription-usage') options.confirm = true;
    else if (arg === '--baseline') { options.baseline = true; options.arm = 'solo'; }
    else if (arg === '--arm') options.arm = argv[++i];
    else if (arg === '--judge') options.judge = true;
    else if (arg === '--no-judge') options.judge = false;
    else if (arg === '--judge-model') options.judgeModel = argv[++i];
    else if (arg === '--judge-effort') options.judgeEffort = argv[++i];
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!['codex', 'claude'].includes(options.host)) throw new Error(`Unknown host: ${options.host}`);
  if (!['solo', 'both', ...FORGE_ARMS].includes(options.arm)) throw new Error(`Unknown arm: ${options.arm}`);
  if (options.arm === 'solo' && !options.baseline) {
    throw new Error('The solo arm is baseline-only; use --baseline for the one-time run.');
  }
  if (options.judge && options.host !== 'codex') throw new Error('The Terra judge is only configured for Codex benchmarks.');
  if (options.judge && options.arm !== 'both') throw new Error('--judge requires --arm both so each judgment has two paired arms.');
  if (options.judgeModel !== JUDGE_MODEL || options.judgeEffort !== JUDGE_EFFORT) {
    throw new Error(`The benchmark judge is pinned to ${JUDGE_MODEL} with ${JUDGE_EFFORT} effort.`);
  }
  if (options.baseline && options.runs !== 1) {
    throw new Error('--baseline runs exactly once per scenario; omit --runs or use --runs 1.');
  }
  for (const name of options.scenarios) if (!SCENARIOS[name]) throw new Error(`Unknown scenario: ${name}`);
  return options;
}

function materialize(name) {
  const scenario = SCENARIOS[name];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `forge5-${name}-`));
  if (scenario.generate) {
    const generated = spawnSync(process.execPath, [scenario.generate, dir], { encoding: 'utf8' });
    if (generated.status !== 0) throw new Error(`Fixture generation failed: ${generated.stderr}`);
  } else {
    fs.cpSync(path.join(BENCH, 'fixtures', scenario.fixture), dir, { recursive: true });
  }
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=bench@forge', '-c', 'user.name=forge-bench', 'commit', '-qm', 'fixture');
  return dir;
}

function fixtureTree(dir) {
  const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: dir, encoding: 'utf8' });
  if (tree.status !== 0) throw new Error(`Fixture tree lookup failed: ${tree.stderr || tree.error?.message || tree.status}`);
  return String(tree.stdout || '').trim();
}

function telemetryEvents(dir, fileName = '.forge-telemetry.jsonl') {
  try {
    return fs.readFileSync(path.join(dir, fileName), 'utf8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch { return []; }
}

function summaryCheck(dir, arm, expectCompleted) {
  if (arm === 'solo') return { known: false, pass: null, status: null, reason: 'not applicable' };
  const root = path.join(dir, '.forge', 'runs');
  let files = [];
  try {
    files = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, 'summary.md'))
      .filter((file) => fs.existsSync(file));
  } catch { /* report the missing summary below */ }
  if (files.length !== 1) {
    return {
      known: true,
      pass: false,
      status: null,
      reason: files.length ? `expected one summary, found ${files.length}` : 'summary.md was not written',
      file: files[0] || null,
    };
  }
  let text;
  try { text = fs.readFileSync(files[0], 'utf8'); } catch (error) {
    return { known: true, pass: false, status: null, reason: `summary.md could not be read: ${error.message}`, file: files[0] };
  }
  const status = /^\s*status\s*:\s*(\S+)\s*$/im.exec(text)?.[1]?.toLowerCase() || null;
  const resume = /^\s*resume\s*:\s*(true|false)\s*$/im.exec(text)?.[1]?.toLowerCase() || null;
  const heading = /^# Forge summary\s*$/im.test(text);
  const sectionBody = (name) => {
    const lines = text.split(/\r?\n/);
    const index = lines.findIndex((line) => new RegExp(`^## ${name}\\s*$`, 'i').test(line));
    if (index < 0) return null;
    const start = index + 1;
    const next = lines.slice(start).findIndex((line) => /^##\s+\S/.test(line));
    const end = next < 0 ? lines.length : start + next;
    return lines.slice(start, end).join('\n').trim() || null;
  };
  const required = expectCompleted
    ? ['Changes', 'Verification', 'Review', 'Limitations', 'Verdict', 'Telemetry']
    : ['Completed work', 'Failure', 'Next resume step'];
  const missing = required.filter((name) => !sectionBody(name));
  const fieldsOk = expectCompleted
    ? status === 'completed' && resume === 'false'
    : status === 'failed' && resume === 'true'
      && /^\s*failed_command\s*:\s*\S/im.test(text)
      && /^\s*error\s*:\s*\S/im.test(text)
      && /^\s*next_step\s*:\s*\S/im.test(text);
  return {
    known: true,
    pass: heading && fieldsOk && missing.length === 0,
    status,
    resume,
    reason: heading && fieldsOk && missing.length === 0
      ? 'canonical summary written and verified'
      : [
        !heading && 'missing # Forge summary',
        !fieldsOk && `invalid ${expectCompleted ? 'completed' : 'failed'} status/resume fields`,
        missing.length && `missing sections: ${missing.join(', ')}`,
      ].filter(Boolean).join('; '),
    file: files[0],
  };
}

// Activation verdict: the hook must fire exactly when it should.
function checkActivation({ arm, expect, events }) {
  const injected = events.filter((event) => event.event === 'injected');
  const fail = (reason) => ({ pass: false, reason });
  if (arm === 'solo') {
    return events.length ? fail('hook ran on the solo arm') : { pass: true, reason: 'hook silent, as expected' };
  }
  if (!injected.length) return fail('hook never ran');
  if (injected.length > 1) return fail(`injected ${injected.length} times, expected once`);
  const event = injected[0];
  for (const skill of expect.skills || []) {
    if (!event.skills.includes(skill)) return fail(`expected skill ${skill}, got [${event.skills}]`);
  }
  return { pass: true, reason: `injected once: ${event.bytes} bytes, skills [${event.skills}]` };
}

// Dry check: exercise the hook in-process, no host, no quota. A fixed Graphify
// observation isolates hook determinism from the external indexer's ordering.
function dryRun(name, requestedArm = 'forge') {
  const scenario = SCENARIOS[name];
  const results = [];
  const forgeArm = requestedArm === 'both' || requestedArm === 'solo' ? 'forge' : requestedArm;
  for (const arm of ['solo', forgeArm]) {
    const dir = materialize(name);
    const forge = arm !== 'solo';
    if (forge) {
      fs.mkdirSync(path.join(dir, 'graphify-out'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'graphify-out', 'graph.json'), '{}\n', 'utf8');
    }
    process.env.FORGE_TELEMETRY_FILE = path.join(dir, '.forge-telemetry.jsonl');
    process.env.FORGE_AUTO_APPROVE = '1';
    const previousRunId = process.env.FORGE_RUN_ID;
    if (forge) process.env.FORGE_RUN_ID = `dry-${name}-${arm}`;
    const prompt = forge ? `$forge ${scenario.task}` : scenario.task;
    const graphify = {
      attempted: true,
      status: 'ready',
      fallback_reason: null,
      evidence: `dry Graphify evidence for ${name}`,
    };
    const dependencies = forge ? { graphify } : {};
    const first = forgeHook({ prompt, cwd: dir }, dependencies);
    const second = forgeHook({ prompt, cwd: dir }, dependencies);
    delete process.env.FORGE_TELEMETRY_FILE;
    if (previousRunId === undefined) delete process.env.FORGE_RUN_ID;
    else process.env.FORGE_RUN_ID = previousRunId;
    const blockOf = (result) => result?.hookSpecificOutput?.additionalContext || '';
    const sameBootstrap = blockOf(first) === blockOf(second);
    // The second call double-writes telemetry; keep only the first call's view.
    const events = telemetryEvents(dir).slice(0, forge ? 1 : 0);
    const activation = checkActivation({ arm, expect: scenario.expect, events });
    if (forge && !sameBootstrap) activation.pass = false, activation.reason = 'context block not byte-identical between builds';
    results.push({ scenario: name, arm, mode: 'dry', activation, injected_bytes: Buffer.byteLength(blockOf(first), 'utf8') });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return results;
}

function sumUsage(perStep) {
  const total = {
    input: 0, cache_write: 0, cache_read: 0, output: 0,
    reasoning_output: 0, visible_output: 0,
  };
  const profile = [];
  for (const step of perStep) {
    if (!step.usage) continue;
    for (const key of Object.keys(total)) total[key] += Number(step.usage[key] || 0);
    profile.push({
      input: step.usage.input,
      cache_read: step.usage.cache_read,
      output: step.usage.output,
      reasoning_output: step.usage.reasoning_output ?? null,
      visible_output: step.usage.visible_output ?? null,
    });
  }
  return { total, profile };
}

function commandTexts(stdout) {
  const commands = [];
  for (const line of String(stdout || '').split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
        commands.push(String(event.item.command || ''));
      }
    } catch { /* non-JSON host output */ }
  }
  return commands;
}

function traceVerification(host, stdout, verify) {
  if (host !== 'codex') return { known: false, pass: null, reason: 'trace-format-not-supported' };
  const needle = [verify.command, ...verify.args].join(' ');
  const runs = commandTexts(stdout).filter((command) => command.includes(needle)).length;
  return {
    known: true,
    pass: runs > 0,
    runs,
    command: needle,
    reason: runs > 0 ? `host ran ${needle}` : `host did not run ${needle}`,
  };
}

function isHealthy(row) {
  const phaseOk = !row.phase || row.phase.known === false || row.phase.pass === true;
  const traceVerificationOk = !row.trace_verification
    || row.trace_verification.known === false
    || row.trace_verification.pass === true;
  const summaryOk = !row.summary || row.summary.known === false || row.summary.pass === true;
  return row.completed === true && row.verify_passed === true && row.activation?.pass === true
    && row.integration?.pass !== false && phaseOk && traceVerificationOk && summaryOk;
}

function readBaseline(scenarios) {
  if (!fs.existsSync(BASELINE_FILE)) {
    throw new Error(`Missing persisted solo baseline: ${path.relative(process.cwd(), BASELINE_FILE)}. Run --baseline once first.`);
  }
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read persisted solo baseline: ${error.message}`);
  }
  const rows = baseline.rows || [];
  for (const name of scenarios) {
    const row = rows.find((item) => item.scenario === name && item.arm === 'solo');
    if (!row) throw new Error(`Persisted solo baseline has no row for scenario ${name}.`);
    if (!isHealthy(row)) throw new Error(`Persisted solo baseline is not healthy for scenario ${name}.`);
  }
  return baseline;
}

function weighted(usage, host) {
  return Object.entries(WEIGHTS[host]).reduce((sum, [key, weight]) => sum + Number(usage[key] || 0) * weight, 0);
}

function parseSkillEntries(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !/^unavailable\b/i.test(part))
    .map((part) => {
      const match = /^(.*?)\s+x(\d+)\s*$/i.exec(part);
      const name = (match ? match[1] : part).replace(/\s+\([^)]*\)\s*$/, '').trim();
      return name ? { name, count: match ? Number(match[2]) : 1 } : null;
    })
    .filter(Boolean);
}

function summarySkillUsage(summaryText) {
  const lines = String(summaryText || '').split(/\r?\n/);
  const skillsLine = lines.find((line) => /^\s*-?\s*Skills used\s*:/i.test(line));
  const internalLine = lines.find((line) => /^\s*-?\s*(?:Internal specialist skills|internal specialists)\s*:/i.test(line));
  let allValue = skillsLine?.replace(/^\s*-?\s*Skills used\s*:\s*/i, '') || '';
  let internalValue = internalLine?.replace(/^\s*-?\s*(?:Internal specialist skills|internal specialists)\s*:\s*/i, '') || '';
  const inlineInternal = /^(.*?);\s*(?:Internal specialist skills|internal specialists)\s*:\s*(.*)$/i.exec(allValue);
  if (inlineInternal) {
    allValue = inlineInternal[1];
    if (!internalValue) internalValue = inlineInternal[2];
  }
  const allEntries = parseSkillEntries(allValue);
  const internalEntries = parseSkillEntries(internalValue);
  const internalNames = new Set(internalEntries.map(({ name }) => name));
  const counts = {};
  for (const { name, count } of [...allEntries, ...internalEntries]) counts[name] = count;
  return {
    publicNames: allEntries.filter(({ name }) => !internalNames.has(name)).map(({ name }) => name),
    internalNames: [...internalNames],
    counts,
    reported: Boolean(skillsLine || internalLine),
  };
}

function observedSkillUsage(injection, summaryText = '') {
  const publicNames = Array.isArray(injection?.skills)
    ? injection.skills.map((skill) => String(skill).trim()).filter(Boolean)
    : [];
  const internalNames = Array.isArray(injection?.internal_skills)
    ? injection.internal_skills.map((skill) => String(skill).trim()).filter(Boolean)
    : [];
  const summary = summarySkillUsage(summaryText);
  const mergedInternalNames = [...new Set([...internalNames, ...summary.internalNames])];
  const mergedInternalSet = new Set(mergedInternalNames);
  const mergedPublicNames = [...new Set([
    ...publicNames,
    ...summary.publicNames.filter((name) => !mergedInternalSet.has(name)),
  ])];
  const names = [...new Set([...mergedPublicNames, ...mergedInternalNames])];
  const counts = Object.fromEntries(names.map((skill) => [skill, 1]));
  if (injection?.skill_usage && typeof injection.skill_usage === 'object') {
    for (const [skill, count] of Object.entries(injection.skill_usage)) counts[skill] = count;
  }
  for (const [skill, count] of Object.entries(summary.counts)) counts[skill] = count;
  return {
    names,
    publicNames: mergedPublicNames,
    internalNames: mergedInternalNames,
    counts,
    summaryReported: summary.reported,
  };
}

function benchmarkTelemetry({ host, arm, model, effort, total, stats, elapsedMs, weightedUnits, graphifyStatus, injection, skills: observedSkills, traceFile }) {
  const inputTokens = total.input + total.cache_read;
  const observedTotal = inputTokens + total.output;
  const pricing = estimateCost({
    platform: host === 'codex' ? 'codex_subscription' : host,
    model,
    usage: {
      input_tokens: inputTokens,
      cached_input_tokens: total.cache_read,
      output_tokens: total.output,
    },
  });
  const apiEquivalent = pricing.api_equivalent_usd === null
    ? 'unavailable'
    : pricing.api_equivalent_usd.toFixed(6);
  const pricingBasis = pricing.pricing
    ? `input ${pricing.pricing.input}, cached ${pricing.pricing.cached_input}, output ${pricing.pricing.output} USD/1M; as of ${pricing.pricing.as_of || 'unavailable'}`
    : 'unavailable';
  const tools = Object.entries(stats.tools || {})
    .map(([name, count]) => {
      const cleanName = String(name).replace(/^['"]|['"]$/g, '');
      return `${path.basename(cleanName) || cleanName} x${count}`;
    })
    .join(', ') || 'unavailable';
  const skills = observedSkills || observedSkillUsage(injection);
  const skillText = Object.entries(skills.counts)
    .map(([name, count]) => `${name} x${count}`)
    .join(', ') || 'unavailable; host did not report skills';
  const internalText = skills.internalNames.length
    ? `; internal specialists: ${skills.internalNames.join(', ')}`
    : '';
  return [
    '## Telemetry',
    `- Platform / model / effort: ${host} / ${model || 'unavailable'} / ${effort || 'unavailable'}`,
    `- Tokens: uncached input ${total.input}; cached input ${total.cache_read}; output ${total.output}; reasoning output ${total.reasoning_output}; visible output ${total.visible_output}; observed total ${observedTotal}`,
    `- Cost: benchmark weighted units ${weightedUnits.toFixed(1)}; actual subscription charge unavailable; API-equivalent USD ${apiEquivalent}`,
    '- Credits: unavailable; the subscription host does not expose billed credits to the session.',
    `- Latency / calls: end-to-end ${elapsedMs} ms; model turns ${stats.turns ?? 'unavailable'}; model calls ${stats.turns ?? 'unavailable'}; tool calls ${stats.tool_calls ?? 'unavailable'}`,
    `- Tools: ${tools}`,
    `- Skills used: ${skillText}${internalText}${skills.names.length ? ` (observed from ${skills.summaryReported ? 'hook activation and Forge summary' : 'hook activation'})` : ''}`,
    `- Activation / Graphify / hook context: ${arm} / ${graphifyStatus || 'unavailable'} / ${injection?.bytes ?? 'unavailable'} bytes`,
    `- Pricing basis: ${pricingBasis}`,
    `- Data source: ${traceFile}; usage parsed from the completed host trace.`,
  ].join('\n');
}

function replaceTelemetry(summary, telemetry) {
  const lines = String(summary || '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^## Telemetry\s*$/i.test(line));
  if (start < 0) return `${String(summary || '').trimEnd()}\n\n${telemetry}\n`;
  const next = lines.slice(start + 1).findIndex((line) => /^##\s+\S/.test(line));
  const end = next < 0 ? lines.length : start + 1 + next;
  return [...lines.slice(0, start), ...telemetry.split('\n'), ...lines.slice(end)].join('\n').trimEnd() + '\n';
}

function liveRun(name, arm, host, runNumber = 1) {
  const scenario = SCENARIOS[name];
  const forge = arm !== 'solo';
  const dir = materialize(name);
  const startingTree = fixtureTree(dir);
  const nativeTelemetryFile = path.join(dir, '.forge-host-telemetry.jsonl');
  const env = {
    ...process.env,
    FORGE_TELEMETRY_FILE: nativeTelemetryFile,
    FORGE_AUTO_APPROVE: '1',
  };
  const prompt = forge ? `$forge ${scenario.task}` : scenario.task;
  let hostPrompt = prompt;
  const hookDelivery = forge ? 'agent_plugin_user_prompt_submit' : 'disabled';
  let graphify = { status: 'not-used' };
  if (forge) {
    graphify = { status: 'on-demand' };
  }

  // Read the prompt from stdin so Windows' npm shim cannot reinterpret JSON or
  // newlines in the task. The model and effort are explicit for every arm.
  const args = host === 'codex'
    // The Forge arm uses the installed Agent Plugin and its native hook. The
    // solo arm disables hooks and plugins so user-level activation cannot
    // contaminate the control arm. Do not create repository-local legacy hooks.
    ? ['--model', CODEX_MODEL, '-c', `model_reasoning_effort="${CODEX_EFFORT}"`, '-c', 'model_verbosity="low"', '-c', 'approval_policy=never', '--sandbox', 'danger-full-access', ...(forge ? ['--enable', 'plugins'] : ['--disable', 'hooks', '--disable', 'plugins']), 'exec', '--dangerously-bypass-hook-trust', '--ephemeral', '--json', '-']
    : ['-p', '--output-format', 'json', '-'];
  const started = Date.now();
  const run = spawnSync(host, args, {
    cwd: dir, env, encoding: 'utf8', shell: process.platform === 'win32',
    maxBuffer: 256 * 1024 * 1024, timeout: 30 * 60 * 1000, input: hostPrompt,
  });
  const elapsedMs = Date.now() - started;

  // Persist the raw transcript: phase compliance and any future attribution
  // question must be answerable from disk, not from memory of the run.
  const tracesDir = path.join(RESULTS, 'traces');
  fs.mkdirSync(tracesDir, { recursive: true });
  const traceFile = path.join(tracesDir, `v5-${name}-${arm}-${Date.now()}.jsonl`);
  fs.writeFileSync(traceFile, String(run.stdout || ''), 'utf8');
  if (run.stderr) fs.writeFileSync(traceFile.replace(/\.jsonl$/, '.stderr.txt'), String(run.stderr), 'utf8');

  const stats = traceStats(host, run.stdout);
  const { total, profile } = sumUsage(stats.per_step);
  const verify = spawnSync(scenario.verify.command, scenario.verify.args, {
    cwd: dir, encoding: 'utf8', shell: process.platform === 'win32', timeout: scenario.verify.timeout_ms,
  });
  const diff = spawnSync('git', ['diff'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const nativeEvents = telemetryEvents(dir, '.forge-host-telemetry.jsonl');
  const events = nativeEvents;
  const activation = checkActivation({ arm, expect: scenario.expect, events });
  const nativeHookDispatched = forge
    ? nativeEvents.some((event) => event.event === 'injected')
    : null;
  const diffText = String(diff.stdout || '');
  const summary = summaryCheck(dir, arm, run.status === 0 && verify.status === 0);
  const diffsDir = path.join(RESULTS, 'diffs');
  fs.mkdirSync(diffsDir, { recursive: true });
  const diffFile = path.join(diffsDir, `v5-${name}-${arm}-run${runNumber}-${Date.now()}.diff`);
  fs.writeFileSync(diffFile, diffText, 'utf8');
  const cacheDenominator = total.input + total.cache_read;
  const shellCommands = commandTexts(run.stdout);
  const injection = events.find((event) => event.event === 'injected') || null;
  const sourceSummaryText = summary.file ? fs.readFileSync(summary.file, 'utf8') : '';
  const skills = observedSkillUsage(injection, sourceSummaryText);
  const graphifyCommands = shellCommands
    .filter((command) => /graphify(?:\.exe)?\s+(?:query|explain|path|affected|god-nodes)\b/i.test(command)).length;
  const graphifyQueries = shellCommands
    .filter((command) => /graphify(?:\.exe)?\s+query\b/i.test(command)).length;
  const nativeDiscoveryCommands = shellCommands.filter((command) =>
    /(?:^|[\s;&|])(?:rg|grep|find|findstr)(?:\.exe)?(?:\s|$)/i.test(command)
    || /\b(?:git\s+grep|Select-String)\b/i.test(command)
    || /\bGet-ChildItem\b[^\r\n]*\b-Recurse\b/i.test(command));
  const integration = !forge ? { pass: true, reason: 'not applicable' }
    : { pass: true, reason: graphifyCommands
      ? `Graphify discovery commands: ${graphifyCommands}`
      : `on-demand native fallback or direct targeted reads: ${nativeDiscoveryCommands.length}` };
  const row = {
    scenario: name, run: runNumber, arm, host, model: host === 'codex' ? CODEX_MODEL : null,
    effort: host === 'codex' ? CODEX_EFFORT : null, mode: 'live',
    fixture_tree: startingTree,
    task_sha256: crypto.createHash('sha256').update(scenario.task).digest('hex'),
    completed: run.status === 0,
    verify_passed: verify.status === 0,
    elapsed_ms: elapsedMs,
    model_steps: stats.steps,
    tool_calls: stats.tool_calls,
    usage: total,
    weighted_units: weighted(total, host),
    cache_read_share: cacheDenominator ? total.cache_read / cacheDenominator : null,
    cache_profile: profile,
    integrations: {
      graphify: graphify.status,
      graphify_commands: graphifyCommands,
      graphify_queries: graphifyQueries,
      native_discovery_commands: nativeDiscoveryCommands.length,
      shell_commands: shellCommands.length,
      headroom: false,
    },
    integration,
    hook_delivery: hookDelivery,
    hook_context_bytes: injection?.bytes ?? null,
    skills: skills.names.length ? skills.names : null,
    skill_usage: skills.names.length ? skills.counts : null,
    internal_skills: skills.internalNames.length ? skills.internalNames : null,
    native_hook_dispatched: nativeHookDispatched,
    native_hook_events: nativeEvents.length,
    injection,
    activation,
    summary: { ...summary, file: null, telemetry_enriched: false },
    trace_verification: traceVerification(host, run.stdout, scenario.verify),
    phase: forge ? phaseCheck(host, run.stdout, scenario.verify) : null,
    diff: diffStats(diffText),
    diff_file: path.relative(process.cwd(), diffFile),
    diff_sha256: crypto.createHash('sha256').update(diffText).digest('hex'),
    trace_file: path.relative(process.cwd(), traceFile),
    trace_sha256: crypto.createHash('sha256').update(String(run.stdout || '')).digest('hex'),
  };
  if (summary.file) {
    const summariesDir = path.join(RESULTS, 'summaries');
    fs.mkdirSync(summariesDir, { recursive: true });
    const summaryFile = path.join(summariesDir, `v5-${name}-${arm}-run${runNumber}-${Date.now()}.md`);
    fs.copyFileSync(summary.file, summaryFile);
    const telemetry = benchmarkTelemetry({
      host,
      arm,
      model: row.model,
      effort: row.effort,
      total,
      stats,
      elapsedMs,
      weightedUnits: row.weighted_units,
      graphifyStatus: graphify.status,
      injection,
      skills,
      traceFile: path.relative(process.cwd(), traceFile),
    });
    fs.writeFileSync(summaryFile, replaceTelemetry(fs.readFileSync(summaryFile, 'utf8'), telemetry), 'utf8');
    row.summary.file = path.relative(process.cwd(), summaryFile);
    row.summary.telemetry_enriched = true;
  }
  if (!isHealthy(row)) {
    const recoveryDir = path.join(RESULTS, 'recovery', `v5-${name}-${arm}-run${runNumber}-${Date.now()}`);
    fs.mkdirSync(path.dirname(recoveryDir), { recursive: true });
    fs.cpSync(dir, recoveryDir, { recursive: true });
    row.recovery_dir = path.relative(process.cwd(), recoveryDir);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return row;
}

function lastAgentMessage(stdout) {
  let text = '';
  for (const line of String(stdout || '').split(/\r?\n/).filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      text = String(event.item.text || '');
    } else if (event.type === 'response.output_text.done') {
      text = String(event.text || event.output_text || text);
    }
  }
  return text;
}

function parseJudgeVerdict(text) {
  const source = String(text || '').trim();
  const candidates = [source];
  for (const match of source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1]);
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(source.slice(first, last + 1));
  for (const candidate of candidates.reverse()) {
    try {
      const verdict = JSON.parse(candidate.trim());
      if (['A', 'B', 'tie'].includes(verdict?.winner)) return verdict;
    } catch { /* keep looking for a JSON-only final answer */ }
  }
  return null;
}

function judgePatch(row) {
  let patch = '';
  try { patch = fs.readFileSync(path.resolve(process.cwd(), row.diff_file), 'utf8'); } catch { /* reported below */ }
  const limit = 120_000;
  return patch.length > limit
    ? `${patch.slice(0, limit)}\n[patch truncated for judge; full patch is persisted at ${row.diff_file}]`
    : (patch || '(no tracked patch)');
}

function judgePair(name, runNumber, solo, forge, model, effort) {
  const scenario = SCENARIOS[name];
  const flip = Number.parseInt(crypto.createHash('sha256').update(`${name}:${runNumber}`).digest('hex').slice(0, 2), 16) % 2 === 0;
  const labels = flip ? { A: 'solo', B: 'forge' } : { A: 'forge', B: 'solo' };
  const byArm = { solo, forge };
  const prompt = [
    'Act as a blind code judge. Compare implementation A and B against the task.',
    'Do not edit files or run commands. Return JSON only with this shape:',
    '{"winner":"A|B|tie","reason":"brief explanation"}',
    '',
    `TASK:\n${scenario.task}`,
    `IMPLEMENTATION A VERIFICATION:\n${JSON.stringify({ completed: byArm[labels.A].completed, verify_passed: byArm[labels.A].verify_passed, diff: byArm[labels.A].diff })}`,
    `IMPLEMENTATION A PATCH:\n${judgePatch(byArm[labels.A])}`,
    `IMPLEMENTATION B VERIFICATION:\n${JSON.stringify({ completed: byArm[labels.B].completed, verify_passed: byArm[labels.B].verify_passed, diff: byArm[labels.B].diff })}`,
    `IMPLEMENTATION B PATCH:\n${judgePatch(byArm[labels.B])}`,
  ].join('\n\n');
  const args = [
    '--model', model,
    '-c', `model_reasoning_effort="${effort}"`,
    '-c', 'model_verbosity="low"',
    '-c', 'approval_policy=never',
    '--sandbox', 'read-only',
    '--disable', 'hooks', '--disable', 'plugins',
    'exec', '--ignore-user-config', '--ephemeral', '--json', '-',
  ];
  const judgesDir = path.join(RESULTS, 'judges');
  fs.mkdirSync(judgesDir, { recursive: true });
  const traceFile = path.join(judgesDir, `v5-${name}-run${runNumber}-${Date.now()}.jsonl`);
  const started = Date.now();
  const result = spawnSync('codex', args, {
    cwd: process.cwd(), env: { ...process.env, FORGE_AUTO_APPROVE: '0' },
    encoding: 'utf8', shell: process.platform === 'win32', input: prompt,
    maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000,
  });
  const stdout = String(result.stdout || '');
  fs.writeFileSync(traceFile, stdout, 'utf8');
  if (result.stderr) fs.writeFileSync(traceFile.replace(/\.jsonl$/, '.stderr.txt'), String(result.stderr), 'utf8');
  const text = lastAgentMessage(stdout);
  const verdict = parseJudgeVerdict(text);
  const stats = traceStats('codex', stdout);
  const { total } = sumUsage(stats.per_step);
  const winnerArm = verdict?.winner === 'tie' ? 'tie' : verdict ? labels[verdict.winner] : null;
  return {
    scenario: name, run: runNumber, model, effort,
    completed: result.status === 0, valid: Boolean(verdict), ok: result.status === 0 && Boolean(verdict),
    winner: verdict?.winner || null, winner_arm: winnerArm, reason: verdict?.reason || null,
    blinded_as: labels, elapsed_ms: Date.now() - started, model_steps: stats.steps,
    usage: total, weighted_units: weighted(total, 'codex'),
    trace_file: path.relative(process.cwd(), traceFile),
    trace_sha256: crypto.createHash('sha256').update(stdout).digest('hex'),
    error: result.status === 0 ? null : String(result.stderr || result.error?.message || `exit ${result.status}`),
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

function report(rows, options, baselineRows = [], judgments = []) {
  const modelLine = `Models: benchmark=${CODEX_MODEL}/${CODEX_EFFORT}; judge=${options.judge ? `${options.judgeModel}/${options.judgeEffort}` : 'disabled'}.`;
  const lines = ['', `## Forge v5 bench — host=${options.host} runs=${options.runs} mode=${options.confirm ? 'live' : 'dry'}`, ''];
  lines.push(modelLine);
  lines.push('| scenario | arm | activation | detail |', '|---|---|---|---|');
  for (const row of rows.filter((r) => r.mode === 'dry')) {
    lines.push(`| ${row.scenario} | ${row.arm} | ${row.activation.pass ? 'PASS' : 'FAIL'} | ${row.activation.reason} |`);
  }
  const live = rows.filter((r) => r.mode === 'live');
  if (live.length) {
    lines.push('', '| scenario | arm | hook delivery | native hook | done | verify | summary | weighted (med) | steps | cache read | latency |', '|---|---|---|---|---:|---:|---|---:|---:|---:|---:|');
    for (const name of options.scenarios) {
      const arms = [...new Set(live.filter((r) => r.scenario === name).map((r) => r.arm))];
      for (const arm of arms) {
        const group = live.filter((r) => r.scenario === name && r.arm === arm);
        if (!group.length) continue;
        const done = group.filter((r) => r.completed && r.verify_passed).length;
        const share = median(group.map((r) => r.cache_read_share ?? 0));
        const delivery = group[0].hook_delivery || 'n/a';
        const native = group[0].native_hook_dispatched === null ? 'n/a' : group.every((r) => r.native_hook_dispatched) ? 'yes' : 'no';
        const summaries = group.every((r) => r.summary?.known === false) ? 'n/a'
          : group.every((r) => r.summary?.pass === true) ? 'yes' : 'no';
        lines.push(`| ${name} | ${arm} | ${delivery} | ${native} | ${done}/${group.length} | ${group.filter((r) => r.verify_passed).length}/${group.length} | ${summaries} | ${Math.round(median(group.map((r) => r.weighted_units)))} | ${median(group.map((r) => r.model_steps ?? 0))} | ${(share * 100).toFixed(1)}% | ${(median(group.map((r) => r.elapsed_ms)) / 1000).toFixed(1)}s |`);
      }
      const persistedSolo = baselineRows.filter((r) => r.scenario === name && r.arm === 'solo');
      if (!live.some((r) => r.scenario === name && r.arm === 'solo') && persistedSolo.length) {
        const row = persistedSolo[0];
        lines.push(`| ${name} | solo (persisted) | n/a | n/a | ${row.completed && row.verify_passed ? '1/1' : '0/1'} | ${row.verify_passed ? '1/1' : '0/1'} | n/a | ${Math.round(row.weighted_units)} | ${row.model_steps ?? 0} | ${((row.cache_read_share ?? 0) * 100).toFixed(1)}% | ${(row.elapsed_ms / 1000).toFixed(1)}s |`);
      }
      const solo = live.filter((r) => r.scenario === name && r.arm === 'solo').map((r) => r.weighted_units);
      if (!solo.length) solo.push(...persistedSolo.map((r) => r.weighted_units));
      for (const arm of arms.filter((item) => item !== 'solo')) {
        const forge = live.filter((r) => r.scenario === name && r.arm === arm).map((r) => r.weighted_units);
        if (solo.length && forge.length) lines.push(`| ${name} | **ratio ${arm}/solo** |  |  | **${(median(forge) / median(solo)).toFixed(3)}x** |  |  |  |`);
      }
    }
    lines.push('', '| scenario | phases (forge) | detail |', '|---|---|---|');
    for (const row of live.filter((r) => r.phase)) {
      lines.push(`| ${row.scenario} | ${row.phase.known === false ? 'n/a' : row.phase.pass ? 'PASS' : 'FAIL'} | ${row.phase.reason} |`);
    }
    lines.push('', '| scenario | integrations (forge) | detail |', '|---|---|---|');
    for (const row of live.filter((r) => r.arm !== 'solo')) {
      lines.push(`| ${row.scenario} | ${row.integration?.pass ? 'PASS' : 'FAIL'} | ${row.integration?.reason || 'missing integration evidence'} |`);
    }
    const failed = live.filter((r) => !r.activation.pass);
    lines.push('', failed.length
      ? `ACTIVATION FAILURES: ${failed.map((r) => `${r.scenario}/${r.arm}: ${r.activation.reason}`).join('; ')}`
      : 'Activation: all live rows behaved as expected.');
    const badPhases = live.filter((r) => r.phase?.known && !r.phase.pass);
    if (badPhases.length) lines.push(`PHASE FAILURES: ${badPhases.map((r) => `${r.scenario}: ${r.phase.reason}`).join('; ')}`);
    if (options.runs < 5) lines.push(`Note: runs=${options.runs} < 5 — treat medians as indicative, not conclusive.`);
  }
  if (judgments.length) {
    lines.push('', `| scenario | run | judge ${options.judgeModel}/${options.judgeEffort} | winner | detail |`, '|---|---:|---|---|---|');
    for (const judgment of judgments) {
      lines.push(`| ${judgment.scenario} | ${judgment.run} | ${judgment.ok ? 'PASS' : 'FAIL'} | ${judgment.winner_arm || 'n/a'} | ${judgment.reason || judgment.error || 'no valid verdict'} |`);
    }
  }
  if (options.haltReason) lines.push('', `HALTED AFTER FIRST FAILURE: ${options.haltReason}`);
  return lines.join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.baseline && !options.confirm) {
    throw new Error('--baseline requires --confirm-subscription-usage.');
  }
  if (options.baseline && fs.existsSync(BASELINE_FILE)) {
    throw new Error(`Persisted solo baseline already exists: ${path.relative(process.cwd(), BASELINE_FILE)}. It will not be overwritten.`);
  }
  const baseline = options.confirm && FORGE_ARMS.has(options.arm)
    && options.scenarios.every((name) => SCENARIOS[name].persisted_baseline !== false)
    ? readBaseline(options.scenarios)
    : null;
  const rows = [];
  const judgments = [];
  options.haltReason = null;
  for (const name of options.scenarios) rows.push(...dryRun(name, options.arm));
  if (options.confirm) {
    if (options.baseline) {
      for (const name of options.scenarios) {
        const row = liveRun(name, 'solo', options.host, 1);
        rows.push(row);
        if (!isHealthy(row)) {
          options.haltReason = `${name}/solo: ${row.activation?.reason || 'verification or session failed'}`;
          break;
        }
      }
    } else {
      let halted = false;
      for (const name of options.scenarios) {
        if (halted) break;
        for (let run = 1; run <= options.runs; run += 1) {
          const arms = options.arm === 'solo' ? ['solo'] : FORGE_ARMS.has(options.arm) ? [options.arm]
            : (run % 2 === 1 ? ['solo', 'forge'] : ['forge', 'solo']);
          const pair = {};
          for (const arm of arms) {
            const row = liveRun(name, arm, options.host, run);
            rows.push(row);
            pair[arm] = row;
            if (!isHealthy(row)) {
              options.haltReason = `${name}/run${run}/${arm}: ${row.integration?.pass === false ? row.integration.reason : row.activation?.reason || 'verification, phase, or session failed'}`;
              halted = true;
              break;
            }
          }
          if (halted) break;
          if (pair.solo && pair.forge) {
            const sameControls = pair.solo.fixture_tree === pair.forge.fixture_tree
              && pair.solo.task_sha256 === pair.forge.task_sha256
              && pair.solo.model === pair.forge.model
              && pair.solo.effort === pair.forge.effort;
            if (!sameControls) {
              options.haltReason = `${name}/run${run}: solo and forge controls differ (fixture, task, model, or effort)`;
              halted = true;
              break;
            }
          }
          if (options.judge && pair.solo && pair.forge) {
            const judgment = judgePair(name, run, pair.solo, pair.forge, options.judgeModel, options.judgeEffort);
            judgments.push(judgment);
            if (!judgment.ok) {
              options.haltReason = `${name}/run${run}/judge: ${judgment.error || 'invalid verdict'}`;
              halted = true;
              break;
            }
          }
        }
      }
    }
  } else {
    console.log('Dry mode (no quota spent). Add --confirm-subscription-usage for live host runs.');
  }
  fs.mkdirSync(RESULTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(RESULTS, `v5-${options.host}-${options.confirm ? 'live' : 'dry'}-${stamp}.json`);
  if (options.baseline) {
    const liveRows = rows.filter((row) => row.mode === 'live');
    if (liveRows.length === options.scenarios.length && liveRows.every(isHealthy)) {
      fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({ schema: 1, created_at: new Date().toISOString(), host: options.host, model: CODEX_MODEL, scenarios: options.scenarios, rows: liveRows }, null, 2)}\n`, 'utf8');
      console.log(`Persisted solo baseline: ${path.relative(process.cwd(), BASELINE_FILE)}`);
    }
  }
  fs.writeFileSync(file, `${JSON.stringify({
    schema: 2,
    options,
    benchmark: { model: CODEX_MODEL, effort: CODEX_EFFORT },
    judge: options.judge ? { model: options.judgeModel, effort: options.judgeEffort, usage_outside_arms: true } : null,
    baseline_file: baseline ? path.relative(process.cwd(), BASELINE_FILE) : null,
    rows, judgments,
  }, null, 2)}\n`, 'utf8');
  console.log(report(rows, options, baseline?.rows || [], judgments));
  console.log(`\nResult file: ${path.relative(process.cwd(), file)}`);
  const failed = Boolean(options.haltReason)
    || rows.some((row) => row.activation?.pass === false || row.integration?.pass === false)
    || rows.some((row) => row.mode === 'live' && !isHealthy(row))
    || judgments.some((judgment) => !judgment.ok);
  process.exit(failed ? 1 : 0);
}

main();
