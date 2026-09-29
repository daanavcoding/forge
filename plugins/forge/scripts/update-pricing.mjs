#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { OFFICIAL_PRICING } from './official-pricing.mjs';

export const PRICING_SCHEMA_VERSION = 2;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PRICING_FILE = path.resolve(scriptDirectory, '..', 'data', 'model-pricing.json');

const OFFICIAL_DOMAINS = {
  openai: 'developers.openai.com',
  anthropic: 'platform.claude.com',
  google: 'ai.google.dev',
  xai: 'docs.x.ai',
  mistral: 'docs.mistral.ai',
  deepseek: 'api-docs.deepseek.com',
  cohere: 'docs.cohere.com',
  alibaba: 'help.aliyun.com',
  moonshotai: 'platform.kimi.ai',
  minimax: 'platform.minimax.io',
  zai: 'docs.z.ai',
  xiaomi: 'platform.xiaomimimo.com',
};

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function price(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative price`);
  }
  return value;
}

function optionalPrice(value, label) {
  return value === undefined ? undefined : price(value, label);
}

function officialUrl(value, providerId, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an official HTTPS URL`); }
  if (url.protocol !== 'https:' || url.hostname !== OFFICIAL_DOMAINS[providerId]) {
    throw new Error(`${label} must be an official ${providerId} URL`);
  }
  return url.href;
}

function sortedEntries(value) {
  return Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

function normalizeRate(value, providerId, label) {
  const raw = object(value, label);
  const rate = {
    input: price(raw.input, `${label}.input`),
    output: price(raw.output, `${label}.output`),
  };
  for (const key of ['cached_input', 'cache_write', 'cache_write_5m', 'cache_write_1h']) {
    const normalized = optionalPrice(raw[key], `${label}.${key}`);
    if (normalized !== undefined) rate[key] = normalized;
  }
  if (raw.source_url) rate.source_url = officialUrl(raw.source_url, providerId, `${label}.source_url`);
  if (raw.max_exact_context_tokens !== undefined) {
    if (!Number.isSafeInteger(raw.max_exact_context_tokens) || raw.max_exact_context_tokens <= 0) {
      throw new Error(`${label}.max_exact_context_tokens is invalid`);
    }
    rate.max_exact_context_tokens = raw.max_exact_context_tokens;
  }
  if (raw.context_tiers !== undefined) {
    if (!Array.isArray(raw.context_tiers)) throw new Error(`${label}.context_tiers must be an array`);
    rate.context_tiers = raw.context_tiers.map((tier, index) => {
      const item = object(tier, `${label}.context_tiers[${index}]`);
      if (!Number.isSafeInteger(item.input_tokens_above) || item.input_tokens_above <= 0) {
        throw new Error(`${label}.context_tiers[${index}].input_tokens_above is invalid`);
      }
      const normalized = normalizeRate({ ...item, source_url: undefined, context_tiers: undefined }, providerId,
        `${label}.context_tiers[${index}]`);
      return { input_tokens_above: item.input_tokens_above, ...normalized };
    }).sort((left, right) => left.input_tokens_above - right.input_tokens_above);
  }
  if (raw.time_tiers !== undefined) {
    if (!Array.isArray(raw.time_tiers)) throw new Error(`${label}.time_tiers must be an array`);
    rate.time_tiers = raw.time_tiers.map((tier, index) => {
      const item = object(tier, `${label}.time_tiers[${index}]`);
      if (!Array.isArray(item.weekday_utc) || !item.weekday_utc.length
        || item.weekday_utc.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
        || !Array.isArray(item.hour_ranges_utc) || !item.hour_ranges_utc.length
        || item.hour_ranges_utc.some((range) => !Array.isArray(range) || range.length !== 2
          || !Number.isInteger(range[0]) || !Number.isInteger(range[1])
          || range[0] < 0 || range[0] >= range[1] || range[1] > 24)) {
        throw new Error(`${label}.time_tiers[${index}] has invalid UTC hours`);
      }
      const normalized = normalizeRate({ ...item, source_url: undefined, context_tiers: undefined,
        time_tiers: undefined }, providerId, `${label}.time_tiers[${index}]`);
      return { weekday_utc: item.weekday_utc, hour_ranges_utc: item.hour_ranges_utc, ...normalized };
    });
  }
  return rate;
}

export function normalizePricingCatalog(raw) {
  const source = object(raw, 'pricing source');
  const providers = {};
  for (const [providerId, value] of sortedEntries(object(source.providers, 'pricing source.providers'))) {
    if (!OFFICIAL_DOMAINS[providerId]) throw new Error(`unofficial pricing provider: ${providerId}`);
    const provider = object(value, `provider ${providerId}`);
    const models = {};
    for (const [modelId, model] of sortedEntries(object(provider.models, `provider ${providerId}.models`))) {
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(modelId)) throw new Error(`invalid model ID: ${modelId}`);
      const rate = normalizeRate(model, providerId, `model ${providerId}/${modelId}`);
      if (!rate.source_url) throw new Error(`model ${providerId}/${modelId} has no official source URL`);
      models[modelId] = rate;
    }
    if (Object.keys(models).length) {
      providers[providerId] = {
        name: String(provider.name || providerId).trim(),
        source_url: officialUrl(provider.source_url, providerId, `provider ${providerId}.source_url`),
        models,
      };
    }
  }
  if (!Object.keys(providers).length) throw new Error('no verified official model pricing');
  return providers;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function buildPricingSnapshot(raw = OFFICIAL_PRICING) {
  const verifiedAt = String(object(raw, 'pricing source').verified_at || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedAt) || !Number.isFinite(Date.parse(verifiedAt))) {
    throw new Error('official pricing verification date is invalid');
  }
  const providers = normalizePricingCatalog(raw);
  return {
    schema_version: PRICING_SCHEMA_VERSION,
    source: { name: 'Official provider rate cards', verified_at: verifiedAt },
    catalog_sha256: digest(providers),
    providers,
  };
}

