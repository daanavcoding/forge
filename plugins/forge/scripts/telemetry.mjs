import crypto from 'node:crypto';
import fs from 'node:fs';
import { PRIVATE_SKILL_CATALOG } from '../worker-skills/catalog.mjs';

const MILLION = 1_000_000;
const PRICING_FILE = new URL('../data/model-pricing.json', import.meta.url);

// The runtime uses only the checked-in rate snapshot; official rows override Models.dev fallbacks.
const AGENT_DEFAULT_PROVIDERS = {
  codex: 'openai',
  codex_cli: 'openai',
  codex_subscription: 'openai',
  openai: 'openai',
  openai_api: 'openai',
  claude: 'anthropic',
  claude_code: 'anthropic',
  anthropic: 'anthropic',
  anthropic_api: 'anthropic',
  gemini: 'google',
  gemini_cli: 'google',
  google: 'google',
  google_api: 'google',
};

const AGENT_NAMES = new Set([
  'codex', 'codex_cli', 'codex_subscription', 'claude', 'claude_code',
  'gemini', 'gemini_cli', 'opencode', 'cursor', 'antigravity', 'generic',
]);

const PROVIDER_ALIASES = [
  [/codex|openai|(?:^|[/_-])gpt|^o[1345](?:-|$)/, 'openai'],
  [/claude|anthropic/, 'anthropic'],
  [/gemini|google/, 'google'],
  [/grok|xai|x-ai/, 'xai'],
  [/mistral/, 'mistral'],
  [/deepseek/, 'deepseek'],
  [/cohere/, 'cohere'],
];

let pricingCatalog;

function loadPricingCatalog() {
  if (pricingCatalog !== undefined) return pricingCatalog;
  try {
    const parsed = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
    const providers = parsed?.providers;
    const checksum = providers && typeof providers === 'object'
      ? crypto.createHash('sha256').update(JSON.stringify(providers)).digest('hex')
      : null;
    pricingCatalog = parsed?.schema_version === 2 && checksum === parsed.catalog_sha256
      ? parsed
      : null;
  } catch {
    pricingCatalog = null;
  }
  return pricingCatalog;
}

