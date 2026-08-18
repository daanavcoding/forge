#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installClient, safeFilter } from './install-client.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '..', '..');
const PORTABLE_MANIFEST = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'plugin.json'), 'utf8'));
const PLUGIN_NAME = PORTABLE_MANIFEST.name;
const VERSION = PORTABLE_MANIFEST.version;
const CLIENTS = new Set(['codex', 'claude', 'opencode', 'cursor', 'antigravity']);
const DOCTOR_CLIENTS = new Set(['codex', 'claude']);
const CODEX_ON_WINDOWS = process.platform === 'win32';
const CODEX_COMMAND = CODEX_ON_WINDOWS ? (process.env.ComSpec || 'cmd.exe') : 'codex';
const CLAUDE_COMMAND = process.platform === 'win32' ? 'claude.exe' : 'claude';

function codexArgs(args) {
  return CODEX_ON_WINDOWS ? ['/d', '/s', '/c', 'codex.cmd', ...args] : args;
}

function samePath(left, right) {
  const normalize = (value) => path.resolve(String(value)).replace(/^\\\\\?\\/, '').toLowerCase();
  return normalize(left) === normalize(right);
}

function within(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertAbsolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return path.resolve(value);
}

function assertExternalPath(value, label) {
  const resolved = assertAbsolute(value, label);
  if (samePath(resolved, REPO_ROOT) || within(REPO_ROOT, resolved) || within(resolved, REPO_ROOT)) {
    throw new Error(`${label} must not be inside or above the Forge repository: ${resolved}`);
  }
  return resolved;
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(String(output || '').trim());
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
}

function writeAtomic(file, contents) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, contents, 'utf8');
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  fs.renameSync(temporary, target);
}

function copyTree(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    filter: safeFilter,
    errorOnExist: true,
    force: false,
  });
}

export function pruneCodexInstallation(installedPath) {
  const root = assertAbsolute(installedPath, 'Codex installed plugin path');
  const manifestPath = path.join(root, '.codex-plugin', 'plugin.json');
  const manifest = readJson(manifestPath);
  if (manifest.name !== PLUGIN_NAME) {
    throw new Error(`Refusing to prune unexpected Codex plugin: ${manifest.name || 'unknown'}`);
  }
  const relativeTargets = ['.claude-plugin', 'claude', path.join('scripts', 'claude-hook.mjs')];
  const removed = [];
  for (const relativeTarget of relativeTargets) {
    const target = path.resolve(root, relativeTarget);
    if (!within(root, target)) throw new Error(`Unsafe Codex prune target: ${target}`);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(relativeTarget.replaceAll('\\', '/'));
  }
  return removed;
}

function runCommand(command, args, { cwd = REPO_ROOT, runner = spawnSync } = {}) {
  const result = runner(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    shell: false,
    windowsHide: true,
  });
  return {
    command,
    args,
    status: typeof result?.status === 'number' ? result.status : 1,
    stdout: String(result?.stdout || ''),
    stderr: String(result?.stderr || result?.error?.message || ''),
    error: result?.error ? String(result.error.message || result.error) : null,
  };
}

function runJsonCommand(command, args, options = {}) {
  const result = runCommand(command, args, options);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
  return { result, value: parseJsonOutput(result.stdout, `${command} ${args.join(' ')}`) };
}

export function listCodexHooks({ cwd = REPO_ROOT, runner = spawn, timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = runner(CODEX_COMMAND, codexArgs(['app-server', '--stdio']), {
      cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        reject(error);
      } else {
        child.stdin.end();
        resolve(value);
      }
    };
    const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
    const timer = setTimeout(() => {
      finish(new Error(`Codex hooks/list timed out after ${timeoutMs} ms${stderr ? `: ${stderr.trim()}` : ''}`));
    }, timeoutMs);

    child.on('error', (error) => finish(error));
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      let newline;
      while ((newline = stdout.indexOf('\n')) !== -1) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          finish(new Error(`Codex app-server returned invalid JSON: ${line}`));
          return;
        }
        if (message.id === 1) {
          if (message.error) {
            finish(new Error(`Codex app-server initialize failed: ${JSON.stringify(message.error)}`));
            return;
          }
          send({ method: 'initialized', params: {} });
          send({ method: 'hooks/list', id: 2, params: { cwds: [cwd] } });
        } else if (message.id === 2) {
          if (message.error) finish(new Error(`Codex hooks/list failed: ${JSON.stringify(message.error)}`));
          else finish(null, message.result);
          return;
        }
      }
    });
    child.on('close', (code) => {
      if (!settled) finish(new Error(`Codex app-server exited before hooks/list completed (${code}): ${stderr.trim()}`));
    });
    send({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: { name: 'forge-host-manager', title: 'Forge host manager', version: VERSION },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    });
  });
}

