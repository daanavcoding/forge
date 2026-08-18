---
name: langchain
description: LangChain 1.x composition with LCEL/Runnables, chat models, prompt templates, output
  parsers, tools, and retrievers. Use when a repository imports langchain or langchain_core and
  needs those abstractions. Do not use for basic LLM calls or stateful graphs; use llm-apps or
  langgraph respectively.
---

# langchain

Target **LangChain 1.x**. Its main namespace is intentionally smaller; legacy chains and memory
live in `langchain-classic` and are not a default for new code.

Glue between providers. Its value is portability and ready-made components; its cost is an
indirection layer between your code and the actual model call.

**If you call a model only once, you do not need LangChain.** A provider SDK is more direct, easier
to debug and does not add a dependency that breaks across frequent releases. Justify the layer with
multiple providers, existing retrievers or genuine composition.

## Composition: LCEL

Chain with `|`; everything implementing `Runnable` composes with everything else.

```python
chain = prompt | model | StrOutputParser()      # ChatPromptTemplate | ChatAnthropic | parser
chain.invoke({"question": "..."})
```

For a standard tool-calling agent, use LangChain 1.x's `create_agent`. Use `langgraph` directly when
the workflow needs custom graph topology, durable checkpoints, or explicit human interrupts; do not
copy legacy `langgraph.prebuilt` agent examples into new code.

The interface is consistent throughout: `invoke`, `batch`, `stream` and their `a*` variants.
`batch` already parallelizes — do not wrap another concurrency loop around it.

## Structured output

Prefer `with_structured_output()` to parsing text; the provider's native mechanism is more reliable
than a parser over free-form output.

```python
class Answer(BaseModel):
    verdict: str
    confidence: float

result: Answer = model.with_structured_output(Answer).invoke("...")
```

## Tools

```python
from langchain.tools import tool

@tool
def get_invoice(invoice_id: str) -> str:
    """Return an invoice total. Use when asked about a specific amount."""
```

The docstring **is** the description the model sees — write it for the model and say when to use
the tool. Signature types generate the schema, so annotate every parameter and return. Bind with
`model.bind_tools([...])`.

## Async: do not mix modes

Pick synchronous or asynchronous and keep it consistent through the chain. A synchronous component
inside an `ainvoke` chain blocks the event loop and silently removes parallelism.

## Streaming

`stream()` works end to end only when **every** component supports it. A parser that needs the
complete output breaks streaming and emits once at the end — usually the cause when the UI shows no
progressive tokens.

## Observability

A chain is opaque by design; debugging without traces is guesswork. Enable callbacks or tracing
from the start, not after a failure. Inspect the **rendered** prompt, not only its template.

## Anti-patterns

- LangChain for one model call.
- `ConversationChain` and legacy memory in new code; use `langgraph` for state, or isolate legacy
  compatibility behind the `langchain-classic` package.
- Seven-step chains where three steps are an `if` that would be clearer in plain Python.
- Tools without docstrings, leaving the model unable to choose them.
- Prompts built with f-strings over user input, without a template or escaping.
- `>=` version constraints — this library breaks across minor versions. Pin exactly.
- Trusting an output parser that "usually" works instead of structured output.

## Verification

- Run the chain with a real input and show the output.
- Inspect the rendered prompt, not only the template.
- If tools exist, verify the model selects the correct one for a concrete case.
- If streaming is enabled, verify progressive output rather than one final burst.
