# Velantis Legal Explorer Architecture Principles

- This is a low-cost side project maintained primarily by one developer.
- Prefer the simplest working solution.
- Production quality does not mean enterprise complexity.
- Never introduce microservices, queues, Redis, Kubernetes, Azure AI Search, separate backend applications, or additional infrastructure unless explicitly requested.
- Do not introduce dependencies for problems already reasonably solved by the existing stack.
- Avoid abstractions for hypothetical future requirements.
- Prefer explicit, readable TypeScript.
- Prefer small cohesive modules.
- Validate external/untrusted input.
- Never expose secrets to the browser.
- Never expose database error details to users.
- PostgreSQL is the primary datastore and pgvector will provide vector search.
- Legal correctness and source traceability will be first-class requirements later.
- Any proposed infrastructure addition must first explain why the existing architecture cannot solve the problem.
- Cost and operational simplicity are first-class architectural requirements.
