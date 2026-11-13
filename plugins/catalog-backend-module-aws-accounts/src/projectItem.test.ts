import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectItem, type RegistryItem } from './projectItem.ts';

const item: RegistryItem = {
  group: 'research',
  account_id: '111111111111',
  organisation: 'acme',
  state_bucket: 'acme-tfstate-111111111111',
  state_region: 'eu-west-1',
  management_account_id: '444444444444',
  base_domain: 'example.com',
  apps_repo: 'git@github.com:acme/phoenix-apps.git',
  ou: 'sandbox',
  status: 'ACTIVE',
};

// The golden is the entity phoenix/accounts.yaml carried by hand.
const golden = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Resource',
  metadata: {
    name: 'research-aws-account',
    description: 'AWS account of the research group',
    annotations: {
      'phoenix/organisation': 'acme',
      'phoenix/account-id': '111111111111',
      'phoenix/state-bucket': 'acme-tfstate-111111111111',
      'phoenix/state-region': 'eu-west-1',
      'phoenix/management-account-id': '444444444444',
      'phoenix/base-domain': 'example.com',
      'phoenix/apps-repo': 'git@github.com:acme/phoenix-apps.git',
    },
  },
  spec: { type: 'aws-account', owner: 'group:default/research' },
};

test('projectItem matches the accounts.yaml golden shape', () => {
  assert.deepEqual(projectItem(item), golden);
});

test('projectItem is keyed and named by group', () => {
  const out = projectItem({ ...item, group: 'payments', account_id: '222222222222' });
  assert.equal(out.metadata.name, 'payments-aws-account');
  assert.equal((out.spec as { owner: string }).owner, 'group:default/payments');
  assert.equal(out.metadata.annotations?.['phoenix/account-id'], '222222222222');
});
