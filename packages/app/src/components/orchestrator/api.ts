import type { FetchApi } from '@backstage/core-plugin-api';

export interface OrchestratorUnit {
  path: string;
  status: string;
  attempt: number;
  runUrl?: string;
}

export interface OrchestratorGate {
  group: string;
  reason: string;
}

export interface OrchestratorRequest {
  id: string;
  requester: string;
  action: 'apply' | 'destroy' | 'retain';
  tier: string;
  status: string;
  reason?: string;
  retentionExpiresAt?: string;
  gates: OrchestratorGate[];
  approvals: Array<{ group: string; decision: string; actor: string }>;
  units: OrchestratorUnit[];
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `orchestrator request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function createOrchestratorClient(fetchApi: FetchApi) {
  const request = (path: string, init?: RequestInit) => fetchApi.fetch(
    `/api/orchestrator${path}`,
    { ...init, headers: { 'content-type': 'application/json', ...init?.headers } },
  );
  return {
    async list() {
      return json<OrchestratorRequest[]>(await request('/requests'));
    },
    async decide(id: string, group: string, decision: 'approved' | 'rejected') {
      return json<OrchestratorRequest>(await request(`/requests/${id}/decisions`, {
        method: 'POST', body: JSON.stringify({ group, decision }),
      }));
    },
    async retry(id: string) {
      return json<OrchestratorRequest>(await request(`/requests/${id}/retry`, { method: 'POST' }));
    },
    async retain(input: {
      tier: 'sandbox';
      reason: string;
      retentionExpiresAt: string;
      source: { owner: string; repo: string; commit: string };
      units: Array<{ path: string }>;
    }) {
      return json<OrchestratorRequest>(await request('/requests', {
        method: 'POST', body: JSON.stringify({ ...input, action: 'retain' }),
      }));
    },
  };
}

