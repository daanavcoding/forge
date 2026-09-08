import crypto from 'node:crypto';
import fs from 'node:fs';

const MILLION = 1_000_000;
const PRICING_FILE = new URL('../data/model-pricing.json', import.meta.url);

// This small fallback keeps cost estimation available if a damaged package is
// missing its generated catalog. Normal releases use the versioned Models.dev
// snapshot and never access the network while Forge is running.
const FALLBACK_PRICING = {
  'gpt-5.6-sol': {
    input: 4,
    cached_input: 0.4,
    output: 20,
    provider: 'openai',
    as_of: '2026-09-02',
    source: 'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
  },
  'gpt-5.6-terra': {
    input: 2,
    cached_input: 0.2,
    output: 12,
    provider: 'openai',
    as_of: '2026-09-02',
    source: 'https://developers.openai.com/api/docs/models/gpt-5.6-terra',
  },
  'gpt-5.6-luna': {
    input: 0.2,
    cached_input: 0.02,
    output: 1.2,
    provider: 'openai',
    as_of: '2026-09-02',
    source: 'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
  },
};

// Models.dev is the offline data snapshot. These links identify the first-
// party rate card that the agent default represents; they do not turn the
// runtime into a network client.
const OFFICIAL_PROVIDER_SOURCES = {
  openai: 'https://developers.openai.com/api/docs/models',
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
};

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
  [/groq/, 'groq'],
  [/azure/, 'azure'],
  [/bedrock|amazon/, 'amazon-bedrock'],
  [/openrouter/, 'openrouter'],
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
    pricingCatalog = parsed?.schema_version === 1 && checksum === parsed.catalog_sha256
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
  if (/^[a-z0-9][a-z0-9._-]*$/i.test(normalized)) return normalized;
  return null;
}

function providerFromModel(model) {
  const normalized = normalizedIdentifier(model);
  if (!normalized || !normalized.includes('/')) return null;
  return providerFromValue(normalized.slice(0, normalized.indexOf('/')));
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
  const providerPrefix = providerId && normalized.startsWith(`${providerId}/`) ? normalized.slice(providerId.length + 1) : null;
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
        cached_input: finite(match.rate.cached_input) ?? input,
        cache_write: finite(match.rate.cache_write),
        output,
        tiers: Array.isArray(match.rate.tiers) ? match.rate.tiers : [],
        currency: 'USD',
        source: catalog.source?.url || 'https://models.dev/api.json',
        as_of: oneLine(catalog.source?.updated_at),
        catalog_sha256: oneLine(catalog.catalog_sha256),
        resolution: route.resolution,
        provider_source: OFFICIAL_PROVIDER_SOURCES[providerId] || null,
      };
    }
  }
  const fallbackKey = providerId === 'openai'
    ? Object.keys(FALLBACK_PRICING).find((candidate) => normalized === candidate)
    : null;
  return fallbackKey ? {
    model: fallbackKey,
    ...FALLBACK_PRICING[fallbackKey],
    currency: 'USD',
    tiers: [],
    resolution: route.resolution,
    provider_source: OFFICIAL_PROVIDER_SOURCES.openai,
  } : null;
}

function suppliedPricing(value) {
  if (!value || typeof value !== 'object') return null;
  const input = finite(value.input_per_million ?? value.input);
  const cached = finite(value.cached_input_per_million ?? value.cached_input);
  const output = finite(value.output_per_million ?? value.output);
  if (input === null || output === null) return null;
  return {
    model: oneLine(value.model),
    provider: oneLine(value.provider),
    input,
    cached_input: cached ?? input,
    output,
    currency: oneLine(value.currency) || 'USD',
    source: oneLine(value.source),
    as_of: oneLine(value.as_of),
    tiers: Array.isArray(value.tiers) ? value.tiers : [],
  };
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
  const inputTokens = integer(value.input_tokens ?? value.inputTokens ?? value.input);
  const cachedInputTokens = integer(value.cached_input_tokens ?? value.cache_read_input_tokens ?? value.cachedInputTokens ?? value.cache_read);
  const usage = {
    // Claude reports uncached input and cache reads as separate fields. Forge's
    // normalized cost model stores total input, so combine them only for that
    // host shape; Codex-style cumulative usage remains unchanged.
    input_tokens: cachedInputIsSeparate && inputTokens !== null && cachedInputTokens !== null
      ? inputTokens + cachedInputTokens
      : inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: integer(value.output_tokens ?? value.outputTokens ?? value.output),
    reasoning_output_tokens: integer(value.reasoning_output_tokens ?? value.reasoningOutputTokens ?? value.reasoning_output),
    total_tokens: integer(value.total_tokens ?? value.totalTokens ?? value.total),
  };
  const tokenCount = integer(value.token_count ?? value.tokenCount);
  if (tokenCount !== null) usage.token_count = tokenCount;
  if (Object.values(usage).every((value) => value === null)) return null;
  return usage;
}

