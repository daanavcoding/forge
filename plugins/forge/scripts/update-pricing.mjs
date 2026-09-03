#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const PRICING_SOURCE_URL = 'https://models.dev/api.json';
export const PRICING_SCHEMA_VERSION = 1;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PRICING_FILE = path.resolve(scriptDirectory, '..', 'data', 'model-pricing.json');

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function price(value, label) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) {
    throw new Error(`${label} must be a finite non-negative price`);
  }
  return number;
}

function optionalPrice(value, label) {
  return value === undefined || value === null ? undefined : price(value, label);
}

function normalizeTier(value, label) {
  const tier = object(value, label);
  const selector = object(tier.tier, `${label}.tier`);
  if (selector.type !== 'context') throw new Error(`${label}.tier.type is unsupported`);
  const size = Number(selector.size);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error(`${label}.tier.size is invalid`);
  const normalized = {
    context_tokens_at_least: size,
    input: price(tier.input, `${label}.input`),
    output: price(tier.output, `${label}.output`),
  };
  const cacheRead = optionalPrice(tier.cache_read, `${label}.cache_read`);
  const cacheWrite = optionalPrice(tier.cache_write, `${label}.cache_write`);
  if (cacheRead !== undefined) normalized.cached_input = cacheRead;
  if (cacheWrite !== undefined) normalized.cache_write = cacheWrite;
  return normalized;
}

function normalizeCost(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.input === undefined || value.output === undefined) return null;
  const normalized = {
    input: price(value.input, `${label}.input`),
    output: price(value.output, `${label}.output`),
  };
  const cacheRead = optionalPrice(value.cache_read, `${label}.cache_read`);
  const cacheWrite = optionalPrice(value.cache_write, `${label}.cache_write`);
  if (cacheRead !== undefined) normalized.cached_input = cacheRead;
  if (cacheWrite !== undefined) normalized.cache_write = cacheWrite;
  if (Array.isArray(value.tiers) && value.tiers.length) {
    normalized.tiers = value.tiers
      .map((tier, index) => normalizeTier(tier, `${label}.tiers[${index}]`))
      .sort((left, right) => left.context_tokens_at_least - right.context_tokens_at_least);
  }
  return normalized;
}

function sortedEntries(value) {
  return Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

export function normalizePricingCatalog(raw) {
  const providers = {};
  for (const [providerId, providerValue] of sortedEntries(object(raw, 'catalog'))) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(providerId)) continue;
    const provider = object(providerValue, `provider ${providerId}`);
    const models = {};
    for (const [modelId, modelValue] of sortedEntries(object(provider.models, `provider ${providerId}.models`))) {
      const model = object(modelValue, `model ${providerId}/${modelId}`);
      const cost = normalizeCost(model.cost, `model ${providerId}/${modelId}.cost`);
      if (cost) models[modelId] = cost;
    }
    if (Object.keys(models).length) {
      providers[providerId] = {
        name: String(provider.name || providerId).replace(/\s+/g, ' ').trim(),
        models,
      };
    }
  }
  if (!Object.keys(providers).length) throw new Error('catalog contains no usable model pricing');
  return providers;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function catalogStats(providers) {
  return Object.values(providers).reduce((totals, provider) => ({
    providers: totals.providers + 1,
    models: totals.models + Object.keys(provider.models).length,
  }), { providers: 0, models: 0 });
}

