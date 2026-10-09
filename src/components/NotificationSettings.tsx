import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { Bell } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { isNative, platform, PocketNative } from '../lib/native';
import { Button, CopyButton, ExternalLink, Toggle } from './ui';
import type { BridgeInfo } from '../types';

export function NotificationSettings() {
  const { client, bridgeInfo, preferences, setPreferences, perform, notify } = usePocket();
  const [info, setInfo] = useState(bridgeInfo);
  const [permission, setPermission] = useState('unknown');
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState('');
  useEffect(() => {
    setInfo(bridgeInfo);
  }, [bridgeInfo]);
  useEffect(() => {
    setTestResult('');
  }, [client]);
  useEffect(() => {
    if (!isNative) return;
    let active = true;
    const check = () =>
      void PocketNative.notificationStatus()
        .then((value) => {
          if (active) setPermission(value.status);
        })
        .catch(() => {
          if (active) setPermission('unknown');
        });
    check();
    const listener = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) check();
    });
    return () => {
      active = false;
      void listener.then((handle) => handle.remove());
    };
  }, []);
  const bridge = client?.connection.mode === 'bridge';
  const topic = info?.push.ntfyTopic;
  const operate = (action: () => Promise<void>) => {
    setBusy(true);
    void perform(action).finally(() => setBusy(false));
  };
  const reload = async () => {
    if (client && bridge) setInfo(await client.companion<BridgeInfo>('/info'));
  };
  const nativeNotifications = async (enabled: boolean) => {
    if (enabled) {
      const result = await PocketNative.requestNotifications();
      setPermission(result.granted ? 'granted' : 'denied');
      if (!result.granted) throw new Error('Разрешите уведомления OCC в настройках телефона.');
      if (platform === 'ios') {
        if (!client || !info?.push.apns) throw new Error('APNs не настроен на компьютере. Используйте ntfy.');
        await client.companion('/push', 'POST', await PocketNative.registerPush());
      }
    } else if (platform === 'ios' && bridge) await client!.companion('/push', 'DELETE');
    await setPreferences({ notifications: enabled });
    await reload();
  };
  return (
    <section className="panel settings-section" aria-label="Настройка уведомлений">
      <div className="settings-section-title">
        <Bell size={20} />
        <div>
          <h2>Уведомления</h2>
          <p>Вопросы, разрешения и ошибки. Отмена генерации — без сигнала.</p>
        </div>
      </div>
      {isNative && (platform !== 'ios' || info?.push.apns) && (
        <>
          <Toggle
            checked={
              platform === 'ios'
                ? (info?.push.registered ?? preferences.notifications)
                : preferences.notifications
            }
            disabled={busy || Boolean(topic)}
            onChange={(enabled) => operate(() => nativeNotifications(enabled))}
            label="Уведомления в OCC"
            description={
              platform === 'ios'
                ? 'APNs на мосте. Нужна подпись с Push Notifications.'
                : 'Фоновое соединение. Энергосбережение может ограничивать доставку.'
            }
          />
          <p className="form-hint">
            Разрешение телефона:{' '}
            {permission === 'granted'
              ? 'выдано'
              : permission === 'denied'
                ? 'запрещено'
                : permission === 'prompt'
                  ? 'ещё не запрошено'
                  : 'не проверено'}
            .
          </p>
          {permission === 'denied' && (
            <Button
              variant="secondary"
              onClick={() => operate(() => PocketNative.openNotificationSettings())}
            >
              Открыть настройки телефона
            </Button>
          )}
        </>
      )}
      {platform === 'ios' && !info?.push.apns && (
        <p className="form-hint">
          Для IPA с sideload используйте ntfy: уведомления приходят в отдельное приложение даже при закрытом
          OCC.
        </p>
      )}
      {info?.push.sharedNtfy && (
        <p className="form-hint">
          На компьютере также настроен общий канал OCC_NTFY_URL. Переключатель ниже управляет только
          персональной темой; общая подписка может дублировать её сообщения.
        </p>
      )}
      {bridge && info?.push.setup ? (
        <>
          <Toggle
            checked={Boolean(topic)}
            disabled={busy}
            label="Доставка через ntfy"
            description="Создать отдельную тему для этого телефона на ntfy.sh. Передаётся только тип события, без текста диалога."
            onChange={(enabled) =>
              operate(async () => {
                await client!.companion('/notifications/ntfy', 'POST', { enabled });
                if (enabled && platform === 'ios' && info.push.registered)
                  await client!.companion('/push', 'DELETE');
                if (enabled && platform === 'android') await setPreferences({ notifications: false });
                await reload();
                setTestResult('');
              })
            }
          />
          {topic && (
            <div className="notification-info notification-setup">
              <strong>Добавьте подписку в ntfy</strong>
              <ol>
                <li>
                  <ExternalLink href="https://docs.ntfy.sh/subscribe/phone/">Установить ntfy</ExternalLink> и
                  разрешить ему уведомления.
                </li>
                <li>
                  Нажать «+», выбрать сервер <code>https://ntfy.sh</code> и вставить тему:
                </li>
              </ol>
              <div className="notification-topic">
                <code>{topic}</code>
                <CopyButton text={topic} label="Копировать тему ntfy" />
              </div>
              <p>
                Затем нажмите тест ниже. Он должен появиться в ntfy. Сохраните тему только у себя: она даёт
                доступ к этой подписке.
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="form-hint">
          {bridge
            ? 'Обновите мост установщиком Pocket и перезапустите OpenCode для настройки с телефона.'
            : 'Подключитесь через мост Pocket, чтобы настроить ntfy или APNs.'}
        </p>
      )}
      {bridge && (
        <Button
          variant="secondary"
          busy={busy}
          disabled={!topic && !info?.push.registered && !info?.push.ntfy}
          onClick={() =>
            operate(async () => {
              const result = await client!.companion<{ dispatched: boolean; failed?: number }>(
                '/notifications/test',
                'POST',
              );
              const text = result.dispatched
                ? `Сервис принял тест${result.failed ? ', но один из каналов вернул ошибку' : ''}. Проверьте ${topic ? 'ntfy' : 'телефон'}: это ещё не подтверждение получения.`
                : 'Тест не отправлен. Проверьте канал и журнал моста на компьютере.';
              setTestResult(text);
              notify(text, !result.dispatched);
            })
          }
        >
          Отправить тестовое уведомление
        </Button>
      )}
      {testResult && <output className="form-hint">{testResult}</output>}
      <details className="notification-info">
        <summary>Условия фоновой доставки</summary>
        <p>
          Компьютер и OpenCode должны работать и иметь интернет. На iPhone включите уведомления ntfy или OCC и
          проверьте режим «Фокусирование». Без APNs или ntfy iOS приостанавливает соединение после
          сворачивания OCC.
        </p>
        <ExternalLink href="https://github.com/HVHBIGNAME/OpenCodePocket/blob/main/docs/notifications.md">
          Инструкция и APNs
        </ExternalLink>
      </details>
    </section>
  );
}
