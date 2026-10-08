import { Link2, QrCode } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { Button } from '../components/ui';

export function Welcome() {
  const { setConnectOpen, setConnectIntent } = usePocket();
  return (
    <div className="welcome page">
      <h1>Подключение</h1>
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
    </div>
  );
}
