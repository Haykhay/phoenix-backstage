import type {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import type {
  LoggerService,
  SchedulerServiceTaskRunner,
} from '@backstage/backend-plugin-api';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { projectItem, type RegistryItem } from './projectItem';

export interface AwsAccountEntityProviderOptions {
  tableName: string;
  region: string;
  /** Set to a Floci endpoint (http://localhost:4566) for local runs. */
  endpoint?: string;
  logger: LoggerService;
  taskRunner: SchedulerServiceTaskRunner;
  /** Injected for tests; defaults to a real DynamoDB client. */
  client?: DynamoDBClient;
}

/**
 * Reads the DynamoDB account registry and projects each item into an
 * `aws-account` Resource entity. DynamoDB is the durable source of truth, so a
 * Backstage rebuild re-syncs from here.
 */
export class AwsAccountEntityProvider implements EntityProvider {
  private readonly client: DynamoDBClient;
  private connection?: EntityProviderConnection;

  constructor(private readonly options: AwsAccountEntityProviderOptions) {
    this.client =
      options.client ??
      new DynamoDBClient({ region: options.region, endpoint: options.endpoint });
  }

  getProviderName(): string {
    return 'aws-account-registry';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    await this.options.taskRunner.run({
      id: this.getProviderName(),
      fn: async () => {
        await this.refresh();
      },
    });
  }

  async refresh(): Promise<void> {
    if (!this.connection) {
      throw new Error('AwsAccountEntityProvider is not connected');
    }

    const items: RegistryItem[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const out = await this.client.send(
        new ScanCommand({ TableName: this.options.tableName, ExclusiveStartKey: startKey as never }),
      );
      for (const raw of out.Items ?? []) {
        items.push(unmarshall(raw) as RegistryItem);
      }
      startKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    await this.connection.applyMutation({
      type: 'full',
      entities: items.map(item => ({
        entity: projectItem(item),
        locationKey: `aws-account-registry:${this.options.tableName}`,
      })),
    });

    this.options.logger.info(
      `aws-account-registry: projected ${items.length} account(s) from ${this.options.tableName}`,
    );
  }
}
