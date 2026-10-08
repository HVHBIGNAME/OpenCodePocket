import { AudioLines, ArrowRight, Link2, MessageSquare, QrCode, ShieldCheck } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { CoreArt } from '../components/Brand';
import { Button } from '../components/ui';

export function Welcome() {
  const { setConnectOpen, setConnectIntent } = usePocket();
  return (
    <div className="welcome page">
      <div className="welcome-art">
        <CoreArt />
      </div>
      <span className="eyebrow">OPEN CODE / В КАРМАНЕ</span>
      <h1>
        Идея пришла?
        <br />
        <em>Продолжай отсюда.</em>
      </h1>
      <p className="welcome-description">
        Твои сессии OpenCode на телефоне. Напиши, надиктуй или ответь на вопрос — работа продолжится на ПК.
      </p>
      <div className="welcome-actions">
        <Button
          onClick={() => {
            setConnectIntent('scan');
            setConnectOpen(true);
          }}
        >
          <QrCode size={21} />
          Сканировать QR
          <ArrowRight size={18} />
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
      <div className="welcome-features">
        <span>
          <MessageSquare size={18} />
          <strong>Весь контекст</strong>
          <small>С того же места</small>
        </span>
        <span>
          <AudioLines size={18} />
          <strong>Голосом проще</strong>
          <small>Просто надиктуй</small>
        </span>
        <span>
          <ShieldCheck size={18} />
          <strong>Твой контроль</strong>
          <small>Решения за тобой</small>
        </span>
      </div>
      <p className="welcome-credit">
        HVHBIGNAME <span>Vibe in. Systems out.</span>
      </p>
    </div>
  );
}
