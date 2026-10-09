import { Children, isValidElement, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText } from 'lucide-react';
import { CopyButton } from './ui';

export function CodeBlock({ children }: { children: ReactNode }) {
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
