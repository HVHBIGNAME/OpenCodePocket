import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Circle, FileCode2, Folder, GitBranch, LoaderCircle, RefreshCw } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { errorMessage } from '../lib/api';
import type { FileContent, FileNode, Session, SnapshotFileDiff, Todo } from '../types';
import { CodeBlockForFile } from './file-view';
import { Button, EmptyState } from './ui';

export function SessionDetails({ session, tab }: { session: Session; tab: 'diff' | 'todos' | 'files' }) {
  const { client, notify } = usePocket();
  const [diffs, setDiffs] = useState<SnapshotFileDiff[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [path, setPath] = useState('');
  const [file, setFile] = useState<{ path: string; content: FileContent }>();
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    setBusy(true);
    void (async () => {
      if (tab === 'diff') {
        const result = await client.request<SnapshotFileDiff[]>(`/session/${encodeURIComponent(session.id)}/diff`, { directory: session.directory, signal: controller.signal });
        if (!controller.signal.aborted) setDiffs(result);
      } else if (tab === 'todos') {
        const result = await client.request<Todo[]>(`/session/${encodeURIComponent(session.id)}/todo`, { directory: session.directory, signal: controller.signal });
        if (!controller.signal.aborted) setTodos(result);
      } else {
        const result = await client.request<FileNode[]>(`/file?path=${encodeURIComponent(path)}`, { directory: session.directory, signal: controller.signal });
        if (!controller.signal.aborted) setFiles(result);
      }
    })().catch((error: unknown) => { if (!controller.signal.aborted) notify(errorMessage(error), true); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [client, session.id, session.directory, tab, path, reload, notify]);
  async function openFile(node: FileNode) {
    if (node.type === 'directory') { setPath(node.path); setFile(undefined); return; }
    if (!client) return;
    setBusy(true);
    try { setFile({ path: node.path, content: await client.request<FileContent>(`/file/content?path=${encodeURIComponent(node.path)}`, { directory: session.directory }) }); }
    catch (error) { notify(errorMessage(error), true); }
    finally { setBusy(false); }
  }
  return <div className="session-details"><div className="details-topbar"><span className="eyebrow">{tab === 'diff' ? `${diffs.length} ИЗМЕНЁННЫХ ФАЙЛОВ` : tab === 'todos' ? `${todos.filter((todo) => todo.status === 'completed').length} / ${todos.length} ЗАДАЧ` : path || 'КОРЕНЬ ПРОЕККТА'}</span><Button variant="ghost" busy={busy} onClick={() => setReload((old) => old + 1)}><RefreshCw size={14}/>Обновить</Button></div>
    {tab === 'diff' && <>{diffs.map((diff, index) => <details open className="diff-file" key={diff.file ?? index}><summary><FileCode2 size={17}/><strong>{diff.file ?? `Изменение ${index + 1}`}</strong><span className="diff-summary"><span>+{diff.additions}</span><span>−{diff.deletions}</span></span></summary><DiffContent diff={diff}/></details>)}{!diffs.length && !busy && <EmptyState icon={<GitBranch size={30}/>} title="Пока без изменений">Здесь появятся патчи файлов из этой сессии.</EmptyState>}</>}
    {tab === 'todos' && <div className="todo-list">{todos.map((todo, index) => <div className={`todo-item todo-${todo.status}`} key={index}><span>{todo.status === 'completed' ? <Check size={18}/> : todo.status === 'in_progress' ? <LoaderCircle size={18} className="spin"/> : <Circle size={18}/>}</span><strong>{todo.content}</strong><span className="eyebrow">{todo.priority}</span></div>)}{!todos.length && !busy && <EmptyState icon={<Check size={30}/>} title="План ещё не создан">OpenCode добавит задачи по мере работы.</EmptyState>}</div>}
    {tab === 'files' && <>{(path || file) && <Button variant="ghost" onClick={() => { if (file) setFile(undefined); else setPath(path.replace(/[\\/]+$/, '').split(/[\\/]/).slice(0, -1).join('/')); }}><ArrowLeft size={16}/>Назад</Button>}{file ? <CodeBlockForFile path={file.path} content={file.content}/> : <div className="file-list">{files.map((node) => <button key={node.path} onClick={() => void openFile(node)}>{node.type === 'directory' ? <Folder size={19}/> : <FileCode2 size={18}/>}<span>{node.name}</span><span className="eyebrow">{node.ignored ? 'IGNORED' : node.type === 'directory' ? 'DIR' : 'FILE'}</span></button>)}{!files.length && !busy && <EmptyState icon={<Folder size={30}/>} title="В папке пусто">Выберите другую папку проекта.</EmptyState>}</div>}</>}
  </div>;
}

function DiffContent({ diff }: { diff: SnapshotFileDiff }) {
  const legacy = diff as SnapshotFileDiff & { before?: string; after?: string };
  if (diff.patch) return <pre className="diff-lines">{diff.patch.split('\n').map((line, index) => <span className={line.startsWith('+') ? 'line-add' : line.startsWith('-') ? 'line-remove' : line.startsWith('@@') ? 'line-info' : ''} key={index}>{line || ' '}<br/></span>)}</pre>;
  if (legacy.before !== undefined || legacy.after !== undefined) return <div className="legacy-diff"><div><span className="eyebrow">ДО</span><pre>{legacy.before}</pre></div><div><span className="eyebrow">ПОСЛЕ</span><pre>{legacy.after}</pre></div></div>;
  return <p className="form-hint">Сервер предоставил статистику без текста патча. Актуальный файл доступен на вкладке «Файлы».</p>;
}
