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

Common schema constraints: no recursion, no `minimum`/`maxLength`, and mandatory
`additionalProperties: false` on every object.

## Check why the model stopped, before reading content

`stop_reason == "refusal"` means the model declined and `content` may be empty;
`stop_reason == "max_tokens"` means the response is truncated and must not be treated as complete.
Reading `response.content[0]` without checking fails in both cases.

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
- **Do not change tools mid-conversation.** Tools render first, so changing them invalidates
  everything.

Verify it: if `usage.cache_read_input_tokens` stays 0 across repeated requests with the same
prefix, something is invalidating it.

## Count tokens

Use the provider endpoint (`client.messages.count_tokens`), not `tiktoken` — that targets another
vendor's tokenizer and is off by 15-20% on ordinary text, more on code.

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
- Cover a `stop_reason` other than `end_turn`.
- With caching enabled, verify `cache_read_input_tokens > 0` on the second call.
