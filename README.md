# Velantis Legal Explorer

Minimal foundation for a single Next.js application that will evolve into semantic search and AI-assisted explanations of Polish and EU law.

## Local Requirements

- Node.js 22+
- pnpm 11+
- Docker

## Startup

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

Application: http://localhost:3000

Health endpoint: http://localhost:3000/api/health

## Common Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Database Commands

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```
