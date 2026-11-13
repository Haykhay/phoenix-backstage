import type { Entity } from '@backstage/catalog-model';

/** One row of the DynamoDB account registry (see registry/upsert.py build_item). */
export interface RegistryItem {
  group: string;
  account_id: string;
  organisation: string;
  state_bucket: string;
  state_region: string;
  management_account_id: string;
  base_domain: string;
  apps_repo: string;
  ou: string;
  status: string;
}

/**
 * Project a registry item into the `aws-account` catalog Resource entity —
 * the same shape phoenix/accounts.yaml carried as a hand-written stand-in, now
 * produced from the live registry.
 */
export function projectItem(item: RegistryItem): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: {
      name: `${item.group}-aws-account`,
      description: `AWS account of the ${item.group} group`,
      annotations: {
        'phoenix/organisation': item.organisation,
        'phoenix/account-id': item.account_id,
        'phoenix/state-bucket': item.state_bucket,
        'phoenix/state-region': item.state_region,
        'phoenix/management-account-id': item.management_account_id,
        'phoenix/base-domain': item.base_domain,
        'phoenix/apps-repo': item.apps_repo,
      },
    },
    spec: {
      type: 'aws-account',
      owner: `group:default/${item.group}`,
    },
  };
}
