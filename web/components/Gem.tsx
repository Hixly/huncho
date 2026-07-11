export default function Gem({ className, idSuffix = '' }: { className?: string; idSuffix?: string }) {
  const id = `gemgrad${idSuffix}`;
  return (
    <svg className={className} viewBox="0 0 24 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="22%" stopColor="#e6e6e6" />
          <stop offset="48%" stopColor="#2a2a34" />
          <stop offset="62%" stopColor="#5a5a64" />
          <stop offset="85%" stopColor="#c8c8c0" />
          <stop offset="100%" stopColor="#7a7a74" />
        </linearGradient>
      </defs>
      <path d="M12 1 L19 14 L12 39 L5 14 Z" fill={`url(#${id})`} stroke="#0a0a0e" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M12 1 L12 39" stroke="#ffffff" strokeWidth="1" opacity="0.85" />
      <path d="M5 14 L12 17 L19 14" fill="none" stroke="#ffffff" strokeWidth="0.6" opacity="0.85" />
    </svg>
  );
}
