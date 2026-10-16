import { Laptop, Link2, QrCode, Smartphone, Terminal } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { Button } from '../components/ui';

export function Welcome() {
  const { setConnectOpen, setConnectIntent } = usePocket();
  return (
    <div className="welcome page">
      <div className="welcome-mark" aria-hidden>
        <Terminal size={32} />
      </div>
      <h1>
        Ваш OpenCode.
        <br />
        Всегда под рукой.
      </h1>
      <p className="welcome-description">
        Продолжайте работу с телефона: пишите в сессии, смотрите изменения и отвечайте на запросы.
      </p>
      <div className="welcome-steps">
        <div>
          <Laptop size={20} />
          <span>
            <strong>Откройте Pocket на компьютере</strong>
            <small>В OpenCode попросите показать QR-код подключения.</small>
          </span>
        </div>
        <div>
          <Smartphone size={20} />
          <span>
            <strong>Подключите этот телефон</strong>
            <small>Сканируйте QR-код или вставьте ссылку.</small>
          </span>
        </div>
      </div>
      <div className="welcome-actions">
        <Button
          onClick={() => {
            setConnectIntent('scan');
            setConnectOpen(true);
          }}
        >
          <QrCode size={21} />
          Сканировать QR
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setConnectIntent('manual');
            setConnectOpen(true);
          }}
        >
          <Link2 size={19} />
          Подключить компьютер
        </Button>
      </div>
      <p className="welcome-note">Проекты и инструменты остаются на вашем компьютере.</p>
    </div>
  );
}
