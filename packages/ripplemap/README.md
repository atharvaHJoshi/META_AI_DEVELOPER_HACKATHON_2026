# RippleMap

The deterministic change-impact engine inside MIRAIWERK AI.

RippleMap answers: **if this ticket or decision moves, what else moves with it?**

Given a project dependency graph and a proposed change, it:

- validates the graph (unknown references, cycles, missing milestones);
- schedules tasks on working days from the project start date;
- computes before/after milestone dates, critical path, effort, and plan diff;
- hashes the exact input so an approval can prove the scenario it used is current.

RippleMap is pure TypeScript with no I/O. It never calls a model, never reads the clock as a scheduling input, and never invents capacity.

```bash
npm run build    -w @miraiwerk/ripplemap
npm test         -w @miraiwerk/ripplemap
npm run typecheck -w @miraiwerk/ripplemap
```
