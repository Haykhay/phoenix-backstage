import type { DispatchInput, DispatchResult } from './dispatch';
import type { OrchestrationService } from './service';

export interface UnitDispatcher {
  dispatch(input: DispatchInput): Promise<DispatchResult>;
}

export async function executeRequest(options: {
  service: OrchestrationService;
  dispatcher: UnitDispatcher;
  requestId: string;
  workerId: string;
}): Promise<void> {
  const request = await options.service.get(options.requestId);
  if (request.action === 'retain') return;
  while (true) {
    const unit = await options.service.claimNextUnit(options.requestId, options.workerId);
    if (!unit) return;
    let result: DispatchResult;
    try {
      result = await options.dispatcher.dispatch({
        orchestrationId: `${options.requestId}:${unit.path}:${unit.attempt}`,
        configFile: unit.path,
        action: request.action,
        tier: request.tier,
      });
    } catch {
      result = { status: 'failed' };
    }
    await options.service.recordUnitResult(options.requestId, unit.path, result);
    if (result.status === 'failed') return;
  }
}
