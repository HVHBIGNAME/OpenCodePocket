import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { PageDeck } from './PageDeck';
import {
  ArrowLeft,
  Check,
  Circle,
  FileCode2,
  Folder,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Search,
} from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { errorMessage } from '../lib/api';
import type { FileContent, FileNode, Session, SnapshotFileDiff, Todo } from '../types';
import { CodeBlockForFile } from './file-view';
import { Button, EmptyState } from './ui';
import { matchesSearch } from '../lib/session-search';

export function SessionDetails({
  session,
  tab,
  onBackChange,
  active = true,
  preload = false,
  gestureSurface,
}: {
  session: Session;
  tab: 'diff' | 'todos' | 'files';
  onBackChange?: (handler?: () => void, label?: string) => void;
  active?: boolean;
  preload?: boolean;
  gestureSurface?: RefObject<HTMLElement | null>;
}) {
  const { client, data, setData } = usePocket();
  const diffs = data.diffs[session.id] ?? [];
  const todos = data.todos[session.id] ?? [];
  const liveRef = useRef(data);
  useLayoutEffect(() => {
    liveRef.current = data;
  }, [data]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const fileLists = useRef(new Map<string, FileNode[]>());
  const [path, setPath] = useState('');
  const [file, setFile] = useState<{ path: string; content: FileContent }>();
  const [filePath, setFilePath] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const remoteQuery = tab === 'files' ? query.trim() : '';
  const parentPath = path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .slice(0, -1)
    .join('/');
  const back = useCallback(() => {
    if (filePath) {
      setFilePath('');
      setFile(undefined);
    } else {
      setFiles(fileLists.current.get(parentPath) ?? []);
      setPath(parentPath);
    }
  }, [filePath, parentPath]);
  useLayoutEffect(() => {
    if (!active) return;
    if (tab === 'files' && (filePath || path))
      onBackChange?.(back, filePath ? 'Назад к файлам' : 'На уровень выше');
    else onBackChange?.();
    return () => onBackChange?.();
  }, [active, tab, filePath, path, onBackChange, back]);
  const visible = active || preload;
  useEffect(() => {
    if (!client || !visible) return;
    const controller = new AbortController();
    const before = liveRef.current;
    setBusy(true);
    setError('');
    const load = async () => {
      if (tab === 'diff') {
        const result = await client.request<SnapshotFileDiff[]>(
          `/session/${encodeURIComponent(session.id)}/diff`,
          { directory: session.directory, signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setData((previous) =>
            previous.diffs[session.id] !== before.diffs[session.id]
              ? previous
              : { ...previous, diffs: { ...previous.diffs, [session.id]: result } },
          );
      } else if (tab === 'todos') {
        const result = await client.request<Todo[]>(`/session/${encodeURIComponent(session.id)}/todo`, {
          directory: session.directory,
          signal: controller.signal,
        });
        if (!controller.signal.aborted)
          setData((previous) =>
            previous.todos[session.id] !== before.todos[session.id]
              ? previous
              : { ...previous, todos: { ...previous.todos, [session.id]: result } },
          );
      } else if (filePath) {
        const content = await client.request<FileContent>(
          `/file/content?path=${encodeURIComponent(filePath)}`,
          { directory: session.directory, signal: controller.signal },
        );
        if (!controller.signal.aborted) setFile({ path: filePath, content });
      } else if (remoteQuery) {
        const result = await client.request<string[]>(
          `/find/file?query=${encodeURIComponent(remoteQuery)}&dirs=false&limit=100`,
          { directory: session.directory, signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setFiles(
            result.map((name) => ({ name, path: name, absolute: name, type: 'file', ignored: false })),
          );
      } else {
        const result = await client.request<FileNode[]>(`/file?path=${encodeURIComponent(path)}`, {
          directory: session.directory,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          fileLists.current.set(path, result);
          setFiles(result);
        }
      }
    };
    const timer = setTimeout(
      () =>
        void load()
          .catch((error: unknown) => {
            if (!controller.signal.aborted) setError(errorMessage(error));
          })
          .finally(() => {
            if (!controller.signal.aborted) setBusy(false);
          }),
      remoteQuery && !filePath ? 250 : 0,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, session.id, session.directory, tab, path, filePath, remoteQuery, reload, setData, visible]);
  function openFile(node: FileNode) {
    setBusy(true);
    setFile(undefined);
    if (node.type === 'directory') {
      setFiles(fileLists.current.get(node.path) ?? []);
      setPath(node.path);
      setFilePath('');
      return;
    }
    setFilePath(node.path);
  }
  const content = (
    <div className="session-details">
      <div className="details-topbar">
        <span className="eyebrow">
          {tab === 'diff'
            ? `${diffs.length} изменённых файлов`
            : tab === 'todos'
              ? `${todos.filter((todo) => todo.status === 'completed').length} / ${todos.length} задач`
              : filePath || (query.trim() ? 'Поиск по проекту' : path || 'Корень проекта')}
        </span>
        <Button variant="ghost" busy={busy} onClick={() => setReload((old) => old + 1)}>
          <RefreshCw size={14} />
          Обновить
        </Button>
      </div>
      {!filePath && (
        <label className="search-field details-search">
          <Search size={18} />
          <input
            disabled={!active}
            aria-label={
              tab === 'files'
                ? 'Поиск файлов в проекте'
                : tab === 'diff'
                  ? 'Поиск изменённых файлов'
                  : 'Поиск задач'
            }
            placeholder={
              tab === 'files'
                ? 'Найти файл в проекте'
                : tab === 'diff'
                  ? 'Фильтр по пути файла'
                  : 'Найти задачу'
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (tab === 'files') setFiles([]);
            }}
          />
          {query && (
            <button aria-label="Очистить поиск" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </label>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <Button variant="ghost" onClick={() => setReload((value) => value + 1)}>
            Повторить
          </Button>
        </div>
      )}
      {busy && (
        <output className="loading-state">
          <LoaderCircle size={18} className="spin" />
          Загрузка…
        </output>
      )}
      {tab === 'diff' && (
        <>
          {diffs
            .filter((diff) => matchesSearch(diff.file ?? '', query))
            .map((diff, index) => (
              <details open className="diff-file" key={diff.file ?? index}>
                <summary>
                  <FileCode2 size={17} />
                  <strong>{diff.file ?? `Изменение ${index + 1}`}</strong>
                  <span className="diff-summary">
                    <span>+{diff.additions}</span>
                    <span>−{diff.deletions}</span>
                  </span>
                </summary>
                <DiffContent diff={diff} />
              </details>
            ))}
          {!diffs.some((diff) => matchesSearch(diff.file ?? '', query)) && !busy && !error && (
            <EmptyState
              icon={<GitBranch size={30} />}
              title={query ? 'Файлы не найдены' : 'Пока без изменений'}
            >
              {query ? 'Измените запрос поиска.' : 'Здесь появятся патчи файлов из этой сессии.'}
            </EmptyState>
          )}
        </>
      )}
      {tab === 'todos' && (
        <div className="todo-list">
          {todos
            .filter((todo) => matchesSearch(todo.content, query))
            .map((todo, index) => (
              <div className={`todo-item todo-${todo.status}`} key={index}>
                <span>
                  {todo.status === 'completed' ? (
                    <Check size={18} />
                  ) : todo.status === 'in_progress' ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : (
                    <Circle size={18} />
                  )}
                </span>
                <strong>{todo.content}</strong>
                <span className="eyebrow">
                  {todo.priority === 'high' ? 'Высокий' : todo.priority === 'low' ? 'Низкий' : 'Обычный'}
                </span>
              </div>
            ))}
          {!todos.some((todo) => matchesSearch(todo.content, query)) && !busy && !error && (
            <EmptyState icon={<Check size={30} />} title={query ? 'Задачи не найдены' : 'План ещё не создан'}>
              {query ? 'Измените запрос поиска.' : 'OpenCode добавит задачи по мере работы.'}
            </EmptyState>
          )}
        </div>
      )}
      {tab === 'files' && (
        <>
          {(path || filePath) && (
            <Button variant="ghost" onClick={back}>
              <ArrowLeft size={16} />
              Назад
            </Button>
          )}
          {filePath ? (
            file && <CodeBlockForFile path={file.path} content={file.content} />
          ) : (
            <FileList files={files} onOpen={openFile}>
              {!files.length && !busy && !error && (
                <EmptyState
                  icon={<Folder size={30} />}
                  title={query.trim() ? 'Файлы не найдены' : 'В папке пусто'}
                >
                  {query.trim()
                    ? 'Попробуйте другую часть имени или пути.'
                    : 'Выберите другую папку проекта.'}
                </EmptyState>
              )}
            </FileList>
          )}
        </>
      )}
    </div>
  );
  if (tab !== 'files') return content;
  return (
    <PageDeck
      name="files"
      pageKey={filePath ? `file:${filePath}` : `folder:${path}`}
      scroll
      enabled={active}
      gestureSurface={gestureSurface}
      onBack={(key) => {
        if (key.startsWith('file:')) setFilePath(key.slice(5));
        else {
          const parent = key.slice(7);
          setFilePath('');
          setFile(undefined);
          setPath(parent);
          if (!remoteQuery) setFiles(fileLists.current.get(parent) ?? []);
        }
      }}
    >
      {content}
    </PageDeck>
  );
}

function FileList({
  files,
  onOpen,
  children,
}: {
  files: FileNode[];
  onOpen?: (node: FileNode) => void;
  children?: ReactNode;
}) {
  return (
    <div className="file-list">
      {files.map((node) => (
        <button key={node.path} onClick={() => onOpen?.(node)}>
          {node.type === 'directory' ? <Folder size={19} /> : <FileCode2 size={18} />}
          <span>{node.name}</span>
          <span className="eyebrow">
            {node.ignored ? 'Игнорируется' : node.type === 'directory' ? 'Папка' : 'Файл'}
          </span>
        </button>
      ))}
      {children}
    </div>
  );
}

function DiffContent({ diff }: { diff: SnapshotFileDiff }) {
  const legacy = diff as SnapshotFileDiff & { before?: string; after?: string };
  if (diff.patch)
    return (
      <pre className="diff-lines">
        {diff.patch.split('\n').map((line, index) => (
          <span
            className={
              line.startsWith('+')
                ? 'line-add'
                : line.startsWith('-')
                  ? 'line-remove'
                  : line.startsWith('@@')
                    ? 'line-info'
                    : ''
            }
            key={index}
          >
            {line || ' '}
            <br />
          </span>
        ))}
      </pre>
    );
  if (legacy.before !== undefined || legacy.after !== undefined)
    return (
      <div className="legacy-diff">
        <div>
          <span className="eyebrow">ДО</span>
          <pre>{legacy.before}</pre>
        </div>
        <div>
          <span className="eyebrow">ПОСЛЕ</span>
          <pre>{legacy.after}</pre>
        </div>
      </div>
    );
  return (
    <p className="form-hint">
      Сервер предоставил статистику без текста патча. Актуальный файл доступен на вкладке «Файлы».
    </p>
  );
}
