// Everything the host CLIs report about a run, extracted in one place.
//
// The raw trace used to be parsed for a token total and then thrown away, which
// left every "where did the cost go" question answerable only by inference.
// This module keeps the raw trace on disk and derives a per-step breakdown from
// it, so attribution questions are looked up instead of estimated.

// Codex `item.completed` types that represent work the model did, as opposed to
// bookkeeping. Unknown types are still counted in `items` so a new one shows up
// rather than silently vanishing.
const CODEX_WORK_ITEMS = new Set([
  'agent_message', 'reasoning', 'command_execution', 'file_change',
  'mcp_tool_call', 'web_search', 'patch_apply', 'todo_list',
]);

const EMPTY = Object.freeze({
  known: false,
  reason: 'trace-unavailable',
  steps: null,
  turns: null,
  work_items: null,
  items: {},
  tools: {},
  tool_calls: null,
  assistant_messages: null,
  reasoning_blocks: null,
  assistant_text_chars: null,
  reasoning_chars: null,
  tool_result_chars: null,
  truncated_tool_outputs: null,
  per_step: [],
  first_step_ms: null,
  last_step_ms: null,
});

function bump(bag, key, by = 1) {
  if (!key) return;
  bag[key] = (bag[key] || 0) + by;
}

function usageOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const input = Number(raw.input_tokens ?? raw.inputTokens ?? raw.input);
  const output = Number(raw.output_tokens ?? raw.outputTokens ?? raw.output);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  const cacheRead = Number(raw.cached_input_tokens ?? raw.cache_read_input_tokens ?? raw.cacheReadInputTokens ?? raw.cache_read ?? 0);
  const reasoningOutput = Number(raw.reasoning_output_tokens ?? raw.reasoningOutputTokens ?? raw.reasoning_output ?? 0);
  return {
    input: Math.max(0, input - cacheRead),
    cache_write: Number(raw.cache_creation_input_tokens ?? raw.cacheCreationInputTokens ?? raw.cache_write ?? 0),
    cache_read: cacheRead,
    output,
    reasoning_output: reasoningOutput,
    visible_output: Math.max(0, output - reasoningOutput),
  };
}

// Claude reports input_tokens already excluding the cached prefix, so the
// subtraction above must not be applied to it.
function claudeUsageOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const input = Number(raw.input_tokens ?? raw.inputTokens);
  const output = Number(raw.output_tokens ?? raw.outputTokens);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return {
    input,
    cache_write: Number(raw.cache_creation_input_tokens ?? raw.cacheCreationInputTokens ?? 0),
    cache_read: Number(raw.cache_read_input_tokens ?? raw.cacheReadInputTokens ?? 0),
    output,
  };
}

function millis(value) {
  if (value === null || value === undefined) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber > 1e12 ? asNumber : asNumber * 1_000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function codexTraceStats(stdout) {
  const items = {};
  const tools = {};
  const perStep = [];
  let turns = 0;
  let assistantText = 0;
  let reasoningChars = 0;
  let toolResultChars = 0;
  let truncatedToolOutputs = 0;
  let firstMs = null;
  let lastMs = null;
  let seen = false;

  for (const line of String(stdout || '').split(/\r?\n/).filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    seen = true;
    const at = millis(event.timestamp ?? event.time ?? event.item?.timestamp);
    if (at !== null) {
      firstMs = firstMs === null ? at : Math.min(firstMs, at);
      lastMs = lastMs === null ? at : Math.max(lastMs, at);
    }
    if (event.type === 'item.completed' && event.item?.type) {
      const item = event.item;
      bump(items, item.type);
      if (item.type === 'agent_message') assistantText += String(item.text || '').length;
      if (item.type === 'reasoning') reasoningChars += String(item.text || item.summary || '').length;
      if (item.type === 'command_execution') {
        const command = String(item.command || '').trim().split(/\s+/)[0] || 'command';
        bump(tools, command);
        const output = String(item.aggregated_output ?? item.output ?? '');
        toolResultChars += output.length;
        if (output.length >= 1_048_576 || /\btruncated\b/i.test(output)) truncatedToolOutputs += 1;
      }
      if (item.type === 'mcp_tool_call') bump(tools, `mcp:${item.server || ''}/${item.tool || ''}`);
      if (item.type === 'file_change' || item.type === 'patch_apply') bump(tools, 'file_change');
      if (item.type === 'web_search') bump(tools, 'web_search');
      // Codex only reports usage once per turn, never per item, so output cannot
      // be attributed to a phase directly. Recording each item's size lets a
      // phase's share be derived from where its characters fall in the sequence.
      perStep.push({
        kind: item.type,
        chars: String(item.text || item.summary || item.command || '').length,
        usage: null,
        at,
      });
    }
    if (event.type === 'turn.completed' || event.type === 'response.completed') {
      turns += 1;
      const usage = usageOf(event.usage || event.response?.usage);
      perStep.push({ kind: 'turn.completed', usage, at });
    }
  }

  if (!seen) return { ...EMPTY };
  const workItems = Object.entries(items)
    .filter(([type]) => CODEX_WORK_ITEMS.has(type))
    .reduce((total, [, count]) => total + count, 0);
  return {
    known: true,
    reason: null,
    steps: turns || workItems,
    turns,
    work_items: workItems,
    items,
    tools,
    tool_calls: Object.values(tools).reduce((total, count) => total + count, 0),
    assistant_messages: items.agent_message || 0,
    reasoning_blocks: items.reasoning || 0,
    assistant_text_chars: assistantText,
    reasoning_chars: reasoningChars,
    tool_result_chars: toolResultChars,
    truncated_tool_outputs: truncatedToolOutputs,
    per_step: perStep,
    first_step_ms: firstMs,
    last_step_ms: lastMs,
  };
}

// A sliced or interrupted run concatenates one JSON document per invocation, so
// the whole buffer is not valid JSON. Parse the largest prefix that is, then
// continue with the rest, instead of losing the entire trace.
function claudeDocuments(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return [];
  try { return [JSON.parse(text)]; } catch { /* concatenated documents; split below */ }
  const documents = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === '[' || character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === ']' || character === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try { documents.push(JSON.parse(text.slice(start, index + 1))); } catch { /* skip a truncated document */ }
        start = -1;
      }
    }
  }
  return documents;
}

