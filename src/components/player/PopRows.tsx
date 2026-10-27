import type { ReactNode, Ref } from 'react';
import { Check, ChevronRight } from 'lucide-react';

export function PopShell({
  label,
  children,
  footer,
  head,
  innerRef,
}: {
  label: string;
  children: ReactNode;
  footer?: ReactNode;
  head?: ReactNode;
  innerRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div className="pop" role="dialog" aria-label={label}>
      {head}
      <div className="pop__scroll" role="menu" ref={innerRef}>
        {children}
      </div>
      {footer && <p className="pop__foot">{footer}</p>}
    </div>
  );
}

export function PopHead({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="pop__head">
      <button type="button" className="pop__back" onClick={onBack} aria-label="Back to settings menu">
        <ChevronRight size={15} aria-hidden="true" className="flip" />
      </button>
      <h3>{title}</h3>
    </div>
  );
}

export function PopGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pop__group">
      <p className="pop__group-h">{title}</p>
      {children}
    </div>
  );
}

interface RowProps {
  label: ReactNode;
  onClick: () => void;
  active?: boolean;
  value?: ReactNode;
  note?: string;
  disabled?: boolean;
  icon?: ReactNode;
  radio?: boolean;
  describedBy?: string;
}

export function PopRow({ label, onClick, active, value, note, disabled, icon, radio, describedBy }: RowProps) {
  return (
    <button
      type="button"
      role={radio ? 'menuitemradio' : 'menuitem'}
      aria-checked={radio ? Boolean(active) : undefined}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      disabled={disabled}
      className={`pop__row${active ? ' is-on' : ''}`}
      onClick={onClick}
    >
      {icon && <span className="pop__ico">{icon}</span>}
      <span className="pop__label">{label}</span>
      {note && <em className="pop__note">{note}</em>}
      {value && <span className="pop__value">{value}</span>}
      {active && <Check size={14} aria-hidden="true" className="pop__check" />}
    </button>
  );
}

export function PopSwitch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="pop__row pop__toggle"
      onClick={() => onChange(!checked)}
    >
      <span className="pop__label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <i className="pop__knob" aria-hidden="true" data-on={checked ? '1' : '0'} />
    </button>
  );
}

export function PopGrid({
  options,
  value,
  onPick,
  disabledIds = [],
}: {
  options: { id: string; label: string }[];
  value: string;
  onPick: (id: string) => void;
  disabledIds?: string[];
}) {
  return (
    <div className="pop__grid">
      {options.map((o) => {
        const disabled = disabledIds.includes(o.id);
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            className={`pop__chip${active ? ' is-on' : ''}`}
            onClick={() => onPick(o.id)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