export async function inspectCodexPluginHooks({
  cwd = REPO_ROOT,
  pluginId,
  runner = spawn,
} = {}) {
  if (!pluginId) throw new Error('pluginId is required to inspect Codex hooks');
  const response = await listCodexHooks({ cwd, runner });
  const entries = Array.isArray(response?.data) ? response.data : [];
  const hooks = entries.flatMap((entry) => entry.hooks || []).filter((hook) => hook.pluginId === pluginId);
  const warnings = entries.flatMap((entry) => entry.warnings || []);
  const errors = entries.flatMap((entry) => entry.errors || []);
  const automatic = hooks.length > 0
    && hooks.every((hook) => hook.enabled && ['trusted', 'managed'].includes(hook.trustStatus));
  return {
    mode: 'plugin',
    automatic,
    hooks: hooks.map((hook) => ({
      key: hook.key,
      event: hook.eventName,
      enabled: hook.enabled,
      trust: hook.trustStatus,
      hash: hook.currentHash,
      source: hook.sourcePath,
    })),
    warnings,
    errors,
  };
}

function normalizeSource(value) {
  if (!value || typeof value !== 'string') return null;
  try { return path.resolve(value).replace(/^\\\\\?\\/, '').toLowerCase(); } catch { return null; }
}

function marketplaceMatches(entry, root) {
  const expected = normalizeSource(root);
  if (!expected || !entry || typeof entry !== 'object') return false;
  return [entry.root, entry.path, entry.installLocation, entry.source]
    .map(normalizeSource)
    .some((candidate) => candidate === expected);
}

function installedPlugin(list, pluginId) {
  const entries = Array.isArray(list) ? list : list?.installed;
  return (entries || []).find((entry) => entry.id === pluginId || entry.pluginId === pluginId) || null;
}

export function renderCodexRequirements({ managedDir, managedOnly = false, platform = process.platform } = {}) {
  const bundleRoot = assertAbsolute(managedDir, 'managedDir');
  const dispatcher = path.join(bundleRoot, 'forge-hook.mjs');
  const windows = platform === 'win32' || platform === 'windows';
  const dirKey = windows ? 'windows_managed_dir' : 'managed_dir';
  const commandKey = windows ? 'command_windows' : 'command';
  const command = `node "${dispatcher}"`;
  const toml = (value) => {
    if (String(value).includes("'")) throw new Error('Managed paths cannot contain single quotes');
    return `'${String(value)}'`;
  };
  const lines = [
    ...(managedOnly ? ['allow_managed_hooks_only = true', ''] : []),
    '[features]',
    'hooks = true',
    '',
    '[hooks]',
    `${dirKey} = ${toml(bundleRoot)}`,
    '',
    '[[hooks.UserPromptSubmit]]',
    '[[hooks.UserPromptSubmit.hooks]]',
    'type = "command"',
    `${commandKey} = ${toml(command)}`,
    'statusMessage = "Loading Forge"',
    '',
    '[[hooks.SessionEnd]]',
    '[[hooks.SessionEnd.hooks]]',
    'type = "command"',
    `${commandKey} = ${toml(command)}`,
    'statusMessage = "Saving Forge telemetry"',
    '',
  ];
  return lines.join('\n');
}

function renderClaudeManagedSettings({
  marketplacePath = REPO_ROOT,
  marketplaceName = 'forge',
  pluginId = `${PLUGIN_NAME}@${marketplaceName}`,
  managedOnly = false,
} = {}) {
  const settings = {
    extraKnownMarketplaces: {
      [marketplaceName]: {
        source: {
          source: 'directory',
          path: path.resolve(marketplacePath),
        },
      },
    },
    enabledPlugins: {
      [pluginId]: true,
    },
  };
  if (managedOnly) settings.allowManagedHooksOnly = true;
  return `${JSON.stringify(settings, null, 2)}\n`;
}

