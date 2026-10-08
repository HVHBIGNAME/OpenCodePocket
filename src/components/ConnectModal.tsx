import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronRight, Laptop, Plus, QrCode, Trash2 } from 'lucide-react';
import { APP_VERSION, normalizeServerUrl, parsePairing } from '../../shared/protocol';
import { usePocket } from '../store/PocketProvider';
import { errorMessage, pairDevice } from '../lib/api';
import { platform } from '../lib/native';
import { captureDiagnostic } from '../lib/diagnostics';
import { Button, CopyButton, ExternalLink, IconButton, Modal } from './ui';

const installCommand = `npx --yes --package=https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v${APP_VERSION}/hvhbigname-occ-bridge-${APP_VERSION}.tgz occ-pocket install`;

export function ConnectModal() {
  const {
    setConnectOpen,
    connect,
    connections,
    client,
    perform,
    forget,
    pairingInput,
    setPairingInput,
    connectIntent,
    setConnectIntent,
  } = usePocket();
  const [adding, setAdding] = useState(
    !connections.length || Boolean(pairingInput) || connectIntent === 'scan',
  );
  const [mode, setMode] = useState<'pair' | 'direct'>('pair');
  const [input, setInput] = useState(pairingInput);
  const [manual, setManual] = useState(connectIntent === 'manual');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('opencode');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('Мой компьютер');
  const [directory, setDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removeID, setRemoveID] = useState<string>();
  const scanStarted = useRef(false);
  useEffect(() => {
    if (pairingInput) {
      setInput(pairingInput);
      setAdding(true);
      setManual(true);
      setPairingInput('');
    }
  }, [pairingInput, setPairingInput]);
  useEffect(() => {
    if (connectIntent === 'scan' && !scanStarted.current) {
      scanStarted.current = true;
      setConnectIntent('manual');
      void scan();
    }
  }, [connectIntent, setConnectIntent]);

  async function scan() {
    setError('');
    try {
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } =
        await import('@capacitor/barcode-scanner');
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: 'Сканируй QR-код OCC на компьютере',
        cancelButtonAccessibilityLabel: 'Отмена',
      });
      parsePairing(result.ScanResult);
      setInput(result.ScanResult);
      setManual(true);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }
  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (mode === 'pair') {
        const pair = parsePairing(input);
        await connect(
          await pairDevice(
            pair.url,
            pair.code,
            `${platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android' : 'Preview'} · OCC`,
          ),
        );
      } else
        await connect({
          id: crypto.randomUUID(),
          name,
          url: normalizeServerUrl(url),
          mode: 'direct',
          username,
          credential: password,
          directory: directory || undefined,
        });
    } catch (failure) {
      captureDiagnostic(failure, { kind: 'action', operation: 'connect' });
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={adding ? 'Подключить компьютер' : 'Подключения'} onClose={() => setConnectOpen(false)}>
      {!adding ? (
        <div className="form-stack">
          <div className="saved-connections">
            {connections.map((connection) => (
              <div key={connection.id} className="saved-connection">
                <Laptop size={23} />
                <button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void perform(() => connect(connection)).finally(() => setBusy(false));
                  }}
                >
                  <strong>{connection.name}</strong>
                  <small>{new URL(connection.url).hostname}</small>
                </button>
                {client?.connection.id === connection.id && <Check size={19} className="accent" />}
                {removeID === connection.id ? (
                  <Button variant="danger" onClick={() => void perform(() => forget(connection.id))}>
                    Забыть?
                  </Button>
                ) : (
                  <IconButton label={`Забыть ${connection.name}`} onClick={() => setRemoveID(connection.id)}>
                    <Trash2 size={19} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
          <Button onClick={() => setAdding(true)}>
            <Plus size={20} />
            Добавить компьютер
          </Button>
        </div>
      ) : (
        <>
          {connections.length > 0 && (
            <button className="text-action" onClick={() => setAdding(false)}>
              ← К сохранённым подключениям
            </button>
          )}
          <div className="segmented full">
            <button className={mode === 'pair' ? 'active' : ''} onClick={() => setMode('pair')}>
              OCC-мост
            </button>
            <button className={mode === 'direct' ? 'active' : ''} onClick={() => setMode('direct')}>
              Свой сервер
            </button>
          </div>
          <form
            className="form-stack connect-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {mode === 'pair' ? (
              <>
                <button type="button" className="scan-card" onClick={() => void scan()}>
                  <span className="scan-icon">
                    <QrCode size={34} />
                  </span>
                  <span>
                    <strong>Сканировать QR-код</strong>
                    <small>Одноразовое безопасное подключение</small>
                  </span>
                  <ChevronRight size={20} />
                </button>
                {!manual && !input ? (
                  <button type="button" className="text-action" onClick={() => setManual(true)}>
                    Вставить ссылку вручную
                  </button>
                ) : (
                  <label>
                    Ссылка подключения
                    <textarea
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder="occ://pair?url=…&code=…"
                      rows={3}
                      spellCheck={false}
                      autoCapitalize="none"
                    />
                  </label>
                )}
                <p className="form-hint">
                  QR-код действует 10 минут. Для нового кода: <code>occ-pocket pair</code> на компьютере.
                </p>
              </>
            ) : (
              <>
                <label>
                  Адрес OpenCode
                  <input
                    type="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://opencode.example.com"
                    required
                    autoCapitalize="none"
                  />
                </label>
                <label>
                  Название
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={100}
                  />
                </label>
                <div className="field-pair">
                  <label>
                    Логин
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoCapitalize="none"
                    />
                  </label>
                  <label>
                    Пароль
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                </div>
                <details className="extra-options">
                  <summary>Папка проекта</summary>
                  <label>
                    Путь на компьютере
                    <input
                      value={directory}
                      onChange={(event) => setDirectory(event.target.value)}
                      placeholder="/home/user/project"
                      spellCheck={false}
                    />
                  </label>
                </details>
              </>
            )}
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <Button type="submit" busy={busy} disabled={mode === 'pair' ? !input.trim() : !url.trim()}>
              Подключиться
              <ArrowRight size={19} />
            </Button>
          </form>
          <details className="connect-instructions">
            <summary>Как подготовить компьютер?</summary>
            <ol>
              <li>
                <ExternalLink
                  href={`https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v${APP_VERSION}/Install-Pocket.cmd`}
                >
                  Windows: скачать установщик
                </ExternalLink>
              </li>
              <li>
                Или выполни команду на ПК с Node.js 22+:
                <div className="command-block">
                  <code>{installCommand}</code>
                  <CopyButton text={installCommand} />
                </div>
              </li>
              <li>Перезапусти OpenCode.</li>
              <li>
                В OpenCode выполни <code>/pocket-qr</code>.
              </li>
            </ol>
            <ExternalLink href="https://github.com/HVHBIGNAME/OpenCodePocket/blob/main/docs/connect.md">
              Полная инструкция
            </ExternalLink>
          </details>
        </>
      )}
    </Modal>
  );
}