function finite(value) {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function integer(value) {
  const number = finite(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function oneLine(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(oneLine).filter(Boolean))].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function listValue(value) {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' && value.trim() ? [value] : [];
}

function countMap(value) {
  if (Array.isArray(value)) {
    return value.reduce((counts, item) => {
      const name = oneLine(item);
      if (name) counts[name] = (counts[name] || 0) + 1;
      return counts;
    }, {});
  }
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value)
    .map(([name, count]) => [oneLine(name), integer(count)])
    .filter(([name, count]) => name && count !== null && count > 0)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function evidenceMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([name, evidence]) => [oneLine(name), stringList(listValue(evidence))])
    .filter(([name, evidence]) => name && evidence.length)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function recordEvidence(target, name, evidence) {
  const skill = oneLine(name);
  const source = oneLine(evidence);
  if (!skill || !source) return;
  if (!target[skill]) target[skill] = new Set();
  target[skill].add(source);
}

function exactModel(models, model) {
  const normalized = oneLine(model)?.toLowerCase();
  if (!normalized || !models || typeof models !== 'object') return null;
  const key = Object.keys(models).find((candidate) => candidate.toLowerCase() === normalized);
  return key ? { key, rate: models[key] } : null;
}

function normalizedIdentifier(value) {
  return oneLine(value)?.toLowerCase() || null;
}

function providerFromValue(value) {
  const normalized = normalizedIdentifier(value);
  if (!normalized) return null;
  if (loadPricingCatalog()?.providers?.[normalized]) return normalized;
  return null;
}

function providerFromModelFamily(model) {
  const normalized = normalizedIdentifier(model);
  if (!normalized) return null;
  const modelName = normalized.split('/').at(-1);
  const family = [
    [/^claude(?:-|$)/, 'anthropic'],
    [/^(?:gpt-|o[1345](?:-|$)|chatgpt-)/, 'openai'],
    [/^gemini(?:-|$)/, 'google'],
    [/^grok(?:-|$)/, 'xai'],
    [/^mimo(?:-|$)/, 'xiaomi'],
    [/^mistral(?:-|$)|^codestral(?:-|$)/, 'mistral'],
    [/^deepseek(?:-|$)/, 'deepseek'],
    [/^command-(?:a|r)(?:-|$)/, 'cohere'],
    [/^qwen(?:-|$)|^qvq(?:-|$)/, 'alibaba'],
    [/^kimi(?:-|$)/, 'moonshotai'],
    [/^minimax(?:-|$)/, 'minimax'],
    [/^glm(?:-|$)/, 'zai'],
  ].find(([pattern]) => pattern.test(modelName));
  return family?.[1] || null;
}

function providerFromModel(model) {
  const normalized = normalizedIdentifier(model);
  if (!normalized) return null;
  return providerFromModelFamily(model)
    || (normalized.includes('/') ? providerFromValue(normalized.slice(0, normalized.indexOf('/'))) : null);
}

function providerFromPlatform(platform, catalog) {
  const normalized = normalizedIdentifier(platform);
  if (!normalized) return null;
  if (AGENT_DEFAULT_PROVIDERS[normalized]) return AGENT_DEFAULT_PROVIDERS[normalized];
  const alias = PROVIDER_ALIASES.find(([pattern]) => pattern.test(normalized));
  if (alias) return alias[1];
  return !AGENT_NAMES.has(normalized) && catalog?.providers?.[normalized] ? normalized : null;
}

export function resolvePricingRoute({ model = null, platform = null, provider = null } = {}) {
  const familyProvider = providerFromModelFamily(model);
  if (familyProvider) {
    const platformName = normalizedIdentifier(platform);
    return {
      provider: familyProvider,
      resolution: AGENT_DEFAULT_PROVIDERS[platformName] === familyProvider
        ? 'official-agent-default' : 'official-model-family',
    };
  }
  const explicitProvider = providerFromValue(provider);
  if (explicitProvider) {
    return { provider: explicitProvider, resolution: 'observed-provider' };
  }

  const modelProvider = providerFromModel(model);
  if (modelProvider) {
    return { provider: modelProvider, resolution: 'model-namespace' };
  }

  const platformName = normalizedIdentifier(platform);
  const platformProvider = providerFromPlatform(platform, loadPricingCatalog());
  if (platformProvider) {
    return {
      provider: platformProvider,
      resolution: AGENT_DEFAULT_PROVIDERS[platformName]
        ? 'official-agent-default'
        : 'platform-provider',
    };
  }

  return {
    provider: null,
    resolution: 'ambiguous-agent',
  };
}

function knownPricing(model, { platform = null, provider = null } = {}) {
  const normalized = oneLine(model)?.toLowerCase();
  if (!normalized) return null;
  const catalog = loadPricingCatalog();
  const route = resolvePricingRoute({ model: normalized, platform, provider });
  const providerId = route.provider;
  const providerPrefix = providerId && normalized.includes('/') ? normalized.split('/').at(-1) : null;
  const match = providerId
    ? exactModel(catalog?.providers?.[providerId]?.models, normalized)
      || (providerPrefix ? exactModel(catalog?.providers?.[providerId]?.models, providerPrefix) : null)
    : null;
  if (match) {
    const input = finite(match.rate.input);
    const output = finite(match.rate.output);
    if (input !== null && output !== null) {
      return {
        model: match.key,
        provider: providerId,
        input,
        cached_input: finite(match.rate.cached_input),
        cache_write: finite(match.rate.cache_write),
        cache_write_5m: finite(match.rate.cache_write_5m),
        cache_write_1h: finite(match.rate.cache_write_1h),
        output,
        context_tiers: Array.isArray(match.rate.context_tiers) ? match.rate.context_tiers : [],
        time_tiers: Array.isArray(match.rate.time_tiers) ? match.rate.time_tiers : [],
        max_exact_context_tokens: integer(match.rate.max_exact_context_tokens),
        currency: 'USD',
        source: oneLine(match.rate.source_url),
        source_kind: oneLine(match.rate.source_kind) || 'official',
        as_of: oneLine(match.rate.as_of) || oneLine(catalog.source?.verified_at),
        catalog_sha256: oneLine(catalog.catalog_sha256),
        resolution: route.resolution,
        provider_source: oneLine(catalog.providers[providerId].source_url),
      };
    }
  }
  return null;
}

function isApiPlatform(platform) {
  return /(?:^api$|[_ -]api$|^openai[_ -]?api$)/i.test(oneLine(platform) || '');
}

function money(value) {
  if (value === null) return 'unavailable';
  return value < 0.01 ? value.toFixed(6) : value.toFixed(4);
}

function amount(value) {
  return value === null ? 'unavailable' : String(value);
}

function milliseconds(value) {
  return value === null ? 'unavailable' : `${value} ms`;
}

function rateWindow(value) {
  if (!value || typeof value !== 'object') return null;
  const usedPercent = finite(value.used_percent ?? value.usedPercent);
  const windowMinutes = integer(value.window_minutes ?? value.windowMinutes);
  const resetsAt = timestampMs(value.resets_at ?? value.resetsAt);
  if (usedPercent === null && windowMinutes === null && resetsAt === null) return null;
  return { used_percent: usedPercent, window_minutes: windowMinutes, resets_at: resetsAt };
}

function rateLimitsShape(value) {
  if (!value || typeof value !== 'object') return null;
  const credits = value.credits && typeof value.credits === 'object' ? value.credits : {};
  const result = {
    plan_type: oneLine(value.plan_type ?? value.planType),
    primary: rateWindow(value.primary),
    secondary: rateWindow(value.secondary),
    credit_balance: finite(credits.balance ?? value.credit_balance ?? value.creditBalance),
    has_credits: typeof credits.has_credits === 'boolean' ? credits.has_credits : null,
    unlimited: typeof credits.unlimited === 'boolean' ? credits.unlimited : null,
  };
  return Object.values(result).every((item) => item === null) ? null : result;
}

function usageShape(value, { cachedInputIsSeparate = false } = {}) {
  if (!value || typeof value !== 'object') return null;
  const inputDetails = value.input_tokens_details ?? value.prompt_tokens_details ?? {};
  const cacheHits = integer(value.prompt_cache_hit_tokens);
  const cacheMisses = integer(value.prompt_cache_miss_tokens);
  const inputTokens = integer(value.input_tokens ?? value.prompt_tokens ?? value.inputTokens ?? value.input)
    ?? (cacheHits !== null && cacheMisses !== null ? cacheHits + cacheMisses : null);
  const cachedInputTokens = integer(value.cached_input_tokens ?? value.cache_read_input_tokens
    ?? value.cachedInputTokens ?? value.cache_read ?? inputDetails.cached_tokens ?? cacheHits);
  const cacheWriteTokens = integer(value.cache_write_input_tokens ?? value.cache_creation_input_tokens
    ?? value.cacheWriteInputTokens ?? inputDetails.cache_write_tokens);
  const cacheCreation = value.cache_creation && typeof value.cache_creation === 'object' ? value.cache_creation : {};
  const cacheWrite5m = integer(cacheCreation.ephemeral_5m_input_tokens ?? value.cache_write_5m_input_tokens);
  const cacheWrite1h = integer(cacheCreation.ephemeral_1h_input_tokens ?? value.cache_write_1h_input_tokens);
  const totalInput = cachedInputIsSeparate && inputTokens !== null
    ? inputTokens + (cachedInputTokens || 0) + (cacheWriteTokens || 0)
    : inputTokens;
  const outputTokens = integer(value.output_tokens ?? value.completion_tokens ?? value.outputTokens ?? value.output);
  const usage = {
    // Claude reports uncached input and cache reads/writes separately. Codex
    // reports total input with cache categories included in that total.
    input_tokens: totalInput,
    uncached_input_tokens: cachedInputIsSeparate ? inputTokens
      : totalInput !== null && cachedInputTokens !== null && cacheWriteTokens !== null
        ? totalInput - cachedInputTokens - cacheWriteTokens : cacheMisses,
    cached_input_tokens: cachedInputIsSeparate ? (cachedInputTokens ?? 0) : cachedInputTokens,
    cache_write_input_tokens: cachedInputIsSeparate ? (cacheWriteTokens ?? 0) : cacheWriteTokens,
    cache_write_5m_input_tokens: cachedInputIsSeparate ? (cacheWrite5m ?? 0) : cacheWrite5m,
    cache_write_1h_input_tokens: cachedInputIsSeparate ? (cacheWrite1h ?? 0) : cacheWrite1h,
    output_tokens: outputTokens,
    reasoning_output_tokens: integer(value.reasoning_output_tokens ?? value.reasoningOutputTokens ?? value.reasoning_output),
    total_tokens: integer(value.total_tokens ?? value.totalTokens ?? value.total)
      ?? (totalInput !== null && outputTokens !== null ? totalInput + outputTokens : null),
  };
  const tokenCount = integer(value.token_count ?? value.tokenCount);
  if (tokenCount !== null) usage.token_count = tokenCount;
  if (Object.values(usage).every((value) => value === null)) return null;
  return usage;
}

function addUsage(left, right) {
  const result = {};
  for (const key of ['input_tokens', 'uncached_input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'cache_write_5m_input_tokens', 'cache_write_1h_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens']) {
    const a = integer(left?.[key]);
    const b = integer(right?.[key]);
    result[key] = a === null && b === null ? null : (a || 0) + (b || 0);
  }
  const aTokenCount = integer(left?.token_count);
  const bTokenCount = integer(right?.token_count);
  result.token_count = aTokenCount === null && bTokenCount === null ? null : (aTokenCount || 0) + (bTokenCount || 0);
  return result;
}

function subtractUsage(current, baseline) {
  if (!current) return null;
  const result = {};
  for (const key of ['input_tokens', 'uncached_input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'cache_write_5m_input_tokens', 'cache_write_1h_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens', 'token_count']) {
    const value = integer(current[key]);
    const before = integer(baseline?.[key]);
    result[key] = value === null ? null : Math.max(0, value - (before || 0));
  }
  return result;
}

function traceRecords(trace) {
  if (Array.isArray(trace)) return trace.filter((value) => value && typeof value === 'object');
  if (trace && typeof trace === 'object') return [trace];
  const text = String(trace || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((value) => value && typeof value === 'object');
  } catch { /* JSONL is the normal host transcript format. */ }
  return text.split(/\r?\n/).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter((value) => value && typeof value === 'object');
}

function timestampMs(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (Number.isFinite(number)) return number > 1e12 ? number : number * 1_000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstMetric(sources, names) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const name of names) {
      const value = finite(source[name]);
      if (value !== null) return value;
    }
  }
  return null;
}

function selectedToolInputs(payload, toolUseBlocks) {
  const values = [];
  const addInput = (value) => {
    if (typeof value === 'string') {
      values.push(value);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) addInput(item);
      return;
    }
    for (const name of ['file_path', 'path', 'command']) {
      if (typeof value[name] === 'string') values.push(value[name]);
    }
    for (const name of ['input', 'arguments']) {
      if (Object.hasOwn(value, name)) addInput(value[name]);
    }
  };
  addInput(payload);
  for (const block of toolUseBlocks) addInput(block.input);
  return values.join('\n');
}

