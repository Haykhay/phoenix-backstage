import type { GitHubWorkflowClient, WorkflowRun } from './dispatch';

export class GitHubActionsClient implements GitHubWorkflowClient {
  readonly #owner: string;
  readonly #repo: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(options: { owner: string; repo: string; token: string; fetch?: typeof fetch }) {
    this.#owner = options.owner;
    this.#repo = options.repo;
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  async #request(path: string, init?: RequestInit): Promise<any> {
    const response = await this.#fetch(`https://api.github.com/repos/${this.#owner}/${this.#repo}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.#token}`,
        'x-github-api-version': '2022-11-28',
        ...init?.headers,
      },
    });
    if (!response.ok) throw new Error(`GitHub Actions request failed: ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  }

  async dispatch(input: { workflow: string; ref: string; inputs: Record<string, string> }): Promise<void> {
    await this.#request(`/actions/workflows/${encodeURIComponent(input.workflow)}/dispatches`, {
      method: 'POST', body: JSON.stringify({ ref: input.ref, inputs: input.inputs }),
    });
  }

  #run(value: any): WorkflowRun {
    return { id: value.id, status: value.status, conclusion: value.conclusion, url: value.html_url };
  }

  async findRunByOrchestrationId(id: string): Promise<WorkflowRun | undefined> {
    const data = await this.#request('/actions/workflows/terraform.yml/runs?event=workflow_dispatch&per_page=50');
    const run = data.workflow_runs.find((value: any) =>
      String(value.display_title ?? value.name ?? '').includes(`[${id}]`),
    );
    return run ? this.#run(run) : undefined;
  }

  async getRun(id: number): Promise<WorkflowRun> {
    return this.#run(await this.#request(`/actions/runs/${id}`));
  }
}
