import { assertLocalDispatchAllowed } from './policy.ts';

export interface DispatchInput {
  orchestrationId: string;
  configFile: string;
  action: 'apply' | 'destroy';
  tier?: string;
}

export interface DispatchResult {
  status: 'succeeded' | 'failed';
  runUrl?: string;
}

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion?: string;
  url: string;
}

export interface GitHubWorkflowClient {
  dispatch(input: {
    workflow: string;
    ref: string;
    inputs: Record<string, string>;
  }): Promise<void>;
  findRunByOrchestrationId(id: string): Promise<WorkflowRun | undefined>;
  getRun(id: number): Promise<WorkflowRun>;
}

// client: phoenix-aws (networking/, infrastructure/); k8sClient: phoenix-k8s
// (environments/, Layer 3). Each runs its own terraform.yml.
export class GitHubWorkflowDispatcher {
  readonly #client: GitHubWorkflowClient;
  readonly #k8sClient?: GitHubWorkflowClient;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: {
    client: GitHubWorkflowClient;
    k8sClient?: GitHubWorkflowClient;
    sleep?: (milliseconds: number) => Promise<void>;
  }) {
    this.#client = options.client;
    this.#k8sClient = options.k8sClient;
    this.#sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    let client = this.#client;
    if (input.configFile.startsWith('environments/')) {
      if (!this.#k8sClient) throw new Error(`no phoenix-k8s client configured for ${input.configFile}`);
      client = this.#k8sClient;
    }
    await client.dispatch({
      workflow: 'terraform.yml',
      ref: 'main',
      inputs: {
        orchestration_id: input.orchestrationId,
        config_file: input.configFile,
        action: input.action,
      },
    });
    let run: WorkflowRun | undefined;
    for (let attempt = 0; attempt < 30 && !run; attempt += 1) {
      run = await client.findRunByOrchestrationId(input.orchestrationId);
      if (!run) await this.#sleep(2_000);
    }
    if (!run) throw new Error(`workflow run not found for ${input.orchestrationId}`);
    while (run.status !== 'completed') {
      await this.#sleep(5_000);
      run = await client.getRun(run.id);
    }
    return {
      status: run.conclusion === 'success' ? 'succeeded' : 'failed',
      runUrl: run.url,
    };
  }
}

interface LocalCommandResult {
  exitCode: number;
  runUrl?: string;
}

interface LocalCommand {
  configFile: string;
  action: 'apply' | 'destroy';
  env: Record<string, string>;
  yamlOverlay: { floci: true; aws_endpoint_url: string };
}

export class FlociDispatcher {
  readonly #endpoint: string;
  readonly #run: (command: LocalCommand) => Promise<LocalCommandResult>;

  constructor(options: {
    endpoint: string;
    run(command: LocalCommand): Promise<LocalCommandResult>;
  }) {
    this.#endpoint = options.endpoint;
    this.#run = options.run;
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    assertLocalDispatchAllowed(input.tier ?? '');
    const result = await this.#run({
      configFile: input.configFile,
      action: input.action,
      env: {
        TF_VAR_floci: '1',
        AWS_ENDPOINT_URL: this.#endpoint,
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
      },
      yamlOverlay: {
        floci: true,
        aws_endpoint_url: this.#endpoint,
      },
    });
    return {
      status: result.exitCode === 0 ? 'succeeded' : 'failed',
      runUrl: result.runUrl ?? `local://${input.orchestrationId}`,
    };
  }
}
