# Frontend

The MIRAIWERK AI workspace: React 18, TypeScript, Vite, Tailwind CSS.

```text
src/
├── pages/         Workspace, plan generator, plan, tickets, decision card, history, docs
├── components/    Layout, Gantt, RippleMap impact, shared UI
├── context/       Bootstrap, identity and toast state
├── hooks/         Request lifecycle
├── lib/           Typed API client, formatting, proposal helpers
├── App.tsx        Routes
└── index.css      Design tokens and component classes
```

The browser talks only to the backend through `/api`. It never receives a model key and never decides authorization. `x-user-id` is attached from the selected demo identity; the backend enforces roles.

## Commands

Run from the repository root:

```bash
npm run dev:frontend
npm run build -w @miraiwerk/frontend
npm run typecheck -w @miraiwerk/frontend
```

The dev server runs on <http://localhost:5173> and proxies `/api` to <http://localhost:4000>.
