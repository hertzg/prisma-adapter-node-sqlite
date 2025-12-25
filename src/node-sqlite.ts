import type {
  IsolationLevel,
  SqlDriverAdapter,
  SqlMigrationAwareDriverAdapterFactory,
  SqlQuery,
  SqlQueryable,
  SqlResultSet,
  Transaction,
  TransactionOptions,
} from '@prisma/driver-adapter-utils';
import { Debug, DriverAdapterError } from '@prisma/driver-adapter-utils';
import { Mutex } from 'async-mutex';
import type {
  DatabaseSync as NodeSQLite,
  DatabaseSyncOptions as NodeSQLiteOptions,
  SQLInputValue,
} from 'node:sqlite';
import { DatabaseSync } from 'node:sqlite';
import { getColumnTypes, mapArg, mapRow, type Row } from './conversion.js';
import { convertDriverError } from './errors.js';
import { PACKAGE_NAME } from './constants.js';

const debug = Debug('prisma:driver-adapter:node-sqlite');

type StdClient = NodeSQLite;

type NodeSQLiteResultSet = {
  declaredTypes: Array<string | null>;
  columnNames: string[];
  values: unknown[][];
};

type NodeSQLiteMeta = {
  /**
   * the total number of rows that were inserted, updated, or deleted by an operation.
   */
  changes: number;

  /**
   * The rowid of the last row inserted into the database.
   */
  lastInsertRowid: number | bigint;
};

class NodeSQLiteQueryable<ClientT extends StdClient> implements SqlQueryable {
  readonly provider = 'sqlite';
  readonly adapterName = PACKAGE_NAME;

  constructor(
    protected readonly client: ClientT,
    protected readonly adapterOptions?: PrismaNodeSQLiteOptions
  ) {}

  /**
   * Execute a query given as SQL, interpolating the given parameters.
   */
  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const tag = '[js::queryRaw]';
    debug(`${tag} %O`, query);

    const { columnNames, declaredTypes, values } = await this.performIO(query);
    const rows = values as Array<Row>;

    const columnTypes = getColumnTypes(declaredTypes, rows);

    return {
      columnNames,
      columnTypes,
      rows: rows.map((row) => mapRow(row, columnTypes)),
    };
  }

  /**
   * Execute a query given as SQL, interpolating the given parameters and
   * returning the number of affected rows.
   * Note: Queryable expects a u64, but napi.rs only supports u32.
   */
  async executeRaw(query: SqlQuery): Promise<number> {
    const tag = '[js::executeRaw]';
    debug(`${tag} %O`, query);

    return (await this.executeIO(query)).changes;
  }

  /**
   * Run a query against the database, returning the result set.
   * Should the query fail due to a connection error, the connection is
   * marked as unhealthy.
   */
  private executeIO(query: SqlQuery): Promise<NodeSQLiteMeta> {
    try {
      const args = query.args.map((arg, i) =>
        mapArg(arg, query.argTypes[i], this.adapterOptions)
      );

      const stmt = this.client.prepare(query.sql);
      const result = stmt.run(...(args as SQLInputValue[]));

      return Promise.resolve({
        changes: Number(result.changes),
        lastInsertRowid: result.lastInsertRowid,
      });
    } catch (e) {
      this.onError(e);
    }
  }

  /**
   * Run a query against the database, returning the result set.
   * Should the query fail due to a connection error, the connection is
   * marked as unhealthy.
   */
  private performIO(query: SqlQuery): Promise<NodeSQLiteResultSet> {
    try {
      const args = query.args.map((arg, i) =>
        mapArg(arg, query.argTypes[i], this.adapterOptions)
      );
      const stmt = this.client.prepare(query.sql);

      if('setReturnArrays' in stmt) {
        stmt.setReturnArrays(true);
      }
      
      stmt.setReadBigInts(true);
      const columns = stmt.columns();

      if (columns.length === 0) {
        stmt.run(...(args as SQLInputValue[]));
        return Promise.resolve({
          columnNames: [],
          declaredTypes: [],
          values: [],
        });
      }

      const values = stmt.all(
        ...(args as SQLInputValue[])
      ) as unknown as unknown[][];

      const resultSet = {
        declaredTypes: columns.map((column) => column.type),
        columnNames: columns.map((column) => column.name),
        values,
      };

      return Promise.resolve(resultSet);
    } catch (e) {
      this.onError(e);
    }
  }

  protected onError(error: any): never {
    debug('Error in performIO: %O', error);
    throw new DriverAdapterError(convertDriverError(error));
  }
}

