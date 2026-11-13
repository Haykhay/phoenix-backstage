import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The pipeline signs in to the unit's own account as the account baseline's
// Terraform-Role / Terraform-Plan-Role (phoenix-aws ADR-0013): a unit names no
// role, and never another account to write into.
const here = dirname(fileURLToPath(import.meta.url));
const unitDirs = ['environment/skeleton', 'workload/infra', 'workload/skeleton'];

for (const dir of unitDirs) {
  for (const file of readdirSync(join(here, dir))) {
    test(`${dir}/${file} names no role and no other account`, () => {
      const tpl = readFileSync(join(here, dir, file), 'utf8');
      assert.doesNotMatch(tpl, /oidc_role_arn|deploy_role_name/);
      assert.doesNotMatch(tpl, /management-account-id/);
    });
  }
}
