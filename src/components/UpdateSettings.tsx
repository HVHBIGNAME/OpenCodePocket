import { Download, RefreshCw, X } from 'lucide-react';
import { APP_VERSION } from '../../shared/protocol';
import { checkUpdates, dismissUpdate, updateAvailable, useUpdates } from '../lib/updates';
import { platform } from '../lib/native';
import { Button, ExternalLink, IconButton } from './ui';

export function UpdateNotice({ onOpen }: { onOpen: () => void }) {
  const state = useUpdates();
  if (!updateAvailable(state) || state.dismissed === state.release?.version) return null;
  return (
    <output className="update-notice">
      <button onClick={onOpen}>
        <Download size={17} />
        <span>Доступна версия {state.release!.version}</span>
      </button>
      <IconButton label="Скрыть уведомление об обновлении" onClick={dismissUpdate}>
        <X size={16} />
      </IconButton>
    </output>
  );
}

export function UpdateSettings() {
  const state = useUpdates();
  const available = updateAvailable(state);
  const release = state.release;
  return (
    <section className="panel settings-section" aria-label="Обновления приложения">
      <div className="settings-section-title">
        <Download size={20} />
        <div>
          <h2>Обновления</h2>
          <p>Установлена версия {APP_VERSION}</p>
        </div>
      </div>
      <output>
        {available
          ? `Вышла новая версия ${release!.version}`
          : state.checkedAt
            ? 'Новых стабильных версий нет.'
            : 'Проверка стабильных релизов GitHub.'}
      </output>
      {state.error && (
        <p className="form-hint" role="alert">
          {state.error}
        </p>
      )}
      {state.checkedAt && (
        <p className="form-hint">
          Последняя успешная проверка: {new Date(state.checkedAt).toLocaleString('ru')}
        </p>
      )}
      <Button variant="secondary" busy={state.checking} onClick={() => void checkUpdates(true)}>
        <RefreshCw size={16} />
        {state.checking ? 'Проверяем…' : 'Проверить обновления'}
      </Button>
      {available && release && (
        <div className="update-downloads">
          {platform !== 'ios' && release.android && (
            <ExternalLink href={release.android}>Скачать APK</ExternalLink>
          )}
          {platform !== 'android' && release.ios && (
            <ExternalLink href={release.ios}>Скачать IPA</ExternalLink>
          )}
          <ExternalLink href={release.url}>Открыть релиз</ExternalLink>
          {platform === 'ios' && (
            <p className="form-hint">
              IPA нужно подписать и установить тем же способом, что текущую версию. Установка поверх
              приложения сохраняет его данные.
            </p>
          )}
          {(platform === 'android' || platform === 'web') && (
            <p className="form-hint">
              Установи APK поверх текущего приложения, чтобы сохранить подключения и настройки.
            </p>
          )}
          {release.notes && (
            <details>
              <summary>Что нового</summary>
              <p className="release-notes">{release.notes}</p>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
