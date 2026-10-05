import { useEffect, useState } from 'react';
import { ArrowRight, Check, Laptop, Link2, QrCode, Radio, ShieldCheck, Trash2 } from 'lucide-react';
import { normalizeServerUrl, parsePairing } from '../../shared/protocol';
import { usePocket } from '../store/PocketProvider';
import { errorMessage, pairDevice } from '../lib/api';
import { isNative, platform } from '../lib/native';
import { Button, CopyButton, ExternalLink, IconButton, Modal } from './ui';

const installCommand = 'npx --yes --package=https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.0/hvhbigname-occ-bridge-1.0.0.tgz occ-pocket install --tunnel';

export function ConnectModal() {
  const { setConnectOpen, connect, connections, client, perform, forget, pairingInput, setPairingInput } = usePocket();
  const [mode, setMode] = useState<'pair' | 'direct'>('pair');
  const [input, setInput] = useState(pairingInput);
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('opencode');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('Мой компьютер');
  const [directory, setDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removeID, setRemoveID] = useState<string>();
  useEffect(() => { if (pairingInput) { setInput(pairingInput); setPairingInput(''); } }, [pairingInput, setPairingInput]);
  async function submit() {
    setBusy(true); setError('');
    try {
      if (mode === 'pair') {
        const pair = parsePairing(input);
        await connect(await pairDevice(pair.url, pair.code, `${platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android' : 'Browser'} · OCC`));
      } else await connect({ id: crypto.randomUUID(), name, url: normalizeServerUrl(url), mode: 'direct', username, credential: password, directory: directory || undefined });
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function scan() {
    setError('');
    try {
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner');
      const result = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE, scanInstructions: 'Наведите камеру на QR-код OCC на компьютере', scanText: 'Подключить', cancelButtonAccessibilityLabel: 'Отмена' });
      parsePairing(result.ScanResult); setInput(result.ScanResult);
    } catch (failure) { setError(errorMessage(failure)); }
  }
  return <Modal title="Большой экран. Маленькое расстояние." subtitle="Подключи свой OpenCode — сессии уже ждут." onClose={() => setConnectOpen(false)} wide>
    {connections.length > 0 && <div className="saved-connections">{connections.map((connection) => <div key={connection.id} className="saved-connection"><Laptop size={20}/><button disabled={busy} onClick={() => { setBusy(true); void perform(() => connect(connection)).finally(() => setBusy(false)); }}><strong>{connection.name}</strong><small>{new URL(connection.url).hostname}</small></button>{client?.connection.id === connection.id && <Check size={16} className="accent"/>}{removeID === connection.id ? <Button variant="danger" onClick={() => void perform(() => forget(connection.id))}>Забыть</Button> : <IconButton label={`Забыть ${connection.name}`} onClick={() => setRemoveID(connection.id)}><Trash2 size={16}/></IconButton>}</div>)}</div>}
    <div className="connect-layout"><div className="connect-guide"><div className="connect-art"><QrCode size={58}/><span className="scan-corner tl"/><span className="scan-corner tr"/><span className="scan-corner bl"/><span className="scan-corner br"/></div><span className="eyebrow">PAIR. PROMPT. SHIP.</span><h3>Пара кликов —<br/>и ты в потоке.</h3><ol><li><strong>Установи мост на ПК</strong><span>Node.js 22+ и cloudflared для автотуннеля.</span></li><li><strong>Перезапусти OpenCode</strong><span><code>opencode --port 4096</code></span></li><li><strong>Скопируй ссылку или сканируй QR</strong><span>Страница pairing.html или команда occ-pocket pair.</span></li></ol><ExternalLink href="https://github.com/HVHBIGNAME/OpenCodePocket/blob/main/docs/connect.md">Инструкция по подключению</ExternalLink></div>
    <div className="connect-form"><div className="segmented full"><button className={mode === 'pair' ? 'active' : ''} onClick={() => setMode('pair')}><Link2 size={15}/>OCC-мост</button><button className={mode === 'direct' ? 'active' : ''} onClick={() => setMode('direct')}><Radio size={15}/>Сервер</button></div>
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {mode === 'pair' ? <><label>Команда для компьютера<span className="command-block"><code>{installCommand}</code><CopyButton text={installCommand}/></span></label><Button type="button" variant="secondary" onClick={() => void scan()}><QrCode size={18}/>Сканировать QR-код</Button><div className="or-divider"><span>или вставь ссылку</span></div><label>Ссылка подключения<textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="occ://pair?url=…&code=…" rows={3} spellCheck={false} autoCapitalize="none" /></label><p className="form-hint">QR-код действует 10 минут и только один раз.</p></> : <><label>Название<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100}/></label><label>Адрес OpenCode<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://opencode.example.com" required autoCapitalize="none" /></label><div className="field-pair"><label>Логин<input value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="none" /></label><label>Пароль<input value={password} type="password" onChange={(event) => setPassword(event.target.value)} autoComplete="off" /></label></div><label>Папка проекта (необязательно)<input value={directory} onChange={(event) => setDirectory(event.target.value)} placeholder="/home/user/project" spellCheck={false}/></label><p className="form-hint">Существующий туннель или локальный IP. Пароль — OPENCODE_SERVER_PASSWORD на ПК.</p></>}
      {error && <p role="alert" className="inline-error">{error}</p>}
      <Button type="submit" busy={busy} disabled={mode === 'pair' ? !input.trim() : !url.trim()}>Подключиться<ArrowRight size={17}/></Button>
      <p className="secure-note"><ShieldCheck size={15}/>{isNative ? 'Ключ хранится в защищённом хранилище устройства.' : 'В браузере ключ живёт только до перезагрузки вкладки.'}</p>
      </form></div></div>
  </Modal>;
}
