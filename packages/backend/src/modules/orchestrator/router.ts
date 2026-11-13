import type { ApprovalInput, OrchestrationService } from './service.ts';
import type { OrchestrationRequestInput } from './types.ts';

interface RouterService {
  list(): Promise<unknown>;
  get(id: string): Promise<unknown>;
  create(input: OrchestrationRequestInput): Promise<unknown>;
  decide(id: string, input: ApprovalInput): Promise<unknown>;
  retry(id: string): Promise<unknown>;
}

export interface RouteInput {
  method: string;
  path: string;
  identity?: string;
  body?: unknown;
}

export interface RouteOutput {
  status: number;
  body: unknown;
}

function objectBody(body: unknown): Record<string, unknown> | undefined {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : undefined;
}

export async function routeOrchestratorRequest(
  service: RouterService | OrchestrationService,
  input: RouteInput,
): Promise<RouteOutput> {
  if (!input.identity) return { status: 401, body: { error: 'authentication required' } };
  try {
    if (input.method === 'GET' && input.path === '/requests') {
      return { status: 200, body: await service.list() };
    }
    if (input.method === 'POST' && input.path === '/requests') {
      const body = objectBody(input.body);
      if (!body) return { status: 400, body: { error: 'request body is required' } };
      return {
        status: 201,
        body: await service.create({ ...body, requester: input.identity } as unknown as OrchestrationRequestInput),
      };
    }
    const decision = input.path.match(/^\/requests\/([^/]+)\/decisions$/);
    if (input.method === 'POST' && decision) {
      const body = objectBody(input.body);
      if (!body || typeof body.group !== 'string' || !['approved', 'rejected'].includes(String(body.decision))) {
        return { status: 400, body: { error: 'group and a valid decision are required' } };
      }
      return {
        status: 200,
        body: await service.decide(decision[1], {
          group: body.group,
          decision: body.decision as 'approved' | 'rejected',
          actor: input.identity,
        }),
      };
    }
    const retry = input.path.match(/^\/requests\/([^/]+)\/retry$/);
    if (input.method === 'POST' && retry) {
      return { status: 200, body: await service.retry(retry[1]) };
    }
    const request = input.path.match(/^\/requests\/([^/]+)$/);
    if (input.method === 'GET' && request) {
      return { status: 200, body: await service.get(request[1]) };
    }
    return { status: 404, body: { error: 'route not found' } };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('request not found:')) {
      return { status: 404, body: { error: 'request not found' } };
    }
    if (message.includes('not a current member') || message.includes('not required')) {
      return { status: 403, body: { error: 'approval is not authorized' } };
    }
    if (message.includes('only failed requests')) {
      return { status: 409, body: { error: 'request is not retryable' } };
    }
    return { status: 500, body: { error: 'internal orchestrator error' } };
  }
}
