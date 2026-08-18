#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_ROOT = path.join(PLUGIN_ROOT, 'skills', 'forge');
const COMMIT_SKILL_ROOT = path.join(PLUGIN_ROOT, 'skills', 'forge-commit');
const CLIENTS = new Set(['claude', 'opencode', 'cursor', 'antigravity']);

function within(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function safeFilter(source) {
  const name = path.basename(source).toLowerCase();
  if (name === '.git' || name === '.forge' || name === 'node_modules') return false;
  if (name === '.env' || name.startsWith('.env.')) return false;
  if (/^appsettings(?:\..+)?\.json$/.test(name)) return false;
  return true;
}

export function resolveInstall(client, { scope = 'user', home = os.homedir(), project = process.cwd() } = {}) {
  if (!CLIENTS.has(client)) throw new Error(`Unsupported client: ${client}`);
  if (!['user', 'project'].includes(scope)) throw new Error(`Unsupported scope: ${scope}`);

  const userTargets = {
    claude: { source: SKILL_ROOT, target: path.join(home, '.claude', 'skills', 'forge'), kind: 'skill' },
    opencode: { source: SKILL_ROOT, target: path.join(home, '.config', 'opencode', 'skills', 'forge'), kind: 'skill' },
    cursor: { source: PLUGIN_ROOT, target: path.join(home, '.cursor', 'plugins', 'local', 'forge'), kind: 'plugin' },
    antigravity: { source: PLUGIN_ROOT, target: path.join(home, '.gemini', 'config', 'plugins', 'forge'), kind: 'plugin' },
  };
  const projectTargets = {
    claude: { source: SKILL_ROOT, target: path.join(project, '.claude', 'skills', 'forge'), kind: 'skill' },
    opencode: { source: SKILL_ROOT, target: path.join(project, '.opencode', 'skills', 'forge'), kind: 'skill' },
    cursor: { source: SKILL_ROOT, target: path.join(project, '.agents', 'skills', 'forge'), kind: 'skill' },
    antigravity: { source: PLUGIN_ROOT, target: path.join(project, '.agents', 'plugins', 'forge'), kind: 'plugin' },
  };
  return { client, scope, ...(scope === 'user' ? userTargets[client] : projectTargets[client]) };
}

export function installClient(client, options = {}) {
  const resolved = resolveInstall(client, options);
  const source = path.resolve(resolved.source);
  const target = path.resolve(resolved.target);
  const entries = [{ source, target }];
  if (resolved.kind === 'skill') {
    entries.push({
      source: path.resolve(COMMIT_SKILL_ROOT),
      target: path.join(path.dirname(target), 'forge-commit'),
    });
  }
  for (const entry of entries) {
    const parent = path.dirname(entry.target);
    const basename = path.basename(entry.target).toLowerCase();
    if (!fs.existsSync(entry.source)) throw new Error(`Forge source is missing: ${entry.source}`);
    if (!within(parent, entry.target) || !['forge', 'forge-commit'].includes(basename)) {
      throw new Error(`Refusing unsafe install target: ${entry.target}`);
    }
    if (entry.source === entry.target || within(entry.source, entry.target)) {
      throw new Error(`Install target cannot be inside the Forge source: ${entry.target}`);
    }
  }
  const companions = entries.slice(1);
  if (options.dryRun) {
    return { ...resolved, source, target, companions, installed: false, dry_run: true };
  }
  const existing = entries.find((entry) => fs.existsSync(entry.target));
  if (existing && !options.force) {
    throw new Error(`Target already exists; rerun with --force to replace it: ${existing.target}`);
  }
  if (options.force) {
    for (const entry of entries) fs.rmSync(entry.target, { recursive: true, force: true });
  }
  for (const entry of entries) {
    fs.mkdirSync(path.dirname(entry.target), { recursive: true });
    fs.cpSync(entry.source, entry.target, { recursive: true, filter: safeFilter, errorOnExist: true, force: false });
  }
  return { ...resolved, source, target, companions, installed: true, dry_run: false };
}

function usage() {
  return [
    'Usage: node scripts/install-client.mjs <claude|opencode|cursor|antigravity> [options]',
    '',
    'Options:',
    '  --scope <user|project>  Install globally for the user or into the current project',
    '  --project <path>        Project root for project scope (defaults to cwd)',
    '  --force                 Replace an existing exact Forge target',
    '  --dry-run               Print the resolved source and target(s) without writing',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {};
  let client = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') return { help: true };
    if (value === '--force') options.force = true;
    else if (value === '--dry-run') options.dryRun = true;
    else if (value === '--scope' || value === '--project') {
      const next = argv[index + 1];
      if (!next) throw new Error(`${value} requires a value`);
      options[value.slice(2)] = next;
      index += 1;
    } else if (value.startsWith('-')) throw new Error(`Unknown option: ${value}`);
    else if (!client) client = value.toLowerCase();
    else throw new Error(`Unexpected argument: ${value}`);
  }
  if (!client) throw new Error('A client name is required');
  return { client, options };
}

function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const result = installClient(parsed.client, parsed.options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