export function claudeTraceStats(stdout) {
  const documents = claudeDocuments(stdout);
  if (!documents.length) return { ...EMPTY };
  const messages = documents.flatMap((doc) => (Array.isArray(doc) ? doc : [doc]));
  const items = {};
  const tools = {};
  const perStep = [];
  let assistantMessages = 0;
  let thinkingBlocks = 0;
  let assistantText = 0;
  let thinkingChars = 0;
  let toolResultChars = 0;
  let truncatedToolOutputs = 0;
  let turns = 0;

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    bump(items, message.type || 'unknown');
    if (message.type === 'assistant') {
      assistantMessages += 1;
      turns += 1;
      const usage = claudeUsageOf(message.message?.usage);
      const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
      for (const block of blocks) {
        if (block?.type === 'text') assistantText += String(block.text || '').length;
        if (block?.type === 'thinking' || block?.type === 'redacted_thinking') {
          thinkingBlocks += 1;
          thinkingChars += String(block.thinking || '').length;
        }
        if (block?.type === 'tool_use') bump(tools, block.name || 'tool');
      }
      perStep.push({ kind: 'assistant', usage, at: millis(message.timestamp) });
    }
    if (message.type === 'user') {
      const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
      for (const block of blocks) {
        if (block?.type !== 'tool_result') continue;
        const content = block.content;
        toolResultChars += typeof content === 'string'
          ? content.length
          : (Array.isArray(content) ? content.reduce((total, part) => total + String(part?.text || '').length, 0) : 0);
        if (toolResultChars >= 1_048_576) truncatedToolOutputs = 1;
      }
    }
  }

  if (!messages.length) return { ...EMPTY };
  return {
    known: true,
    reason: null,
    steps: assistantMessages || null,
    turns,
    work_items: null,
    items,
    tools,
    tool_calls: Object.values(tools).reduce((total, count) => total + count, 0),
    assistant_messages: assistantMessages,
    reasoning_blocks: thinkingBlocks,
    assistant_text_chars: assistantText,
    reasoning_chars: thinkingChars,
    tool_result_chars: toolResultChars,
    truncated_tool_outputs: truncatedToolOutputs,
    per_step: perStep,
    first_step_ms: null,
    last_step_ms: null,
  };
}

export function traceStats(host, stdout) {
  return host === 'codex' ? codexTraceStats(stdout) : claudeTraceStats(stdout);
}

