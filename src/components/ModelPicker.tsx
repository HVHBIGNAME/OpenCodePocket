import { useState } from 'react';
import { Check, Cpu, Search, Sparkles } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { number } from '../lib/format';
import { EmptyState, Modal } from './ui';
import type { ModelChoice } from '../types';

export function ModelPicker({ onClose, onSelect }: { onClose: () => void; onSelect?: (choice: ModelChoice) => void }) {
  const { connectedModels, model, setModel } = usePocket();
  const [query, setQuery] = useState('');
  const matches = connectedModels.filter((item) => `${item.name} ${item.id} ${item.providerName}`.toLowerCase().includes(query.toLowerCase()));
  return <Modal title="Выбери своего напарника" subtitle="Модели, подключённые к твоему OpenCode." onClose={onClose}><label className="search-field"><Search size={17}/><input autoFocus aria-label="Найти модель" placeholder="Название или провайдер…" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
    <div className="model-picker-list">{matches.map((item) => <button key={`${item.providerID}/${item.id}`} className="model-picker-row" onClick={() => { const choice = { providerID: item.providerID, modelID: item.id }; (onSelect ?? setModel)(choice); onClose(); }}><span className="model-symbol"><Sparkles size={19}/></span><span><strong>{item.name}</strong><small>{item.providerName} · {item.limit ? `${number(item.limit.context)} context` : item.id}</small></span>{model?.modelID === item.id && model.providerID === item.providerID && <Check size={18} className="accent"/>}</button>)}</div>
    {!matches.length && <EmptyState icon={<Cpu size={28}/>} title="Модели не найдены">Добавьте провайдера на странице «Модели» или измените поиск.</EmptyState>}
  </Modal>;
}
