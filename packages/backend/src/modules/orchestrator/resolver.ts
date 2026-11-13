import type {
  ComponentDependencies,
  OrchestrationUnit,
  ResolvedUnit,
  UnitLayer,
} from './types.ts';

function parseUnit(unit: OrchestrationUnit): ResolvedUnit {
  const path = unit.path;
  let layer: UnitLayer;

  if (path.startsWith('accounts/')) layer = 0;
  else if (path.startsWith('networking/environments/')) layer = 1;
  else if (path.startsWith('infrastructure/environments/')) layer = 2;
  else if (path.startsWith('k8s-installs/environments/')) layer = 3;
  else throw new Error(`unknown unit path: ${path}`);

  if (!path.endsWith('.yaml')) throw new Error(`unit must be YAML: ${path}`);
  if (layer !== 3) return { ...unit, layer };

  const filename = path.slice(path.lastIndexOf('/') + 1, -'.yaml'.length);
  const [component, instance] = filename.split('.', 2);
  if (!component) throw new Error(`missing component in unit path: ${path}`);
  return { ...unit, layer, component, instance };
}

function topologicalLayerThree(
  units: readonly ResolvedUnit[],
  dependencies: ComponentDependencies,
  originalIndex: ReadonlyMap<string, number>,
): ResolvedUnit[] {
  const byComponent = new Map<string, ResolvedUnit[]>();
  for (const unit of units) {
    const group = byComponent.get(unit.component!) ?? [];
    group.push(unit);
    byComponent.set(unit.component!, group);
  }

  const incoming = new Map(units.map(unit => [unit.path, 0]));
  const outgoing = new Map(units.map(unit => [unit.path, [] as string[]]));

  for (const unit of units) {
    for (const dependency of dependencies[unit.component!] ?? []) {
      const prerequisites = byComponent.get(dependency);
      if (!prerequisites?.length) {
        throw new Error(`missing dependency ${dependency} for ${unit.component}`);
      }
      for (const prerequisite of prerequisites) {
        outgoing.get(prerequisite.path)!.push(unit.path);
        incoming.set(unit.path, incoming.get(unit.path)! + 1);
      }
    }
  }

  const byPath = new Map(units.map(unit => [unit.path, unit]));
  const ready = units.filter(unit => incoming.get(unit.path) === 0);
  const result: ResolvedUnit[] = [];
  const sortReady = () => ready.sort(
    (a, b) => originalIndex.get(a.path)! - originalIndex.get(b.path)!,
  );
  sortReady();

  while (ready.length) {
    const unit = ready.shift()!;
    result.push(unit);
    for (const dependentPath of outgoing.get(unit.path)!) {
      const next = incoming.get(dependentPath)! - 1;
      incoming.set(dependentPath, next);
      if (next === 0) ready.push(byPath.get(dependentPath)!);
    }
    sortReady();
  }

  if (result.length !== units.length) {
    const cycle = units
      .filter(unit => incoming.get(unit.path)! > 0)
      .map(unit => unit.component)
      .filter((value, index, all) => all.indexOf(value) === index)
      .sort()
      .join(' -> ');
    throw new Error(`dependency cycle: ${cycle}`);
  }
  return result;
}

export function resolveInstallOrder(
  units: readonly OrchestrationUnit[],
  dependencies: ComponentDependencies,
): ResolvedUnit[] {
  const seen = new Set<string>();
  const parsed = units.map((unit, index) => {
    if (seen.has(unit.path)) throw new Error(`duplicate unit: ${unit.path}`);
    seen.add(unit.path);
    return { unit: parseUnit(unit), index };
  });
  const originalIndex = new Map(parsed.map(item => [item.unit.path, item.index]));
  const ordered: ResolvedUnit[] = [];
  for (const layer of [0, 1, 2] as const) {
    ordered.push(...parsed.filter(item => item.unit.layer === layer).map(item => item.unit));
  }
  const layerThree = parsed.filter(item => item.unit.layer === 3).map(item => item.unit);
  return ordered.concat(topologicalLayerThree(layerThree, dependencies, originalIndex));
}