// Splits a git diff into the work the model actually did and files the harness
// copied into the worktree (the Forge hook shims), which otherwise inflate the
// apparent size of the Forge arm's change.
export function diffStats(diff, harnessPrefixes = ['.codex/', '.claude/']) {
  const byFile = {};
  let work = 0;
  let harness = 0;
  let added = 0;
  let removed = 0;
  for (const chunk of String(diff || '').split(/^diff --git /m).filter(Boolean)) {
    const name = (/a\/(\S+)/.exec(chunk) || [])[1] || 'unknown';
    const size = chunk.length;
    byFile[name] = size;
    if (harnessPrefixes.some((prefix) => name.startsWith(prefix))) harness += size;
    else {
      work += size;
      for (const line of chunk.split(/\r?\n/)) {
        if (/^\+(?!\+\+)/.test(line)) added += 1;
        else if (/^-(?!--)/.test(line)) removed += 1;
      }
    }
  }
  return { by_file: byFile, work_chars: work, harness_chars: harness, work_lines_added: added, work_lines_removed: removed };
}

// Phase compliance, from the persisted trace: did the session actually do
// meta-prompt+plan first, run verification, and review once or twice after
// green? A second review is valid only after focused verification following
// the first review.
// The current Forge contract requires a `Forge plan` heading; older traces
// used `## Plan`. Accept both exact forms and keep the check structural:
// repository discovery may precede the plan, but the plan must appear before
// focused verification. Codex traces only; other hosts report known:false
// rather than a fake verdict.
export function phaseCheck(host, stdout, verify) {
  if (host !== 'codex') return { known: false, pass: null, reason: 'trace-format-not-supported' };
  const sequence = [];
  for (const line of String(stdout || '').split(/\r?\n/).filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type !== 'item.completed' || !event.item?.type) continue;
    if (event.item.type === 'agent_message') sequence.push({ kind: 'message', text: String(event.item.text || '') });
    if (event.item.type === 'command_execution') sequence.push({ kind: 'command', text: String(event.item.command || '') });
  }
  const verifyNeedle = [verify.command, ...verify.args].join(' ');
  const verifyIndexes = sequence
    .map((entry, index) => (entry.kind === 'command' && entry.text.includes(verifyNeedle) ? index : -1))
    .filter((index) => index >= 0);
  const planIndex = sequence.findIndex((entry) => entry.kind === 'message' && (
    /^\s*##\s*Plan\b/m.test(entry.text)
    || /^\s*(?:#{1,6}\s*)?Forge plan\b/m.test(entry.text)
  ));
  const planFirst = planIndex >= 0 && (verifyIndexes.length === 0 || planIndex < verifyIndexes[0]);
  const reviewIndexes = sequence
    .map((entry, index) => (entry.kind === 'message' && /^\s*## Review\b/m.test(entry.text) ? index : -1))
    .filter((index) => index >= 0);
  const firstReviewAfterVerify = reviewIndexes.length > 0 && verifyIndexes.length > 0
    && reviewIndexes[0] > verifyIndexes[0];
  const secondReviewHasVerification = reviewIndexes.length < 2
    || verifyIndexes.some((index) => index > reviewIndexes[0] && index < reviewIndexes[1]);
  const reviewCountValid = reviewIndexes.length >= 1 && reviewIndexes.length <= 2;
  const pass = planFirst && verifyIndexes.length > 0 && reviewCountValid
    && firstReviewAfterVerify && secondReviewHasVerification;
  const reason = pass ? 'plan → execution → verify → one or two reviews' : [
    !planFirst && 'Forge plan turn missing or appeared after execution',
    !verifyIndexes.length && 'verification command never ran in-session',
    !reviewCountValid && `expected one or two ## Review turns, found ${reviewIndexes.length}`,
    reviewCountValid && !firstReviewAfterVerify && 'first ## Review appeared before verification',
    reviewIndexes.length === 2 && !secondReviewHasVerification && 'second ## Review lacked focused verification after the first review',
  ].filter(Boolean).join('; ');
  return {
    known: true,
    pass,
    reason,
    plan_first: planFirst,
    verify_runs: verifyIndexes.length,
    review_count: reviewIndexes.length,
    review_after_verify: firstReviewAfterVerify,
    second_review_has_verification: secondReviewHasVerification,
  };
}

// The Forge injection, measured rather than estimated. `chars` is exact; tokens
// use the same ~4 chars/token approximation the context telemetry already uses,
// so the two numbers are comparable.
export function injectionStats(parts = {}) {
  const out = { chars: 0, tokens_estimate: 0, parts: {} };
  for (const [name, value] of Object.entries(parts)) {
    const chars = typeof value === 'string' ? value.length : Number(value || 0);
    out.parts[name] = { chars, tokens_estimate: Math.round(chars / 4) };
    out.chars += chars;
  }
  out.tokens_estimate = Math.round(out.chars / 4);
  return out;
}
