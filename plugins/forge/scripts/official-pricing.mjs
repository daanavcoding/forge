// Standard, first-party text-token API rates in USD per million tokens.
// Each entry is checked against the linked provider rate card before editing.
// No gateway, reseller, batch, priority, regional, or subscription rate belongs here.
const openaiSource = 'https://developers.openai.com/api/docs/pricing';
const anthropicSource = 'https://platform.claude.com/docs/en/about-claude/pricing';

function openai(input, cached, write, output, model) {
  return {
    input, cached_input: cached, ...(write === null ? {} : { cache_write: write }), output,
    source_url: `https://developers.openai.com/api/docs/models/${model}`,
    context_tiers: [{
      input_tokens_above: 272_000,
      input: input * 2,
      cached_input: cached * 2,
      ...(write === null ? {} : { cache_write: write * 2 }),
      output: output * 1.5,
    }],
  };
}

function anthropic(input, cached, write5m, write1h, output, options = {}) {
  return {
    input, cached_input: cached,
    cache_write_5m: write5m, cache_write_1h: write1h, output,
    source_url: anthropicSource,
    ...options,
  };
}

export const OFFICIAL_PRICING = {
  verified_at: '2026-09-29',
  providers: {
    openai: {
      name: 'OpenAI', source_url: openaiSource,
      models: {
        'gpt-6-astra': openai(10, 1, 12.5, 50, 'gpt-6-astra'),
        'gpt-6-sol': openai(2, 0.2, 2.5, 10, 'gpt-6-sol'),
        'gpt-6-luna': openai(0.1, 0.01, 0.125, 0.5, 'gpt-6-luna'),
        'gpt-5.6-sol': openai(4, 0.4, 5, 20, 'gpt-5.6-sol'),
        'gpt-5.6-terra': openai(2, 0.2, 2.5, 12, 'gpt-5.6-terra'),
        'gpt-5.6-luna': openai(0.2, 0.02, 0.25, 1.2, 'gpt-5.6-luna'),
        'gpt-5.5': openai(5, 0.5, null, 30, 'gpt-5.5'),
      },
    },
    anthropic: {
      name: 'Anthropic', source_url: anthropicSource,
      models: {
        'claude-fable-5-1': anthropic(10, 0.25, 12.5, 20, 50),
        'claude-fable-5': anthropic(10, 1, 12.5, 20, 50),
        'claude-opus-5-5': anthropic(4, 0.2, 5, 8, 20),
        'claude-opus-5': anthropic(5, 0.5, 6.25, 10, 25),
        'claude-opus-4-8': anthropic(5, 0.5, 6.25, 10, 25),
        'claude-opus-4-7': anthropic(5, 0.5, 6.25, 10, 25),
        'claude-opus-4-6': anthropic(5, 0.5, 6.25, 10, 25),
        'claude-opus-4-5': anthropic(5, 0.5, 6.25, 10, 25, { max_exact_context_tokens: 200_000 }),
        'claude-opus-4-5-20251101': anthropic(5, 0.5, 6.25, 10, 25, { max_exact_context_tokens: 200_000 }),
        'claude-sonnet-5-5': anthropic(2, 0.2, 2.5, 4, 10),
        'claude-sonnet-5': anthropic(2, 0.2, 2.5, 4, 10),
        'claude-sonnet-4-6': anthropic(3, 0.3, 3.75, 6, 15),
        'claude-sonnet-4-5': anthropic(3, 0.3, 3.75, 6, 15, { max_exact_context_tokens: 200_000 }),
        'claude-sonnet-4-5-20250929': anthropic(3, 0.3, 3.75, 6, 15, { max_exact_context_tokens: 200_000 }),
        'claude-haiku-4-5': anthropic(1, 0.1, 1.25, 2, 5, { max_exact_context_tokens: 200_000 }),
        'claude-haiku-4-5-20251001': anthropic(1, 0.1, 1.25, 2, 5, { max_exact_context_tokens: 200_000 }),
      },
    },
    xai: {
      name: 'xAI', source_url: 'https://docs.x.ai/developers/pricing',
      models: {
        'grok-4.5': {
          input: 2, cached_input: 0.3, output: 6,
          max_exact_context_tokens: 200_000,
          source_url: 'https://docs.x.ai/developers/models/grok-4.5',
        },
      },
    },
    mistral: {
      name: 'Mistral', source_url: 'https://docs.mistral.ai/inference/pricing',
      models: {
        'mistral-large-3': {
          input: 0.5, cached_input: 0.05, output: 1.5,
          source_url: 'https://docs.mistral.ai/inference/pricing',
        },
        'mistral-medium-3.5': {
          input: 1.5, cached_input: 0.15, output: 7.5,
          source_url: 'https://docs.mistral.ai/inference/pricing',
        },
        'mistral-small-4': {
          input: 0.15, cached_input: 0.015, output: 0.6,
          source_url: 'https://docs.mistral.ai/inference/pricing',
        },
      },
    },
    cohere: {
      name: 'Cohere', source_url: 'https://docs.cohere.com/docs/how-does-cohere-pricing-work',
      models: {
        'command-a-03-2025': {
          input: 2.5, output: 10,
          source_url: 'https://docs.cohere.com/docs/command-a',
        },
      },
    },
    google: {
      name: 'Google', source_url: 'https://ai.google.dev/gemini-api/docs/pricing',
      models: {
        'gemini-3.5-flash': {
          input: 1.5, cached_input: 0.15, output: 9,
          source_url: 'https://ai.google.dev/gemini-api/docs/pricing',
        },
        'gemini-3.5-flash-lite': {
          input: 0.3, cached_input: 0.03, output: 2.5,
          source_url: 'https://ai.google.dev/gemini-api/docs/pricing',
        },
      },
    },
    xiaomi: {
      name: 'Xiaomi MiMo', source_url: 'https://platform.xiaomimimo.com/',
      models: {
        'mimo-v2.5': {
          input: 0.14, cached_input: 0.0028, output: 0.28,
          source_url: 'https://platform.xiaomimimo.com/',
        },
        'mimo-v2.5-pro': {
          input: 0.435, cached_input: 0.0036, output: 0.87,
          source_url: 'https://platform.xiaomimimo.com/',
        },
        'mimo-v2.5-pro-ultraspeed': {
          input: 1.305, cached_input: 0.0108, output: 2.61,
          source_url: 'https://platform.xiaomimimo.com/',
        },
      },
    },
    zai: {
      name: 'Z.AI', source_url: 'https://docs.z.ai/guides/overview/pricing',
      models: {
        'glm-5': { input: 1, cached_input: 0.2, output: 3.2,
          source_url: 'https://docs.z.ai/guides/overview/pricing' },
        'glm-5.1': { input: 1.4, cached_input: 0.26, output: 4.4,
          source_url: 'https://docs.z.ai/guides/overview/pricing' },
        'glm-5.2': { input: 1.4, cached_input: 0.26, output: 4.4,
          source_url: 'https://docs.z.ai/guides/overview/pricing' },
        'glm-4.7': { input: 0.6, cached_input: 0.11, output: 2.2,
          source_url: 'https://docs.z.ai/guides/overview/pricing' },
      },
    },
    minimax: {
      name: 'MiniMax', source_url: 'https://platform.minimax.io/subscribe/token-plan',
      models: {
        'minimax-m2.7': { input: 0.3, cached_input: 0.06, cache_write: 0.375, output: 1.2,
          source_url: 'https://platform.minimax.io/subscribe/token-plan' },
        'minimax-m2.7-highspeed': { input: 0.6, cached_input: 0.06, cache_write: 0.375, output: 2.4,
          source_url: 'https://platform.minimax.io/subscribe/token-plan' },
      },
    },
    deepseek: {
      name: 'DeepSeek', source_url: 'https://api-docs.deepseek.com/quick_start/pricing/',
      models: {
        'deepseek-flash': {
          input: 0.15, cached_input: 0.003, cache_write: 0, output: 0.6,
          time_tiers: [{ weekday_utc: [1, 2, 3, 4, 5], hour_ranges_utc: [[1, 4], [6, 10]],
            input: 0.3, cached_input: 0.006, cache_write: 0, output: 1.2 }],
          source_url: 'https://api-docs.deepseek.com/quick_start/pricing/',
        },
        'deepseek-v4-pro': {
          input: 0.66, cached_input: 0.022, cache_write: 0, output: 1.98,
          time_tiers: [{ weekday_utc: [1, 2, 3, 4, 5], hour_ranges_utc: [[1, 4], [6, 10]],
            input: 1.32, cached_input: 0.044, cache_write: 0, output: 3.96 }],
          source_url: 'https://api-docs.deepseek.com/quick_start/pricing/',
        },
      },
    },
    moonshotai: {
      name: 'Moonshot AI', source_url: 'https://platform.kimi.ai/',
      models: {
        'kimi-k3': { input: 3, cached_input: 0.3,
          cache_write_5m: 3, cache_write_1h: 6, output: 15,
          source_url: 'https://platform.kimi.ai/docs/guide/context-caching' },
        'kimi-k2.6': { input: 0.95, cached_input: 0.16, output: 4,
          source_url: 'https://platform.kimi.ai/' },
        'kimi-k2.7-code': { input: 0.95, cached_input: 0.19, output: 4,
          source_url: 'https://platform.kimi.ai/' },
      },
    },
  },
};
