import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY_MS = 450;
/** Juste après une infobulle, la suivante s'affiche sans délai (on parcourt une barre). */
const WARM_WINDOW_MS = 300;

interface Tip {
  target: HTMLElement;
  label: string;
  shortcut?: string;
}

/**
 * Infobulles de toute l'app : tout élément portant `data-tooltip` (et `data-shortcut`)
 * en reçoit une au survol ou au focus clavier. Rendue dans body et positionnée par
 * Floating UI : jamais rognée par un conteneur qui défile (barre d'outils, sidebar).
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: number | undefined;
    let hovered: HTMLElement | null = null;
    let visible = false;
    let hiddenAt = 0;

    const read = (target: HTMLElement): Tip => ({
      target,
      label: target.dataset.tooltip ?? '',
      shortcut: target.dataset.shortcut || undefined,
    });

    const show = (target: HTMLElement) => {
      window.clearTimeout(timer);
      const warm = visible || Date.now() - hiddenAt < WARM_WINDOW_MS;
      timer = window.setTimeout(
        () => {
          visible = true;
          setTip(read(target));
        },
        warm ? 0 : SHOW_DELAY_MS,
      );
    };

    const hide = () => {
      window.clearTimeout(timer);
      if (visible) hiddenAt = Date.now();
      visible = false;
      setTip(null);
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const target = (event.target as Element).closest<HTMLElement>('[data-tooltip]');
      if (target === hovered) return;
      hovered = target;
      if (target) show(target);
      else hide();
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches?.('[data-tooltip]:focus-visible')) show(target);
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!tip || !element) return;
    void computePosition(tip.target, element, {
      strategy: 'fixed',
      placement: 'bottom',
      middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.visibility = 'visible';
    });
  }, [tip]);

  if (!tip || !tip.label) return null;

  return createPortal(
    <div
      ref={ref}
      // Décoratif : les boutons portent déjà leur nom (aria-label).
      aria-hidden
      data-print-hidden
      style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}
      className="pointer-events-none z-[60] flex animate-tooltip-in items-center gap-1.5 rounded-md bg-ink px-2 py-1 font-sans text-[11px] font-medium whitespace-nowrap text-canvas"
    >
      {tip.label}
      {tip.shortcut && <span className="text-canvas/60">{tip.shortcut}</span>}
    </div>,
    document.body,
  );
}
