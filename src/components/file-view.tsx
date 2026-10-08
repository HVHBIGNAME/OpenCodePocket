import type { FileContent } from '../types';
import { CopyButton } from './ui';

export function CodeBlockForFile({ path, content }: { path: string; content: FileContent }) {
  const binary = content.encoding === 'base64';
  return (
    <div className="code-block file-view">
      <div className="code-block-title">
        <span className="mono">{path}</span>
        {!binary && <CopyButton text={content.content} />}
      </div>
      {binary ? (
        content.mimeType?.startsWith('image/') ? (
          <img src={`data:${content.mimeType};base64,${content.content}`} alt={path} />
        ) : (
          <p className="form-hint">Бинарный файл · {content.mimeType ?? 'unknown'}</p>
        )
      ) : (
        <pre>
          <code>{content.content}</code>
        </pre>
      )}
    </div>
  );
}
