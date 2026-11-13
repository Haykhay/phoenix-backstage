import { selectTeardownCandidates } from './policy.ts';
import type { ReclaimableEnvironment } from './types.ts';

export interface ReclamationAction {
  type: 'notify' | 'destroy';
  environmentId: string;
  reason: 'friday' | 'idle';
}

export function planFridayTeardown(
  environments: readonly ReclaimableEnvironment[],
  now: Date,
): ReclamationAction[] {
  return selectTeardownCandidates(environments, now)
    .filter(environment => environment.reclaimReason !== 'idle')
    .map(environment => ({
      type: 'destroy',
      environmentId: environment.id,
      reason: 'friday',
    }));
}

export function planIdleReclamation(
  environments: readonly ReclaimableEnvironment[],
  now: Date,
  options: { graceHours: number; autoTeardown: boolean },
): ReclamationAction[] {
  const graceMilliseconds = options.graceHours * 60 * 60 * 1_000;
  return selectTeardownCandidates(environments, now)
    .filter(environment => environment.reclaimReason === 'idle')
    .flatMap<ReclamationAction>(environment => {
      if (!environment.notifiedAt) {
        return [{ type: 'notify' as const, environmentId: environment.id, reason: 'idle' as const }];
      }
      const graceElapsed = now.getTime() - new Date(environment.notifiedAt).getTime() >= graceMilliseconds;
      if (graceElapsed && options.autoTeardown) {
        return [{ type: 'destroy' as const, environmentId: environment.id, reason: 'idle' as const }];
      }
      return [];
    });
}
