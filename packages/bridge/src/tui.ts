import type { TuiPlugin, TuiPluginModule, TuiDialogSelectOption } from '@opencode-ai/plugin/tui';
import { managePocket, type ManagementInput } from './management';

const tui: TuiPlugin = async (api) => {
  const alert = (title: string, message: string) =>
    api.ui.dialog.replace(() => api.ui.DialogAlert({ title, message }));
  const perform = async (input: ManagementInput) => {
    api.ui.dialog.clear();
    api.ui.toast({ title: 'OpenCode Pocket', message: 'Выполняется…', variant: 'info' });
    try {
      const result = await managePocket(input);
      alert('OpenCode Pocket', JSON.stringify(result, null, 2));
    } catch (error) {
      alert('Ошибка подключения', error instanceof Error ? error.message : String(error));
    }
  };
  const prompt = (title: string, apply: (value: string) => ManagementInput) => {
    api.ui.dialog.replace(() =>
      api.ui.DialogPrompt({
        title,
        onConfirm: (value) => {
          void perform(apply(value));
        },
      }),
    );
  };
  const settings = () => {
    const options: TuiDialogSelectOption<string>[] = [
      {
        title: 'Интернет: автоматический туннель',
        value: 'tunnel',
        onSelect: () => {
          void perform({ action: 'configure', mode: 'tunnel' });
        },
      },
      {
        title: 'Локальная сеть / Wi-Fi / VPN',
        value: 'lan',
        onSelect: () => {
          void perform({ action: 'configure', mode: 'lan' });
        },
      },
      {
        title: 'Свой HTTPS-туннель',
        value: 'custom',
        onSelect: () =>
          prompt('Адрес HTTPS-туннеля', (url) => ({ action: 'configure', mode: 'custom', url })),
      },
      {
        title: 'Имя компьютера',
        value: 'name',
        onSelect: () => prompt('Имя компьютера', (name) => ({ action: 'configure', name })),
      },
      {
        title: 'Порт моста',
        value: 'port',
        onSelect: () => prompt('Порт моста', (port) => ({ action: 'configure', port: Number(port) })),
      },
      {
        title: 'Отчёты: только локально',
        value: 'local-reports',
        onSelect: () => {
          void perform({ action: 'configure', reportsGithub: false });
        },
      },
      {
        title: 'Отчёты: отправлять в GitHub',
        value: 'github-reports',
        onSelect: () => {
          void perform({ action: 'configure', reportsGithub: true });
        },
      },
      {
        title: 'Показать настройки',
        value: 'show',
        onSelect: () => {
          void perform({ action: 'settings' });
        },
      },
    ];
    api.ui.dialog.replace(() => api.ui.DialogSelect({ title: 'Настройки Pocket', options }));
  };
  const menu = () =>
    api.ui.dialog.replace(() =>
      api.ui.DialogSelect({
        title: 'OpenCode Pocket',
        options: [
          {
            title: 'Подключить телефон / новый QR',
            value: 'qr',
            onSelect: () => {
              void perform({ action: 'qr' });
            },
          },
          {
            title: 'Состояние подключения и устройства',
            value: 'status',
            onSelect: () => {
              void perform({ action: 'status' });
            },
          },
          { title: 'Настройки', value: 'settings', onSelect: settings },
        ],
      }),
    );
  api.keymap.registerLayer({
    commands: [
      {
        name: 'pocket.open',
        title: 'Pocket: подключение телефона',
        category: 'Pocket',
        namespace: 'palette',
        slashName: 'pocket',
        run: menu,
      },
      {
        name: 'pocket.qr',
        title: 'Pocket: новый QR',
        category: 'Pocket',
        namespace: 'palette',
        slashName: 'pocket-qr',
        run: () => perform({ action: 'qr' }),
      },
      {
        name: 'pocket.status',
        title: 'Pocket: состояние',
        category: 'Pocket',
        namespace: 'palette',
        slashName: 'pocket-status',
        run: () => perform({ action: 'status' }),
      },
      {
        name: 'pocket.config',
        title: 'Pocket: настройки',
        category: 'Pocket',
        namespace: 'palette',
        slashName: 'pocket-config',
        run: settings,
      },
    ],
  });
};
export default { id: 'dev.hvhbigname.occ.tui', tui } satisfies TuiPluginModule;
