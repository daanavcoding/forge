#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DISPATCHER_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CURRENT_FILE = path.join(DISPATCHER_ROOT, 'current.json');

async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function dispatch(payload = {}, dependencies = {}) {
  try {
    const state = JSON.parse(fs.readFileSync(CURRENT_FILE, 'utf8'));
    const script = payload.hook_event_name === 'SessionEnd' ? 'session-end.mjs' : 'hook.mjs';
    const modulePath = path.join(state.root, 'scripts', script);
    const loader = dependencies.load || ((specifier) => import(specifier));
    const module = await loader(pathToFileURL(modulePath).href);
    const result = await module.handle(payload);
    return result || {};
  } catch {
    return {};
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  dispatch(await readInput()).then((result) => {
    process.stdout.write(JSON.stringify(result));
  }).catch(() => process.stdout.write('{}'));
}
