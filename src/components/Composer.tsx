import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  Command as CommandIcon,
  Mic,
  Paperclip,
  Square,
  X,
} from 'lucide-react';
import { PageDeck, usePageActive } from './PageDeck';
import type { PluginListenerHandle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { usePocket } from '../store/PocketProvider';
import { errorMessage } from '../lib/api';
import { isNative, PocketNative } from '../lib/native';
import { useComposerDraft } from '../store/drafts';
import { captureDiagnostic } from '../lib/diagnostics';
import type { Command, Session } from '../types';
import { closeDialog, ExternalLink, IconButton, KeyboardDismiss, Modal } from './ui';
import { commandCatalog, commandSuggestions, type SlashCommand } from '../lib/commands';
import { useSessionCommands } from './useSessionCommands';
import { ModelPicker } from './ModelPicker';
import { SessionOptions } from './SessionOptions';
import { prepareAttachment, type Attachment } from '../lib/attachments';

export function Composer({ session, active: tabActive = true }: { session: Session; active?: boolean }) {
  const pageActive = usePageActive();
  const active = tabActive && pageActive;
  const {
    client,
    data,
    drafts,
    model,
    connectedModels,
    agent,
    preferences,
    perform,
    notify,
    loadMessages,
    haptic,
    isCurrentClient,
  } = usePocket();
  const storageKey = `occ.draft.${client?.connection.id ?? 'none'}.${session.id}`;
  const {
    text: draft,
    loaded: draftLoaded,
    attachments,
    sending,
    preparing: preparingFiles,
  } = useComposerDraft(drafts, storageKey);
  const setDraft = (text: string) => drafts.update(storageKey, { text });
  const [speechState, setSpeechState] = useState<'idle' | 'starting' | 'listening' | 'finishing'>('idle');
  const speechPhase = useRef(speechState);
  const listening = speechState !== 'idle';
  const setSpeechPhase = (value: typeof speechState) => {
    speechPhase.current = value;
    setSpeechState(value);
  };
  const [showModels, setShowModels] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const optionsRef = useRef<HTMLDialogElement>(null);
  const resetOptions = () => {
    setShowModels(false);
    setShowOptions(false);
  };
  const closeOptions = () => closeDialog(optionsRef.current, resetOptions);
  const [commands, setCommands] = useState<Command[]>([]);
  const catalog = useMemo(() => commandCatalog(commands), [commands]);
  const [commandIndex, setCommandIndex] = useState(0);
  const [hideCommands, setHideCommands] = useState(false);
  const { runBuiltin, sharedURL, setSharedURL } = useSessionCommands(session, () => setShowModels(true));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const speech = useRef<PluginListenerHandle | undefined>(undefined);
  const speechBase = useRef('');
  const followDictation = useRef(true);
  const speechEdit = useRef(false);
  const speechID = useRef<string | undefined>(undefined);
  const speechTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [stopping, setStopping] = useState(false);
  const stoppingRef = useRef(false);
  const busy = data.statuses[session.id]?.type === 'busy' || data.statuses[session.id]?.type === 'retry';
  const selected = connectedModels.find(
    (item) => item.id === model?.modelID && item.providerID === model?.providerID,
  );
  useEffect(() => {
    if (!active) {
      setSpeechPhase('idle');
      return;
    }
    return () => {
      speechID.current = undefined;
      clearTimeout(speechTimeout.current);
      void speech.current?.remove();
      if (isNative)
        void PocketNative.stopSpeech({ cancel: true }).catch((error: unknown) =>
          captureDiagnostic(error, { kind: 'action' }),
        );
    };
  }, [active]);
  useEffect(() => {
    if (inputRef.current) {
      const previousTop = inputRef.current.scrollTop;
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 180)}px`;
      if (speechEdit.current) {
        inputRef.current.scrollTop = followDictation.current ? inputRef.current.scrollHeight : previousTop;
        speechEdit.current = false;
      }
    }
  }, [draft, draftLoaded]);
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    void client
      .request<Command[]>('/command', { directory: session.directory, signal: controller.signal })
      .then(setCommands)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) notify(errorMessage(error), true);
      });
    return () => controller.abort();
  }, [client, session.directory, notify]);

  async function send() {
    if (
      !client ||
      !draftLoaded ||
      (!draft.trim() && !attachments.length) ||
      drafts.get(storageKey).sending ||
      preparingFiles ||
      stopping ||
      speechPhase.current !== 'idle'
    )
      return;
    drafts.update(storageKey, { sending: true });
    const text = draft.trim();
    const command = text.startsWith('/')
      ? catalog.find((item) => text.split(/\s/)[0] === `/${item.name}`)
      : undefined;
    let restoredText = '';
    const success = await perform(async () => {
      await speech.current?.remove();
      speech.current = undefined;
      setSpeechPhase('idle');
      const messageID = `msg_${Date.now().toString(16)}${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      if (text.startsWith('/') && !command)
        throw new Error('Команда не найдена. Введи / и выбери команду из списка.');
      if (command?.builtin) {
        if (busy && ['compact', 'undo', 'redo', 'fork'].includes(command.builtin))
          throw new Error('Эта команда меняет историю. Дождись завершения текущего ответа.');
        if (attachments.length || text.slice(command.name.length + 1).trim())
          throw new Error('Эта встроенная команда выполняется без вложений и аргументов.');
        restoredText = await runBuiltin(command.builtin);
      } else if (command) {
        if (attachments.length)
          throw new Error('Для slash-команды удалите вложения или отправьте обычный промпт.');
        await client.request(`/session/${encodeURIComponent(session.id)}/command`, {
          method: 'POST',
          directory: session.directory,
          data: {
            messageID,
            command: command.name,
            arguments: text.slice(command.name.length + 1).trim(),
            agent,
            model: model ? `${model.providerID}/${model.modelID}` : undefined,
            variant: model?.variant,
          },
        });
      } else
        await client.request(`/session/${encodeURIComponent(session.id)}/prompt_async`, {
          method: 'POST',
          directory: session.directory,
          data: {
            messageID,
            agent,
            model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
            variant: model?.variant,
            parts: [
              ...(text ? [{ type: 'text', text }] : []),
              ...attachments.map(({ bytes: _bytes, ...part }) => part),
            ],
          },
        });
      haptic();
    });
    if (success) {
      drafts.update(storageKey, { text: restoredText, attachments: [] });
      await drafts.flush(storageKey);
      if (isNative && inputRef.current)
        void Keyboard.hide().catch((error: unknown) => notify(errorMessage(error), true));
      try {
        if (isCurrentClient(client)) await loadMessages(session);
      } catch (error) {
        notify(`Сообщение отправлено. Не удалось обновить историю: ${errorMessage(error)}`, true);
      }
    }
    drafts.update(storageKey, { sending: false });
  }

  async function startSpeech() {
    if (!isNative) {
      notify('Голосовой ввод доступен в Android/iOS-приложении.', true);
      return;
    }
    if (speechPhase.current === 'starting' || speechPhase.current === 'finishing') return;
    if (speechPhase.current === 'listening') {
      setSpeechPhase('finishing');
      const id = speechID.current;
      await perform(() => PocketNative.stopSpeech());
      speechTimeout.current = setTimeout(() => {
        if (speechID.current !== id || speechPhase.current !== 'finishing') return;
        speechID.current = undefined;
        setSpeechPhase('idle');
        void perform(() => PocketNative.stopSpeech({ cancel: true }));
        void speech.current?.remove();
      }, 4000);
      return;
    }
    await beginDictation();
  }

  async function beginDictation() {
    const id = crypto.randomUUID();
    speechID.current = id;
    setSpeechPhase('starting');
    clearTimeout(speechTimeout.current);
    let listener: PluginListenerHandle | undefined;
    try {
      await speech.current?.remove();
      void Keyboard.hide().catch(() => undefined);
      inputRef.current?.blur();
      speechBase.current = drafts.get(storageKey).text;
      followDictation.current = true;
      listener = await PocketNative.addListener('speech', (event) => {
        if (speechID.current !== id || (event.id && event.id !== id)) return;
        if (event.text) {
          speechEdit.current = true;
          setDraft(
            `${speechBase.current}${speechBase.current && !/\s$/.test(speechBase.current) ? ' ' : ''}${event.text}`,
          );
        }
        if (event.state === 'finishing') setSpeechPhase('finishing');
        if (event.error) notify(event.error, true);
        if (event.final || event.error) {
          speechID.current = undefined;
          clearTimeout(speechTimeout.current);
          setSpeechPhase('idle');
          void speech.current?.remove();
        }
      });
      if (speechID.current !== id) {
        await listener.remove();
        return;
      }
      speech.current = listener;
      await PocketNative.startSpeech({
        id,
        locale: preferences.speechLocale,
        offline: preferences.offlineSpeech,
      });
      if (speechID.current === id && speechPhase.current === 'starting') setSpeechPhase('listening');
    } catch (error) {
      if (speechID.current !== id) return;
      speechID.current = undefined;
      setSpeechPhase('idle');
      await listener?.remove();
      notify(errorMessage(error), true);
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list || drafts.get(storageKey).preparing || drafts.get(storageKey).sending) return;
    const files = Array.from(list);
    drafts.update(storageKey, { preparing: true });
    await perform(async () => {
      if (attachments.length + files.length > 6) throw new Error('До 6 вложений в одном сообщении.');
      const added: Attachment[] = [];
      for (const file of files) added.push(await prepareAttachment(file));
      const next = [...drafts.get(storageKey).attachments, ...added];
      const total = next.reduce((sum, item) => sum + item.bytes, 0);
      if (total > 8 * 1024 * 1024) throw new Error('Максимальный размер вложений после обработки — 8 МБ.');
      drafts.update(storageKey, { attachments: next });
    });
    drafts.update(storageKey, { preparing: false });
    if (filesRef.current) filesRef.current.value = '';
  }
  function keyboard(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (suggestions.length && !event.ctrlKey && !event.metaKey) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setCommandIndex(
          (index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        completeCommand(suggestions[commandIndex] ?? suggestions[0]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setHideCommands(true);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && /^\/\S+\s/.test(draft)) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send();
    }
  }
  const suggestions = hideCommands || listening || sending ? [] : commandSuggestions(catalog, draft);
  const completeCommand = (command: SlashCommand) => {
    setDraft(`/${command.name} `);
    setCommandIndex(0);
    inputRef.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    document.getElementById(`slash-command-${commandIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [commandIndex]);
  return (
    <div className="composer-wrap">
      {suggestions.length > 0 && (
        <div className="command-suggestions" role="listbox" id="slash-commands" aria-label="Команды OpenCode">
          {suggestions.map((command, index) => (
            <button
              key={command.name}
              id={`slash-command-${index}`}
              role="option"
              aria-selected={index === commandIndex}
              onPointerDown={(event) => event.preventDefault()}
              disabled={listening || sending}
              onClick={() => completeCommand(command)}
            >
              <CommandIcon size={15} />
              <strong>/{command.name}</strong>
              <span>{command.description}</span>
            </button>
          ))}
        </div>
      )}
      <div className={`composer ${listening ? 'composer-listening' : ''}`}>
        {preparingFiles && <output className="form-hint">Подготовка вложений…</output>}
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((file, index) => (
              <span key={index}>
                <Paperclip size={13} />
                <span className="attachment-name">{file.filename}</span>
                <IconButton
                  label={`Удалить ${file.filename}`}
                  disabled={sending}
                  onClick={() =>
                    drafts.update(storageKey, { attachments: attachments.filter((_, i) => i !== index) })
                  }
                >
                  <X size={13} />
                </IconButton>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          aria-label="Промпт для OpenCode"
          aria-autocomplete="list"
          aria-controls={suggestions.length ? 'slash-commands' : undefined}
          aria-activedescendant={
            suggestions.length ? `slash-command-${Math.min(commandIndex, suggestions.length - 1)}` : undefined
          }
          placeholder={listening ? 'Диктовка…' : 'Сообщение OpenCode…'}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setCommandIndex(0);
            setHideCommands(false);
          }}
          onScroll={(event) => {
            if (listening) {
              const input = event.currentTarget;
              followDictation.current = input.scrollHeight - input.scrollTop - input.clientHeight < 24;
            }
          }}
          onKeyDown={keyboard}
          rows={1}
          spellCheck={false}
          disabled={!active || !draftLoaded || sending}
          readOnly={listening}
        />
        <div className="composer-controls">
          <div className="composer-selection">
            <button
              className="composer-model"
              data-pocket-glass="model"
              aria-label="Модель и режим сессии"
              onClick={() => setShowOptions(true)}
            >
              <span className="model-tiny-dot" />
              <span>{selected?.name ?? model?.modelID ?? 'Модель'}</span>
              <ChevronDown size={15} />
            </button>
          </div>
          <div className="composer-buttons">
            <KeyboardDismiss />
            <input
              ref={filesRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              hidden
              onChange={(event) => void addFiles(event.target.files)}
            />
            <IconButton
              label="Прикрепить файл"
              disabled={sending || preparingFiles}
              onClick={() => filesRef.current?.click()}
            >
              <Paperclip size={19} />
            </IconButton>
            <IconButton
              label={
                speechState === 'starting'
                  ? 'Включаем микрофон'
                  : speechState === 'finishing'
                    ? 'Завершаем диктовку'
                    : listening
                      ? 'Завершить диктовку'
                      : 'Надиктовать промпт'
              }
              className={listening ? 'recording' : ''}
              aria-pressed={listening}
              disabled={sending || !draftLoaded || speechState === 'starting' || speechState === 'finishing'}
              onClick={() => void perform(startSpeech)}
            >
              {listening ? <Square size={17} fill="currentColor" /> : <Mic size={19} />}
            </IconButton>
            {busy && !draft.trim() && !attachments.length && !preparingFiles && !sending ? (
              <button
                className="send-button stop-button"
                aria-label="Остановить генерацию"
                disabled={stopping}
                onClick={() => {
                  if (stoppingRef.current || !client) return;
                  stoppingRef.current = true;
                  setStopping(true);
                  void perform(async () => {
                    await client.request(`/session/${encodeURIComponent(session.id)}/abort`, {
                      method: 'POST',
                      directory: session.directory,
                    });
                    await loadMessages(session);
                  }).finally(() => {
                    stoppingRef.current = false;
                    setStopping(false);
                  });
                }}
              >
                <Square size={17} fill="currentColor" />
              </button>
            ) : (
              <button
                className="send-button"
                aria-label="Отправить промпт"
                disabled={
                  !draftLoaded ||
                  sending ||
                  stopping ||
                  preparingFiles ||
                  listening ||
                  (!draft.trim() && !attachments.length)
                }
                onClick={() => void send()}
              >
                {sending ? <span className="send-loading" /> : <ArrowUp size={21} />}
              </button>
            )}
          </div>
        </div>
      </div>
      {(listening || agent === 'plan' || busy || model?.variant) && (
        <div className="composer-footnote">
          <span>
            {listening ? (
              <>
                <span className="record-dot" />
                {speechState === 'finishing'
                  ? 'Сохраняю последние слова…'
                  : speechState === 'starting'
                    ? 'Включаю микрофон…'
                    : preferences.offlineSpeech
                      ? 'Распознавание на устройстве'
                      : 'Системное распознавание'}
              </>
            ) : agent === 'plan' ? (
              'Режим планирования'
            ) : (
              ''
            )}
          </span>
          <span>{busy ? 'В работе…' : (model?.variant ?? '')}</span>
        </div>
      )}
      {(showModels || showOptions) && (
        <Modal
          title={showModels ? 'Выбрать модель' : 'Как будем работать?'}
          header={false}
          className="navigation-modal"
          dialogRef={optionsRef}
          onClose={resetOptions}
          onBack={showModels && showOptions ? () => setShowModels(false) : undefined}
        >
          <PageDeck
            name="session-options"
            pageKey={showModels ? 'models' : 'options'}
            scroll
            onBack={() => setShowModels(false)}
          >
            <div className="sheet-page">
              <header className="sheet-page-header">
                {showModels && showOptions && (
                  <IconButton label="Назад к режиму сессии" onClick={() => setShowModels(false)}>
                    <ArrowLeft size={20} />
                  </IconButton>
                )}
                <h2>{showModels ? 'Выбрать модель' : 'Как будем работать?'}</h2>
                <IconButton label="Закрыть" onClick={closeOptions}>
                  <X size={20} />
                </IconButton>
              </header>
              {showModels ? (
                <ModelPicker embedded onClose={closeOptions} />
              ) : (
                <SessionOptions embedded onClose={closeOptions} chooseModel={() => setShowModels(true)} />
              )}
            </div>
          </PageDeck>
        </Modal>
      )}
      {sharedURL && (
        <Modal title="Ссылка на диалог" onClose={() => setSharedURL(undefined)}>
          <ExternalLink href={sharedURL}>Открыть общий диалог</ExternalLink>
        </Modal>
      )}
    </div>
  );
}
