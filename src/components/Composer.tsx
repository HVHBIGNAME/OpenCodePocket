import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, ChevronDown, Command as CommandIcon, Mic, Paperclip, Square, X } from 'lucide-react';
import type { PluginListenerHandle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { usePocket } from '../store/PocketProvider';
import { errorMessage } from '../lib/api';
import { isNative, PocketNative } from '../lib/native';
import { useComposerDraft } from '../store/drafts';
import { captureDiagnostic } from '../lib/diagnostics';
import type { Command, Session } from '../types';
import { IconButton } from './ui';
import { ModelPicker } from './ModelPicker';
import { SessionOptions } from './SessionOptions';
import { prepareAttachment, type Attachment } from '../lib/attachments';

export function Composer({ session }: { session: Session }) {
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
  const [listening, setListening] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [commands, setCommands] = useState<Command[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const speech = useRef<PluginListenerHandle | undefined>(undefined);
  const speechBase = useRef('');
  const [stopping, setStopping] = useState(false);
  const stoppingRef = useRef(false);
  const busy = data.statuses[session.id]?.type === 'busy' || data.statuses[session.id]?.type === 'retry';
  const selected = connectedModels.find(
    (item) => item.id === model?.modelID && item.providerID === model?.providerID,
  );
  useEffect(() => {
    return () => {
      void speech.current?.remove();
      if (isNative)
        void PocketNative.stopSpeech().catch((error: unknown) =>
          captureDiagnostic(error, { kind: 'action' }),
        );
    };
  }, []);
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 180)}px`;
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
      busy ||
      listening
    )
      return;
    drafts.update(storageKey, { sending: true });
    const text = draft.trim();
    const command = text.startsWith('/')
      ? commands.find((item) => text.split(/\s/)[0] === `/${item.name}`)
      : undefined;
    const success = await perform(async () => {
      await speech.current?.remove();
      speech.current = undefined;
      setListening(false);
      const messageID = `msg_${Date.now().toString(16)}${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      if (command) {
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
      drafts.update(storageKey, { text: '', attachments: [] });
      await drafts.flush(storageKey);
      if (isNative && inputRef.current)
        void Keyboard.hide().catch((error: unknown) => notify(errorMessage(error), true));
      try {
        await loadMessages(session);
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
    if (listening) {
      await perform(() => PocketNative.stopSpeech());
      setListening(false);
      return;
    }
    await speech.current?.remove();
    void Keyboard.hide().catch(() => undefined);
    speechBase.current = draft;
    speech.current = await PocketNative.addListener('speech', (event) => {
      if (event.text !== undefined)
        setDraft(`${speechBase.current}${speechBase.current ? ' ' : ''}${event.text}`);
      if (event.error) {
        notify(event.error, true);
        setListening(false);
      }
      if (event.final) setListening(false);
    });
    const started = await perform(() =>
      PocketNative.startSpeech({ locale: preferences.speechLocale, offline: preferences.offlineSpeech }),
    );
    setListening(started);
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
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send();
    }
  }
  const suggestions =
    draft.startsWith('/') && !draft.includes(' ')
      ? commands.filter((item) => item.name.startsWith(draft.slice(1))).slice(0, 5)
      : [];
  return (
    <div className="composer-wrap">
      {suggestions.length > 0 && (
        <div className="command-suggestions">
          {suggestions.map((command) => (
            <button key={command.name} onClick={() => setDraft(`/${command.name} `)}>
              <CommandIcon size={15} />
              <strong>/{command.name}</strong>
              <span>{command.description}</span>
            </button>
          ))}
        </div>
      )}
      <div data-pocket-glass="composer" className={`composer ${listening ? 'composer-listening' : ''}`}>
        {preparingFiles && <output className="form-hint">Подготовка вложений…</output>}
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((file, index) => (
              <span key={index}>
                <Paperclip size={13} />
                {file.filename}
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
          placeholder={listening ? 'Диктовка…' : 'Запрос…'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyboard}
          rows={2}
          spellCheck={false}
          disabled={!draftLoaded || sending}
        />
        <div className="composer-controls">
          <div className="composer-selection">
            <button
              className="composer-model"
              aria-label="Модель и режим сессии"
              onClick={() => setShowOptions(true)}
            >
              <span className="model-tiny-dot" />
              <span>{selected?.name ?? model?.modelID ?? 'Модель'}</span>
              <ChevronDown size={15} />
            </button>
          </div>
          <div className="composer-buttons">
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
              label={listening ? 'Завершить диктовку' : 'Надиктовать промпт'}
              className={listening ? 'recording' : ''}
              disabled={sending || !draftLoaded}
              onClick={() => void perform(startSpeech)}
            >
              <Mic size={19} />
            </IconButton>
            {busy ? (
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
                {preferences.offlineSpeech ? 'Распознавание на устройстве' : 'Системное распознавание'}
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
      {showModels && <ModelPicker onClose={() => setShowModels(false)} />}
      {showOptions && (
        <SessionOptions
          onClose={() => setShowOptions(false)}
          chooseModel={() => {
            setShowOptions(false);
            setShowModels(true);
          }}
        />
      )}
    </div>
  );
}