function addUsage(left, right) {
  const result = {};
  for (const key of ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens']) {
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
  for (const key of ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens', 'token_count']) {
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

// Extract only stable, scalar observations from a host transcript. The
// transcript format is intentionally treated as best-effort input: malformed
// lines, new fields, or missing files must never affect the coding workflow.
export function telemetryFromTrace(trace, { state = {}, source = 'host trace', baseline_usage = null } = {}) {
  const records = traceRecords(trace);
  if (!records.length) return null;
  let cumulativeUsage = null;
  const perTurnUsages = [];
  const directUsages = [];
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
  let observedProvider = oneLine(state.provider);
  let observedEffort = oneLine(state.reasoning_effort);
  const toolUsage = {};
  const publicSkills = new Set(stringList(listValue(state.public_skills ?? state.publicSkills)));
  const internalSkills = new Set();
  const skillEvidence = {};
  for (const skill of publicSkills) recordEvidence(skillEvidence, skill, 'hook activation');

  for (const record of records) {
    const payload = record.payload && typeof record.payload === 'object' ? record.payload : record;
    const info = payload.info && typeof payload.info === 'object' ? payload.info : record.info;
    const at = timestampMs(record.timestamp ?? record.time ?? payload.timestamp ?? payload.time ?? record.at ?? payload.at);
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
    const contentBlocks = Array.isArray(message?.content)
      ? message.content.filter((block) => block && typeof block === 'object')
      : [];
    const toolUseBlocks = contentBlocks.filter((block) => [
      'tool_use', 'tool-call', 'tool_call', 'function_call', 'function-call',
    ].includes(String(block.type || '').toLowerCase()));
    const isAssistantMessage = messageType === 'assistant'
      || (messageRole === 'assistant' && Boolean(message));
    observedModel = observedModel || oneLine(message?.model ?? threadSettings?.model ?? payload.model ?? record.model);
    observedProvider = observedProvider || oneLine(message?.provider ?? threadSettings?.provider ?? payload.provider ?? record.provider);
    observedEffort = observedEffort || oneLine(message?.reasoning_effort ?? threadSettings?.reasoning_effort ?? payload.reasoning_effort ?? record.reasoning_effort);
    const itemType = String(payload.type || '').toLowerCase();
    const isToolCall = ['custom_tool_call', 'function_call', 'tool_call'].includes(itemType) || toolUseBlocks.length > 0;
    const isUserMessage = (itemType === 'message' && String(payload.role || '').toLowerCase() === 'user')
      || messageType === 'user'
      || (messageRole === 'user' && Boolean(message));
    if (isToolCall || isUserMessage) {
      let serialized = '';
      try { serialized = JSON.stringify({ payload, message }); } catch { /* Skill metadata is best effort. */ }
      const searchable = `${String(payload.input ?? payload.arguments ?? '')}\n${serialized.replace(/\\\\/g, '\\')}`;
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
        const skillPattern = /worker-skills[\\\\/]+([a-z0-9-]+)[\\\\/]+SKILL\.md/gi;
        for (const match of searchable.matchAll(skillPattern)) {
          internalSkills.add(match[1]);
          recordEvidence(skillEvidence, match[1], 'private SKILL.md read');
        }
        if (/worker-skills/i.test(searchable) && /SKILL\.md/i.test(searchable)) {
          const names = /\bconst\s+names\s*=\s*(\[[^\]\r\n]*\])/i.exec(searchable);
          if (names) {
            try {
              for (const name of JSON.parse(names[1])) {
                if (/^[a-z0-9-]+$/i.test(String(name))) {
                  internalSkills.add(String(name));
                  recordEvidence(skillEvidence, String(name), 'private SKILL.md batch read');
                }
              }
            } catch { /* Dynamic batch skill reads are optional telemetry. */ }
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
    if (isAssistantMessage) turnContexts += 1;
    if (isTokenEvent) {
      tokenEvents += 1;
      observedRateLimits = rateLimitsShape(payload.rate_limits ?? record.rate_limits) || observedRateLimits;
      const total = usageShape(info?.total_token_usage ?? payload.total_token_usage ?? record.total_token_usage);
      const last = usageShape(info?.last_token_usage ?? payload.last_token_usage ?? record.last_token_usage);
      if (total) cumulativeUsage = total;
      else if (last) perTurnUsages.push(last);
      explicitTokenCount = firstMetric([info, payload, record], ['token_count', 'tokenCount']) ?? explicitTokenCount;
    }
    const messageUsage = message?.usage && typeof message.usage === 'object' ? message.usage : null;
    const claudeUsage = Boolean(messageUsage && (
      Object.hasOwn(messageUsage, 'cache_read_input_tokens')
      || Object.hasOwn(messageUsage, 'cache_creation_input_tokens')
    ));
    const direct = usageShape(messageUsage ?? payload.usage ?? record.usage, {
      cachedInputIsSeparate: claudeUsage,
    });
    if (direct) {
      directUsages.push(direct);
      if (isAssistantMessage) tokenEvents += 1;
    }
    explicitTokenCount = firstMetric([payload, record], ['token_count', 'tokenCount']) ?? explicitTokenCount;
    explicitDuration = firstMetric([payload, record], ['duration_ms', 'durationMs', 'elapsed_ms', 'elapsedMs', 'duration']) ?? explicitDuration;
    explicitLatency = firstMetric([payload, record], ['latency_ms', 'latencyMs', 'latency']) ?? explicitLatency;
    explicitModelLatency = firstMetric([payload, record], ['model_latency_ms', 'modelLatencyMs', 'model_latency']) ?? explicitModelLatency;
    credits = firstMetric([payload, record, payload.rate_limits, record.rate_limits, info], [
      'host_reported_credits', 'hostReportedCredits', 'codex_credits', 'codexCredits', 'credits',
    ]) ?? credits;
  }

  let usage = cumulativeUsage;
  if (!usage && perTurnUsages.length) usage = perTurnUsages.reduce((total, item) => addUsage(total, item), null);
  if (!usage && directUsages.length) usage = directUsages.reduce((total, item) => addUsage(total, item), null);
  if (cumulativeUsage && baseline_usage) usage = subtractUsage(cumulativeUsage, usageShape(baseline_usage));
  const startedMs = timestampMs(state.started_epoch_ms ?? state.started_at);
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
    model_calls: tokenEvents || null,
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

export function estimateCost({ model = null, platform = null, provider = null, usage = {}, pricing = null } = {}) {
  const rate = suppliedPricing(pricing) || knownPricing(model, { platform, provider });
  const input = integer(usage.input_tokens);
  const cached = integer(usage.cached_input_tokens);
  const output = integer(usage.output_tokens);
  const route = resolvePricingRoute({ model, platform, provider });
  if (!rate || input === null || cached === null || output === null || cached > input) {
    return {
      estimated_usd: null,
      api_equivalent_usd: null,
      pricing: rate,
      reason: !rate
        ? route.resolution === 'ambiguous-agent'
          ? 'pricing unavailable: provider route is ambiguous'
          : 'pricing unavailable for this exact model'
        : input === null || output === null
        ? 'token usage unavailable'
        : cached === null
          ? 'cached input usage unavailable'
        : 'cached input exceeds total input',
    };
  }
  if ((rate.currency || 'USD').toUpperCase() !== 'USD') {
    return {
      estimated_usd: null,
      api_equivalent_usd: null,
      pricing: rate,
      reason: `unsupported pricing currency: ${rate.currency}`,
    };
  }
  const uncached = input - cached;
  const equivalent = ((uncached * rate.input) + (cached * rate.cached_input) + (output * rate.output)) / MILLION;
  return {
    estimated_usd: isApiPlatform(platform) ? equivalent : null,
    api_equivalent_usd: equivalent,
    pricing: {
      ...rate,
      currency: 'USD',
      as_of: rate.as_of || null,
    },
    reason: isApiPlatform(platform)
      ? 'estimated from API list prices'
      : 'actual platform charge unavailable; API-equivalent only',
  };
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
  const cost = estimateCost({
    model: value.model,
    platform: value.platform,
    provider: value.provider,
    usage,
    pricing: value.pricing,
  });
  const totalTokens = integer(usage.total_tokens);
  const tokenCount = integer(value.token_count ?? value.tokenCount ?? usage.token_count) ?? totalTokens;
  return {
    platform: oneLine(value.platform),
    provider: oneLine(value.provider) || cost.pricing?.provider || null,
    model: oneLine(value.model),
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
      cached_input_tokens: integer(usage.cached_input_tokens),
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
  const platformModel = [data.platform || 'unavailable', data.provider, data.model || 'unavailable', data.reasoning_effort ? `effort ${data.reasoning_effort}` : null]
    .filter(Boolean).join(' / ');
  const tokenLine = [
    `input ${amount(data.usage.input_tokens)}`,
    `cached ${amount(data.usage.cached_input_tokens)}`,
    `output ${amount(data.usage.output_tokens)}`,
    `reasoning ${amount(data.usage.reasoning_output_tokens)}`,
    `total ${amount(data.usage.total_tokens)}`,
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
  const tierText = data.cost.pricing?.tiers?.length
    ? `; context tiers ${data.cost.pricing.tiers.map((tier) => `${tier.context_tokens_at_least}+`).join(', ')} require per-request usage and are not applied here`
    : '';
  const routeLabels = {
    'official-agent-default': 'official agent default',
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
    ? `; rates USD/1M input ${data.cost.pricing.input}, cached ${data.cost.pricing.cached_input}, output ${data.cost.pricing.output}${tierText}; snapshot ${data.cost.pricing.as_of?.slice(0, 10) || 'unavailable'} from ${data.cost.pricing.source || 'source unavailable'}${routeText}${providerSourceText}`
    : '';
  const hasTokens = Object.values(data.usage).some((value) => value !== null);
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
