import { useId } from 'react';

/**
 * Logo Mistral AI (tracé : Simple Icons, CC0 ; marque de Mistral AI).
 * En couleur, les bandes horizontales reprennent le dégradé de la marque, du jaune au rouge ;
 * `mono` le dessine en couleur courante (bouton au repos). `thinking` fait s'allumer
 * les bandes l'une après l'autre.
 */
const PATH =
  'M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z';

const STRIPES = ['#ffd800', '#ffaf00', '#ff8205', '#fa500f', '#e10500'];
const STRIPE_HEIGHT = (20.571 - 3.429) / STRIPES.length;

interface AssistantIconProps {
  size?: number;
  mono?: boolean;
  thinking?: boolean;
  className?: string;
}

export function AssistantIcon({ size = 16, mono = false, thinking = false, className = '' }: AssistantIconProps) {
  // Identifiant stable par instance (un nouvel id à chaque rendu faisait clignoter le logo).
  const clip = `mistral-${useId().replace(/:/g, '')}`;
  if (mono) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
        <path d={PATH} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <clipPath id={clip}>
        <path d={PATH} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        {STRIPES.map((color, index) => (
          <rect
            key={color}
            x="0"
            y={3.429 + index * STRIPE_HEIGHT}
            width="24"
            height={STRIPE_HEIGHT + 0.05}
            fill={color}
            className={thinking ? 'animate-stripe' : undefined}
            style={thinking ? { animationDelay: `${index * 0.14}s` } : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
