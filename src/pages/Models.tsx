import { useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Cpu,
  KeyRound,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { number } from '../lib/format';
import { Button, EmptyState, Modal } from '../components/ui';
import type { Provider, Model } from '../types';

export function Models() {
  const {
    client,
    providers,
    connectedModels,
    model,
    setModel,
    setScreen,
    session,
    config,
    saveConfig,
    perform,
  } = usePocket();
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [add, setAdd] = useState(false);
  const [editing, setEditing] = useState<{ provider: string; model: Model }>();
  const matches = connectedModels.filter(
    (item) =>
      `${item.name} ${item.id} ${item.providerName}`.toLowerCase().includes(query.toLowerCase()) &&
      (providerFilter === 'all' || item.providerID === providerFilter),
  );
  return (
    <div className="page models-page">
      <div className="page-heading">
        <div>
          <h1>Модели</h1>
        </div>
        <Button disabled={!client} onClick={() => setAdd(true)}>
          <Plus size={17} />
          Провайдер
        </Button>
      </div>
      <div className="models-active panel">
        <span className="active-model-symbol">
          <Sparkles size={26} />
        </span>
        <div>
          <span className="eyebrow">{model ? 'ВЫБРАНО ДЛЯ ЧАТА' : 'МОДЕЛЬ ПО УМОЛЧАНИЮ'}</span>
          <h3>
            {model
              ? (connectedModels.find(
                  (item) => item.id === model.modelID && item.providerID === model.providerID,
                )?.name ?? model.modelID)
              : (config.model ?? 'Выбери модель ниже')}
          </h3>
          <p>{model?.providerID ?? 'Настройки OpenCode на сервере'}</p>
        </div>
        {model && (
          <Button
            variant="secondary"
            onClick={() => void perform(() => saveConfig({ model: `${model.providerID}/${model.modelID}` }))}
          >
            По умолчанию
            <Check size={15} />
          </Button>
        )}
      </div>
      <div className="session-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Поиск моделей"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти модель…"
          />
        </label>
        <label className="provider-filter">
          <span className="sr-only">Провайдер</span>
          <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
            <option value="all">Все провайдеры</option>
            {providers.all
              .filter((item) => providers.connected.includes(item.id))
              .map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
          </select>
          <ChevronDown size={15} />
        </label>
        <span className="eyebrow">{matches.length} ДОСТУПНО</span>
      </div>
      <div className="model-grid">
        {matches.map((item) => (
          <article
            className={`model-card panel ${model?.modelID === item.id && model.providerID === item.providerID ? 'selected' : ''}`}
            key={`${item.providerID}/${item.id}`}
          >
            <div className="model-card-top">
              <span className="model-symbol">
                <Cpu size={22} />
              </span>
              <span className="eyebrow">{item.providerName}</span>
              {model?.modelID === item.id && model.providerID === item.providerID && (
                <Check size={17} className="accent" />
              )}
            </div>
            <h3>{item.name}</h3>
            <p className="mono model-id">{item.id}</p>
            <div className="model-capabilities">
              <span>
                <Terminal size={12} />
                CODE
              </span>
              {(item.reasoning || item.capabilities?.reasoning) && (
                <span>
                  <Sparkles size={12} />
                  REASONING
                </span>
              )}
              {(item.attachment || item.capabilities?.attachment) && <span>VISION</span>}
            </div>
            <div className="model-limits">
              <span>
                Контекст<strong>{item.limit ? number(item.limit.context) : '—'}</strong>
              </span>
              <span>
                Ответ<strong>{item.limit ? number(item.limit.output) : '—'}</strong>
              </span>
              <span>
                Вход / 1M<strong>{item.cost ? `$${item.cost.input}` : '—'}</strong>
              </span>
            </div>
            <div className="model-card-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setModel({ providerID: item.providerID, modelID: item.id });
                  if (session) setScreen('chat');
                }}
              >
                Выбрать
                <ArrowRight size={15} />
              </Button>
              <button
                className="icon-button"
                aria-label={`Настроить ${item.name}`}
                onClick={() => setEditing({ provider: item.providerID, model: item })}
              >
                <SlidersHorizontal size={18} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!matches.length && (
        <section className="panel">
          <EmptyState icon={<Cpu size={30} />} title="Здесь будет твоя команда моделей">
            {client
              ? 'Подключите провайдера через API-ключ или добавьте свой OpenAI-совместимый сервер.'
              : 'Подключитесь к OpenCode, чтобы увидеть доступные модели.'}
          </EmptyState>
        </section>
      )}
      {add && <ProviderModal providers={providers.all} onClose={() => setAdd(false)} />}
      {editing && (
        <ModelSettings
          provider={editing.provider}
          model={editing.model}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

function ProviderModal({ providers, onClose }: { providers: Provider[]; onClose: () => void }) {
  const { client, perform, refresh, saveConfig } = usePocket();
  const [custom, setCustom] = useState(false);
  const [provider, setProvider] = useState(
    providers.find((item) => item.id === 'anthropic')?.id ?? providers[0]?.id ?? '',
  );
  const [key, setKey] = useState('');
  const [id, setId] = useState('my-provider');
  const [name, setName] = useState('My provider');
  const [url, setUrl] = useState('');
  const [modelID, setModelID] = useState('');
  const [context, setContext] = useState('128000');
  const [output, setOutput] = useState('8192');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!client) return;
    setBusy(true);
    await perform(async () => {
      if (custom) {
        const address = new URL(url);
        if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password)
          throw new Error('Нужен HTTP(S) адрес без встроенного пароля');
        if (
          !Number.isSafeInteger(Number(context)) ||
          !Number.isSafeInteger(Number(output)) ||
          Number(output) > Number(context)
        )
          throw new Error('Проверьте лимиты контекста и ответа');
        await saveConfig({
          provider: {
            [id]: {
              npm: '@ai-sdk/openai-compatible',
              name,
              options: { baseURL: address.toString() },
              models: {
                [modelID]: { name: modelID, limit: { context: Number(context), output: Number(output) } },
              },
            },
          },
        });
      }
      if (key.trim())
        await client.request(`/auth/${encodeURIComponent(custom ? id : provider)}`, {
          method: 'PUT',
          data: { type: 'api', key: key.trim() },
        });
      await refresh();
      setKey('');
      onClose();
    });
    setBusy(false);
  }
  return (
    <Modal
      title="Подключить провайдера"
      subtitle="Ключ отправляется на твой компьютер и сохраняется в OpenCode."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="segmented full">
          <button type="button" className={!custom ? 'active' : ''} onClick={() => setCustom(false)}>
            Из каталога
          </button>
          <button type="button" className={custom ? 'active' : ''} onClick={() => setCustom(true)}>
            Свой API
          </button>
        </div>
        {custom ? (
          <>
            <div className="field-pair">
              <label>
                ID
                <input
                  value={id}
                  required
                  pattern="[a-z0-9_-]+"
                  onChange={(event) => setId(event.target.value)}
                />
              </label>
              <label>
                Название
                <input value={name} required onChange={(event) => setName(event.target.value)} />
              </label>
            </div>
            <label>
              OpenAI-совместимый URL
              <input
                type="url"
                required
                value={url}
                placeholder="https://api.example.com/v1"
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <label>
              ID модели
              <input
                required
                value={modelID}
                onChange={(event) => setModelID(event.target.value)}
                placeholder="model-name"
              />
            </label>
            <div className="field-pair">
              <label>
                Контекст
                <input
                  type="number"
                  min="1"
                  required
                  value={context}
                  onChange={(event) => setContext(event.target.value)}
                />
              </label>
              <label>
                Максимальный ответ
                <input
                  type="number"
                  min="1"
                  required
                  value={output}
                  onChange={(event) => setOutput(event.target.value)}
                />
              </label>
            </div>
          </>
        ) : (
          <label>
            Провайдер
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              {providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          API-ключ {custom && '(если нужен)'}
          <input
            type="password"
            value={key}
            required={!custom}
            onChange={(event) => setKey(event.target.value)}
            placeholder="sk-…"
            autoComplete="off"
          />
        </label>
        <p className="form-hint">
          OAuth-провайдеры можно авторизовать в OpenCode на компьютере — OCC увидит их автоматически.
        </p>
        <Button type="submit" busy={busy}>
          <KeyRound size={17} />
          Подключить
        </Button>
      </form>
    </Modal>
  );
}

function ModelSettings({
  provider,
  model,
  onClose,
}: {
  provider: string;
  model: Model;
  onClose: () => void;
}) {
  const { config, saveConfig, perform } = usePocket();
  const current = config.provider?.[provider]?.models?.[model.id];
  const [options, setOptions] = useState(JSON.stringify(current?.options ?? {}, null, 2));
  const [variants, setVariants] = useState(
    JSON.stringify(current?.variants ?? model.variants ?? {}, null, 2),
  );
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={model.name}
      subtitle="Параметры этой модели на компьютере. Формат зависит от провайдера."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void perform(async () => {
            const parsedOptions: unknown = JSON.parse(options);
            const parsedVariants: unknown = JSON.parse(variants);
            if (
              !parsedOptions ||
              typeof parsedOptions !== 'object' ||
              Array.isArray(parsedOptions) ||
              !parsedVariants ||
              typeof parsedVariants !== 'object' ||
              Array.isArray(parsedVariants)
            )
              throw new Error('Options и variants должны быть JSON-объектами');
            await saveConfig({
              provider: {
                [provider]: {
                  models: {
                    [model.id]: {
                      options: parsedOptions as Record<string, unknown>,
                      variants: parsedVariants as Record<string, Record<string, unknown>>,
                    },
                  },
                },
              },
            });
            onClose();
          }).finally(() => setBusy(false));
        }}
      >
        <label>
          Options
          <textarea
            className="code-input"
            value={options}
            onChange={(event) => setOptions(event.target.value)}
            rows={6}
            spellCheck={false}
          />
        </label>
        <label>
          Variants
          <textarea
            className="code-input"
            value={variants}
            onChange={(event) => setVariants(event.target.value)}
            rows={6}
            spellCheck={false}
          />
        </label>
        <p className="form-hint">
          Например, reasoningEffort у поддерживающих его моделей. Неизвестные параметры проверяет сервер
          OpenCode.
        </p>
        <Button type="submit" busy={busy}>
          Сохранить параметры
          <Check size={16} />
        </Button>
      </form>
    </Modal>
  );
}
