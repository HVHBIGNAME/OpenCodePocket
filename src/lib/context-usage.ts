import type { MessageEntry, Model } from '../types';

export function contextUsage(entries: MessageEntry[], models: Model[]) {
  const info = entries.findLast((entry) => entry.info.role === 'assistant')?.info;
  if (!info || info.role !== 'assistant') return;
  const tokens = info.tokens;
  const used =
    'total' in tokens && typeof tokens.total === 'number'
      ? tokens.total
      : tokens.input + tokens.output + tokens.cache.read + tokens.cache.write;
  const model = models.find((item) => item.id === info.modelID && item.providerID === info.providerID);
  const limit = model?.limit?.context;
  return {
    used,
    limit,
    model: model?.name ?? info.modelID,
    percent: limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : undefined,
  };
}
