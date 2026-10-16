import { useState } from 'react';
import type { Connection } from '../types';
import { errorMessage } from '../lib/api';
import { captureDiagnostic } from '../lib/diagnostics';
import { Button } from './ui';

type Details = Pick<Connection, 'name' | 'url'>;

export function ConnectionEditor({
  connection,
  onSave,
  onCancel,
}: {
  connection: Details;
  onSave: (changes: Details) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(connection.name);
  const [url, setUrl] = useState(connection.url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave({ name, url });
    } catch (failure) {
      captureDiagnostic(failure, { kind: 'action', operation: 'connect' });
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label>
        Название компьютера
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError('');
          }}
          required
          maxLength={100}
          disabled={busy}
        />
      </label>
      <label>
        Адрес сервера
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setError('');
          }}
          placeholder="http://192.168.1.20:4141"
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={busy}
          aria-describedby="connection-address-hint"
        />
      </label>
      <p className="form-hint" id="connection-address-hint">
        Полный адрес с http:// или https://, включая порт и путь, если они нужны.
      </p>
      <p className="form-hint">
        Сопряжение сохранится. Можно сохранить адрес, даже если ПК сейчас недоступен.
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="field-pair">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
        <Button type="submit" busy={busy} disabled={!name.trim() || !url.trim()}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}
