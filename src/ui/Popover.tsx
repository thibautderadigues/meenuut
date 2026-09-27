import { computePosition, flip, offset, shift, size } from '@floating-ui/dom';
import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface Point {
  x: number;
  y: number;
}

interface PopoverProps extends HTMLAttributes<HTMLDivElement> {
  anchor: Point;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Panneau flottant ancré à un point (Floating UI), rendu dans body.
 * Prend le focus à l'ouverture et le rend à son déclencheur à la fermeture ;
 * se ferme sur un clic extérieur, un redimensionnement ou la perte de focus de la fenêtre.
 */
export function Popover({ anchor, onClose, children, className = '', ...rest }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reference = { getBoundingClientRect: () => new DOMRect(anchor.x, anchor.y, 0, 0) };
    void computePosition(reference, element, {
      strategy: 'fixed',
      placement: 'bottom-start',
      middleware: [
        offset(4),
        flip({ padding: 8 }),
        shift({ padding: 8 }),
        // Jamais plus haut que l'espace disponible : au-delà, le panneau défile.
        size({
          padding: 8,
          apply: ({ availableHeight, elements }) => {
            elements.floating.style.maxHeight = `${Math.max(160, availableHeight)}px`;
          },
        }),
      ],
    }).then(({ x, y }) => {
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.visibility = 'visible';
      // Focus seulement une fois visible (un élément masqué ne peut pas le recevoir) : sur
      // l'élément marqué data-autofocus, sinon sur le panneau — sauf si un enfant l'a déjà.
      if (!element.contains(document.activeElement)) {
        (element.querySelector<HTMLElement>('[data-autofocus]') ?? element).focus();
      }
    });
  }, [anchor]);

  // Mémorise le déclencheur pour lui rendre le focus. useLayoutEffect : rendu avant qu'une action
  // (renommage…) ne pose le sien.
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Sans défilement : rendre le focus à l'éditeur ne doit pas faire sauter la page.
    return () => previous?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      onContextMenu={(event) => event.preventDefault()}
      style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}
      className={`z-50 animate-pop-in overflow-y-auto overscroll-contain rounded-lg border border-rule bg-elevated font-sans shadow-popover outline-none ${className}`}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  );
}
