// Metadata-only private catalogue. Forge uses these descriptions to select
// specialist names; it must not load the corresponding SKILL.md bodies here.
export const PRIVATE_SKILL_CATALOG = Object.freeze([
  { name: 'agent-design', description: 'LLM agents, loops, tool surfaces, memory, context limits, and reliability.' },
  { name: 'angular', description: 'Angular standalone components, signals, modern control flow, routing, forms, and tests.' },
  { name: 'dotnet', description: '.NET and C# with Clean Architecture, layer boundaries, domain modeling, and tests.' },
  { name: 'error-contracts', description: 'Typed errors crossing layer or service boundaries, mappings, and stable contracts.' },
  { name: 'fastapi', description: 'FastAPI with Pydantic contracts, router/service/repository layers, validation, and tests.' },
  { name: 'html-css', description: 'Semantic HTML, accessibility, responsive layout, focus, forms, and modern CSS.' },
  { name: 'java', description: 'Modern Java with records, sealed types, Optional, streams, resources, and tests.' },
  { name: 'javascript', description: 'Modern ECMAScript, ESM, async behavior, equality, and runtime semantics.' },
  { name: 'langchain', description: 'LangChain composition, runnables, chat models, prompts, structured output, and tools.' },
  { name: 'langgraph', description: 'LangGraph state graphs, nodes, conditional edges, checkpointing, and human-in-the-loop.' },
  { name: 'llm-apps', description: 'LLM app patterns for prompts, structured output, tool calling, state, and reliability.' },
  { name: 'llm-evals', description: 'LLM evaluation test sets, metrics, judges, and failure analysis.' },
  { name: 'mcp', description: 'MCP servers and clients, stateless tool contracts, lifecycle, and security.' },
  { name: 'nextjs', description: 'Next.js App Router, server/client components, data fetching, caching, and routing.' },
  { name: 'node', description: 'Node.js modules, filesystems, streams, processes, runtime behavior, and tests.' },
  { name: 'postgres', description: 'PostgreSQL schemas and migrations, snake_case, idempotent DDL, and query safety.' },
  { name: 'python', description: 'Python scripts, CLIs, libraries, domain logic, typing, packaging, and tests.' },
  { name: 'rag', description: 'Retrieval-augmented generation: ingestion, chunking, embeddings, hybrid retrieval, and grounding.' },
  { name: 'react', description: 'React hooks, derived state, component boundaries, stable identity, and tests.' },
  { name: 'typescript', description: 'Strict TypeScript, inference, generics, discriminated unions, and safe APIs.' },
]);
