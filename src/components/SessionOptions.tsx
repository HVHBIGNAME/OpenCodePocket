import { Check, ChevronRight, Cpu, Sparkles, Terminal } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { Button, Modal } from './ui';

export function SessionOptions({ onClose, chooseModel }: { onClose: () => void; chooseModel: () => void }) {
  const { connectedModels, model, setModel, agents, agent, setAgent } = usePocket();
  const selected = connectedModels.find(
    (item) => item.id === model?.modelID && item.providerID === model?.providerID,
  );
  const variants = Object.keys(selected?.variants ?? {});
  return (
    <Modal title="Как будем работать?" subtitle="Модель и режим для этой сессии." onClose={onClose}>
      <div className="form-stack">
        <button className="option-row selected" onClick={chooseModel}>
          <Cpu size={23} />
          <span>
            <strong>{selected?.name ?? model?.modelID ?? 'Модель по умолчанию'}</strong>
            <small>Выбрать другую модель</small>
          </span>
          <ChevronRight size={20} />
        </button>
        <section>
          <h3 className="sheet-section-title">Режим</h3>
          <div className="option-list">
            {agents
              .filter((item) => !item.hidden && item.mode !== 'subagent')
              .map((item) => (
                <button
                  className={`option-row ${agent === item.name ? 'selected' : ''}`}
                  key={item.name}
                  onClick={() => setAgent(item.name)}
                >
                  <Terminal size={21} />
                  <span>
                    <strong>
                      {item.name === 'build' ? 'Создавать' : item.name === 'plan' ? 'Планировать' : item.name}
                    </strong>
                    <small>
                      {item.name === 'build'
                        ? 'Писать код и использовать инструменты'
                        : item.name === 'plan'
                          ? 'Сначала обсудить и составить план'
                          : (item.description ?? item.name)}
                    </small>
                  </span>
                  {agent === item.name && <Check size={20} />}
                </button>
              ))}
          </div>
        </section>
        {variants.length > 0 && (
          <section>
            <h3 className="sheet-section-title">Вариант модели</h3>
            <div className="variant-options">
              {['', ...variants].map((variant) => (
                <button
                  key={variant}
                  aria-pressed={(model?.variant ?? '') === variant}
                  className={(model?.variant ?? '') === variant ? 'selected' : ''}
                  onClick={() => model && setModel({ ...model, variant: variant || undefined })}
                >
                  <Sparkles size={16} />
                  {variant || 'По умолчанию'}
                </button>
              ))}
            </div>
          </section>
        )}
        <Button onClick={onClose}>
          Готово
          <Check size={18} />
        </Button>
      </div>
    </Modal>
  );
}
