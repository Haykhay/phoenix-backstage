import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { notificationService } from '@backstage/plugin-notifications-node';
import { Router, json } from 'express';

import { routeOrchestratorRequest } from './router';
import { OrchestrationService } from './service';
import {
  DatabaseOrchestrationStore,
  type MinimalKnex,
} from './store';

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export const orchestratorPlugin = createBackendPlugin({
  pluginId: 'orchestrator',
  register(registration) {
    registration.registerInit({
      deps: {
        auth: coreServices.auth,
        catalog: catalogServiceRef,
        config: coreServices.rootConfig,
        database: coreServices.database,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        notifications: notificationService,
        userInfo: coreServices.userInfo,
      },
      async init({
        auth,
        catalog,
        config,
        database,
        httpAuth,
        httpRouter,
        logger,
        notifications,
        userInfo,
      }) {
        const client = await database.getClient();
        const store = await DatabaseOrchestrationStore.create(
          client as unknown as MinimalKnex,
        );
        const credentials = await auth.getOwnServiceCredentials();
        const entities = await catalog.getEntities(
          { filter: { kind: 'Resource', 'spec.type': 'phoenix-component' } },
          { credentials },
        );
        const componentDependencies = Object.fromEntries(
          entities.items.flatMap(entity => {
            const component = entity.metadata.annotations?.['phoenix/module'];
            if (!component) return [];
            const dependsOn = Array.isArray(entity.spec?.dependsOn)
              ? entity.spec.dependsOn
                  .filter((value): value is string => typeof value === 'string')
                  .map(value => value.split('/').at(-1)?.replace(/^component-/, ''))
                  .filter((value): value is string => Boolean(value))
              : [];
            return [[component, dependsOn] as const];
          }),
        );
        const service = new OrchestrationService({
          store,
          componentDependencies,
          policy: {
            tierApprovalGroups: stringMap(
              config.getOptional('phoenix.orchestrator.approvals.tiers'),
            ),
            retentionApprovalGroup: config.getOptionalString(
              'phoenix.orchestrator.approvals.retentionGroup',
            ),
            componentApprovalGroups: Object.fromEntries(
              entities.items.flatMap(entity => {
                const component = entity.metadata.annotations?.['phoenix/module'];
                const group = entity.metadata.annotations?.[
                  'phoenix/deployment-approval-group'
                ];
                return component && group ? [[component, group]] : [];
              }),
            ),
          },
          async getGroupMembers(group) {
            const entity = await catalog.getEntityByRef(group, { credentials });
            const members = Array.isArray(entity?.spec?.members)
              ? entity.spec.members.filter(
                  (value): value is string => typeof value === 'string',
                )
              : [];
            return new Set(members);
          },
          async notify(notification) {
            await notifications.send({
              recipients: { type: 'entity', entityRef: notification.recipient },
              payload: {
                title: notification.title,
                description: notification.description,
                topic: 'phoenix-orchestrator',
                link: `/orchestrator?request=${notification.requestId}`,
              },
            });
          },
        });

        const router = Router();
        router.use(json({ limit: '256kb' }));
        router.use(async (request, response) => {
          const requestCredentials = await httpAuth.credentials(request, {
            allow: ['user'],
          });
          const identity = await userInfo.getUserInfo(requestCredentials);
          const result = await routeOrchestratorRequest(service, {
            method: request.method,
            path: request.path,
            identity: identity.userEntityRef,
            body: request.body,
          });
          response.status(result.status).json(result.body);
        });
        httpRouter.use(router);
        logger.info('Phoenix orchestrator backend initialized');
      },
    });
  },
});

export default orchestratorPlugin;
