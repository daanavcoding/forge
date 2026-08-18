---
name: langgraph
description: LangGraph 1.x state graphs, nodes, conditional edges, checkpointing, human-in-the-loop
  interrupts, and agent cycles. Use when a repository imports langgraph or needs a stateful,
  resumable, or cyclic workflow. Do not use for linear stateless chains; use langchain instead.
---

# langgraph

Target **LangGraph 1.x**. Prefer the current graph and functional APIs; do not copy legacy
`langgraph.prebuilt` agent examples into new code.

A state machine for LLM workflows: cycles, conditional branches, persistence and resumption.

**If the workflow is linear and stateless, an LCEL chain is enough.** LangGraph earns its place
with cycles (retry-until-valid), genuine branches, persistence across turns, or a pause for human
intervention.

## State is the design

Everything flows through state. Design it first; the rest follows.

```python
class State(TypedDict):
    messages: Annotated[list, add]   # accumulate
    attempts: int                    # overwrite
    result: str | None

def plan(state: State) -> dict:
    return {"attempts": state["attempts"] + 1}   # return the DELTA, not the entire state
```

Two rules prevent most bugs:

- **A node returns only the keys it changes.** Returning the whole state overwrites what other
  nodes wrote.
- **The reducer decides accumulate vs overwrite.** `Annotated[list, add]` concatenates; without the
  annotation the value is replaced. A disappearing message history usually means a missing reducer.

## Conditional edges and cycles

```python
def should_retry(state: State) -> str:
    if state["result"] is not None:
        return END
    if state["attempts"] >= 3:        # the limit lives in the graph, not the prompt
        return END
    return "plan"

graph.add_conditional_edges("plan", should_retry)
```

**Every cycle needs a counter-based exit, not only a success condition.** A graph that exits only
on success runs forever when success is impossible. Also pass `recursion_limit` at invocation as a
safety net.

## Checkpointing

Use `InMemorySaver` for development and tests. Use a durable saver such as
`AsyncPostgresSaver` for production, and run its setup/initialization step when required.

A checkpointer persists state per thread, enabling multi-turn conversations, recovery after failure
and debugging against real state:

The current in-memory implementation is `InMemorySaver`; treat older `MemorySaver` examples as
legacy and do not copy them into new code.

```python
from langgraph.checkpoint.memory import InMemorySaver

app = graph.compile(checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "user-42"}}
```

`InMemorySaver` is development-only and loses data on restart — use SQLite or PostgreSQL in
production. `thread_id` identifies the conversation; generating a new one per request removes
memory and produces the symptom "it forgets everything".

## Human in the loop

For current 1.x workflows, prefer `interrupt()` for a dynamic approval payload and resume with
`Command(resume=...)`. Keep `interrupt_before`/`interrupt_after` for fixed review points or
debugging; every interrupt still requires a checkpointer and a stable `thread_id`.

`interrupt_before` pauses before a node for approval. It **requires a checkpointer** — without one
there is nowhere to pause. Resuming with `None` continues from the exact location. Use it for
irreversible actions: paying, deleting, publishing.

## Anti-patterns

- A cycle without an iteration limit.
- Nodes returning the entire state and overwriting concurrent writes.
- State with 20 keys whose writers are unclear. If it does not fit on one screen, the graph is
  badly decomposed.
- Side effects inside a node that can rerun after a retry. Make them idempotent or move them out of
  the cycle.
- `InMemorySaver` in production.
- A new `thread_id` per request, then surprise that nothing is remembered.
- Non-serializable objects in state — the checkpointer fails.

## Verification

- Run the whole graph and show the final state.
- Force the failure path and verify the cycle **terminates** at the attempt limit.
- With a checkpointer, interrupt halfway, resume, verify continuation from the saved point.
- Verify reducers: two nodes writing the same key must produce the expected result.
