import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { matchesSearch, messageSearchText } from '../lib/session-search';
import type { MessageEntry } from '../types';
import { IconButton } from './ui';

export function ChatSearch({
  entries,
  onSelect,
  onClose,
  active = true,
}: {
  entries: MessageEntry[];
  onSelect: (id: string) => void;
  onClose: () => void;
  active?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>();
  const matches = useMemo(
    () => (query.trim() ? entries.filter((entry) => matchesSearch(messageSearchText(entry), query)) : []),
    [entries, query],
  );
  const index = matches.findIndex((entry) => entry.info.id === selected);
  const select = (offset: number) => {
    const next =
      matches[
        index < 0 ? (offset < 0 ? matches.length - 1 : 0) : (index + offset + matches.length) % matches.length
      ];
    if (next) {
      setSelected(next.info.id);
      onSelect(next.info.id);
    }
  };
  return (
    <search className="chat-search" aria-label="Поиск по диалогу">
      <label className="search-field">
        <Search size={17} />
        <input
          disabled={!active}
          aria-label="Поиск в загруженной истории"
          placeholder="Поиск в истории"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              select(event.shiftKey ? -1 : 1);
            }
          }}
        />
      </label>
      <div className="chat-search-controls">
        <output>{query.trim() ? `${index + 1} / ${matches.length}` : 'По загруженным сообщениям'}</output>
        <IconButton label="Предыдущее совпадение" disabled={!matches.length} onClick={() => select(-1)}>
          <ArrowUp size={17} />
        </IconButton>
        <IconButton label="Следующее совпадение" disabled={!matches.length} onClick={() => select(1)}>
          <ArrowDown size={17} />
        </IconButton>
        <IconButton label="Закрыть поиск" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
    </search>
  );
}
