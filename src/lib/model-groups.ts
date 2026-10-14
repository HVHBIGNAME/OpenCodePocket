import type { Model } from '../types';
import { matchesSearch } from './session-search';

type ConnectedModel = Model & { providerID: string; providerName: string };
export function groupModels(models: ConnectedModel[], query: string) {
  const groups = new Map<string, { id: string; name: string; models: ConnectedModel[] }>();
  for (const model of models) {
    if (
      model.status === 'deprecated' ||
      !matchesSearch(`${model.name} ${model.id} ${model.providerName} ${model.providerID}`, query)
    )
      continue;
    const group = groups.get(model.providerID) ?? {
      id: model.providerID,
      name: model.providerName,
      models: [],
    };
    group.models.push(model);
    groups.set(model.providerID, group);
  }
  const priority = (id: string) => (id === 'opencode' ? 0 : 1);
  for (const group of groups.values())
    group.models.sort(
      (a, b) =>
        Number(b.providerID === 'opencode' && b.cost?.input === 0) -
          Number(a.providerID === 'opencode' && a.cost?.input === 0) ||
        (Date.parse(b.release_date ?? '') || 0) - (Date.parse(a.release_date ?? '') || 0) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  return [...groups.values()].sort(
    (a, b) => priority(a.id) - priority(b.id) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}