export function stageManagedBundle({ managedDir, force = false } = {}) {
  const requestedRoot = assertExternalPath(managedDir, 'managedDir');
  const bundleRoot = path.join(requestedRoot, 'forge-managed');
  const versionRoot = path.join(bundleRoot, VERSION);
  const dispatcherSource = path.join(PLUGIN_ROOT, 'scripts', 'managed-dispatcher.mjs');
  const dispatcherTarget = path.join(bundleRoot, 'forge-hook.mjs');
  const currentFile = path.join(bundleRoot, 'current.json');
  fs.mkdirSync(bundleRoot, { recursive: true });

  const sourceManifestHash = hashFile(path.join(PLUGIN_ROOT, 'plugin.json'));
  const sourceHookHash = hashFile(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'));
  const sourceDispatcherHash = hashFile(dispatcherSource);
  if (fs.existsSync(versionRoot)) {
    const targetManifest = path.join(versionRoot, 'plugin.json');
    const targetHook = path.join(versionRoot, 'hooks', 'hooks.json');
    const targetDispatcher = path.join(versionRoot, 'scripts', 'managed-dispatcher.mjs');
    const matches = fs.existsSync(targetManifest)
      && fs.existsSync(targetHook)
      && fs.existsSync(targetDispatcher)
      && hashFile(targetManifest) === sourceManifestHash
      && hashFile(targetHook) === sourceHookHash
      && hashFile(targetDispatcher) === sourceDispatcherHash;
    if (!matches && !force) {
      throw new Error(`Managed Forge version already exists with different content: ${versionRoot}`);
    }
    if (!matches || force) fs.rmSync(versionRoot, { recursive: true, force: true });
  }
  if (!fs.existsSync(versionRoot)) {
    const staging = path.join(bundleRoot, `.staging-${process.pid}-${crypto.randomUUID()}`);
    copyTree(PLUGIN_ROOT, staging);
    fs.renameSync(staging, versionRoot);
  }
  pruneCodexInstallation(versionRoot);

  writeAtomic(dispatcherTarget, fs.readFileSync(dispatcherSource, 'utf8'));
  writeAtomic(path.join(versionRoot, 'managed.json'), `${JSON.stringify({
    name: PLUGIN_NAME,
    version: VERSION,
    manifest_sha256: sourceManifestHash,
    hook_sha256: sourceHookHash,
    dispatcher_sha256: sourceDispatcherHash,
  }, null, 2)}\n`);
  writeAtomic(currentFile, `${JSON.stringify({
    name: PLUGIN_NAME,
    version: VERSION,
    root: versionRoot,
    manifest_sha256: sourceManifestHash,
    hook_sha256: sourceHookHash,
    dispatcher_sha256: sourceDispatcherHash,
  }, null, 2)}\n`);

  return {
    managed_dir: requestedRoot,
    bundle_root: bundleRoot,
    version_root: versionRoot,
    dispatcher: dispatcherTarget,
    current_file: currentFile,
    version: VERSION,
    manifest_sha256: sourceManifestHash,
    hook_sha256: sourceHookHash,
    dispatcher_sha256: sourceDispatcherHash,
  };
}

export function installManagedCodex({
  managedDir,
  requirementsPath = null,
  managedOnly = false,
  force = false,
  dryRun = false,
} = {}) {
  if (!managedDir) throw new Error('--managed-dir is required for Codex managed setup');
  const requestedRoot = assertExternalPath(managedDir, 'managedDir');
  const bundleRoot = path.join(requestedRoot, 'forge-managed');
  const requirements = renderCodexRequirements({ managedDir: bundleRoot, managedOnly });
  const result = {
    client: 'codex',
    mode: 'managed',
    dry_run: Boolean(dryRun),
    managed_dir: requestedRoot,
    bundle_root: bundleRoot,
    requirements_path: requirementsPath ? assertExternalPath(requirementsPath, 'requirementsPath') : null,
    requirements,
    requirements_written: false,
    trust: 'managed_policy',
  };
  if (dryRun) return result;
  Object.assign(result, stageManagedBundle({ managedDir: requestedRoot, force }));
  if (result.requirements_path) {
    const file = result.requirements_path;
    if (fs.existsSync(file) && !force && fs.readFileSync(file, 'utf8') !== requirements) {
      throw new Error(`Requirements file already exists with different content; rerun with --force: ${file}`);
    }
    if (!fs.existsSync(file) || force) writeAtomic(file, requirements);
    result.requirements_written = true;
  }
  return result;
}

export async function installCodex({
  dryRun = false,
  managedDir = null,
  requirementsPath = null,
  managedOnly = false,
  force = false,
  runner = spawnSync,
} = {}) {
  const commands = [
    [CODEX_COMMAND, codexArgs(['plugin', 'marketplace', 'add', REPO_ROOT, '--json'])],
    [CODEX_COMMAND, codexArgs(['plugin', 'add', 'forge@forge', '--json'])],
  ];
  if (dryRun) {
    return {
      client: 'codex',
      mode: managedDir ? 'managed' : 'plugin',
      dry_run: true,
      commands,
      managed: managedDir ? installManagedCodex({ managedDir, requirementsPath, managedOnly, force, dryRun: true }) : null,
      hook: managedDir
        ? 'managed policy bundle generated; requirements.toml must be deployed as admin policy'
        : 'manifest-declared plugin hooks are installed; Codex trust is verified after installation',
    };
  }

  const marketplace = runJsonCommand(CODEX_COMMAND, codexArgs(['plugin', 'marketplace', 'list', '--json']), { runner });
  let marketplaceName = marketplace.value.marketplaces?.find((entry) => marketplaceMatches(entry, REPO_ROOT))?.name;
  let replacedMarketplace = null;
  if (!marketplaceName) {
    const conflicting = marketplace.value.marketplaces?.find((entry) => entry.name === 'forge');
    if (conflicting) {
      if (!force) {
        throw new Error(`Codex marketplace forge points to a different checkout (${conflicting.root || 'unknown'}); rerun with --force to replace only forge@forge`);
      }
      const oldPlugins = runJsonCommand(CODEX_COMMAND, codexArgs(['plugin', 'list', '--marketplace', 'forge', '--json']), { runner }).value;
      if (installedPlugin(oldPlugins, `${PLUGIN_NAME}@forge`)) {
        runJsonCommand(CODEX_COMMAND, codexArgs(['plugin', 'remove', `${PLUGIN_NAME}@forge`, '--json']), { runner });
      }
      runJsonCommand(CODEX_COMMAND, codexArgs(['plugin', 'marketplace', 'remove', 'forge', '--json']), { runner });
      replacedMarketplace = conflicting.root || 'forge';
    }
    runJsonCommand(CODEX_COMMAND, codexArgs(['plugin', 'marketplace', 'add', REPO_ROOT, '--json']), { runner });
    const refreshed = runJsonCommand(CODEX_COMMAND, codexArgs(['plugin', 'marketplace', 'list', '--json']), { runner });
    marketplaceName = refreshed.value.marketplaces?.find((entry) => marketplaceMatches(entry, REPO_ROOT))?.name;
  }
  if (!marketplaceName) throw new Error(`Codex marketplace was not registered for ${REPO_ROOT}`);
  const installed = runJsonCommand(CODEX_COMMAND, codexArgs(['plugin', 'add', `${PLUGIN_NAME}@${marketplaceName}`, '--json']), { runner });
  const pruned = pruneCodexInstallation(installed.value.installedPath);
  const listed = runJsonCommand(CODEX_COMMAND, codexArgs(['plugin', 'list', '--marketplace', marketplaceName, '--json']), { runner });
  const plugin = installedPlugin(listed.value, `${PLUGIN_NAME}@${marketplaceName}`);
  if (!plugin?.installed || !plugin.enabled) {
    throw new Error('Codex installed Forge but did not report it as enabled');
  }
  const pluginId = `${PLUGIN_NAME}@${marketplaceName}`;
  const hook = await inspectCodexPluginHooks({ pluginId });
  if (!hook.automatic) {
    throw new Error(`Codex installed Forge but its manifest-declared hooks are not active: ${JSON.stringify(hook)}`);
  }
  return {
    client: 'codex',
    mode: managedDir ? 'managed' : 'plugin',
    dry_run: false,
    marketplace: marketplaceName,
    replaced_marketplace: replacedMarketplace,
    plugin,
    install: installed.value,
    pruned,
    managed: managedDir ? installManagedCodex({ managedDir, requirementsPath, managedOnly, force }) : null,
    hook,
  };
}

export function installClaude({
  scope = 'user',
  project = process.cwd(),
  dryRun = false,
  force = false,
  managedSettingsPath = null,
  managedOnly = false,
  runner = spawnSync,
} = {}) {
  if (!['user', 'project', 'local'].includes(scope)) throw new Error(`Unsupported Claude scope: ${scope}`);
  const commands = [
    [CLAUDE_COMMAND, ['plugin', 'marketplace', 'add', REPO_ROOT, '--scope', scope]],
    [CLAUDE_COMMAND, ['plugin', 'install', 'forge@forge', '--scope', scope]],
  ];
  const settings = managedSettingsPath
    ? {
      path: assertExternalPath(managedSettingsPath, 'managedSettingsPath'),
      content: renderClaudeManagedSettings({ marketplacePath: REPO_ROOT, marketplaceName: 'forge', pluginId: `${PLUGIN_NAME}@forge`, managedOnly }),
      written: false,
    }
    : null;
  if (dryRun) return { client: 'claude', scope, dry_run: true, commands, managed_settings: settings };

  const marketplaces = runJsonCommand(CLAUDE_COMMAND, ['plugin', 'marketplace', 'list', '--json'], { cwd: project, runner });
  let marketplaceName = marketplaces.value.find((entry) => marketplaceMatches(entry, REPO_ROOT))?.name;
  let replacedMarketplace = null;
  if (!marketplaceName) {
    const conflicting = marketplaces.value.find((entry) => entry.name === 'forge');
    if (conflicting) {
      if (!force) {
        throw new Error(`Claude marketplace forge points to a different checkout (${conflicting.path || conflicting.installLocation || 'unknown'}); rerun with --force to replace only forge@forge`);
      }
      const oldPlugins = runJsonCommand(CLAUDE_COMMAND, ['plugin', 'list', '--json'], { cwd: project, runner }).value;
      const oldPlugin = installedPlugin(oldPlugins, `${PLUGIN_NAME}@forge`);
      if (oldPlugin) {
        const uninstallScope = oldPlugin.scope || scope;
        const removed = runCommand(CLAUDE_COMMAND, ['plugin', 'uninstall', `${PLUGIN_NAME}@forge`, '--scope', uninstallScope, '--yes'], { cwd: project, runner });
        if (removed.status !== 0) throw new Error(`Claude old Forge uninstall failed: ${removed.stderr || removed.stdout}`);
      }
      const removedMarketplace = runCommand(CLAUDE_COMMAND, ['plugin', 'marketplace', 'remove', 'forge'], { cwd: project, runner });
      if (removedMarketplace.status !== 0) throw new Error(`Claude old Forge marketplace removal failed: ${removedMarketplace.stderr || removedMarketplace.stdout}`);
      replacedMarketplace = conflicting.path || conflicting.installLocation || 'forge';
    }
    const added = runCommand(CLAUDE_COMMAND, ['plugin', 'marketplace', 'add', REPO_ROOT, '--scope', scope], { cwd: project, runner });
    if (added.status !== 0) throw new Error(`Claude marketplace add failed: ${added.stderr || added.stdout}`);
    const refreshed = runJsonCommand(CLAUDE_COMMAND, ['plugin', 'marketplace', 'list', '--json'], { cwd: project, runner });
    marketplaceName = refreshed.value.find((entry) => marketplaceMatches(entry, REPO_ROOT))?.name;
  }
  if (!marketplaceName) throw new Error(`Claude marketplace was not registered for ${REPO_ROOT}`);
  const pluginId = `${PLUGIN_NAME}@${marketplaceName}`;
  if (settings) settings.content = renderClaudeManagedSettings({ marketplacePath: REPO_ROOT, marketplaceName, pluginId, managedOnly });
  let plugins = runJsonCommand(CLAUDE_COMMAND, ['plugin', 'list', '--json'], { cwd: project, runner }).value;
  let plugin = installedPlugin(plugins, pluginId);
  let action = null;
  if (!plugin) {
    const result = runCommand(CLAUDE_COMMAND, ['plugin', 'install', pluginId, '--scope', scope], { cwd: project, runner });
    if (result.status !== 0) throw new Error(`Claude plugin install failed: ${result.stderr || result.stdout}`);
    action = 'install';
  } else if (force) {
    const result = runCommand(CLAUDE_COMMAND, ['plugin', 'update', pluginId, '--scope', scope], { cwd: project, runner });
    if (result.status !== 0) throw new Error(`Claude plugin update failed: ${result.stderr || result.stdout}`);
    action = 'update';
  }
  plugins = runJsonCommand(CLAUDE_COMMAND, ['plugin', 'list', '--json'], { cwd: project, runner }).value;
  plugin = installedPlugin(plugins, pluginId);
  if (!plugin) throw new Error('Claude did not report Forge as installed');
  if (!plugin.enabled) {
    const result = runCommand(CLAUDE_COMMAND, ['plugin', 'enable', pluginId, '--scope', scope], { cwd: project, runner });
    if (result.status !== 0) throw new Error(`Claude plugin enable failed: ${result.stderr || result.stdout}`);
    action = action || 'enable';
    plugins = runJsonCommand(CLAUDE_COMMAND, ['plugin', 'list', '--json'], { cwd: project, runner }).value;
    plugin = installedPlugin(plugins, pluginId);
  }
  if (!plugin?.enabled) throw new Error('Claude installed Forge but did not report it as enabled');
  if (settings) {
    const existing = fs.existsSync(settings.path) ? fs.readFileSync(settings.path, 'utf8') : null;
    if (existing !== null && !force && existing !== settings.content) {
      throw new Error(`Managed settings already exist with different content; rerun with --force: ${settings.path}`);
    }
    if (existing === null || force) writeAtomic(settings.path, settings.content);
    settings.written = true;
  }
  return { client: 'claude', scope, dry_run: false, marketplace: marketplaceName, replaced_marketplace: replacedMarketplace, plugin, action, managed_settings: settings };
}

function inspectFiles() {
  return Object.fromEntries([
    '.codex-plugin/plugin.json',
    'hooks/hooks.json',
    'claude/hooks.json',
    'scripts/hook.mjs',
  ].map((relative) => [relative, hashFile(path.join(PLUGIN_ROOT, relative))]));
}

async function doctorCodex({ runner = spawnSync, hookRunner = spawn, managedDir = null } = {}) {
  try {
    const marketplaces = runJsonCommand(CODEX_COMMAND, codexArgs(['plugin', 'marketplace', 'list', '--json']), { runner }).value;
    const marketplace = marketplaces.marketplaces?.find((entry) => marketplaceMatches(entry, REPO_ROOT)) || null;
    const plugins = marketplace
      ? runJsonCommand(CODEX_COMMAND, codexArgs(['plugin', 'list', '--marketplace', marketplace.name, '--json']), { runner }).value
      : [];
    const plugin = marketplace ? installedPlugin(plugins, `${PLUGIN_NAME}@${marketplace.name}`) : null;
    const managed = managedDir ? inspectManagedBundle(managedDir) : null;
    const hook = plugin
      ? await inspectCodexPluginHooks({ pluginId: `${PLUGIN_NAME}@${marketplace.name}`, runner: hookRunner })
      : { mode: 'plugin', automatic: false, hooks: [], warnings: [], errors: ['Forge is not installed'] };
    return {
      client: 'codex',
      available: true,
      marketplace,
      plugin,
      hook: managed?.mode === 'managed'
        ? { ...hook, managed }
        : managed
          ? { ...hook, managed }
          : hook,
    };
  } catch (error) {
    return { client: 'codex', available: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function doctorClaude({ runner = spawnSync } = {}) {
  try {
    const marketplaces = runJsonCommand(CLAUDE_COMMAND, ['plugin', 'marketplace', 'list', '--json'], { runner }).value;
    const plugins = runJsonCommand(CLAUDE_COMMAND, ['plugin', 'list', '--json'], { runner }).value;
    const marketplace = marketplaces.find((entry) => marketplaceMatches(entry, REPO_ROOT)) || null;
    const plugin = marketplace ? installedPlugin(plugins, `${PLUGIN_NAME}@${marketplace.name}`) : null;
    return {
      client: 'claude',
      available: true,
      marketplace,
      plugin,
      hook: { mode: 'native-plugin', automatic: Boolean(plugin?.enabled) },
    };
  } catch (error) {
    return { client: 'claude', available: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function inspectManagedBundle(managedDir) {
  const requestedRoot = assertExternalPath(managedDir, 'managedDir');
  const bundleRoot = path.join(requestedRoot, 'forge-managed');
  const currentFile = path.join(bundleRoot, 'current.json');
  if (!fs.existsSync(currentFile)) return { mode: 'not-staged', managed_dir: requestedRoot };
  const current = readJson(currentFile);
  const rootExists = fs.existsSync(current.root);
  const dispatcher = fs.existsSync(path.join(bundleRoot, 'forge-hook.mjs'))
    ? hashFile(path.join(bundleRoot, 'forge-hook.mjs'))
    : null;
  const manifest = rootExists && fs.existsSync(path.join(current.root, 'plugin.json'))
    ? hashFile(path.join(current.root, 'plugin.json'))
    : null;
  const hook = rootExists && fs.existsSync(path.join(current.root, 'hooks', 'hooks.json'))
    ? hashFile(path.join(current.root, 'hooks', 'hooks.json'))
    : null;
  return {
    mode: 'managed',
    managed_dir: requestedRoot,
    bundle_root: bundleRoot,
    current_file: currentFile,
    version: current.version,
    root: current.root,
    root_exists: rootExists,
    dispatcher_sha256: current.dispatcher_sha256 || null,
    integrity: manifest === current.manifest_sha256
      && hook === current.hook_sha256
      && dispatcher === current.dispatcher_sha256,
  };
}

export async function doctor({ client = 'all', runner = spawnSync, hookRunner = spawn, managedDir = null } = {}) {
  const clients = client === 'all' ? ['codex', 'claude'] : [client];
  if (clients.some((entry) => !DOCTOR_CLIENTS.has(entry))) throw new Error(`Unsupported doctor client: ${client}`);
  const results = await Promise.all(clients.map((entry) => (
    entry === 'codex' ? doctorCodex({ runner, hookRunner, managedDir }) : doctorClaude({ runner })
  )));
  return {
    forge: { name: PLUGIN_NAME, version: VERSION, source: REPO_ROOT, files: inspectFiles() },
    clients: Object.fromEntries(clients.map((entry, index) => [entry, results[index]])),
  };
}

export async function installHost(client, options = {}) {
  if (!CLIENTS.has(client)) throw new Error(`Unsupported client: ${client}`);
  if (client === 'codex') return installCodex(options);
  if (client === 'claude') return installClaude(options);
  return { client, mode: 'native-skill-or-plugin', ...installClient(client, { ...options, force: options.force !== false }) };
}

function usage() {
  return [
    'Usage:',
    '  node scripts/host-manager.mjs install <codex|claude|opencode|cursor|antigravity> [options]',
    '  node scripts/host-manager.mjs doctor [--client codex|claude|all] [options]',
    '',
    'Options:',
    '  --scope <user|project|local>  Client installation scope (Claude/skill clients)',
    '  --project <path>              Project root for project scope',
    '  --managed-dir <absolute path> Stage the Codex managed hook bundle',
    '  --requirements <absolute path> Write the Codex requirements.toml output',
    '  --managed-settings <absolute path> Write Claude managed-settings.json output',
    '  --managed-only                Ignore user/project/plugin hooks in generated policy',
    '  --force                       Replace only the exact Forge target/output',
    '  --dry-run                     Print the plan without writing or installing',
    '  --json                        Print machine-readable output',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { command: 'install', client: null };
  const values = new Map([
    ['--scope', 'scope'],
    ['--project', 'project'],
    ['--managed-dir', 'managedDir'],
    ['--requirements', 'requirementsPath'],
    ['--managed-settings', 'managedSettingsPath'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') return { help: true };
    if (value === '--force') options.force = true;
    else if (value === '--managed-only') options.managedOnly = true;
    else if (value === '--dry-run') options.dryRun = true;
    else if (value === '--json') options.json = true;
    else if (value === '--client') {
      const next = argv[++index];
      if (!next) throw new Error('--client requires a value');
      options.client = next.toLowerCase();
    } else if (values.has(value)) {
      const next = argv[++index];
      if (!next) throw new Error(`${value} requires a value`);
      options[values.get(value)] = next;
    } else if (value === 'install' || value === 'setup' || value === 'doctor') {
      options.command = value === 'setup' ? 'install' : value;
    } else if (!options.client) options.client = value.toLowerCase();
    else throw new Error(`Unexpected argument: ${value}`);
  }
  if (options.command === 'install' && !options.client) throw new Error('A client name is required');
  if (options.command === 'doctor' && !options.client) options.client = 'all';
  return options;
}

async function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const result = parsed.command === 'doctor'
      ? await doctor(parsed)
      : await installHost(parsed.client, parsed);
    process.stdout.write(`${parsed.json ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
