# Backend

The MIRAIWERK AI HTTP API and persistence layer.

```text
src/
├── routes/        HTTP parsing and Zod validation
├── services/      Plan, ticket, decision, simulation orchestration
├── db/            Pool, row mapping, plan snapshots
├── lib/           IDs, API errors, response helpers
├── auth.ts        Demo identity and project-role checks
├── config.ts      Runtime configuration and AI mode label
├── app.ts         Express application
└── index.ts       Process entry point
db/migrations/     SQL schema
scripts/           migrate, seed, reset
__tests__/         PostgreSQL integration suite
```

The backend is a modular monolith. Routes do not query the database directly. Plan mutations go through transaction-aware services. The deterministic schedule and impact maths live in `packages/ripplemap`; model and rule-based proposals live in `aiml/`.

## Commands

Run from the repository root:

```bash
npm run dev:backend
npm test
npm run db:migrate
npm run db:seed
npm run db:reset
```

The integration suite requires PostgreSQL on port `55434` and applied migrations. It creates and removes its own users and project.

## Configuration

The API reads `backend/.env` and the root `.env`. `MODEL_API_KEY` is server-only. Without it the API reports `deterministic-demo` and never claims a Meta result.