class NodeSQLiteTransaction
  extends NodeSQLiteQueryable<StdClient>
  implements Transaction
{
  readonly #unlockParent: () => void;

  constructor(
    client: StdClient,
    readonly options: TransactionOptions,
    adapterOptions: PrismaNodeSQLiteOptions | undefined,
    unlockParent: () => void
  ) {
    super(client, adapterOptions);
    this.#unlockParent = unlockParent;
  }

  commit(): Promise<void> {
    debug(`[js::commit]`);
    this.#unlockParent();
    return Promise.resolve();
  }

  rollback(): Promise<void> {
    debug(`[js::rollback]`);
    this.#unlockParent();
    return Promise.resolve();
  }
}

export class PrismaNodeSQLiteAdapter
  extends NodeSQLiteQueryable<StdClient>
  implements SqlDriverAdapter
{
  #mutex = new Mutex();

  constructor(client: StdClient, adapterOptions?: PrismaNodeSQLiteOptions) {
    super(client, adapterOptions);
  }

  executeScript(script: string): Promise<void> {
    try {
      this.client.exec(script);
    } catch (e) {
      this.onError(e);
    }
    return Promise.resolve();
  }

  async startTransaction(
    isolationLevel?: IsolationLevel
  ): Promise<Transaction> {
    if (isolationLevel && isolationLevel !== 'SERIALIZABLE') {
      throw new DriverAdapterError({
        kind: 'InvalidIsolationLevel',
        level: isolationLevel,
      });
    }

    const options: TransactionOptions = {
      usePhantomQuery: false,
    };

    const tag = '[js::startTransaction]';
    debug('%s options: %O', tag, options);

    try {
      const release = await this.#mutex.acquire();

      this.client.prepare('BEGIN').run();

      return new NodeSQLiteTransaction(
        this.client,
        options,
        this.adapterOptions,
        release
      );
    } catch (e) {
      this.onError(e);
    }
  }

  dispose(): Promise<void> {
    this.client.close();
    return Promise.resolve();
  }
}

type NodeSQLiteInputParams = NodeSQLiteOptions & {
  url: ':memory:' | (string & {});
};

export type PrismaNodeSQLiteOptions = {
  shadowDatabaseUrl?: string;
  timestampFormat?: 'iso8601' | 'unixepoch-ms';
};

export class PrismaNodeSQLiteAdapterFactory
  implements SqlMigrationAwareDriverAdapterFactory
{
  readonly provider = 'sqlite';
  readonly adapterName = PACKAGE_NAME;

  readonly #config: NodeSQLiteInputParams;
  readonly #options?: PrismaNodeSQLiteOptions;

  constructor(
    config: NodeSQLiteInputParams,
    options?: PrismaNodeSQLiteOptions
  ) {
    this.#config = config;
    this.#options = options;
  }

  connect(): Promise<SqlDriverAdapter> {
    return Promise.resolve(
      new PrismaNodeSQLiteAdapter(
        createNodeSQLiteClient(this.#config),
        this.#options
      )
    );
  }

  connectToShadowDb(): Promise<SqlDriverAdapter> {
    const url = this.#options?.shadowDatabaseUrl ?? ':memory:';
    return Promise.resolve(
      new PrismaNodeSQLiteAdapter(
        createNodeSQLiteClient({ ...this.#config, url }),
        this.#options
      )
    );
  }
}

function createNodeSQLiteClient(input: NodeSQLiteInputParams): StdClient {
  const { url, ...config } = input;
  const dbPath = url.replace(/^file:/, '');
  const db = new DatabaseSync(dbPath, config);
  return db;
}
