import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FlociDispatcher, GitHubWorkflowDispatcher } from './dispatch.ts';

describe('GitHubWorkflowDispatcher', () => {
  it('correlates and returns the exact completed workflow run', async () => {
    const calls = [];
    const client = {
      async dispatch(input) { calls.push(input); },
      async findRunByOrchestrationId(id) {
        assert.equal(id, 'request-1:unit-0:attempt-1');
        return { id: 42, status: 'queued', url: 'https://github.test/runs/42' };
      },
      async getRun() { return { id: 42, status: 'completed', conclusion: 'success', url: 'https://github.test/runs/42' }; },
    };
    const dispatcher = new GitHubWorkflowDispatcher({ client, sleep: async () => {} });
    const result = await dispatcher.dispatch({
      orchestrationId: 'request-1:unit-0:attempt-1',
      configFile: 'infrastructure/environments/sandbox/a/eu-west-1/core-platform.yaml',
      action: 'apply',
    });
    assert.deepEqual(calls[0].inputs, {
      orchestration_id: 'request-1:unit-0:attempt-1',
      config_file: 'infrastructure/environments/sandbox/a/eu-west-1/core-platform.yaml',
      action: 'apply',
    });
    assert.deepEqual(result, { status: 'succeeded', runUrl: 'https://github.test/runs/42' });
  });

  it('reports a failed run without dispatching another unit', async () => {
    const client = {
      async dispatch() {},
      async findRunByOrchestrationId() { return { id: 7, status: 'completed', conclusion: 'failure', url: 'run-7' }; },
      async getRun() { throw new Error('must not poll completed run'); },
    };
    const dispatcher = new GitHubWorkflowDispatcher({ client, sleep: async () => {} });
    assert.deepEqual(await dispatcher.dispatch({ orchestrationId: 'x', configFile: 'x.yaml', action: 'apply' }), {
      status: 'failed', runUrl: 'run-7',
    });
  });
});

describe('FlociDispatcher', () => {
  it('sets local endpoints and floci mode for sandbox units', async () => {
    const calls = [];
    const dispatcher = new FlociDispatcher({
      endpoint: 'http://localhost:4566',
      run: async input => { calls.push(input); return { exitCode: 0, runUrl: 'local://request-1' }; },
    });
    assert.deepEqual(await dispatcher.dispatch({
      orchestrationId: 'request-1', configFile: 'infrastructure/environments/sandbox/a/eu-west-1/core-platform.yaml', action: 'apply', tier: 'sandbox',
    }), { status: 'succeeded', runUrl: 'local://request-1' });
    assert.equal(calls[0].env.TF_VAR_floci, '1');
    assert.equal(calls[0].env.AWS_ENDPOINT_URL, 'http://localhost:4566');
    assert.deepEqual(calls[0].yamlOverlay, {
      floci: true,
      aws_endpoint_url: 'http://localhost:4566',
    });
  });

  it('refuses stage and production without invoking a command', async () => {
    let invoked = false;
    const dispatcher = new FlociDispatcher({ endpoint: 'http://localhost:4566', run: async () => { invoked = true; return { exitCode: 0 }; } });
    await assert.rejects(dispatcher.dispatch({ orchestrationId: 'x', configFile: 'x', action: 'apply', tier: 'prod' }), /sandbox only/);
    assert.equal(invoked, false);
  });
});
