import type { ApprovalDecision, ApprovalGate, ResolvedUnit } from './types.ts';

export type RequestStatus =
  | 'pending_approval'
  | 'ready'
  | 'running'
  | 'failed'
  | 'completed'
  | 'retained'
  | 'rejected';

export type UnitStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface StoredUnit extends ResolvedUnit {
  status: UnitStatus;
  attempt: number;
  leaseOwner?: string;
  runUrl?: string;
}

export interface StoredRequest {
  id: string;
  digest: string;
  status: RequestStatus;
  requester: string;
  tier: string;
  action: 'apply' | 'destroy' | 'retain';
  source: { owner: string; repo: string; commit: string };
  gates: readonly ApprovalGate[];
  approvals: readonly ApprovalDecision[];
  units: readonly StoredUnit[];
  createdAt: string;
  updatedAt: string;
  reason?: string;
  retentionExpiresAt?: string;
}

export interface OrchestrationStore {
  insert(request: StoredRequest): Promise<void>;
  get(id: string): Promise<StoredRequest | undefined>;
  list(): Promise<StoredRequest[]>;
  update(
    id: string,
    updater: (request: StoredRequest) => StoredRequest,
  ): Promise<StoredRequest>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryOrchestrationStore implements OrchestrationStore {
  readonly #requests = new Map<string, StoredRequest>();

  async insert(request: StoredRequest): Promise<void> {
    if (this.#requests.has(request.id)) throw new Error(`request already exists: ${request.id}`);
    this.#requests.set(request.id, clone(request));
  }

  async get(id: string): Promise<StoredRequest | undefined> {
    const request = this.#requests.get(id);
    return request ? clone(request) : undefined;
  }

  async list(): Promise<StoredRequest[]> {
    return [...this.#requests.values()].map(clone);
  }

  async update(
    id: string,
    updater: (request: StoredRequest) => StoredRequest,
  ): Promise<StoredRequest> {
    const current = this.#requests.get(id);
    if (!current) throw new Error(`request not found: ${id}`);
    const updated = updater(clone(current));
    this.#requests.set(id, clone(updated));
    return clone(updated);
  }
}

interface TableBuilder {
  string(name: string, length?: number): TableBuilder;
  text(name: string): TableBuilder;
  integer(name: string): TableBuilder;
  primary(): TableBuilder;
  notNullable(): TableBuilder;
}

interface QueryBuilder {
  where(criteria: Record<string, unknown>): QueryBuilder;
  first(): Promise<Record<string, unknown> | undefined>;
  select(...columns: string[]): Promise<Record<string, unknown>[]>;
  insert(row: Record<string, unknown>): Promise<unknown>;
  update(row: Record<string, unknown>): Promise<number>;
  forUpdate(): QueryBuilder;
}

export interface MinimalKnex {
  (table: string): QueryBuilder;
  schema: {
    hasTable(table: string): Promise<boolean>;
    createTable(table: string, callback: (builder: TableBuilder) => void): Promise<void>;
  };
  transaction<T>(callback: (transaction: MinimalKnex) => Promise<T>): Promise<T>;
}

export class DatabaseOrchestrationStore implements OrchestrationStore {
  static readonly table = 'phoenix_orchestration_requests';
  readonly #client: MinimalKnex;

  private constructor(client: MinimalKnex) {
    this.#client = client;
  }

  static async create(client: MinimalKnex): Promise<DatabaseOrchestrationStore> {
    if (!await client.schema.hasTable(DatabaseOrchestrationStore.table)) {
      await client.schema.createTable(DatabaseOrchestrationStore.table, table => {
        table.string('id', 64).primary();
        table.text('payload').notNullable();
        table.integer('version').notNullable();
      });
    }
    return new DatabaseOrchestrationStore(client);
  }

  async insert(request: StoredRequest): Promise<void> {
    await this.#client(DatabaseOrchestrationStore.table).insert({
      id: request.id,
      payload: JSON.stringify(request),
      version: 1,
    });
  }

  async get(id: string): Promise<StoredRequest | undefined> {
    const row = await this.#client(DatabaseOrchestrationStore.table).where({ id }).first();
    return row ? JSON.parse(String(row.payload)) as StoredRequest : undefined;
  }

  async list(): Promise<StoredRequest[]> {
    const rows = await this.#client(DatabaseOrchestrationStore.table).select('payload');
    return rows.map(row => JSON.parse(String(row.payload)) as StoredRequest);
  }

  async update(
    id: string,
    updater: (request: StoredRequest) => StoredRequest,
  ): Promise<StoredRequest> {
    return this.#client.transaction(async transaction => {
      const row = await transaction(DatabaseOrchestrationStore.table)
        .where({ id })
        .forUpdate()
        .first();
      if (!row) throw new Error(`request not found: ${id}`);
      const updated = updater(JSON.parse(String(row.payload)) as StoredRequest);
      await transaction(DatabaseOrchestrationStore.table).where({ id }).update({
        payload: JSON.stringify(updated),
        version: Number(row.version) + 1,
      });
      return updated;
    });
  }
}

