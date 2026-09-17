# Skills alignment review

Reviewed on 2026-09-17 against the public [skills.sh directory](https://skills.sh/).
Scope: both public workflows and all 20 private specialists in the canonical package.

## Selection and limits

Use adoption as a discovery signal, then prefer the technology author's guidance and a close
match to each skill's purpose. This is a comparison with prominent or authoritative examples,
not a claim that each reference is the absolute most-installed skill in its category. Counts
change, and directory summaries can lag the underlying repository.

Examples observed during this review: Vercel React approximately 722K installs, Supabase Postgres
405K, Superpowers systematic debugging 262K, Anthropic MCP builder 115K, TypeScript advanced types
76K, GitHub git-commit 45K, Angular's official skill 36K, and FastAPI templates 24K.

Inspected directory entries and their published guidance; additionally read the full upstream
[Vercel React entrypoint](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md),
[MCP builder](https://github.com/anthropics/skills/blob/main/skills/mcp-builder/SKILL.md), and
[Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md).
Not every linked reference tree was audited. No third-party package was installed or copied.

## Decisions by skill

| Forge skill | Comparison source | Decision |
| --- | --- | --- |
| forge | [systematic-debugging](https://skills.sh/obra/superpowers/systematic-debugging), [verification-before-completion](https://skills.sh/obra/superpowers/verification-before-completion) | Add causal diagnosis, behavior-based regression checks, and claims tied to command evidence; retain the existing workflow gates. |
| forge-commit | [git-commit](https://skills.sh/github/awesome-copilot/git-commit) | Retain: scoped staging, diff review, descriptive messages, and remote verification already cover the relevant practices. Do not impose a new commit-message convention. |
| agent-design | [MCP builder](https://skills.sh/anthropics/skills/mcp-builder), [LangGraph](https://skills.sh/langchain-ai/docs/langgraph) | Keep bounded loops and focused tools; distinguish stalled execution from legitimate polling and transient retries. |
| angular | [angular-developer](https://skills.sh/angular/skills/angular-developer) | Respect installed APIs and conventions, allow appropriate forms choices, add build/UI checks, remove missing testing-skill dependency. |
| dotnet | [dotnet-backend-patterns](https://skills.sh/wshobson/agents/dotnet-backend-patterns) | Replace a universal custom layer matrix and bans on enums/static helpers/DI with repository-aware boundaries, DI lifetimes, cancellation, data access, and API verification. |
| error-contracts | [error-handling-patterns](https://skills.sh/wshobson/agents/error-handling-patterns) | Keep stable codes and boundary translation; align .NET guidance with actual application layers and existing Result types. |
| fastapi | [fastapi-templates](https://skills.sh/wshobson/agents/fastapi-templates) | Correct sync/async guidance, move HTTP status out of domain errors, remove exception-string leakage, add endpoint and session tests. |
| html-css | [web-design-guidelines](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines) | Add form recovery/autocomplete, accessible async feedback, UI states, and focus restoration checks. |
| java | [java-architect](https://skills.sh/jeffallan/claude-skills/java-architect) | Prefer existing build wrappers; clarify future failure propagation. Keep this specialist framework-neutral rather than forcing Spring or a coverage percentage. |
| javascript | [modern-javascript-patterns](https://skills.sh/wshobson/agents/modern-javascript-patterns) | Retain: modules, async order, immutability, and runtime edge cases already cover the relevant baseline. |
| langchain | [LangGraph routing guidance](https://skills.sh/langchain-ai/docs/langgraph), [langchain-rag](https://skills.sh/langchain-ai/skills-benchmarks/langchain-rag) | Retain composition and structured outputs; correct the blanket async claim and make hosted tracing respect data authorization. |
| langgraph | [langgraph-persistence](https://skills.sh/langchain-ai/langchain-skills/langgraph-persistence), [LangGraph](https://skills.sh/langchain-ai/docs/langgraph) | Use message-aware reducers and explicitly distinguish dynamic interrupt replay from static breakpoints. |
| llm-apps | [MCP builder](https://skills.sh/anthropics/skills/mcp-builder), [llm-evaluation](https://skills.sh/wshobson/agents/llm-evaluation) | Preserve validation and cost controls; remove universal claims based on one provider's schema, stop reasons, cache fields, and tokenizer. Sources overlap only partially with this broad specialist. |
| llm-evals | [llm-evaluation](https://skills.sh/wshobson/agents/llm-evaluation) | Require independent calibrated judging and metric-appropriate reporting rather than a universal different-model rule or median. |
| mcp | [mcp-builder](https://skills.sh/anthropics/skills/mcp-builder) | Add tool annotations and task-level usability checks. Keep protocol-specific compatibility guidance; older examples are not a reason to downgrade the protocol. |
| nextjs | [vercel-react-best-practices](https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices) | Narrow discovery to actual Next.js projects, clarify RSC boundaries/deduplication, minimize serialized data, and put authorization into the mutation example. |
| node | [nodejs-backend-patterns](https://skills.sh/wshobson/agents/nodejs-backend-patterns) | Keep runtime/process safeguards; clarify that lockfiles enable reproducibility without banning compatible manifest ranges. |
| postgres | [supabase-postgres-best-practices](https://skills.sh/supabase/agent-skills/supabase-postgres-best-practices) | Add plans, lock-aware migrations, pooling and RLS checks; remove mandatory repeatability, placeholder defaults, and automatic soft deletion. |
| python | [python-testing-patterns](https://skills.sh/wshobson/agents/python-testing-patterns) | Add focused test, fixture, temporary-directory, and async verification guidance without forcing a new runner. |
| rag | [rag-implementation](https://skills.sh/wshobson/agents/rag-implementation), [langchain-rag](https://skills.sh/langchain-ai/skills-benchmarks/langchain-rag) | Retain retrieval/grounding measurement; make access filtering and revoked-content checks explicit. |
| react | [vercel-react-best-practices](https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices) | Prioritize waterfalls and bundle size, handle stale async results, and repair the TypeScript/testing references. |
| typescript | [typescript-advanced-types](https://skills.sh/wshobson/agents/typescript-advanced-types) | Preserve project compiler scope, add public type-contract checks, and correct the literal-preservation example. |

Technical cross-checks: [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
for node replay and [PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html)
for concurrent-index restrictions. The directory's `vercel-labs/next-skills/next-best-practices`
entry returned an unavailable/404 page, so it was not used as evidence.

## Validation boundary

Passed `npm run check`, `npm run plugin:check`, and `quick_validate.py` for all 22 skills.
The final diff review also checked cross-skill references and conflicting guidance.
These checks establish package integrity and instruction consistency, not improved model performance.
No live model benchmarks, host installation, release, commit, or push are part of this review.
Behavioral improvement remains to be measured with representative tasks under the user's normal
benchmark authorization and budget.
