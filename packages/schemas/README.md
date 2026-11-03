# Schemas

Shared Zod contracts and inferred TypeScript types for MIRAIWERK AI.

The browser and backend import the same package, so an API shape change fails typecheck before it becomes a runtime surprise. The package also owns product constants such as the MIRAIWERK AI tagline.

```bash
npm run build     -w @miraiwerk/schemas
npm run typecheck -w @miraiwerk/schemas
```
