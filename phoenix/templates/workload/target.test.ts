import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// k8s units are phoenix-k8s paths (environments/...); the model's
// infrastructure units stay phoenix-aws paths (infrastructure/environments/...).
// The orchestrator picks the repo from that prefix.
const tpl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'template.yaml'), 'utf8');
const targets = [...tpl.matchAll(/targetPath: >-\n\s+(\S+?)\$/g)].map(m => m[1]);

test('k8s units are written at phoenix-k8s paths', () => {
  assert.deepEqual(targets.filter(t => !t.startsWith('infrastructure/')), ['environments/']);
  assert.doesNotMatch(tpl, /k8s-installs/);
});

test('model infrastructure units stay at phoenix-aws paths', () => {
  assert.deepEqual(targets.filter(t => t.startsWith('infrastructure/')), ['infrastructure/environments/', 'infrastructure/environments/']);
});
