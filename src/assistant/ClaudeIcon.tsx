/** Pictogramme de l'assistant : une étoile à rayons arrondis, dans la teinte de l'IA. */
export function ClaudeIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      aria-hidden
      className={className}
    >
      <path d="M12.00 9.80L12.00 2.00M13.10 10.09L16.00 5.07M13.91 10.90L20.66 7.00M14.20 12.00L20.00 12.00M13.91 13.10L20.66 17.00M13.10 13.91L16.00 18.93M12.00 14.20L12.00 22.00M10.90 13.91L8.00 18.93M10.09 13.10L3.34 17.00M9.80 12.00L4.00 12.00M10.09 10.90L3.34 7.00M10.90 10.09L8.00 5.07" />
    </svg>
  );
}
