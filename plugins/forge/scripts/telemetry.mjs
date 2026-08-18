const MILLION = 1_000_000;
const PRICING_AS_OF = '2026-08-11';

// Public OpenAI API list prices in USD per 1M text tokens. These rates are
// deliberately versioned: subscription products do not expose a token-to-USD
// bill, so Forge labels the result as API-equivalent on those platforms.
const OPENAI_API_PRICING = {
  'gpt-5.6-sol': {
    input: 5,
    cached_input: 0.5,
    output: 30,
    source: 'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
  },
  'gpt-5.6-terra': {
    input: 2,
    cached_input: 0.2,
    output: 12,
    source: 'https://developers.openai.com/api/docs/models/gpt-5.6-terra',
  },
  'gpt-5.6-luna': {
    input: 0.2,
    cached_input: 0.02,
    output: 1.2,
    source: 'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
  },
};

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

function knownPricing(model) {
  const normalized = oneLine(model)?.toLowerCase();
  if (!normalized) return null;
  const key = Object.keys(OPENAI_API_PRICING).find((candidate) => normalized === candidate);
  return key ? { model: key, ...OPENAI_API_PRICING[key], as_of: PRICING_AS_OF } : null;
}

function suppliedPricing(value) {
  if (!value || typeof value !== 'object') return null;
  const input = finite(value.input_per_million ?? value.input);
  const cached = finite(value.cached_input_per_million ?? value.cached_input);
  const output = finite(value.output_per_million ?? value.output);
  if (input === null || output === null) return null;
  return {
    model: oneLine(value.model),
    input,
    cached_input: cached ?? input,
    output,
    currency: oneLine(value.currency) || 'USD',
    source: oneLine(value.source),
    as_of: oneLine(value.as_of),
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

function usageShape(value) {
  if (!value || typeof value !== 'object') return null;
  const usage = {
    input_tokens: integer(value.input_tokens ?? value.inputTokens ?? value.input),
    cached_input_tokens: integer(value.cached_input_tokens ?? value.cache_read_input_tokens ?? value.cachedInputTokens ?? value.cache_read),
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
  let observedModel = oneLine(state.model);
  let observedEffort = oneLine(state.reasoning_effort);
  const toolUsage = {};
  const internalSkills = new Set();

  for (const record of records) {
    const payload = record.payload && typeof record.payload === 'object' ? record.payload : record;
    const info = payload.info && typeof payload.info === 'object' ? payload.info : record.info;
    const at = timestampMs(record.timestamp ?? record.time ?? payload.timestamp ?? payload.time ?? record.at ?? payload.at);
    if (at !== null) {
      firstTimestamp = firstTimestamp === null ? at : Math.min(firstTimestamp, at);
      lastTimestamp = lastTimestamp === null ? at : Math.max(lastTimestamp, at);
    }
    const isTokenEvent = String(payload.type || record.type || '').toLowerCase() === 'token_count';
    const threadSettings = payload.thread_settings && typeof payload.thread_settings === 'object'
      ? payload.thread_settings
      : null;
    observedModel = observedModel || oneLine(threadSettings?.model ?? payload.model ?? record.model);
    observedEffort = observedEffort || oneLine(threadSettings?.reasoning_effort ?? payload.reasoning_effort ?? record.reasoning_effort);
    const itemType = String(payload.type || '').toLowerCase();
    if (['custom_tool_call', 'function_call', 'tool_call'].includes(itemType)) {
      const toolName = oneLine(payload.name || payload.tool_name || payload.toolName);
      if (toolName) toolUsage[toolName] = (toolUsage[toolName] || 0) + 1;
      let serialized = '';
      try { serialized = JSON.stringify(payload); } catch { /* Tool metadata is best effort. */ }
      const searchable = `${String(payload.input ?? payload.arguments ?? '')}\n${serialized.replace(/\\\\/g, '\\')}`;
      const skillPattern = /worker-skills[\\\\/]+([a-z0-9-]+)[\\\\/]+SKILL\.md/gi;
      for (const match of searchable.matchAll(skillPattern)) internalSkills.add(match[1]);
      if (/worker-skills/i.test(searchable) && /SKILL\.md/i.test(searchable)) {
        const names = /\bconst\s+names\s*=\s*(\[[^\]\r\n]*\])/i.exec(searchable);
        if (names) {
          try {
            for (const name of JSON.parse(names[1])) {
              if (/^[a-z0-9-]+$/i.test(String(name))) internalSkills.add(String(name));
            }
          } catch { /* Dynamic batch skill reads are optional telemetry. */ }
        }
      }
    }
    if (isTokenEvent) {
      tokenEvents += 1;
      const total = usageShape(info?.total_token_usage ?? payload.total_token_usage ?? record.total_token_usage);
      const last = usageShape(info?.last_token_usage ?? payload.last_token_usage ?? record.last_token_usage);
      if (total) cumulativeUsage = total;
      else if (last) perTurnUsages.push(last);
      explicitTokenCount = firstMetric([info, payload, record], ['token_count', 'tokenCount']) ?? explicitTokenCount;
    }
    const direct = usageShape(payload.usage ?? record.usage);
    if (direct) directUsages.push(direct);
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
  const startedAt = state.started_at || (firstTimestamp === null ? null : new Date(firstTimestamp).toISOString());
  const startedMs = timestampMs(state.started_epoch_ms ?? state.started_at);
  const derivedDuration = lastTimestamp !== null && (startedMs === null || lastTimestamp >= startedMs)
    ? Math.max(0, lastTimestamp - (startedMs ?? firstTimestamp ?? lastTimestamp))
    : firstTimestamp !== null && lastTimestamp !== null
      ? Math.max(0, lastTimestamp - firstTimestamp)
      : null;
  const observed = usage || explicitTokenCount !== null || explicitDuration !== null || explicitLatency !== null
    || firstTimestamp !== null || credits !== null;
  if (!observed) return null;
  return normalizeTelemetry({
    platform: state.platform || state.host,
    model: observedModel,
    reasoning_effort: observedEffort,
    activation: state.activation,
    usage: usage || (explicitTokenCount === null ? {} : { total_tokens: explicitTokenCount, token_count: explicitTokenCount }),
    token_count: explicitTokenCount ?? usage?.token_count ?? usage?.total_tokens,
    duration_ms: explicitDuration ?? derivedDuration,
    latency_ms: explicitLatency,
    model_latency_ms: explicitModelLatency,
    turns: tokenEvents || null,
    model_calls: tokenEvents || null,
    tool_usage: toolUsage,
    internal_skills: [...internalSkills],
    host_reported_credits: credits,
    started_at: startedAt,
    finished_at: lastTimestamp === null ? null : new Date(lastTimestamp).toISOString(),
    source,
  });
}

export function estimateCost({ model = null, platform = null, usage = {}, pricing = null } = {}) {
  const rate = suppliedPricing(pricing) || knownPricing(model);
  const input = integer(usage.input_tokens);
  const cached = integer(usage.cached_input_tokens);
  const output = integer(usage.output_tokens);
  if (!rate || input === null || cached === null || output === null || cached > input) {
    return {
      estimated_usd: null,
      api_equivalent_usd: null,
      pricing: rate,
      reason: !rate ? 'pricing unavailable for this exact model' : input === null || output === null
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
  const suppliedSkills = value.skills ?? value.loaded_skills;
  const suppliedSkillList = listValue(suppliedSkills);
  const internalSkills = stringList(listValue(value.internal_skills ?? value.internalSkills));
  const hasForge = suppliedSkillList.some((skill) => oneLine(skill)?.toLowerCase() === 'forge');
  const listedSkills = [
    ...(hasForge ? [] : ['forge']),
    ...suppliedSkillList,
    ...internalSkills,
  ];
  const skills = stringList(listedSkills);
  const skillUsage = value.skill_usage ?? value.skills_used;
  const skillCounts = skillUsage && typeof skillUsage === 'object'
    ? countMap(skillUsage)
    : countMap(listedSkills);
  const toolCalls = integer(value.tool_calls) ?? (Object.keys(tools).length ? Object.values(tools).reduce((sum, count) => sum + count, 0) : null);
  const cost = estimateCost({ model: value.model, platform: value.platform, usage, pricing: value.pricing });
  const totalTokens = integer(usage.total_tokens);
  const tokenCount = integer(value.token_count ?? value.tokenCount ?? usage.token_count) ?? totalTokens;
  return {
    platform: oneLine(value.platform),
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
    internal_skills: internalSkills,
    skill_usage: skillCounts,
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
    source: oneLine(value.source) || 'host-reported or session-observed values; unavailable fields are not inferred',
  };
}

export function formatTelemetry(value = {}) {
  const data = normalizeTelemetry(value);
  const toolList = Object.entries(data.tools).map(([name, count]) => `${name} x${count}`).join(', ') || 'unavailable';
  const skillList = data.skills.length ? data.skills.join(', ') : 'unavailable';
  const skillUsageList = Object.entries(data.skill_usage).map(([name, count]) => `${name} x${count}`).join(', ') || 'unavailable';
  const internalSkillList = data.internal_skills.length ? data.internal_skills.join(', ') : 'unavailable';
  const platformModel = [data.platform || 'unavailable', data.model || 'unavailable', data.reasoning_effort ? `effort ${data.reasoning_effort}` : null]
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
  const creditText = data.host_reported_credits === null ? '' : `; host-reported credits ${data.host_reported_credits}`;
  const latencyLine = [
    `end-to-end ${milliseconds(data.duration_ms)}`,
    `request ${milliseconds(data.latency_ms)}`,
    `model ${milliseconds(data.model_latency_ms)}`,
  ].join('; ');
  const pricingLine = data.cost.pricing
    ? `USD per 1M tokens: input ${data.cost.pricing.input}, cached ${data.cost.pricing.cached_input}, output ${data.cost.pricing.output}; as of ${data.cost.pricing.as_of || 'unavailable'}; ${data.cost.pricing.source || 'source unavailable'}`
    : 'unavailable';
  return [
    '## Telemetry',
    `- Platform / model: ${platformModel}`,
    `- Token count: ${amount(data.token_count)}`,
    `- Tokens: ${tokenLine}`,
    `- Cost: ${costLine}${creditText}`,
    `- Credits: ${amount(data.host_reported_credits)}`,
    `- Latency: ${latencyLine}`,
    `- Turns / model calls: ${amount(data.turns)} / ${amount(data.model_calls)}`,
    `- Tool calls: ${amount(data.tool_calls)} across ${amount(data.unique_tools)} unique tools`,
    `- Tools: ${toolList}`,
    `- Skills used: ${skillUsageList}`,
    `- Internal specialist skills: ${internalSkillList}`,
    `- Loaded skills: ${data.skills.length || 'unavailable'} (${skillList})`,
    `- Activation / Graphify: ${data.activation || 'unavailable'} / ${data.graphify_status || 'unavailable'}`,
    `- Started / finished: ${data.started_at || 'unavailable'} / ${data.finished_at || 'unavailable'}`,
    `- Pricing basis: ${pricingLine}`,
    `- Data source: ${data.source}`,
    '- Estimate limits: output includes reasoning tokens when the host reports it that way; >272K per-request multipliers and tool-specific fees are excluded unless the platform reports enough data to calculate them.',
  ].join('\n');
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
  const data = normalizeTelemetry(telemetry);
  const block = formatTelemetry(data).split('\n');
  if (start < 0) return `${String(summary || '').trimEnd()}\n\n${block.join('\n')}\n`;
  const next = lines.slice(start + 1).findIndex((line) => /^##\s+\S/.test(line));
  const end = next < 0 ? lines.length : start + 1 + next;
  const current = lines.slice(start + 1, end);
  const generated = new Map();
  for (const line of block) {
    const match = /^(- (?:Platform \/ model|Token count|Tokens|Cost|Credits|Latency|Turns \/ model calls|Tool calls|Tools|Skills used|Internal specialist skills|Loaded skills|Activation \/ Graphify|Started \/ finished|Pricing basis|Data source)):/.exec(line);
    if (match) generated.set(match[1], line);
  }
  const has = (prefix) => current.some((line) => line.startsWith(`${prefix}:`));
  const shouldCopy = new Set(['- Data source']);
  if (data.platform || data.model || data.reasoning_effort) shouldCopy.add('- Platform / model');
  if (data.token_count !== null || Object.values(data.usage).some((value) => value !== null)) {
    shouldCopy.add('- Token count');
    shouldCopy.add('- Tokens');
    shouldCopy.add('- Cost');
  }
  if (data.host_reported_credits !== null || !has('- Credits')) shouldCopy.add('- Credits');
  if (data.duration_ms !== null || data.latency_ms !== null || data.model_latency_ms !== null) shouldCopy.add('- Latency');
  if (data.turns !== null || data.model_calls !== null) shouldCopy.add('- Turns / model calls');
  if (data.tool_calls !== null || !has('- Tool calls')) shouldCopy.add('- Tool calls');
  if (Object.keys(data.tools).length || !has('- Tools')) shouldCopy.add('- Tools');
  if (Object.keys(data.skill_usage).length || !has('- Skills used')) shouldCopy.add('- Skills used');
  if (data.internal_skills.length || !has('- Internal specialist skills')) shouldCopy.add('- Internal specialist skills');
  if (data.skills.length || !has('- Loaded skills')) shouldCopy.add('- Loaded skills');
  if (data.activation || data.graphify_status || !has('- Activation / Graphify')) shouldCopy.add('- Activation / Graphify');
  if (data.started_at || data.finished_at) shouldCopy.add('- Started / finished');
  if (data.cost.pricing) shouldCopy.add('- Pricing basis');
  const enriched = [...current];
  for (const prefix of shouldCopy) {
    const replacement = generated.get(prefix);
    if (!replacement) continue;
    const index = enriched.findIndex((line) => line.startsWith(`${prefix}:`));
    if (index >= 0) enriched[index] = replacement;
    else enriched.push(replacement);
  }
  return [...lines.slice(0, start + 1), ...enriched, ...lines.slice(end)].join('\n').trimEnd() + '\n';
}
