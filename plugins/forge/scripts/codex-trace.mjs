import fs from 'node:fs';
import path from 'node:path';

function identifiers(env) {
  return [...new Set([env.CODEX_SESSION_ID, env.CODEX_THREAD_ID]
    .map((value) => String(value || '').trim())
    .filter((value) => /^[a-zA-Z0-9_-]{8,}$/.test(value)))];
}

function codexRoot(env) {
  const configured = String(env.CODEX_HOME || '').trim();
  return configured && path.isAbsolute(configured)
    ? configured
    : path.join(String(env.USERPROFILE || env.HOME || ''), '.codex');
}

// Codex does not expose transcript_path to ordinary tool commands, but it does
// expose the current session/thread identifier. Resolve only an exact matching
// rollout filename below the host-owned sessions directory.
export function locateCodexTranscript(env = process.env) {
  const ids = identifiers(env);
  const root = codexRoot(env);
  if (!ids.length || !path.isAbsolute(root)) return null;
  const pending = ['sessions', 'archived_sessions']
    .map((directory) => path.join(root, directory))
    .filter((directory) => fs.existsSync(directory));
  if (!pending.length) return null;
  const matches = [];
  try {
    while (pending.length) {
      const directory = pending.pop();
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) pending.push(target);
        else if (entry.isFile() && entry.name.endsWith('.jsonl') && ids.some((id) => entry.name.includes(id))) {
          matches.push({ file: target, mtime: fs.statSync(target).mtimeMs });
        }
      }
    }
  } catch {
    return null;
  }
  matches.sort((left, right) => right.mtime - left.mtime);
  return matches[0]?.file || null;
}

export function codexTraceContext(env = process.env) {
  const sessionId = identifiers(env)[0] || null;
  return {
    session_id: sessionId,
    transcript_path: locateCodexTranscript(env),
  };
}
