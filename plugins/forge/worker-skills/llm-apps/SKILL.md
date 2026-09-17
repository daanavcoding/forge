---
name: llm-apps
description: Core LLM application patterns for prompts, structured output, tool calling,
  streaming, prompt caching, retries, and cost control. Use when calling a language model from
  code, designing system prompts, or handling model responses. Do not use for agent loops or
  evaluation design; use agent-design or llm-evals respectively.
---

# llm-apps

Cross-cutting rules for any application that calls an LLM. `langchain`, `langgraph` and
`agent-design` have their own skills.

**Model output is untrusted input.** Validate it at the boundary exactly as you validate a form
submission. A model that is usually correct can still return anything: validate the schema, check
ranges, define behavior for invalid responses.

## Choose the simplest level that solves the problem

1. **One call** — classify, summarize, extract, answer. Covers most cases.
2. **A code-controlled workflow** — several calls whose order **you** determine.
3. **An agent** — the model chooses the steps. Only when the task cannot be specified in advance
   and failures are recoverable. See `agent-design`.

An agent for a task that fits in one call is expensive, slow and harder to debug.

## Prefer structured output to text parsing

Asking for JSON in a prompt and parsing it with a regex is a primary source of intermittent
failures. Use the provider's structured-output mechanism and validate against the schema.

```python
# Provider SDK pseudocode: use that provider's current structured-output API.
response = client.structured_output(
    model=model_id,                    # a model ID supported by this deployment
    schema=Extraction.model_json_schema(),
    input=text,
)
data = response.parsed_output           # may be None; check it
```

Supported JSON Schema subsets vary by provider and model. Check supported keywords and enforce
business constraints locally even when the provider guarantees syntactically valid output.

## Check why the model stopped, before reading content

Inspect the selected SDK's completion status, refusal representation, and tool-call response
shape before reading content. A refusal may be a content block rather than a stop reason, and
truncation must not be treated as a complete answer. Never index an assumed nonempty content list.

## Parameters: use those supported today

- Select a model ID supported by the configured provider and record it with every result; do not
  hard-code an unverified alias in a reusable skill.
- Reasoning controls, effort levels, sampling parameters, and token limits are provider- and
  model-specific. Send only fields documented for the selected model; never assume that
  `temperature`, `top_p`, `top_k`, `thinking`, `budget_tokens`, or `effort` are interchangeable.
- Confirm what the provider's `max_tokens` means: some APIs count output only, while others include
  hidden reasoning or use a separate reasoning/output budget.
- Stream long responses when the provider supports it, but still enforce an explicit timeout and
  handle partial output as incomplete.

## Prompt caching is prefix matching

Changing any byte invalidates everything after it. Three practical rules:

- **Nothing dynamic at the beginning.** A `datetime.now()` or session ID in the system prompt
  invalidates the cache on every request. Variable context goes at the end.
- **Serialize deterministically** — `json.dumps(d, sort_keys=True)`, never iterate a `set`.
- Keep tool definitions stable when useful for the provider's cache, but do not retain unnecessary
  tools or permissions solely to preserve a cache hit.

Verify provider-reported cached-token usage. Minimum prefix length, eligibility, expiry, and
provider-specific cache controls can explain a miss even when the prefix is unchanged.

## Count tokens

Use the selected provider's counting endpoint or a tokenizer matching the actual model. Label
local counts as estimates and use returned usage for observed billing; no tokenizer is universal.

## Errors and retries

- Retryable: 429, 5xx, network failures. SDKs already retry with backoff by default.
- Not retryable: 400, 401, 403, 404. Retrying a 400 repeats the same failure at extra cost.
- Catch typed SDK exception classes; **never** `if "rate limit" in str(e)`.
- A timeout is not proof of failure — the operation may have completed. Make side-effecting
  operations idempotent with an idempotency key.

## Anti-patterns

- Asking for JSON in the prompt and parsing manually instead of structured output.
- Treating `temperature=0` as deterministic. It never guarantees determinism and may be unsupported by
  the selected model.
- An API key in a prompt or message history, where it gets persisted.
- Retrying indefinitely after a refusal; it refuses again at the same cost.
- Logging a complete prompt containing personal data.
- Treating cost as an afterthought. Measure tokens per operation from day one.

## Verification

- Execute one successful case and one invalid-schema case.
- Cover refusal, truncation, and tool-call responses using the selected SDK's actual representation.
- With caching enabled, check eligible repeated requests and the provider's cached-token field.
