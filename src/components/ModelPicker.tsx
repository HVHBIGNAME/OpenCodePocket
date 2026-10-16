import { useState } from 'react';
import { Check, Cpu, Search, Sparkles } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { number } from '../lib/format';
import { EmptyState, Modal } from './ui';
import type { ModelChoice } from '../types';
import { groupModels } from '../lib/model-groups';

export function ModelPicker({
  onClose,
  onSelect,
  embedded = false,
}: {
  onClose: () => void;
  onSelect?: (choice: ModelChoice) => void;
  embedded?: boolean;
}) {
  const { connectedModels, model, setModel } = usePocket();
  const [query, setQuery] = useState('');
  const groups = groupModels(connectedModels, query);
  const content = (
    <>
      <label className="search-field">
        <Search size={17} />
        <input
          aria-label="Найти модель"
          placeholder="Название или провайдер…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="model-picker-list">
        {groups.map((group) => (
          <section key={group.id} aria-label={`Провайдер ${group.name}`} className="model-provider-group">
            <h3>
              {group.name}
              <small>{group.models.length}</small>
            </h3>
            {group.models.map((item) => (
              <button
                key={`${item.providerID}/${item.id}`}
                className="model-picker-row"
                aria-pressed={model?.modelID === item.id && model.providerID === item.providerID}
                onClick={() => {
                  const choice = { providerID: item.providerID, modelID: item.id };
                  (onSelect ?? setModel)(choice);
                  onClose();
                }}
              >
                <span className="model-symbol">
                  <Sparkles size={19} />
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.limit ? `${number(item.limit.context)} context` : item.id}
                    {item.providerID === 'opencode' && item.cost?.input === 0 ? ' · Free' : ''}
                  </small>
                </span>
                {model?.modelID === item.id && model.providerID === item.providerID && (
                  <Check size={18} className="accent" />
                )}
              </button>
            ))}
          </section>
        ))}
      </div>
      {!groups.length && (
        <EmptyState icon={<Cpu size={28} />} title="Модели не найдены">
          Добавьте провайдера на странице «Модели» или измените поиск.
        </EmptyState>
      )}
    </>
  );
  return embedded ? (
    content
  ) : (
    <Modal title="Выбрать модель" subtitle="Модели, подключённые к твоему OpenCode." onClose={onClose}>
      {content}
    </Modal>
  );
}