export function validatePricingSnapshot(value) {
  const snapshot = object(value, 'snapshot');
  if (snapshot.schema_version !== PRICING_SCHEMA_VERSION) throw new Error('unsupported pricing schema version');
  const source = object(snapshot.source, 'snapshot.source');
  if (source.name !== 'Official provider rate cards'
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(source.verified_at || ''))
    || !Number.isFinite(Date.parse(source.verified_at))) {
    throw new Error('invalid official pricing source metadata');
  }
  const providers = normalizePricingCatalog({ providers: snapshot.providers });
  if (digest(providers) !== snapshot.catalog_sha256) throw new Error('pricing catalog checksum mismatch');
  return snapshot;
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function updatePricing({ file = DEFAULT_PRICING_FILE, check = false, raw = OFFICIAL_PRICING } = {}) {
  const current = await readJson(file);
  if (current?.schema_version === PRICING_SCHEMA_VERSION) validatePricingSnapshot(current);
  else if (current && current.schema_version !== 1) throw new Error('unsupported existing pricing schema version');
  const incoming = buildPricingSnapshot(raw);
  validatePricingSnapshot(incoming);
  const changed = !current || JSON.stringify(current) !== JSON.stringify(incoming);
  if (!changed || check) return { changed, file, catalog_sha256: incoming.catalog_sha256 };
  await writeAtomic(file, `${JSON.stringify(incoming, null, 2)}\n`);
  return { changed: true, file, catalog_sha256: incoming.catalog_sha256 };
}

async function main() {
  const { values } = parseArgs({ options: {
    check: { type: 'boolean', default: false },
    file: { type: 'string' },
  } });
  const result = await updatePricing({
    file: values.file ? path.resolve(values.file) : DEFAULT_PRICING_FILE,
    check: values.check,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (values.check && result.changed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Pricing update failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
