---
name: changing-database-schema
description: Changing a database schema safely - expand then contract, never editing an applied migration, backfills apart from schema changes, avoiding long locks, testing what a migration promises against a real database, and rollback. Use when writing or reviewing a migration, a Prisma, TypeORM, Drizzle, Alembic, golang-migrate or sqlx schema change, an index, a constraint, or a data backfill.
---

# Changing a database schema

A migration runs once, against data you cannot see, while the previous release may still be serving traffic. Every rule below follows from that.

## Rules

- **Expand, then contract.** Add the new column, table or index in one release; switch reads and writes; remove the old one in a later release. A rename is an add, a copy and a later drop. Never a change that breaks the release still running.
- **Never edit an applied migration.** Once it ran anywhere shared (CI, staging, production, a teammate's database), fix forward with a new migration. Ask when unsure whether it ran.
- **Never hand-edit generated migration files or lockfiles of the tool.** Change the schema source and regenerate.
- **Backfill apart from the schema change.** The schema migration stays fast; the backfill runs in batches, can resume, and can run while traffic flows.
- **Avoid long locks on large tables:**
  - create indexes concurrently (`CREATE INDEX CONCURRENTLY` in PostgreSQL, outside a transaction);
  - add a column nullable first, backfill, then add the constraint (`NOT VALID` then `VALIDATE CONSTRAINT` in PostgreSQL);
  - add defaults that do not rewrite the table;
  - set a `lock_timeout` so a migration waiting on a lock fails instead of queueing all traffic behind it.
- **A rollback plan for every migration:** the down migration, or the forward fix if a down would lose data. Say which in your report.
- **Destructive steps get the user's explicit go:** a dropped column or table, a type change that truncates, a delete in a backfill.

## Tests

The migration is the contract step of the test-first loop (`writing-tests-first`). Its test runs against a real database (a container), never a mocked client, and asserts what the migration promises: the constraint refuses the bad row, the cascade removes the children, the policy hides another user's row, the role has no write grant. A migration that adds a table adds the access rules for it in the same change, with their test.

## Know the tool's two commands

Each tool has a development command that may reset or generate, and a deploy command that only applies. Use the deploy one against anything shared, and never run a reset outside a local database.

| Tool | Development | Deploy |
| --- | --- | --- |
| Prisma | `prisma migrate dev` (may reset) | `prisma migrate deploy` |
| TypeORM | `migration:generate`, `migration:run` | `migration:run` |
| Drizzle | `drizzle-kit generate` | `drizzle-kit migrate` |
| Alembic | `alembic revision --autogenerate` (read the output: it misses things) | `alembic upgrade head` |
| golang-migrate | `migrate create` | `migrate up` |
| sqlx | `sqlx migrate add` | `sqlx migrate run` |

Check the installed version in the lockfile before using a flag: these tools change between majors.

Running a migration against a non-local database is shared state: ask first (CLAUDE.md, Safety).
