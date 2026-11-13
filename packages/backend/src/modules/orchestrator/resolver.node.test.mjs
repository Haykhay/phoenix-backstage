import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveInstallOrder } from './resolver.ts';

const unit = path => ({ path });

describe('resolveInstallOrder', () => {
  it('orders fixed layers before stable layer-three dependencies', () => {
    const units = [
      unit('k8s-installs/environments/sandbox/team-sandbox-jdoe/eu-west-1/1/vllm.model.yaml'),
      unit('infrastructure/environments/sandbox/team-sandbox-jdoe/eu-west-1/core-platform.yaml'),
      unit('networking/environments/eu-west-1/region.yaml'),
      unit('accounts/team-sandbox-jdoe.yaml'),
      unit('k8s-installs/environments/sandbox/team-sandbox-jdoe/eu-west-1/1/model-weights.model.yaml'),
      unit('k8s-installs/environments/sandbox/team-sandbox-jdoe/eu-west-1/1/opencost.yaml'),
    ];

    const result = resolveInstallOrder(units, {
      vllm: ['model-weights'],
      'model-weights': [],
      opencost: [],
    });

    assert.deepEqual(result.map(item => item.path), [
      'accounts/team-sandbox-jdoe.yaml',
      'networking/environments/eu-west-1/region.yaml',
      'infrastructure/environments/sandbox/team-sandbox-jdoe/eu-west-1/core-platform.yaml',
      'k8s-installs/environments/sandbox/team-sandbox-jdoe/eu-west-1/1/model-weights.model.yaml',
      'k8s-installs/environments/sandbox/team-sandbox-jdoe/eu-west-1/1/vllm.model.yaml',
      'k8s-installs/environments/sandbox/team-sandbox-jdoe/eu-west-1/1/opencost.yaml',
    ]);
  });

  it('rejects a dependency absent from the requested unit set', () => {
    assert.throws(
      () => resolveInstallOrder([
        unit('k8s-installs/environments/sandbox/a/eu-west-1/1/vllm.model.yaml'),
      ], { vllm: ['model-weights'] }),
      /missing dependency model-weights/,
    );
  });

  it('rejects duplicate unit paths', () => {
    const path = 'infrastructure/environments/sandbox/a/eu-west-1/core-platform.yaml';
    assert.throws(() => resolveInstallOrder([unit(path), unit(path)], {}), /duplicate unit/);
  });

  it('reports a component dependency cycle', () => {
    assert.throws(
      () => resolveInstallOrder([
        unit('k8s-installs/environments/sandbox/a/eu-west-1/1/istio.yaml'),
        unit('k8s-installs/environments/sandbox/a/eu-west-1/1/cert-manager.yaml'),
      ], { istio: ['cert-manager'], 'cert-manager': ['istio'] }),
      /dependency cycle.*cert-manager.*istio|dependency cycle.*istio.*cert-manager/,
    );
  });
});
