import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node/alpha';
import { AwsAccountEntityProvider } from './AwsAccountEntityProvider';

/**
 * Registers the AWS account registry entity provider with the catalog.
 *
 * Config (app-config.yaml):
 *   phoenix:
 *     registry:
 *       tableName: phoenix-account-registry
 *       region: eu-west-1
 *       endpoint: http://localhost:4566   # optional, for local Floci
 */
export const catalogModuleAwsAccounts = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'aws-accounts',
  register(reg) {
    reg.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        scheduler: coreServices.scheduler,
      },
      async init({ catalog, logger, config, scheduler }) {
        const tableName = config.getString('phoenix.registry.tableName');
        const region = config.getString('phoenix.registry.region');
        const endpoint = config.getOptionalString('phoenix.registry.endpoint');

        const taskRunner = scheduler.createScheduledTaskRunner({
          frequency: { minutes: 10 },
          timeout: { minutes: 5 },
        });

        catalog.addEntityProvider(
          new AwsAccountEntityProvider({
            tableName,
            region,
            endpoint,
            logger,
            taskRunner,
          }),
        );
      },
    });
  },
});
