#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './hook.mjs';

export async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload = {};
  try { payload = JSON.parse(raw); } catch { /* Fail open on non-JSON input. */ }
  process.stdout.write(JSON.stringify(handle({ ...payload, host: payload.host || 'claude' })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => process.stdout.write('{}'));
}
