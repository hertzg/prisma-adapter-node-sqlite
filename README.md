# `prisma-adapter-node-sqlite`

This is a Prisma adapter for the native `node:sqlite` database. It is heavily inspired by the [@prisma/adapter-better-sqlite3](https://github.com/prisma/prisma/blob/2bd7a436ef21681499b12164fce41a038d0959d8/packages/adapter-better-sqlite3/src/better-sqlite3.ts) adapter.

# Installation

```sh
$ npm i prisma-adapter-node-sqlite
```

# Connection details

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
```

# Instantiation

```ts
import { PrismaNodeSQLite } from 'prisma-adapter-node-sqlite';

const adapter = new PrismaNodeSQLite({
  url: 'file:./prisma/dev.db',
});
const prisma = new PrismaClient({ adapter });
```

# Configure timestamp format for backward compatibility

```ts
import { PrismaNodeSQLite } from 'prisma-adapter-node-sqlite';

const adapter = new PrismaNodeSQLite(
  {
    url: 'file:./prisma/dev.db',
  },
  { timestampFormat: 'unixepoch-ms' }
);
const prisma = new PrismaClient({ adapter });
```

**When to use each format:**

- `ISO 8601 (default)`: Best for new projects and integrates well with SQLite's built-in date/time functions.
- `unixepoch-ms`: Required when migrating from Prisma ORM's native SQLite driver to maintain compatibility with existing timestamp data.

# Native type mapping from Prisma ORM to `node:sqlite`

| Prisma ORM | `node:sqlite` |
| ---------- | ------------- |
| `String`   | `TEXT`        |
| `Boolean`  | `BOOLEAN`     |
| `Int`      | `INTEGER`     |
| `BigInt`   | `INTEGER`     |
| `Float`    | `REAL`        |
| `Decimal`  | `DECIMAL`     |
| `DateTime` | `NUMERIC`     |
| `Json`     | `JSONB`       |
| `Bytes`    | `BLOB`        |
| `Enum`     | `TEXT`        |