function traceMessageIdentity(message, payload, record) {
  const messageId = oneLine(message?.id);
  if (messageId) return `message:${messageId}`;
  const requestId = oneLine(message?.requestId ?? message?.request_id
    ?? payload.requestId ?? payload.request_id ?? record.requestId ?? record.request_id);
  return requestId ? `request:${requestId}` : null;
}

// Extract only stable, scalar observations from a host transcript. The
// transcript format is intentionally treated as best-effort input: malformed
// lines, new fields, or missing files must never affect the coding workflow.
export function telemetryFromTrace(trace, { state = {}, source = 'host trace', baseline_usage = null } = {}) {
  const records = traceRecords(trace);
  if (!records.length) return null;
  const startedMs = timestampMs(state.started_epoch_ms ?? state.started_at);
  const finishedMs = timestampMs(state.finished_epoch_ms ?? state.finished_at);
  let preRunUsage = null;
  let preRunModel = null;
  let preRunProvider = null;
  let preRunEffort = null;
  let hasPreRunRecords = false;
  let cumulativeUsage = null;
  const perTurnUsages = [];
  const directUsages = [];
  const directUsageByMessage = new Map();
  const codexCalls = [];
  let explicitTokenCount = null;
  let explicitDuration = null;
  let explicitLatency = null;
  let explicitModelLatency = null;
  let credits = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let tokenEvents = 0;
  let turnContexts = 0;
  let taskStarts = 0;
  let observedRateLimits = null;
  let observedModel = oneLine(state.model);
  let currentModel = observedModel;
  let observedProvider = oneLine(state.provider);
  let observedEffort = oneLine(state.reasoning_effort);
  const toolUsage = {};
  const seenAssistantMessages = new Set();
  const publicSkills = new Set(stringList(listValue(state.public_skills ?? state.publicSkills)));
  const internalSkills = new Set();
  const skillEvidence = {};
  for (const skill of publicSkills) recordEvidence(skillEvidence, skill, 'hook activation');

  let lastSeenMs = null;
  for (const record of records) {
    const payload = record.payload && typeof record.payload === 'object' ? record.payload : record;
    const info = payload.info && typeof payload.info === 'object' ? payload.info : record.info;
    const recordedAt = timestampMs(record.timestamp ?? record.time ?? payload.timestamp ?? payload.time ?? record.at ?? payload.at);
    if (recordedAt !== null) lastSeenMs = recordedAt;
    const at = recordedAt ?? lastSeenMs;
    if (at === null && (startedMs !== null || finishedMs !== null)) continue;
    if (at !== null && finishedMs !== null && at > finishedMs) continue;
    if (startedMs !== null && at !== null && at < startedMs) {
      hasPreRunRecords = true;
      const settings = payload.thread_settings && typeof payload.thread_settings === 'object' ? payload.thread_settings : null;
      preRunModel = oneLine(payload.message?.model ?? settings?.model ?? payload.model ?? record.model) || preRunModel;
      preRunProvider = oneLine(payload.message?.provider ?? settings?.provider ?? payload.provider ?? record.provider) || preRunProvider;
      preRunEffort = oneLine(payload.message?.reasoning_effort ?? settings?.reasoning_effort ?? payload.reasoning_effort ?? record.reasoning_effort) || preRunEffort;
      if (String(payload.type || record.type || '').toLowerCase() === 'token_count') {
        preRunUsage = usageShape(info?.total_token_usage ?? payload.total_token_usage ?? record.total_token_usage) || preRunUsage;
      }
      continue;
    }
    if (at !== null) {
      firstTimestamp = firstTimestamp === null ? at : Math.min(firstTimestamp, at);
      lastTimestamp = lastTimestamp === null ? at : Math.max(lastTimestamp, at);
    }
    const isTokenEvent = String(payload.type || record.type || '').toLowerCase() === 'token_count';
    if (String(record.type || '').toLowerCase() === 'turn_context') turnContexts += 1;
    if (String(payload.type || '').toLowerCase() === 'task_started') taskStarts += 1;
    const threadSettings = payload.thread_settings && typeof payload.thread_settings === 'object'
      ? payload.thread_settings
      : null;
    const message = payload.message && typeof payload.message === 'object'
      ? payload.message
      : record.message && typeof record.message === 'object'
        ? record.message
        : null;
    const messageType = String(record.type || payload.type || '').toLowerCase();
    const messageRole = String(message?.role ?? payload.role ?? '').toLowerCase();
    const messageContent = Array.isArray(message?.content)
      ? message.content
      : Array.isArray(payload.content) ? payload.content : [];
    const contentBlocks = messageContent.filter((block) => block && typeof block === 'object');
    const toolUseBlocks = contentBlocks.filter((block) => [
      'tool_use', 'tool-call', 'tool_call', 'function_call', 'function-call',
    ].includes(String(block.type || '').toLowerCase()));
    const isAssistantMessage = messageType === 'assistant'
      || (messageRole === 'assistant' && Boolean(message));
    const messageIdentity = traceMessageIdentity(message, payload, record);
    const traceModel = oneLine(message?.model ?? threadSettings?.model ?? payload.model ?? record.model);
    if (traceModel && (!observedModel || /^(?:default|inherit)$/i.test(observedModel))) observedModel = traceModel;
    if (traceModel) currentModel = traceModel;
    observedProvider = observedProvider || oneLine(message?.provider ?? threadSettings?.provider ?? payload.provider ?? record.provider);
    observedEffort = observedEffort || oneLine(message?.reasoning_effort ?? threadSettings?.reasoning_effort ?? payload.reasoning_effort ?? record.reasoning_effort);
    const itemType = String(payload.type || '').toLowerCase();
    const isToolCall = ['custom_tool_call', 'function_call', 'tool_call'].includes(itemType) || toolUseBlocks.length > 0;
    const isUserMessage = (itemType === 'message' && String(payload.role || '').toLowerCase() === 'user')
      || messageType === 'user'
      || (messageRole === 'user' && Boolean(message));
    if (isToolCall || isUserMessage) {
      const userText = isUserMessage
        ? contentBlocks.map((block) => block.text || block.input_text || block.output_text || '').join('\n')
        : '';
      const searchable = `${selectedToolInputs(payload, toolUseBlocks)}\n${userText}\n${isUserMessage ? payload.text || '' : ''}`
        .replace(/\\+/g, '/');
      const publicSkillPattern = /(?:^|[\\/])skills[\\/]+([a-z0-9-]+)[\\/]+SKILL\.md/gi;
      for (const match of searchable.matchAll(publicSkillPattern)) {
        publicSkills.add(match[1]);
        recordEvidence(skillEvidence, match[1], 'transcript skill reference');
      }
      const attachmentPattern = /\[\$[a-z0-9-]+:([a-z0-9-]+)\]/gi;
      for (const match of searchable.matchAll(attachmentPattern)) {
        publicSkills.add(match[1]);
        recordEvidence(skillEvidence, match[1], 'host skill attachment');
      }
      if (isToolCall) {
        // Read tools use file_path; shell tools use command or input.
        const toolInputs = selectedToolInputs(payload, toolUseBlocks);
        const directReadTool = ['read', 'bash', 'exec_command'].includes(String(payload.name || '').toLowerCase())
          || toolUseBlocks.some((block) => ['read', 'bash'].includes(String(block.name || '').toLowerCase()));
        const wrappedRead = /tools\.exec_command\s*\(/.test(toolInputs)
          || (!/tools\.apply_patch\s*\(/.test(toolInputs)
            && (/\b(?:Get-Content|cat)\b/.test(toolInputs)
              || (/worker-skills/i.test(toolInputs) && /SKILL\.md/i.test(toolInputs))));
        if (directReadTool || wrappedRead) {
          const skillSearch = toolInputs.replace(/\\+/g, '/');
          if (/worker-skills/i.test(skillSearch) && !/tools\.apply_patch\s*\(/.test(skillSearch)) {
            for (const { name } of PRIVATE_SKILL_CATALOG) {
              const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              if (new RegExp(`(?:^|[^a-z0-9_-])${escapedName}[/\\\\]+SKILL\\.md\\b`, 'i').test(skillSearch)) {
                internalSkills.add(name);
                recordEvidence(skillEvidence, name, 'private SKILL.md read');
              }
            }
          }
        }
      }
    }
    if (isToolCall) {
      const nestedToolNames = toolUseBlocks.map((block) => oneLine(block.name || block.tool_name || block.toolName)).filter(Boolean);
      const toolNames = nestedToolNames.length
        ? nestedToolNames
        : [oneLine(payload.name || payload.tool_name || payload.toolName)].filter(Boolean);
      for (const toolName of toolNames) {
        toolUsage[toolName] = (toolUsage[toolName] || 0) + 1;
      }
    }
    if (isAssistantMessage && (!messageIdentity || !seenAssistantMessages.has(messageIdentity))) {
      turnContexts += 1;
      if (messageIdentity) seenAssistantMessages.add(messageIdentity);
    }
    if (isTokenEvent) {
      tokenEvents += 1;
      observedRateLimits = rateLimitsShape(payload.rate_limits ?? record.rate_limits) || observedRateLimits;
      const total = usageShape(info?.total_token_usage ?? payload.total_token_usage ?? record.total_token_usage);
      const last = usageShape(info?.last_token_usage ?? payload.last_token_usage ?? record.last_token_usage);
      if (total) cumulativeUsage = total;
      if (last) {
        codexCalls.push({ model: currentModel, usage: last,
          at: at === null ? null : new Date(at).toISOString() });
        if (!total) perTurnUsages.push(last);
      }
      explicitTokenCount = firstMetric([info, payload, record], ['token_count', 'tokenCount']) ?? explicitTokenCount;
    }
    const messageUsage = message?.usage && typeof message.usage === 'object' ? message.usage : null;
    const claudeUsage = Boolean(messageUsage && (
      Object.hasOwn(messageUsage, 'cache_read_input_tokens')
      || Object.hasOwn(messageUsage, 'cache_creation_input_tokens')
      || /^claude(?:-|$)/i.test(oneLine(message?.model) || observedModel || '')
    ));
    const direct = usageShape(messageUsage ?? payload.usage ?? record.usage, {
      cachedInputIsSeparate: claudeUsage,
    });
    if (direct) {
      const messageId = isAssistantMessage ? messageIdentity : null;
      const call = {
        model: traceModel || currentModel,
        usage: direct,
        at: at === null ? null : new Date(at).toISOString(),
        pricing_conditions: messageUsage ? {
          service_tier: oneLine(messageUsage.service_tier),
          inference_geo: oneLine(messageUsage.inference_geo),
          speed: oneLine(messageUsage.speed),
        } : null,
      };
      if (messageId) directUsageByMessage.set(messageId, call);
      else directUsages.push(call);
    }
    explicitTokenCount = firstMetric([payload, record], ['token_count', 'tokenCount']) ?? explicitTokenCount;
    explicitDuration = firstMetric([payload, record], ['duration_ms', 'durationMs', 'elapsed_ms', 'elapsedMs', 'duration']) ?? explicitDuration;
    explicitLatency = firstMetric([payload, record], ['latency_ms', 'latencyMs', 'latency']) ?? explicitLatency;
    explicitModelLatency = firstMetric([payload, record], ['model_latency_ms', 'modelLatencyMs', 'model_latency']) ?? explicitModelLatency;
    credits = firstMetric([payload, record, payload.rate_limits, record.rate_limits, info], [
      'host_reported_credits', 'hostReportedCredits', 'codex_credits', 'codexCredits', 'credits',
    ]) ?? credits;
  }

  const uniqueDirectCalls = [...directUsageByMessage.values(), ...directUsages];
  let usage = codexCalls.length
    ? codexCalls.reduce((total, call) => addUsage(total, call.usage), null)
    : cumulativeUsage;
  if (!codexCalls.length && cumulativeUsage && (baseline_usage || preRunUsage)) {
    usage = subtractUsage(cumulativeUsage, usageShape(baseline_usage) || preRunUsage);
  } else if (!codexCalls.length && cumulativeUsage && hasPreRunRecords) {
    usage = null;
  }
  if (!usage && perTurnUsages.length) usage = perTurnUsages.reduce((total, item) => addUsage(total, item), null);
  if (!usage && uniqueDirectCalls.length) usage = uniqueDirectCalls.reduce((total, call) => addUsage(total, call.usage), null);
  observedModel ||= preRunModel;
  observedProvider ||= preRunProvider;
  observedEffort ||= preRunEffort;
  const stateStartIsUsable = startedMs !== null && (lastTimestamp === null || startedMs <= lastTimestamp);
  const startedAt = stateStartIsUsable
    ? state.started_at
    : firstTimestamp === null ? null : new Date(firstTimestamp).toISOString();
  const derivedDuration = lastTimestamp !== null && (startedMs === null || lastTimestamp >= startedMs)
    ? Math.max(0, lastTimestamp - (startedMs ?? firstTimestamp ?? lastTimestamp))
    : firstTimestamp !== null && lastTimestamp !== null
      ? Math.max(0, lastTimestamp - firstTimestamp)
      : null;
  const observed = usage || explicitTokenCount !== null || explicitDuration !== null || explicitLatency !== null
    || firstTimestamp !== null || credits !== null || observedModel || observedProvider || observedEffort
    || turnContexts || publicSkills.size || internalSkills.size || Object.keys(toolUsage).length;
  if (!observed) return null;
  return normalizeTelemetry({
    platform: state.platform || state.host,
    provider: observedProvider,
    model: observedModel,
    reasoning_effort: observedEffort,
    activation: state.activation,
    graphify_status: state.graphify_status,
    usage: usage || (explicitTokenCount === null ? {} : { total_tokens: explicitTokenCount, token_count: explicitTokenCount }),
    token_count: explicitTokenCount ?? usage?.token_count ?? usage?.total_tokens,
    duration_ms: explicitDuration ?? derivedDuration,
    latency_ms: explicitLatency,
    model_latency_ms: explicitModelLatency,
    turns: turnContexts || taskStarts || null,
    model_calls: codexCalls.length || uniqueDirectCalls.length || tokenEvents || null,
    calls: codexCalls.length ? codexCalls : uniqueDirectCalls,
    tool_usage: toolUsage,
    public_skills: [...publicSkills],
    internal_skills: [...internalSkills],
    skill_evidence: Object.fromEntries(Object.entries(skillEvidence).map(([name, evidence]) => [name, [...evidence]])),
    host_reported_credits: credits,
    rate_limits: observedRateLimits,
    started_at: startedAt,
    finished_at: lastTimestamp === null ? null : new Date(lastTimestamp).toISOString(),
    source,
  });
}

export function estimateCost({ model = null, platform = null, provider = null, usage = {}, at = null } = {}) {
  const rate = knownPricing(model, { platform, provider });
  const input = integer(usage.input_tokens);
  const cached = integer(usage.cached_input_tokens);
  const cacheWrite = integer(usage.cache_write_input_tokens);
  const output = integer(usage.output_tokens);
  const route = resolvePricingRoute({ model, platform, provider });
  const unavailable = (reason) => ({ estimated_usd: null, api_equivalent_usd: null, pricing: rate, reason });
  if (!rate) return unavailable(route.resolution === 'ambiguous-agent'
    ? 'pricing unavailable: provider route is ambiguous'
    : `precio no disponible para ${oneLine(model) || 'este modelo'}`);
  if (input === null || output === null) return unavailable('token usage unavailable');
  if (cached === null) return unavailable('cache-read usage unavailable');
  const hasWriteRate = (rate.cache_write !== null && rate.cache_write > 0)
    || rate.cache_write_5m !== null || rate.cache_write_1h !== null;
  if (cacheWrite === null && hasWriteRate) return unavailable('cache-write usage unavailable');
  if (cached + (cacheWrite ?? 0) > input) return unavailable('cache categories exceed total input');
  if (rate.max_exact_context_tokens !== null && input > rate.max_exact_context_tokens) {
    return unavailable('official pricing for this context size is unavailable');
  }
  const tier = rate.context_tiers.filter((item) => input > item.input_tokens_above).at(-1);
  let activeRate = tier ? { ...rate, ...tier } : rate;
  if (rate.time_tiers.length) {
    const timestamp = timestampMs(at);
    if (timestamp === null) return unavailable('call time required for official time-dependent pricing');
    const date = new Date(timestamp);
    const timeTier = rate.time_tiers.find((item) => item.weekday_utc.includes(date.getUTCDay())
      && item.hour_ranges_utc.some(([start, end]) => date.getUTCHours() >= start && date.getUTCHours() < end));
    if (timeTier) activeRate = { ...activeRate, ...timeTier };
  }
  const uncached = input - cached - (cacheWrite ?? 0);
  const observedUncached = integer(usage.uncached_input_tokens);
  if (observedUncached !== null && observedUncached !== uncached) {
    return unavailable('input token categories do not reconcile');
  }
  if (cached > 0 && activeRate.cached_input === null) return unavailable('official cache-read rate unavailable');
  const writes5m = integer(usage.cache_write_5m_input_tokens);
  const writes1h = integer(usage.cache_write_1h_input_tokens);
  const durationRates = activeRate.cache_write_5m !== null || activeRate.cache_write_1h !== null;
  if (cacheWrite > 0 && durationRates && (writes5m === null || writes1h === null
    || writes5m + writes1h !== cacheWrite)) {
    return unavailable('cache-write duration usage unavailable');
  }
  if (cacheWrite > 0 && !durationRates && activeRate.cache_write === null) {
    return unavailable('official cache-write rate unavailable');
  }
  const equivalent = Number((((uncached * activeRate.input)
    + (cached * (activeRate.cached_input ?? 0))
    + (durationRates
      ? (writes5m * (activeRate.cache_write_5m ?? 0)) + (writes1h * (activeRate.cache_write_1h ?? 0))
      : (cacheWrite ?? 0) * (activeRate.cache_write ?? 0))
    + (output * activeRate.output)) / MILLION).toFixed(12));
  return {
    estimated_usd: isApiPlatform(platform) ? equivalent : null,
    api_equivalent_usd: equivalent,
    pricing: {
      ...activeRate,
      currency: 'USD',
      as_of: rate.as_of || null,
    },
    reason: isApiPlatform(platform)
      ? (rate.source_kind === 'models.dev'
        ? 'estimated from Models.dev API list prices'
        : 'estimated from API list prices')
      : 'actual platform charge unavailable; API-equivalent only',
  };
}

function estimateCallCosts(calls, { platform, provider }) {
  let total = 0;
  let pricing = null;
  const models = new Set();
  for (const call of calls) {
    const model = oneLine(call.model);
    const conditions = call.pricing_conditions || {};
    if ((conditions.service_tier && conditions.service_tier !== 'standard')
      || (conditions.inference_geo && !['not_available', 'us'].includes(conditions.inference_geo))
      || (conditions.speed && conditions.speed !== 'standard')) {
      return { estimated_usd: null, api_equivalent_usd: null, pricing: null,
        reason: `${model || 'unknown model'}: official rate for observed service conditions is unavailable` };
    }
    const result = estimateCost({ model, platform, provider, usage: call.usage, at: call.at });
    if (result.api_equivalent_usd === null) {
      return { estimated_usd: null, api_equivalent_usd: null, pricing: result.pricing,
        reason: `${model || 'unknown model'}: ${result.reason}` };
    }
    models.add(model);
    total += result.api_equivalent_usd;
    pricing = result.pricing;
  }
  if (models.size !== 1) pricing = null;
  total = Number(total.toFixed(12));
  return { estimated_usd: isApiPlatform(platform) ? total : null,
    api_equivalent_usd: total, pricing,
    reason: isApiPlatform(platform) ? 'estimated from official API token rates'
      : 'actual platform charge unavailable; official API-equivalent token cost' };
}

export function normalizeTelemetry(value = {}) {
  const usage = value.usage && typeof value.usage === 'object' ? value.usage : {};
  const inputTokens = integer(usage.input_tokens);
  const outputTokens = integer(usage.output_tokens);
  const tools = countMap(value.tools ?? value.tool_usage);
  const internalSkills = stringList(listValue(value.internal_skills ?? value.internalSkills));
  const internalSet = new Set(internalSkills);
  const suppliedPublicSkills = value.public_skills ?? value.publicSkills ?? value.skills ?? value.loaded_skills;
  const publicSkills = stringList(listValue(suppliedPublicSkills)).filter((skill) => !internalSet.has(skill));
  const skills = stringList([...publicSkills, ...internalSkills]);
  const skillUsage = value.skill_usage ?? value.skills_used;
  const skillCounts = skillUsage && typeof skillUsage === 'object'
    ? countMap(skillUsage)
    : {};
  const toolCalls = integer(value.tool_calls) ?? (Object.keys(tools).length ? Object.values(tools).reduce((sum, count) => sum + count, 0) : null);
  const calls = Array.isArray(value.calls) ? value.calls.filter((call) => call && typeof call === 'object') : [];
  let cost = calls.length
    ? estimateCallCosts(calls, { platform: value.platform, provider: value.provider })
    : estimateCost({ model: value.model, platform: value.platform, provider: value.provider, usage,
      at: value.at });
  if (!calls.length && cost.api_equivalent_usd !== null && integer(value.model_calls) !== 1
    && cost.pricing?.context_tiers?.some((tier) => (inputTokens ?? 0) > tier.input_tokens_above)) {
    cost = { ...cost, estimated_usd: null, api_equivalent_usd: null,
      reason: 'per-call usage required for context-tier pricing' };
  }
  const callProviders = [...new Set(calls.map((call) => resolvePricingRoute({
    model: call.model, platform: value.platform, provider: value.provider,
  }).provider).filter(Boolean))];
  const provider = calls.length
    ? (callProviders.length === 1 ? callProviders[0] : null)
    : cost.pricing?.provider
      || resolvePricingRoute({ model: value.model, platform: value.platform, provider: value.provider }).provider;
  const totalTokens = integer(usage.total_tokens)
    ?? (provider === 'anthropic' && inputTokens !== null && outputTokens !== null
      ? inputTokens + outputTokens
      : null);
  const tokenCount = integer(value.token_count ?? value.tokenCount ?? usage.token_count) ?? totalTokens;
  return {
    platform: oneLine(value.platform),
    provider,
    model: oneLine(value.model),
    models: stringList(calls.map((call) => call.model)),
    calls,
    reasoning_effort: oneLine(value.reasoning_effort),
    activation: oneLine(value.activation),
    graphify_status: oneLine(value.graphify_status ?? value.graphify?.status),
    started_at: oneLine(value.started_at),
    finished_at: oneLine(value.finished_at),
    duration_ms: integer(value.duration_ms),
    latency_ms: integer(value.latency_ms),
    model_latency_ms: integer(value.model_latency_ms),
    turns: integer(value.turns),
    model_calls: integer(value.model_calls),
    tool_calls: toolCalls,
    tools,
    unique_tools: Object.keys(tools).length || (integer(value.unique_tools) ?? null),
    skills,
    public_skills: publicSkills,
    internal_skills: internalSkills,
    skill_usage: skillCounts,
    skill_evidence: evidenceMap(value.skill_evidence ?? value.skillEvidence),
    usage: {
      input_tokens: inputTokens,
      uncached_input_tokens: integer(usage.uncached_input_tokens),
      cached_input_tokens: integer(usage.cached_input_tokens),
      cache_write_input_tokens: integer(usage.cache_write_input_tokens),
      cache_write_5m_input_tokens: integer(usage.cache_write_5m_input_tokens),
      cache_write_1h_input_tokens: integer(usage.cache_write_1h_input_tokens),
      output_tokens: outputTokens,
      reasoning_output_tokens: integer(usage.reasoning_output_tokens),
      total_tokens: totalTokens,
    },
    token_count: tokenCount,
    cost,
    host_reported_credits: finite(value.host_reported_credits ?? value.codex_credits),
    rate_limits: rateLimitsShape(value.rate_limits ?? value.rateLimits),
    source: oneLine(value.source) || 'host-reported or session-observed values; unavailable fields are not inferred',
  };
}

export function formatTelemetry(value = {}) {
  const data = normalizeTelemetry(value);
  const publicSkillList = data.public_skills.length ? data.public_skills.join(', ') : 'unavailable';
  const internalSkillList = data.internal_skills.length ? data.internal_skills.join(', ') : 'unavailable';
  const displayedModel = data.models.length > 1 ? data.models.join(', ') : data.model || 'unavailable';
  const platformModel = [data.platform || 'unavailable', data.provider, displayedModel, data.reasoning_effort ? `effort ${data.reasoning_effort}` : null]
    .filter(Boolean).join(' / ');
  const tokenLine = [
    `input tokens ${amount(data.usage.input_tokens)}`,
    `output tokens ${amount(data.usage.output_tokens)}`,
    `reasoning ${data.provider === 'anthropic' ? 'included in output' : amount(data.usage.reasoning_output_tokens)}`,
    `total ${amount(data.usage.total_tokens)}`,
    `cache read ${amount(data.usage.cached_input_tokens)}`,
    `cache write ${amount(data.usage.cache_write_input_tokens)}`,
  ].join('; ');
  const costLine = data.cost.estimated_usd !== null
    ? `estimated API cost USD ${money(data.cost.estimated_usd)}`
    : data.cost.api_equivalent_usd !== null
      ? `actual charge unavailable; API-equivalent USD ${money(data.cost.api_equivalent_usd)}`
      : `unavailable (${data.cost.reason})`;
  const creditText = data.host_reported_credits === null ? '' : `; host-reported credits used ${data.host_reported_credits}`;
  const durationLine = data.duration_ms === null ? 'unavailable' : milliseconds(data.duration_ms);
  const rateWindowText = (label, window) => window ? [
    `${label} ${window.used_percent === null ? 'usage unavailable' : `${window.used_percent}% used`}`,
    window.window_minutes === null ? null : `${window.window_minutes} min window`,
    window.resets_at === null ? null : `resets ${new Date(window.resets_at).toISOString()}`,
  ].filter(Boolean).join(', ') : null;
  const limitParts = [
    data.rate_limits?.plan_type ? `plan ${data.rate_limits.plan_type}` : null,
    data.rate_limits?.credit_balance === null || data.rate_limits?.credit_balance === undefined
      ? null : `credit balance ${data.rate_limits.credit_balance}`,
    data.rate_limits?.unlimited === true ? 'unlimited credits' : null,
    rateWindowText('primary', data.rate_limits?.primary),
    rateWindowText('secondary', data.rate_limits?.secondary),
  ].filter(Boolean);
  const routeLabels = {
    'official-agent-default': 'official agent default',
    'official-model-family': 'official model family',
    'observed-provider': 'observed provider',
    'model-namespace': 'model namespace',
    'platform-provider': 'platform provider',
  };
  const routeText = routeLabels[data.cost.pricing?.resolution]
    ? `; route ${routeLabels[data.cost.pricing.resolution]}`
    : '';
  const providerSourceText = data.cost.pricing?.provider_source
    ? `; provider rate card ${data.cost.pricing.provider_source}`
    : '';
  const pricingText = data.cost.pricing
    ? `; rates USD/1M input ${data.cost.pricing.input}, cache read ${amount(data.cost.pricing.cached_input)}, cache write ${amount(data.cost.pricing.cache_write)}, cache write 5m ${amount(data.cost.pricing.cache_write_5m)}, cache write 1h ${amount(data.cost.pricing.cache_write_1h)}, output ${data.cost.pricing.output}; verified ${data.cost.pricing.as_of || 'unavailable'} from ${data.cost.pricing.source || 'source unavailable'}${routeText}${providerSourceText}`
    : '';
  const hasTokens = [data.usage.input_tokens, data.usage.output_tokens,
    data.usage.cached_input_tokens, data.usage.cache_write_input_tokens]
    .some((value) => value !== null);
  const lines = ['## Telemetry'];
  if (data.platform || data.provider || data.model || data.reasoning_effort) lines.push(`- Model: ${platformModel}`);
  if (hasTokens) lines.push(`- Tokens: ${tokenLine}`);
  if (data.model || hasTokens || data.cost.pricing) lines.push(`- Cost: ${costLine}${creditText}${pricingText}`);
  if (limitParts.length) lines.push(`- Host limits: ${limitParts.join('; ')}`);
  if (data.duration_ms !== null) lines.push(`- Duration: ${durationLine}`);
  if (data.public_skills.length || data.internal_skills.length) {
    lines.push(`- Skills: public ${publicSkillList}; internal ${internalSkillList}`);
  }
  lines.push(`- Data source: ${data.source}`);
  return lines.join('\n');
}

export function stripTelemetry(summary) {
  const lines = String(summary ?? '').split(/\r?\n/);
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    if (/^## Telemetry\s*$/i.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^##\s+\S/.test(line)) skipping = false;
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').trimEnd();
}

export function replaceTelemetry(summary, telemetry = {}) {
  const lines = String(summary || '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^## Telemetry\s*$/i.test(line));
  const block = formatTelemetry(telemetry).split('\n');
  if (start < 0) return `${String(summary || '').trimEnd()}\n\n${block.join('\n')}\n`;
  const next = lines.slice(start + 1).findIndex((line) => /^##\s+\S/.test(line));
  const end = next < 0 ? lines.length : start + 1 + next;
  return [...lines.slice(0, start), ...block, ...lines.slice(end)].join('\n').trimEnd() + '\n';
}
