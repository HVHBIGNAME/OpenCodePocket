import { Children, isValidElement, memo, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, Check, ChevronRight, FileCode2, FileText, LoaderCircle, Terminal, X } from 'lucide-react';
import { clock, money, number } from '../lib/format';
import type { MessageEntry, Part } from '../types';
import { CopyButton } from './ui';
import { isAbortedTool, isGenerationCancelled } from '../lib/session-errors';

function CodeBlock({ children }: { children: ReactNode }) {
  const child = Children.toArray(children)[0];
  const props = isValidElement<{ children?: string; className?: string }>(child) ? child.props : undefined;
  const text = typeof props?.children === 'string' ? props.children : '';
  const language = props?.className?.replace('language-', '') ?? 'code';
  return (
    <div className="code-block">
      <div className="code-block-title">
        <span className="mono">{language}</span>
        <CopyButton text={text} />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export function RichText({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="markdown-image-placeholder">
              <FileText size={15} />
              {alt ?? 'Изображение из ответа'}
            </span>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

function ReasoningView({ part }: { part: Extract<Part, { type: 'reasoning' }> }) {
  const [expanded, setExpanded] = useState<boolean>();
  const hasText = Boolean(part.text.trim());
  return (
    <details
      className="reasoning-block"
      open={expanded ?? hasText}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <Brain size={15} />
        Ход рассуждений{!hasText && (part.time.end ? ' · текст не передан' : '…')}
        <ChevronRight size={14} />
      </summary>
      {hasText ? (
        <RichText text={part.text} />
      ) : (
        <p className="form-hint">
          {part.time.end ? 'Сервер не передал текст рассуждений.' : 'Модель обдумывает ответ.'}
        </p>
      )}
    </details>
  );
}

function PartView({ part }: { part: Part }) {
  switch (part.type) {
    case 'text':
      return part.ignored ? null : <RichText text={part.text} />;
    case 'reasoning':
      return <ReasoningView part={part} />;
    case 'tool': {
      const state = part.state;
      return (
        <details className={`tool-block tool-${state.status}`}>
          <summary>
            <span className="tool-status">
              {state.status === 'completed' ? (
                <Check size={14} />
              ) : state.status === 'error' ? (
                <X size={14} />
              ) : (
                <LoaderCircle size={14} className="spin" />
              )}
            </span>
            <Terminal size={15} />
            <strong>{part.tool}</strong>
            <span>{'title' in state ? state.title : state.status === 'pending' ? 'В очереди' : ''}</span>
            <ChevronRight size={14} />
          </summary>
          <div className="tool-body">
            <span className="eyebrow">INPUT</span>
            <CodeBlock>
              <code className="language-json">{JSON.stringify(state.input, null, 2)}</code>
            </CodeBlock>
            {state.status === 'completed' && (
              <>
                <span className="eyebrow">OUTPUT</span>
                <CodeBlock>
                  <code className="language-output">{state.output}</code>
                </CodeBlock>
              </>
            )}
            {state.status === 'error' && (
              <p className={isAbortedTool(state.error) ? 'system-part' : 'inline-error'}>
                {isAbortedTool(state.error) ? 'Выполнение отменено' : state.error}
              </p>
            )}
          </div>
        </details>
      );
    }
    case 'file':
      return (
        <div className="file-attachment">
          <FileText size={18} />
          <span>{part.filename ?? part.mime}</span>
          {part.url.startsWith('data:image/') && (
            <img src={part.url} alt={part.filename ?? 'Вложение'} loading="lazy" />
          )}
        </div>
      );
    case 'patch':
      return (
        <details className="tool-block">
          <summary>
            <FileCode2 size={16} />
            Изменены файлы<span>{part.files.length}</span>
          </summary>
          <div className="tool-body">
            {part.files.map((file) => (
              <code className="patch-file" key={file}>
                {file}
              </code>
            ))}
          </div>
        </details>
      );
    case 'subtask':
      return (
        <details className="tool-block">
          <summary>
            <Terminal size={15} />
            Подзадача · {part.agent}
            <span>{part.description}</span>
          </summary>
          <div className="tool-body">
            <RichText text={part.prompt} />
          </div>
        </details>
      );
    case 'agent':
      return <div className="agent-part">@{part.name}</div>;
    case 'compaction':
      return <div className="system-part">Контекст сессии сжат</div>;
    case 'retry':
      return (
        <div className="inline-error">
          Повтор {part.attempt}: {part.error.data.message}
        </div>
      );
    default:
      return null;
  }
}

export const MessageView = memo(function MessageView({ entry }: { entry: MessageEntry }) {
  const assistant = entry.info.role === 'assistant';
  const text = entry.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
  return (
    <article className={`message ${assistant ? 'message-assistant' : 'message-user'}`}>
      <div className="message-content">
        <header className="message-header">
          <strong>{assistant ? 'OpenCode' : 'Ты'}</strong>
          {entry.info.role === 'assistant' && (
            <span className="message-model mono">{entry.info.modelID}</span>
          )}
          <time>{clock(entry.info.time.created)}</time>
          <CopyButton text={text} />
        </header>
        <div className="message-parts">
          {entry.parts.map((part) => (
            <PartView key={part.id} part={part} />
          ))}
        </div>
        {entry.info.role === 'assistant' && entry.info.error && (
          <p className={isGenerationCancelled(entry.info.error) ? 'system-part' : 'inline-error'}>
            {isGenerationCancelled(entry.info.error)
              ? 'Генерация отменена'
              : 'message' in entry.info.error.data
                ? String(entry.info.error.data.message)
                : entry.info.error.name}
          </p>
        )}
        {entry.info.role === 'assistant' && entry.info.time.completed && !entry.info.error && (
          <footer className="message-footer">
            <Check size={12} />
            <span>
              {number(entry.info.tokens.input)} in · {number(entry.info.tokens.output)} out
            </span>
            <span>{money(entry.info.cost)}</span>
          </footer>
        )}
      </div>
    </article>
  );
});
