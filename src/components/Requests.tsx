import { useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronRight, MessageSquare, ShieldCheck, X } from 'lucide-react';
import { ApiError } from '../lib/api';
import { usePocket } from '../store/PocketProvider';
import type { PendingPermission, PendingQuestion } from '../types';
import { Button, KeyboardDismiss } from './ui';

export function QuestionCard({ request }: { request: PendingQuestion }) {
  const { client, perform, setData, notify, haptic, questionDrafts } = usePocket();
  const signature = JSON.stringify(request.questions);
  const saved = questionDrafts.current.get(request.id);
  const draft = saved?.signature === signature ? saved : undefined;
  const [selected, setSelected] = useState<string[][]>(
    () => draft?.selected ?? request.questions.map(() => []),
  );
  const [custom, setCustom] = useState<string[]>(() => draft?.custom ?? request.questions.map(() => ''));
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(draft?.step ?? 0);
  useLayoutEffect(() => {
    questionDrafts.current.set(request.id, { selected, custom, step, signature });
  }, [questionDrafts, request.id, selected, custom, step, signature]);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [step]);
  const answers = request.questions.map((question, index) => {
    const text = custom[index]?.trim();
    return text ? (question.multiple ? [...(selected[index] ?? []), text] : [text]) : (selected[index] ?? []);
  });
  const clear = () => {
    questionDrafts.current.delete(request.id);
    setData((previous) => ({
      ...previous,
      questions: previous.questions.filter((item) => item.id !== request.id),
    }));
  };
  async function reply(reject = false) {
    if (!client) return;
    setBusy(true);
    await perform(async () => {
      try {
        await client.request(`/question/${encodeURIComponent(request.id)}/${reject ? 'reject' : 'reply'}`, {
          method: 'POST',
          data: reject ? undefined : { answers },
          directory: request.directory,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404)
          notify('На этот вопрос уже ответили с другого устройства.');
        else throw error;
      }
      clear();
      haptic();
    });
    setBusy(false);
  }
  return (
    <section
      className="request-card question-card"
      data-steps={request.questions.length}
      aria-label="Вопрос от OpenCode"
    >
      <div className="request-heading">
        <span className="request-icon">
          <MessageSquare size={18} />
        </span>
        <span>
          <strong>Нужен твой ответ</strong>
          <small>
            {request.questions.length > 1
              ? `Вопрос ${step + 1} из ${request.questions.length}`
              : 'Чтобы продолжить работу'}
          </small>
        </span>
      </div>
      <div className="request-body" ref={body}>
        {request.questions.map((question, index) =>
          index === step ? (
            <fieldset key={index}>
              <legend>
                <span className="eyebrow">{question.header} </span>
                <span className="question-text">{question.question}</span>
              </legend>
              <div className="question-options">
                {question.options.map((option) => (
                  <label
                    key={option.label}
                    className="question-option"
                    aria-label={`${option.label} ${option.description}`}
                  >
                    <input
                      type={question.multiple ? 'checkbox' : 'radio'}
                      name={`${request.id}-${index}`}
                      checked={
                        (selected[index] ?? []).includes(option.label) &&
                        (question.multiple || !custom[index])
                      }
                      onChange={() => {
                        setSelected((old) =>
                          old.map((values, i) =>
                            i !== index
                              ? values
                              : question.multiple
                                ? values.includes(option.label)
                                  ? values.filter((item) => item !== option.label)
                                  : [...values, option.label]
                                : [option.label],
                          ),
                        );
                        if (!question.multiple)
                          setCustom((old) => old.map((value, i) => (i === index ? '' : value)));
                      }}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
              {question.custom !== false && (
                <input
                  aria-label={`Свой ответ: ${question.header}`}
                  placeholder="Или свой вариант…"
                  value={custom[index] ?? ''}
                  onChange={(event) =>
                    setCustom((old) => old.map((value, i) => (i === index ? event.target.value : value)))
                  }
                />
              )}
            </fieldset>
          ) : null,
        )}
      </div>
      <div className="request-actions">
        <KeyboardDismiss />
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => (step > 0 ? setStep(step - 1) : void reply(true))}
        >
          {step > 0 ? 'Назад' : 'Пропустить'}
        </Button>
        <Button
          busy={busy}
          disabled={!answers[step]?.length}
          onClick={() => (step < request.questions.length - 1 ? setStep(step + 1) : void reply())}
        >
          {step < request.questions.length - 1 ? 'Далее' : 'Отправить ответ'}
          <ChevronRight size={16} />
        </Button>
      </div>
    </section>
  );
}

export function PermissionCard({ request }: { request: PendingPermission }) {
  const { client, perform, setData, notify, haptic } = usePocket();
  const [busy, setBusy] = useState(false);
  const [confirmAlways, setConfirmAlways] = useState(false);
  async function reply(value: 'once' | 'always' | 'reject') {
    if (!client) return;
    setBusy(true);
    await perform(async () => {
      try {
        await client.request(`/permission/${encodeURIComponent(request.id)}/reply`, {
          method: 'POST',
          data: { reply: value },
          directory: request.directory,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404)
          notify('Этот запрос уже обработан на другом устройстве.');
        else throw error;
      }
      setData((previous) => ({
        ...previous,
        permissions: previous.permissions.filter((item) => item.id !== request.id),
      }));
      haptic();
    });
    setBusy(false);
  }
  return (
    <section className="request-card permission-card" aria-label="Запрос разрешения">
      <div className="request-heading">
        <span className="request-icon">
          <ShieldCheck size={20} />
        </span>
        <span>
          <strong>Разрешить действие?</strong>
          <small>Инструмент: {request.permission}</small>
        </span>
      </div>
      <div className="request-body">
        <div className="permission-patterns">
          {request.patterns.map((pattern, index) => (
            <code key={index}>{pattern}</code>
          ))}
        </div>
        {Object.keys(request.metadata).length > 0 && (
          <details className="tool-details">
            <summary>Параметры действия</summary>
            <pre>{JSON.stringify(request.metadata, null, 2)}</pre>
          </details>
        )}
        {confirmAlways && (
          <p className="form-hint">
            OpenCode запомнит разрешение для указанных шаблонов:{' '}
            {(request.always.length ? request.always : request.patterns).join(', ')}.
          </p>
        )}
      </div>
      <div className="request-actions">
        <KeyboardDismiss />
        <Button variant="ghost" disabled={busy} onClick={() => void reply('reject')}>
          <X size={15} />
          Отклонить
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => (confirmAlways ? void reply('always') : setConfirmAlways(true))}
        >
          {confirmAlways ? 'Да, запомнить' : 'Запомнить'}
        </Button>
        <Button busy={busy} onClick={() => void reply('once')}>
          <Check size={16} />
          Разрешить
        </Button>
      </div>
    </section>
  );
}

export function RequestSheet({
  questions,
  permissions,
}: {
  questions: PendingQuestion[];
  permissions: PendingPermission[];
}) {
  const requests = [
    ...questions.map((request, index) => ({
      key: `question.${request.id}`,
      label: `Вопрос ${index + 1}: ${request.questions[0]?.header ?? 'Ответ'}`,
      content: <QuestionCard request={request} />,
    })),
    ...permissions.map((request, index) => ({
      key: `permission.${request.id}`,
      label: `Доступ ${index + 1}: ${request.permission}`,
      content: <PermissionCard request={request} />,
    })),
  ];
  const [selected, setSelected] = useState<string>();
  const active = requests.some((request) => request.key === selected) ? selected : requests[0]?.key;
  return (
    <div className="request-sheet">
      {requests.length > 1 && (
        <select
          aria-label="Выбрать запрос"
          value={active}
          onChange={(event) => setSelected(event.target.value)}
        >
          {requests.map((request) => (
            <option key={request.key} value={request.key}>
              {request.label}
            </option>
          ))}
        </select>
      )}
      {requests.map((request) => (
        <div className="request-sheet-item" key={request.key} hidden={active !== request.key}>
          {request.content}
        </div>
      ))}
    </div>
  );
}
