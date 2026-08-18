---
name: agent-design
description: Design LLM agents, including agent loops, tool surfaces, memory, context limits,
  termination, and subagent delegation. Use when building an agent, defining its tools, or
  debugging a loop that does not terminate. Do not use for basic model calls; use llm-apps instead.
---

# agent-design

An agent is a loop in which **the model decides the next step**. That is what separates it from a
code-controlled workflow, and what makes it expensive and hard to debug.

## Before building one: do you need it?

If any answer is "no", keep the workflow controlled by code:

1. **Multi-step and impossible to specify in advance?** "Turn this design into a PR" is; "extract
   the title from this PDF" is not.
2. **Does the result justify cost and latency?** An agent costs orders of magnitude more than one
   call.
3. **Is the model capable in this domain?** A step that fails 40% of the time compounds through the
   loop.
4. **Can failures be detected and reversed?** Tests, review, rollback. Without them a mistaken
   agent does damage silently.

## The tool surface is the design

An agent can do only what its tools allow. Security is decided there, not in the prompt.

- **`bash` gives reach; a dedicated tool gives control.** `bash` hands you an opaque string;
  `send_email(to, subject, body)` hands you typed arguments you can validate, gate, record or deny.
- **Promote an operation to its own tool** when it needs a permission gate, stale-write detection
  (reject a write when the file changed since it was read), its own interface, or parallelism.
- **Write prescriptive descriptions** — say *when* to call it, not only what it does. Current
  models are conservative with tools, and trigger conditions materially change usage rates.
- **Few, focused tools.** A catalog of 40 confuses the model; load on demand if there are many.

## Termination: the loop must be able to stop

- Always a hard iteration limit. Not a precaution — it will be reached.
- A per-run cost or cumulative token limit.
- Detect loops: same call with the same arguments twice, stop.
- After two attempts at the same failure, escalate. A third almost never helps.

## Context: the silent enemy

History grows with every tool result and eventually dominates cost.

| Problem | Technique |
|---|---|
| Irrelevant old results | Prune them from history |
| Conversation nearing its limit | Compact it into a summary |
| State needed across runs | Store memory in a file, not in history |

**Never insert a huge tool result in full.** Write it to disk, return its path plus a summary. A
4,000-line `grep` result does not become useful by consuming the context window.

## Delegating to subagents

A subagent costs more than it looks: it rebuilds context, explores again, reports back, and the
coordinator reads the report. Delegate only work that is **large and independent**.

- Do not delegate what a few tool calls solve.
- Do not delegate verification of your own work when the coordinator can do it.
- If you delegate, **commit to it** — do not redo the subagent's work afterwards.
- Run independent parallel work concurrently, not serially.
- Set an explicit ceiling on subagents per run.

## Memory

- **Within a run**, history is memory; pruning and compaction are memory management.
- **Across runs**, use explicit storage — a `.md` file per lesson with a summary on the first line
  is enough.
- **Never store secrets in memory.** They get repeated in every future session that loads it.

## Anti-patterns

- A loop with no iteration or cost limit.
- A generic `execute` tool that accepts anything — `eval` renamed.
- Relying on a prompt to prevent destructive action instead of withholding the capability.
- Loading an entire repository into context "just in case".
- Letting history grow unpruned until the model loses the thread.
- Confusing "the agent said it did this" with "this is done". Verify the effect, not the report.

## Verification

- Run the loop with a task designed to **fail**: does it stop, escalate, or spin forever?
- Exercise the iteration limit until it is actually reached.
- Route a destructive action through its permission gate and verify denial.
- Measure tokens per run. If you do not know the cost, you do not control it.
