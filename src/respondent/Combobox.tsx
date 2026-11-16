import {type KeyboardEvent, useEffect, useId, useMemo, useRef, useState} from 'react';

import {inputClass} from './classes';
import {RIcon} from './icons';
import {cx} from './util';

export interface ComboOption {
  value: string;
  label: string;
}

/** Options matching a query: those starting with it first, then those containing it. */
export function filterOptions<T extends ComboOption>(options: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  const starts = options.filter(o => o.label.toLowerCase().startsWith(q));
  const contains = options.filter(o => !o.label.toLowerCase().startsWith(q) && o.label.toLowerCase().includes(q));
  return [...starts, ...contains];
}

/**
 * Searchable single select (ARIA 1.2 combobox with a listbox popup), used by dropdown and
 * country. Type to filter, arrows to move, Enter to pick, Escape to close. While the list is
 * open Enter only picks; with it closed Enter advances (one-at-a-time) or submits the page.
 */
export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder,
  noResults,
  describedBy,
  invalid,
  onAdvance,
  autoComplete,
}: {
  id: string;
  options: ComboOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  noResults: string;
  describedBy?: string;
  invalid?: boolean;
  onAdvance?: () => void;
  autoComplete?: string;
}) {
  const listId = useId();
  const selected = options.find(o => o.value === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => filterOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({block: 'nearest'});
  }, [active, open]);

  const openList = () => {
    setOpen(true);
    setActive(Math.max(0, selected ? filtered.findIndex(o => o.value === selected.value) : 0));
  };
  const pick = (o: ComboOption) => {
    onChange(o.value);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openList();
        else setActive(a => Math.min(filtered.length - 1, a + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (open) setActive(a => Math.max(0, a - 1));
        break;
      case 'Home':
      case 'End':
        if (open) {
          e.preventDefault();
          setActive(e.key === 'Home' ? 0 : filtered.length - 1);
        }
        break;
      case 'Enter':
        if (open) {
          // Picking an option never submits or advances.
          e.preventDefault();
          e.stopPropagation();
          const o = filtered[active];
          if (o) pick(o);
          else setOpen(false);
        } else if (onAdvance && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          onAdvance();
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setQuery('');
        }
        break;
      case 'Tab':
        if (open && query && filtered[active]) pick(filtered[active]);
        setOpen(false);
        break;
    }
  };

  const text = open ? query : (selected?.label ?? '');
  return (
    <div className="rf-combobox">
      <input
        data-slot="input"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete={autoComplete ?? 'off'}
        placeholder={open && selected ? selected.label : placeholder}
        value={text}
        onChange={e => {
          setQuery(e.target.value);
          setActive(0);
          if (!open) setOpen(true);
          if (e.target.value === '' && selected) onChange(null);
        }}
        onClick={() => (open ? setOpen(false) : openList())}
        onBlur={() => {
          setOpen(false);
          setQuery('');
        }}
        onKeyDown={onKeyDown}
        className={inputClass('rf-combobox-input')}
      />
      <RIcon name="chevron-down" className="rf-select-chevron" />
      <ul ref={listRef} id={listId} role="listbox" hidden={!open} className="rf-listbox">
        {filtered.length === 0 && <li className="rf-listbox-empty rf-text-body rf-muted">{noResults}</li>}
        {filtered.map((o, i) => (
          <li
            key={o.value}
            id={`${listId}-${i}`}
            data-index={i}
            role="option"
            aria-selected={o.value === value}
            onMouseDown={e => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(o)}
            className={cx('rf-option', i === active && 'is-active')}
          >
            <span className="rf-option-label">{o.label}</span>
            {o.value === value && <RIcon name="check" className="rf-icon-sm" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
