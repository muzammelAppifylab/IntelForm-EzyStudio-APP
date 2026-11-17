import {
  cloneElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {Icon, type IconName} from './icon';

/**
 * Floating pieces: `Popover` (a small panel of controls next to its button),
 * `Tooltip` (a short hint on hover / focus), `Combobox` (pick one of many with
 * type-to-filter: countries, fields, forms) and `CommandPalette` (a searchable
 * list of actions in a dialog).
 *
 * Positioned `fixed` from their anchor through the CSSOM (`element.style`, which
 * the CSP allows; never a `style=""` attribute), like `Menu`, so a scroll box
 * never clips them. Esc closes and returns focus; a click outside closes.
 */

// ------------------------------------------------------------ positioning --

/** Place `panel` under (or above, when there is no room) `anchor`, kept inside the viewport. */
function useAnchoredPosition(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  align: 'start' | 'end' | 'center',
  onAway?: () => void
) {
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const place = () => {
      const a = anchor.current;
      const p = panel.current;
      if (!a || !p) return;
      const rect = a.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom > p.offsetHeight + 12 || rect.top < p.offsetHeight + 12;
      p.style.top = `${below ? rect.bottom + 6 : rect.top - p.offsetHeight - 6}px`;
      const left =
        align === 'end' ? rect.right - p.offsetWidth : align === 'center' ? rect.left + rect.width / 2 - p.offsetWidth / 2 : rect.left;
      p.style.left = `${Math.max(8, Math.min(left, window.innerWidth - p.offsetWidth - 8))}px`;
    };
    place();
    const away = () => (onAway ? onAway() : place());
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => {
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
  }, [open, anchor, panel, align, onAway]);
}

/** Close on a pointer press outside both elements. */
function useOutside(open: boolean, refs: RefObject<HTMLElement | null>[], onOutside: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: PointerEvent) => {
      if (refs.every(ref => !ref.current?.contains(event.target as Node))) onOutside();
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open, refs, onOutside]);
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// ---------------------------------------------------------------- popover --

/**
 * A small panel of controls opened by a button: a colour picker, a filter, a
 * date. Not for actions (that is `Menu`) and not for a task with a Save (that is
 * a `Modal` or `Drawer`). Controlled (`open` + `onOpenChange`) or not.
 */
export function Popover({
  label,
  trigger,
  children,
  align = 'start',
  open: openProp,
  onOpenChange,
  triggerClassName,
  disabled,
  wide,
  triggerId,
}: {
  /** What the panel is for ("Filter responses"): the trigger's and the panel's name. */
  label: string;
  /** The trigger button's content; default a "more" icon. */
  trigger?: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** e.g. `buttonClass({variant: 'secondary'})`; default a plain, quiet trigger. */
  triggerClassName?: string;
  disabled?: boolean;
  /** A wider panel (up to 360px) for a calendar or a form. */
  wide?: boolean;
  /** The trigger's id, so a `Field` label can name it. */
  triggerId?: string;
}) {
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOwn(next);
    onOpenChange?.(next);
  };
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  useAnchoredPosition(open, button, panel, align);
  const refs = useMemo(() => [button, panel], []);
  useOutside(open, refs, () => close(false));
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={button}
        id={triggerId}
        type="button"
        className={triggerClassName ?? 'popover-trigger'}
        aria-label={trigger ? undefined : label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}>
        {trigger ?? <Icon name="more" size={16} />}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          className={wide ? 'popover popover-wide' : 'popover'}
          role="dialog"
          aria-label={label}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}>
          {children}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- tooltip --

/**
 * A short hint for ONE control, on hover and on keyboard focus (never the only
 * way to learn something essential; an icon-only button still has its own
 * `aria-label`). The child must be a single element that takes a ref-less
 * `aria-describedby` (a `Button`, `IconButton`, `<a>`).
 */
export function Tooltip({content, children, side = 'top'}: {content: ReactNode; children: ReactElement<Record<string, unknown>>; side?: 'top' | 'bottom'}) {
  const [shown, setShown] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!shown || !wrap.current || !tip.current) return;
    const rect = wrap.current.getBoundingClientRect();
    const t = tip.current;
    const top = side === 'top' && rect.top > t.offsetHeight + 12 ? rect.top - t.offsetHeight - 6 : rect.bottom + 6;
    t.style.top = `${top}px`;
    const left = rect.left + rect.width / 2 - t.offsetWidth / 2;
    t.style.left = `${Math.max(8, Math.min(left, window.innerWidth - t.offsetWidth - 8))}px`;
  }, [shown, side]);
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setShown(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shown]);
  return (
    <span
      ref={wrap}
      className="tooltip-anchor"
      onPointerEnter={() => setShown(true)}
      onPointerLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}>
      {cloneElement(children, {'aria-describedby': id})}
      <span ref={tip} id={id} role="tooltip" className="tooltip" hidden={!shown}>
        {content}
      </span>
    </span>
  );
}

// --------------------------------------------------------------- combobox --

export type ComboboxOption = {value: string; label: string; description?: string; group?: string; disabled?: boolean};

/**
 * Pick ONE of many with type-to-filter (countries, a form, a field). A button
 * that shows the choice opens a search box over a listbox: ↑ ↓ move, Enter
 * picks, Esc closes. For 2–5 options use `RadioCards`; for a long list that
 * needs no search, `Select`.
 */
