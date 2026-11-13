import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const skeletonDir = join(here, 'skeleton');

// Minimal stand-in for the scaffolder's ${{ values.X }} substitution, enough to
// assert the skeleton's output shape without the full Backstage build.
function render(tpl: string, values: Record<string, string>): string {
  return tpl.replace(/\$\{\{\s*values\.(\w+)\s*\}\}/g, (_m, k: string) => {
    if (!(k in values)) throw new Error(`missing value: ${k}`);
    return values[k];
  });
}

const values: Record<string, string> = {
  group: 'research',
  email: 'aws+research@example.com',
  ou: 'sandbox',
  organisation: 'acme',
  base_domain: 'example.com',
  apps_repo: 'git@github.com:acme/phoenix-apps.git',
};

test('skeleton renders research.tf with the request module and no account_id', () => {
  const nameTpl = readdirSync(skeletonDir)[0]; // "${{ values.group }}.tf"
  assert.equal(render(nameTpl, values), 'research.tf');

  const out = render(readFileSync(join(skeletonDir, nameTpl), 'utf8'), values);
  assert.match(out, /module "research"/);
  assert.match(out, /source = "\.\/modules\/account-request"/);
  assert.match(out, /ou\s+=\s+"sandbox"/);
  assert.match(out, /apps_repo\s+=\s+"git@github\.com:acme\/phoenix-apps\.git"/);
  assert.doesNotMatch(out, /account_id\s*=/); // no account id — Control Tower assigns it
});
