import type { ButtonHTMLAttributes } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Nom accessible, repris dans l'infobulle. */
  label: string;
  shortcut?: string;
  /** Pour les boutons bascule (gras, italique…) : expose aria-pressed. */
  pressed?: boolean;
  /** sm : actions secondaires dans les lignes de la sidebar. */
  size?: 'md' | 'sm';
}

export function IconButton({
  label,
  shortcut,
  pressed,
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      data-tooltip={label}
      data-shortcut={shortcut}
      className={`grid shrink-0 place-items-center rounded-md ${size === 'sm' ? 'size-6' : 'size-8'} transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-accent ${
        pressed ? 'bg-surface text-ink' : 'text-ink-muted hover:bg-surface hover:text-ink'
      } ${className}`}
      {...rest}
    />
  );
}