export function assertSafeCatalogChange(current, incoming) {
  if (!current) return;
  const before = catalogStats(current.providers);
  const after = catalogStats(incoming.providers);
  if (after.providers < before.providers * 0.9) throw new Error('pricing source removed more than 10% of providers');
  if (after.models < before.models * 0.9) throw new Error('pricing source removed more than 10% of priced models');
  for (const [providerId, provider] of Object.entries(current.providers)) {
    for (const [modelId, cost] of Object.entries(provider.models)) {
      const next = incoming.providers[providerId]?.models?.[modelId];
      if (!next) continue;
      const comparePrices = (beforeCost, afterCost, suffix = '') => {
        for (const field of ['input', 'cached_input', 'cache_write', 'output']) {
          const oldPrice = beforeCost[field];
          const newPrice = afterCost[field];
          if (oldPrice === undefined || newPrice === undefined || oldPrice === 0 || newPrice === 0) continue;
          const ratio = newPrice / oldPrice;
          if (ratio > 10 || ratio < 0.1) {
            throw new Error(`suspicious ${field} price change for ${providerId}/${modelId}${suffix}: ${oldPrice} -> ${newPrice}`);
          }
        }
      };
      comparePrices(cost, next);
      const nextTiers = new Map((next.tiers || []).map((tier) => [tier.context_tokens_at_least, tier]));
      for (const tier of cost.tiers || []) {
        const nextTier = nextTiers.get(tier.context_tokens_at_least);
        if (nextTier) comparePrices(tier, nextTier, ` at ${tier.context_tokens_at_least}+ tokens`);
      }
    }
  }
}

export function buildPricingSnapshot(raw, { updatedAt = new Date().toISOString() } = {}) {
  const providers = normalizePricingCatalog(raw);
  return {
    schema_version: PRICING_SCHEMA_VERSION,
    source: {
      name: 'Models.dev',
      url: PRICING_SOURCE_URL,
      updated_at: updatedAt,
    },
    catalog_sha256: digest(providers),
    providers,
  };
}

export function validatePricingSnapshot(value) {
  const snapshot = object(value, 'snapshot');
  if (snapshot.schema_version !== PRICING_SCHEMA_VERSION) throw new Error('unsupported pricing schema version');
  const source = object(snapshot.source, 'snapshot.source');
  if (source.url !== PRICING_SOURCE_URL || !Number.isFinite(Date.parse(source.updated_at))) {
    throw new Error('invalid pricing source metadata');
  }
  const providers = object(snapshot.providers, 'snapshot.providers');
  if (digest(providers) !== snapshot.catalog_sha256) throw new Error('pricing catalog checksum mismatch');
  normalizePricingCatalog(Object.fromEntries(Object.entries(providers).map(([id, provider]) => [id, {
    name: provider.name,
    models: Object.fromEntries(Object.entries(provider.models || {}).map(([model, cost]) => [model, {
      cost: {
        ...cost,
        cache_read: cost.cached_input,
        tiers: Array.isArray(cost.tiers) ? cost.tiers.map((tier) => ({
          ...tier,
          cache_read: tier.cached_input,
          tier: { type: 'context', size: tier.context_tokens_at_least },
        })) : undefined,
      },
    }]))
  }])));
  return snapshot;
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function fetchCatalog(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'forge-pricing-updater/1' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`pricing source returned HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) throw new Error('pricing source did not return JSON');
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > 10_000_000) throw new Error('pricing source exceeds 10 MB limit');
  const body = await response.text();
  if (Buffer.byteLength(body) > 10_000_000) throw new Error('pricing source exceeds 10 MB limit');
  return JSON.parse(body);
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

export async function updatePricing({ file = DEFAULT_PRICING_FILE, check = false, allowLargeChange = false, raw = null, now = new Date() } = {}) {
  const current = await readJson(file);
  if (current) validatePricingSnapshot(current);
  const incoming = buildPricingSnapshot(raw || await fetchCatalog(PRICING_SOURCE_URL), { updatedAt: now.toISOString() });
  const changed = !current || current.catalog_sha256 !== incoming.catalog_sha256;
  if (!changed) return { changed: false, file, catalog_sha256: current.catalog_sha256 };
  if (!allowLargeChange) assertSafeCatalogChange(current, incoming);
  if (check) return { changed: true, file, catalog_sha256: incoming.catalog_sha256 };
  await writeAtomic(file, `${JSON.stringify(incoming, null, 2)}\n`);
  return { changed: true, file, catalog_sha256: incoming.catalog_sha256 };
}

async function main() {
  const { values } = parseArgs({
    options: {
      check: { type: 'boolean', default: false },
      'allow-large-change': { type: 'boolean', default: false },
      file: { type: 'string' },
    },
  });
  const result = await updatePricing({
    file: values.file ? path.resolve(values.file) : DEFAULT_PRICING_FILE,
    check: values.check,
    allowLargeChange: values['allow-large-change'],
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
