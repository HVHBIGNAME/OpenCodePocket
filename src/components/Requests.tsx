import { useState } from 'react';
import { Check, ChevronRight, MessageSquare, ShieldCheck, X } from 'lucide-react';
import { ApiError } from '../lib/api';
import { usePocket } from '../store/PocketProvider';
import type { PendingPermission, PendingQuestion } from '../types';
import { Button } from './ui';

export function QuestionCard({ request }: { request: PendingQuestion }) {
  const { client, perform, setData, notify, haptic } = usePocket();
  const [selected, setSelected] = useState<string[][]>(request.questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(request.questions.map(() => ''));
  const [busy, setBusy] = useState(false);
  const answers = request.questions.map((question, index) => {
    const text = custom[index]?.trim();
    return text ? question.multiple ? [...(selected[index] ?? []), text] : [text] : selected[index] ?? [];
  });
  const clear = () => setData((previous) => ({ ...previous, questions: previous.questions.filter((item) => item.id !== request.id) }));
  async function reply(reject = false) {
    if (!client) return;
    setBusy(true);
    await perform(async () => {
      try { await client.request(`/question/${encodeURIComponent(request.id)}/${reject ? 'reject' : 'reply'}`, {
        method: 'POST', data: reject ? undefined : { answers }, directory: request.directory,
      }); } catch (error) {
        if (error instanceof ApiError && error.status === 404) notify('На этот вопрос уже ответили с другого устройства.');
        else throw error;
      }
      clear(); haptic();
    });
    setBusy(false);
  }
  return <section className="request-card question-card" aria-label="Вопрос от OpenCode"><div className="request-heading"><span className="request-icon"><MessageSquare size={18}/></span><span><strong>Нужен твой ответ</strong><small>OpenCode приостановил работу</small></span><span className="request-live">ОЖИДАНИЕ</span></div>
    {request.questions.map((question, index) => <fieldset key={index}><legend><span className="eyebrow">{question.header} {request.questions.length > 1 && ` / ${index + 1} из ${request.questions.length}`}</span><span className="question-text">{question.question}</span></legend>
      <div className="question-options">{question.options.map((option) => <label key={option.label} className="question-option"><input type={question.multiple ? 'checkbox' : 'radio'} name={`${request.id}-${index}`} checked={(selected[index] ?? []).includes(option.label) && (question.multiple || !custom[index])} onChange={() => {
        setSelected((old) => old.map((values, i) => i !== index ? values : question.multiple ? values.includes(option.label) ? values.filter((item) => item !== option.label) : [...values, option.label] : [option.label]));
        if (!question.multiple) setCustom((old) => old.map((value, i) => i === index ? '' : value));
      }}/><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div>
      {question.custom !== false && <input aria-label={`Свой ответ: ${question.header}`} placeholder="Или свой вариант…" value={custom[index] ?? ''} onChange={(event) => setCustom((old) => old.map((value, i) => i === index ? event.target.value : value))}/>}
    </fieldset>)}
    <div className="request-actions"><Button variant="ghost" disabled={busy} onClick={() => void reply(true)}>Пропустить</Button><Button busy={busy} disabled={answers.some((answer) => answer.length === 0)} onClick={() => void reply()}>Отправить ответ<ChevronRight size={16}/></Button></div>
  </section>;
}

export function PermissionCard({ request }: { request: PendingPermission }) {
  const { client, perform, setData, notify, haptic } = usePocket();
  const [busy, setBusy] = useState(false);
  const [confirmAlways, setConfirmAlways] = useState(false);
  async function reply(value: 'once' | 'always' | 'reject') {
    if (!client) return;
    setBusy(true);
    await perform(async () => {
      try { await client.request(`/permission/${encodeURIComponent(request.id)}/reply`, { method: 'POST', data: { reply: value }, directory: request.directory }); }
      catch (error) {
        if (error instanceof ApiError && error.status === 404) notify('Этот запрос уже обработан на другом устройстве.');
        else throw error;
      }
      setData((previous) => ({ ...previous, permissions: previous.permissions.filter((item) => item.id !== request.id) })); haptic();
    });
    setBusy(false);
  }
  return <section className="request-card permission-card" aria-label="Запрос разрешения"><div className="request-heading"><span className="request-icon"><ShieldCheck size={20}/></span><span><strong>Разрешить действие?</strong><small>Инструмент: {request.permission}</small></span><span className="request-live">ДОСТУП</span></div><div className="permission-patterns">{request.patterns.map((pattern, index) => <code key={index}>{pattern}</code>)}</div>
    {Object.keys(request.metadata).length > 0 && <details className="tool-details"><summary>Параметры действия</summary><pre>{JSON.stringify(request.metadata, null, 2)}</pre></details>}
    {confirmAlways && <p className="form-hint">OpenCode запомнит разрешение для указанных шаблонов: {(request.always.length ? request.always : request.patterns).join(', ')}.</p>}
    <div className="request-actions"><Button variant="ghost" disabled={busy} onClick={() => void reply('reject')}><X size={15}/>Отклонить</Button><Button variant="secondary" disabled={busy} onClick={() => confirmAlways ? void reply('always') : setConfirmAlways(true)}>{confirmAlways ? 'Да, запомнить' : 'Запомнить'}</Button><Button busy={busy} onClick={() => void reply('once')}><Check size={16}/>Разрешить</Button></div>
  </section>;
}
