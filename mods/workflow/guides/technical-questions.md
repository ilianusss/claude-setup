# Technical questions

A bank to draw from in the design phase. Ask only what the spec, the codebase and the project CLAUDE.md leave open, in batches of at most four.

## Load and scale

- How many users, requests or items now, and in a year? Peak versus average?
- What latency is acceptable for the main path?
- Batch or real time? Does anything need to push updates to clients?

## Data

- Which consistency does each operation need: strict, or eventual within seconds?
- Retention, archiving, deletion on request?
- Migration of existing data, and can it run while the old version serves traffic?

## Integration

- Which external systems, owned by whom, with which limits and failure modes?
- Synchronous calls, webhooks, queues?
- Who else consumes what we build: an API contract to keep stable?

## Security

- How do users authenticate today, and how are permissions decided?
- Several tenants or organisations? Where is isolation enforced?
- Which secrets are needed, and where do they live?

## Operations

- Where does it run: which cloud, cluster, region? Who is on call?
- Rollout: feature flag, gradual, all at once? How is it rolled back?
- What must be observable: logs, metrics, traces, alerts?

## Constraints

- Languages, frameworks and services the team already runs and knows?
- Anything forbidden: a vendor, a licence, a data location?
- Deadlines that make one option impossible?
