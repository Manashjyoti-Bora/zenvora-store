import type { SVGProps } from 'react';

/**
 * Shared inline-SVG glyph set (stroke = currentColor, 24px grid).
 * Replaces emoji icons on customer surfaces: emoji render inconsistently
 * across Android/iOS/desktop and clash with the ink/cream identity.
 */

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  'aria-hidden': true,
} as const;

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path strokeLinecap="round" d="m16 16 4.5 4.5" />
    </svg>
  );
}

export function BoxIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 7 8 4 8-4M12 21V11" />
    </svg>
  );
}

export function CartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 3h1.6c.5 0 .95.34 1.08.84l.38 1.43M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.22c1.12-2.3 2.1-4.68 2.92-7.14a60.1 60.1 0 0 0-16.54-1.84M7.5 14.25 5.1 5.27M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 11v5.5" />
      <circle cx="12" cy="7.9" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

export function WarnIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.6 3.9 2.7 17.4A1.6 1.6 0 0 0 4.1 19.8h15.8a1.6 1.6 0 0 0 1.4-2.4L13.4 3.9a1.6 1.6 0 0 0-2.8 0Z" />
      <path strokeLinecap="round" d="M12 8.5v4.5" />
      <circle cx="12" cy="16.3" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
    </svg>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
    </svg>
  );
}

export function ToolIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75a4.5 4.5 0 0 1-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 1 1-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 0 1 6.336-4.486l-3.276 3.276a3.004 3.004 0 0 0 2.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.867 19.125h.008v.008h-.008v-.008Z" />
    </svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
    </svg>
  );
}

export function CreditCardIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
    </svg>
  );
}

export function ReceiptIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}
