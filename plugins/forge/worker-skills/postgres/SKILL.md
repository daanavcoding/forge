---
name: postgres
description: PostgreSQL schemas, migrations, query plans, indexes, locking, and row-level access.
  Use when creating or modifying PostgreSQL SQL, migrations, tables, indexes, or constraints. Do not
  use for application-layer persistence logic.
---

# PostgreSQL schemas and migrations

Target **PostgreSQL 18** for new schema work unless the deployment declares another major version.
PostgreSQL 18 provides `uuidv7()` for time-ordered UUIDs; use it when index locality matters, and
keep `gen_random_uuid()` when opaque random IDs are the requirement.

## Naming: `snake_case`, without exception

PostgreSQL folds an unquoted identifier to lowercase, so `REL_TB_UserProfile` is stored and read as
`rel_tb_userprofile` — the PascalCase exists only in the migration file, not in the catalog.
`snake_case` removes that discrepancy.

| Object | Convention | Example |
|---|---|---|
| Table | `snake_case` (singular or plural, matching the repository) | `user_profile` |
| Column | `snake_case` | `created_at` |
| Index | `idx_<table>_<column>` | `idx_user_profile_user_id` |
| Foreign-key constraint | `fk_<table>_<column>` | `fk_user_profile_user_id` |
| Unique constraint | `uq_<table>_<column>` | `uq_user_email` |
| Sequence | `seq_<table>_id` | `seq_user_profile_id` |

## Idempotent DDL

Follow the migration runner's contract: versioned migrations normally execute once; repeatable
setup scripts must be idempotent. `IF NOT EXISTS` does not verify that an existing object has the
expected shape and can conceal schema drift. Never rewrite an already applied migration.

**`CREATE CONSTRAINT` does not exist as SQL syntax.** Constraints are added with `ALTER TABLE`:

```sql
ALTER TABLE user_profile
    ADD CONSTRAINT fk_user_profile_user_id
    FOREIGN KEY (user_id) REFERENCES app_user (id)
    ON DELETE CASCADE
    ON UPDATE CASCADE;
```

## DROP: one rule

`DROP` is not categorically forbidden; a **hidden** drop is. Allowed when the migration explicitly
exists to remove a table or column, always with `IF EXISTS`, never as a side effect of a migration
claiming another purpose.

Never `TRUNCATE` a table with real data outside a test environment. In production
`DELETE FROM ... WHERE ...` is auditable and can be bounded.

## Foreign keys: deliberate actions and supporting indexes

Choose `ON DELETE` and `ON UPDATE` from the data lifecycle; the default is `NO ACTION`, not
`RESTRICT`. Index referencing columns when joins or parent updates/deletes need it, checking
whether an existing composite index already provides the needed leading columns. Do not create
duplicate indexes or choose cascading deletion merely because an example uses it.

```sql
CREATE TABLE IF NOT EXISTS user_role (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_role_user_id ON user_role (user_id);
```

## Columns

- For existing rows, plan a backfill before enforcing `NOT NULL`. Add a default only when it is a
  meaningful domain value; do not manufacture placeholder data to make a migration pass.
- `TIMESTAMPTZ`, never timezone-free `TIMESTAMP`, for `created_at`/`updated_at`, with
  `DEFAULT now()`.
- No hardcoded data in the schema. Catalog values (roles, statuses) go in a separate seed script,
  not beside `CREATE TABLE`.

## Soft delete, when appropriate

Use soft deletion only when the product needs recoverability or retained history. Define how it
affects uniqueness, filters, retention, and actual erasure before adding `deleted_at`.

## Performance and access boundaries

- Inspect query plans on representative data before adding indexes. `EXPLAIN (ANALYZE, BUFFERS)`
  executes the statement: use a safe test database for writes or expensive queries.
- Match composite-index order to predicates and ordering; consider partial indexes for selective
  predicates. Measure write overhead as well as read gains.
- Plan lock duration and backfill size on populated tables. `CREATE INDEX CONCURRENTLY` cannot
  run inside a transaction block; configure the migration runner accordingly when needed.
- Use bounded connection pools and short transactions. Check timeouts and lock contention before
  increasing the pool size.
- For tenant-scoped data, test access as the actual application role. RLS owners and privileged
  roles can bypass policies; a successful superuser test does not prove tenant isolation.

## Before merging a migration

- Apply it locally against a real test database; visual review is insufficient.
- `\d <table>` to confirm expected columns, types and constraints.
- Verify the migration runner's reapply behavior, existing-data upgrade, and recovery plan.

Translating a foreign-key or unique violation into the service's domain error lives in
`error-contracts`.

## Anti-patterns

- `REL_TB_PascalCase`, or any unquoted identifier whose case supposedly matters.
- `CREATE CONSTRAINT`, which does not exist.
- A `DROP` hidden inside a migration with another stated purpose.
- Unexamined cascade behavior or a missing index on an actively joined foreign key.
- Catalog data inserted in the same file as table DDL.
