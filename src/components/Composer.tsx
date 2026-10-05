import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, ChevronDown, Command as CommandIcon, Mic, Paperclip, Square, X } from 'lucide-react';
import type { PluginListenerHandle } from '@capacitor/core';
import { usePocket } from '../store/PocketProvider';
import { errorMessage } from '../lib/api';
import { isNative, PocketNative, vaultRead, vaultWrite } from '../lib/native';
import type { Command, Session } from '../types';
import { IconButton } from './ui';
import { ModelPicker } from './ModelPicker';

type Attachment = { type: 'file'; mime: string; filename: string; url: string; bytes: number };

export function Composer({ session }: { session: Session }) {
  const { client, data, model, setModel, connectedModels, agent, setAgent, agents, preferences, perform, notify, loadMessages, haptic } = usePocket();
  const [draft, setDraft] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [commands, setCommands] = useState<Command[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const speech = useRef<PluginListenerHandle | undefined>(undefined);
  const speechBase = useRef('');
  const currentDraft = useRef('');
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = data.statuses[session.id]?.type === 'busy' || data.statuses[session.id]?.type === 'retry';
  currentDraft.current = draft;
  const selected = connectedModels.find((item) => item.id === model?.modelID && item.providerID === model?.providerID);
  const variants = Object.keys(selected?.variants ?? {});
  const storageKey = `occ.draft.${client?.connection.id ?? 'none'}.${session.id}`;

  useEffect(() => {
    let alive = true;
    void vaultRead<string>(storageKey).then((saved) => { if (alive) { setDraft(saved ?? ''); setDraftLoaded(true); } }).catch((error: unknown) => notify(errorMessage(error), true));
    return () => {
      alive = false; clearTimeout(draftTimer.current);
      void vaultWrite(storageKey, currentDraft.current).catch((error: unknown) => console.error('Draft save failed', errorMessage(error)));
      void speech.current?.remove();
      if (isNative) void PocketNative.stopSpeech().catch((error: unknown) => console.debug(errorMessage(error)));
    };
  }, [storageKey, notify]);
  useEffect(() => {
    if (!draftLoaded) return;
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => { void vaultWrite(storageKey, draft).catch((error: unknown) => notify(errorMessage(error), true)); }, 450);
    if (inputRef.current) { inputRef.current.style.height = 'auto'; inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 180)}px`; }
  }, [draft, draftLoaded, storageKey, notify]);
  useEffect(() => {
    if (!client) return;
    void client.request<Command[]>('/command', { directory: session.directory }).then(setCommands).catch((error: unknown) => notify(errorMessage(error), true));
  }, [client, session.directory, notify]);

  async function send() {
    if (!client || (!draft.trim() && !attachments.length) || sending || busy) return;
    setSending(true);
    const text = draft.trim();
    const command = text.startsWith('/') ? commands.find((item) => text.split(/\s/)[0] === `/${item.name}`) : undefined;
    const success = await perform(async () => {
      if (listening) await PocketNative.stopSpeech();
      const messageID = `msg_${Date.now().toString(16)}${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
      if (command) {
        if (attachments.length) throw new Error('Для slash-команды удалите вложения или отправьте обычный промпт.');
        await client.request(`/session/${encodeURIComponent(session.id)}/command`, { method: 'POST', directory: session.directory,
          data: { messageID, command: command.name, arguments: text.slice(command.name.length + 1).trim(), agent,
            model: model ? `${model.providerID}/${model.modelID}` : undefined, variant: model?.variant } });
      } else await client.request(`/session/${encodeURIComponent(session.id)}/prompt_async`, { method: 'POST', directory: session.directory,
        data: { messageID, agent, model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined, variant: model?.variant,
          parts: [...(text ? [{ type: 'text', text }] : []), ...attachments.map(({ bytes: _bytes, ...part }) => part)] } });
      haptic();
    });
    if (success) { setDraft(''); setAttachments([]); await perform(() => loadMessages(session)); }
    setSending(false);
  }

  async function startSpeech() {
    if (!isNative) { notify('Голосовой ввод доступен в Android/iOS-приложении.', true); return; }
    if (listening) { await perform(() => PocketNative.stopSpeech()); setListening(false); return; }
    await speech.current?.remove(); speechBase.current = draft;
    speech.current = await PocketNative.addListener('speech', (event) => {
      if (event.text !== undefined) setDraft(`${speechBase.current}${speechBase.current ? ' ' : ''}${event.text}`);
      if (event.error) { notify(event.error, true); setListening(false); }
      if (event.final) setListening(false);
    });
    const started = await perform(() => PocketNative.startSpeech({ locale: preferences.speechLocale, offline: preferences.offlineSpeech }));
    setListening(started);
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    await perform(async () => {
      const total = attachments.reduce((sum, item) => sum + item.bytes, 0) + [...list].reduce((sum, file) => sum + file.size, 0);
      if (total > 8 * 1024 * 1024) throw new Error('Максимальный размер вложений — 8 МБ.');
      if (attachments.length + list.length > 6) throw new Error('До 6 вложений в одном сообщении.');
      const added = await Promise.all([...list].map(async (file): Promise<Attachment> => {
        if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type)) throw new Error('Поддерживаются PNG, JPEG, WebP и PDF');
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(`Не удалось прочитать ${file.name}`)); reader.readAsDataURL(file);
        });
        return { type: 'file', filename: file.name, mime: file.type, url, bytes: file.size };
      }));
      setAttachments((old) => [...old, ...added]);
    });
    if (filesRef.current) filesRef.current.value = '';
  }
  function keyboard(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }
  const suggestions = draft.startsWith('/') && !draft.includes(' ') ? commands.filter((item) => item.name.startsWith(draft.slice(1))).slice(0, 5) : [];
  return <div className="composer-wrap">{suggestions.length > 0 && <div className="command-suggestions">{suggestions.map((command) => <button key={command.name} onClick={() => setDraft(`/${command.name} `)}><CommandIcon size={15}/><strong>/{command.name}</strong><span>{command.description}</span></button>)}</div>}
    <div className={`composer ${listening ? 'composer-listening' : ''}`}>{attachments.length > 0 && <div className="composer-attachments">{attachments.map((file, index) => <span key={index}><Paperclip size={13}/>{file.filename}<IconButton label={`Удалить ${file.filename}`} onClick={() => setAttachments((items) => items.filter((_, i) => i !== index))}><X size={13}/></IconButton></span>)}</div>}
      <textarea ref={inputRef} aria-label="Промпт для OpenCode" placeholder={listening ? 'Слушаю. Расскажи свою идею…' : 'Что соберём дальше?'} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={keyboard} rows={2} spellCheck={false} disabled={!draftLoaded || sending}/>
      <div className="composer-controls"><div className="composer-selection"><button className="composer-model" onClick={() => setShowModels(true)}><span className="model-tiny-dot"/>{selected?.name ?? model?.modelID ?? 'Модель по умолчанию'}<ChevronDown size={13}/></button><select aria-label="Агент" value={agent} onChange={(event) => setAgent(event.target.value)}>{agents.filter((item) => !item.hidden && item.mode !== 'subagent').map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}{!agents.length && <option value="build">build</option>}</select>{variants.length > 0 && <select aria-label="Вариант модели" value={model?.variant ?? ''} onChange={(event) => { if (model) setModel({ ...model, variant: event.target.value || undefined }); }}><option value="">default</option>{variants.map((variant) => <option key={variant}>{variant}</option>)}</select>}</div><div className="composer-buttons"><input ref={filesRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple hidden onChange={(event) => void addFiles(event.target.files)}/><IconButton label="Прикрепить файл" disabled={sending} onClick={() => filesRef.current?.click()}><Paperclip size={19}/></IconButton><IconButton label={listening ? 'Завершить диктовку' : 'Надиктовать промпт'} className={listening ? 'recording' : ''} disabled={sending} onClick={() => void startSpeech()}><Mic size={19}/></IconButton>{busy ? <button className="send-button stop-button" aria-label="Остановить генерацию" onClick={() => void perform(() => client!.request(`/session/${encodeURIComponent(session.id)}/abort`, { method: 'POST', directory: session.directory }))}><Square size={17} fill="currentColor"/></button> : <button className="send-button" aria-label="Отправить промпт" disabled={sending || (!draft.trim() && !attachments.length)} onClick={() => void send()}>{sending ? <span className="send-loading"/> : <ArrowUp size={21}/>}</button>}</div></div>
    </div><div className="composer-footnote"><span>{listening ? <><span className="record-dot"/>{preferences.offlineSpeech ? 'Распознавание на устройстве' : 'Системное распознавание'}</> : 'Твой контекст остаётся с тобой.'}</span><span>{busy ? 'OpenCode работает…' : 'Ctrl ↵ отправить'}</span></div>{showModels && <ModelPicker onClose={() => setShowModels(false)}/>}
  </div>;
}
