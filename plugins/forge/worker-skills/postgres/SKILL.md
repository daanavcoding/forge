---
name: postgres
description: PostgreSQL 18 schemas and migrations, including snake_case naming, idempotent DDL,
  acceptable DROP usage, indexed foreign keys, and explicit ON DELETE/ON UPDATE actions. Use when
  creating or modifying PostgreSQL migrations, tables, indexes, constraints, or schemas. Do not
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

Every migration must survive reapplication: `CREATE TABLE IF NOT EXISTS`,
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.

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

## Foreign keys: always indexed, with explicit actions

Every foreign key declares `ON DELETE` and `ON UPDATE` explicitly rather than inheriting an
unexamined implicit `RESTRICT`, and carries an index. Without the index, every `DELETE`/`UPDATE`
on the referenced table scans the whole child table to validate references.

```sql
CREATE TABLE IF NOT EXISTS user_role (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_role_user_id ON user_role (user_id);
```

## Columns

- Every new `NOT NULL` column includes a `DEFAULT`, unless the absence of a value is intentional
  and explicitly required by the task.
- `TIMESTAMPTZ`, never timezone-free `TIMESTAMP`, for `created_at`/`updated_at`, with
  `DEFAULT now()`.
- No hardcoded data in the schema. Catalog values (roles, statuses) go in a separate seed script,
  not beside `CREATE TABLE`.

## Soft delete, when appropriate

`deleted_at TIMESTAMPTZ DEFAULT NULL` with `WHERE deleted_at IS NULL` is the default for historical
business entities such as users and orders. Not for catalog or pure join tables like `user_role`,
where keeping the deleted row has no value.

## Before merging a migration

- Apply it locally against a real test database; visual review is insufficient.
- `\d <table>` to confirm expected columns, types and constraints.
- Every `CREATE`/`ALTER` idempotent with `IF (NOT) EXISTS`.

Translating a foreign-key or unique violation into the service's domain error lives in
`error-contracts`.

## Anti-patterns

- `REL_TB_PascalCase`, or any unquoted identifier whose case supposedly matters.
- `CREATE CONSTRAINT`, which does not exist.
- A `DROP` hidden inside a migration with another stated purpose.
- A foreign key without explicit `ON DELETE`/`ON UPDATE` or without an index.
- Catalog data inserted in the same file as table DDL.
