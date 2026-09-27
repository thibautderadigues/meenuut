import { useRef, useState } from 'react';

interface RenameInputProps {
  initial: string;
  label: string;
  onCommit: (value: string, refocus: boolean) => void;
  onCancel: () => void;
}

export function RenameInput({ initial, label, onCommit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial);
  // Le blur peut suivre Entrée ou Échap (démontage) : on ne conclut qu'une fois.
  const settled = useRef(false);
  const settle = (action: () => void) => {
    if (settled.current) return;
    settled.current = true;
    action();
  };

  return (
    <input
      autoFocus
      value={value}
      aria-label={label}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => settle(() => onCommit(value, false))}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // Les flèches, F2, Suppr… appartiennent au champ, pas à l'arbre.
        event.stopPropagation();
        if (event.key === 'Enter') settle(() => onCommit(value, true));
        if (event.key === 'Escape') settle(onCancel);
      }}
      className="h-6 min-w-0 flex-1 rounded bg-elevated px-1.5 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--accent)] outline-none"
    />
  );
}