export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  searchLabel = 'Search',
  emptyText = 'Nothing matches.',
  disabled,
  invalid,
  describedBy,
}: {
  /** The trigger's id: pass `Field`'s `id` so its `<label>` names it. */
  id?: string;
  value: string | null;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchLabel?: string;
  emptyText?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find(option => option.value === value);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(option => `${option.label} ${option.description ?? ''}`.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const close = (refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) button.current?.focus();
  };
  useAnchoredPosition(open, button, panel, 'start');
  const refs = useMemo(() => [button, panel], []);
  useOutside(open, refs, () => close(false));
  useEffect(() => {
    if (!open) return;
    const at = shown.findIndex(option => option.value === value);
    setActive(at >= 0 ? at : 0);
    // Only when it opens (typing resets the active row in onChange).
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    panel.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({block: 'nearest'});
  }, [active]);

  const pick = (option: ComboboxOption | undefined) => {
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') setActive(i => Math.min(shown.length - 1, i + 1));
    else if (event.key === 'ArrowUp') setActive(i => Math.max(0, i - 1));
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(shown.length - 1);
    else if (event.key === 'Enter') pick(shown[active]);
    else if (event.key === 'Escape') close();
    else if (event.key === 'Tab') return close(false);
    else return;
    event.preventDefault();
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={button}
        id={id}
        type="button"
        className="combobox-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={event => {
          if ((event.key === 'ArrowDown' || event.key === 'Enter') && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}>
        <span className={selected ? 'combobox-value' : 'combobox-value combobox-placeholder'}>{selected?.label ?? placeholder}</span>
        <Icon name="chevrons-up-down" size={16} />
      </button>
      {open && (
        <div ref={panel} className="popover combobox-panel">
          <span className="combobox-search">
            <Icon name="search" size={16} />
            <input
              type="text"
              role="combobox"
              aria-label={searchLabel}
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              autoFocus
              value={query}
              onChange={event => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </span>
          <ul className="combobox-list" id={listId} role="listbox" aria-label={searchLabel}>
            {shown.length === 0 && <li className="combobox-empty">{emptyText}</li>}
            {shown.map((option, i) => {
              const header = option.group && option.group !== lastGroup ? option.group : null;
              lastGroup = option.group;
              return (
                <li key={option.value} role="presentation">
                  {header && (
                    <span className="combobox-group" aria-hidden="true">
                      {header}
                    </span>
                  )}
                  <span
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    className="combobox-option"
                    aria-selected={option.value === value}
                    aria-disabled={option.disabled || undefined}
                    data-active={i === active ? '' : undefined}
                    onPointerMove={() => setActive(i)}
                    onClick={() => pick(option)}>
                    <span className="combobox-option-text">
                      <span>{option.label}</span>
                      {option.description && <span className="combobox-option-sub">{option.description}</span>}
                    </span>
                    {option.value === value && <Icon name="check" size={16} />}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------- command palette --

export type Command = {id: string; label: string; group?: string; icon?: IconName; hint?: string; keywords?: string; onSelect: () => void};

/**
 * A searchable list of actions in a dialog (⌘K / Ctrl K, or "Add a field"):
 * type to filter, ↑ ↓ to move, Enter to run, Esc to close. Built on the native
 * `<dialog>`, so focus is trapped and returned like `Modal`.
 */
export function CommandPalette({
  open,
  onClose,
  commands,
  label = 'Commands',
  placeholder = 'Type to search…',
  emptyText = 'Nothing matches.',
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  label?: string;
  placeholder?: string;
  emptyText?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      setQuery('');
      setActive(0);
      node.showModal();
    }
    if (!open && node.open) node.close();
  }, [open]);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    node.addEventListener('cancel', cancel);
    return () => node.removeEventListener('cancel', cancel);
  }, [onClose]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter(command => `${command.label} ${command.group ?? ''} ${command.keywords ?? ''}`.toLowerCase().includes(q)) : commands;
  }, [commands, query]);
  useEffect(() => {
    dialog.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({block: 'nearest'});
  }, [active]);
  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.onSelect();
  };
  let lastGroup: string | undefined;
  return (
    <dialog
      ref={dialog}
      className="modal modal-md command-palette"
      aria-label={label}
      onClick={event => event.target === event.currentTarget && onClose()}>
      {open && (
        <div className="modal-box">
          <span className="combobox-search command-search">
            <Icon name="search" size={18} />
            <input
              type="text"
              role="combobox"
              aria-label={label}
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              placeholder={placeholder}
              autoFocus
              value={query}
              onChange={event => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={event => {
                if (event.key === 'ArrowDown') setActive(i => Math.min(shown.length - 1, i + 1));
                else if (event.key === 'ArrowUp') setActive(i => Math.max(0, i - 1));
                else if (event.key === 'Enter') run(shown[active]);
                else return;
                event.preventDefault();
              }}
            />
          </span>
          <ul className="combobox-list command-list" id={listId} role="listbox" aria-label={label}>
            {shown.length === 0 && <li className="combobox-empty">{emptyText}</li>}
            {shown.map((command, i) => {
              const header = command.group && command.group !== lastGroup ? command.group : null;
              lastGroup = command.group;
              return (
                <li key={command.id} role="presentation">
                  {header && (
                    <span className="combobox-group" aria-hidden="true">
                      {header}
                    </span>
                  )}
                  <span
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    className="combobox-option"
                    data-active={i === active ? '' : undefined}
                    onPointerMove={() => setActive(i)}
                    onClick={() => run(command)}>
                    {command.icon && <Icon name={command.icon} size={16} />}
                    <span className="combobox-option-text">{command.label}</span>
                    {command.hint && <kbd className="kbd">{command.hint}</kbd>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </dialog>
  );
}
