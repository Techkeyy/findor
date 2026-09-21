import type { ReactNode, SVGProps } from "react";

export type UiIconProps = SVGProps<SVGSVGElement> & { size?: number };

function UiIcon({ size = 18, children, ...props }: UiIconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>;
}

export function SearchIcon(props: UiIconProps) { return <UiIcon {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></UiIcon>; }
export function BoltIcon(props: UiIconProps) { return <UiIcon {...props}><path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" /></UiIcon>; }
export function WrenchIcon(props: UiIconProps) { return <UiIcon {...props}><path d="M14.7 6.3a4.2 4.2 0 0 0-5.5-5.1l3 3-2.1 2.1-3-3a4.2 4.2 0 0 0 5.1 5.5l7.2 7.2a2.2 2.2 0 0 1-3.1 3.1l-7.2-7.2a4.2 4.2 0 0 0-5.5-5.1l3 3-2.1 2.1-3-3a4.2 4.2 0 0 0 5.1 5.5l7.2 7.2a2.2 2.2 0 0 0 3.1-3.1Z" /></UiIcon>; }
export function SparklesIcon(props: UiIconProps) { return <UiIcon {...props}><path d="m12 3-1.2 4.1a3 3 0 0 1-2.1 2.1L4.6 10.5l4.1 1.2a3 3 0 0 1 2.1 2.1L12 18l1.2-4.2a3 3 0 0 1 2.1-2.1l4.1-1.2-4.1-1.3a3 3 0 0 1-2.1-2.1L12 3Z" /><path d="m19 16-.5 1.7a2 2 0 0 1-1.3 1.3l-1.7.5 1.7.5a2 2 0 0 1 1.3 1.3L19 23l.5-1.7a2 2 0 0 1 1.3-1.3l1.7-.5-1.7-.5a2 2 0 0 1-1.3-1.3L19 16Z" /></UiIcon>; }
export function HammerIcon(props: UiIconProps) { return <UiIcon {...props}><path d="m14 6 4-4 4 4-4 4" /><path d="m18 10-8.5 8.5a2.1 2.1 0 0 1-3 0l-1-1a2.1 2.1 0 0 1 0-3L14 6" /><path d="m2 22 5-5" /></UiIcon>; }
export function PackageIcon(props: UiIconProps) { return <UiIcon {...props}><path d="m3 7 9-4 9 4-9 4-9-4Z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /><path d="m7 5 9 4" /></UiIcon>; }
export function SnowflakeIcon(props: UiIconProps) { return <UiIcon {...props}><path d="M12 2v20M4.9 6l14.2 12M4.9 18 19.1 6M5 12h14" /><path d="m12 2 2 3M12 2 10 5M12 22l2-3M12 22l-2-3M4.9 6l3.6.2M4.9 6l1.4 3.3M19.1 18l-3.6-.2M19.1 18l-1.4-3.3M4.9 18l1.4-3.3M4.9 18l3.6-.2M19.1 6l-1.4 3.3M19.1 6l-3.6.2" /></UiIcon>; }
export function PaletteIcon(props: UiIconProps) { return <UiIcon {...props}><path d="M12 3a9 9 0 0 0 0 18h1.2a1.8 1.8 0 0 0 1.4-2.9 1.8 1.8 0 0 1 1.4-2.9H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z" /><circle cx="7.5" cy="11" r=".8" fill="currentColor" stroke="none" /><circle cx="9" cy="7.5" r=".8" fill="currentColor" stroke="none" /><circle cx="14" cy="7" r=".8" fill="currentColor" stroke="none" /><circle cx="17" cy="10" r=".8" fill="currentColor" stroke="none" /></UiIcon>; }
export function LeafIcon(props: UiIconProps) { return <UiIcon {...props}><path d="M20.8 3.2C12 3.4 5.1 6.7 4 13.2c-.6 3.5 2 6.8 5.5 7.4 6.5 1.1 9.8-5.8 10-14.6a1 1 0 0 0-1-1Z" /><path d="M3 21c3.5-5.5 7.5-8.5 13.5-10.5" /></UiIcon>; }
export function ToolsIcon(props: UiIconProps) { return <UiIcon {...props}><path d="m14.7 6.3 3-3a4.2 4.2 0 0 0-5.5 5.5l-7.5 7.5a2.1 2.1 0 0 0 3 3l7.5-7.5a4.2 4.2 0 0 0 5.5-5.5l-3 3Z" /><path d="m14 14 6 6" /></UiIcon>; }
export function CheckIcon(props: UiIconProps) { return <UiIcon {...props}><path d="m5 12 4 4L19 6" /></UiIcon>; }
export function LoaderIcon(props: UiIconProps) { return <UiIcon {...props}><circle cx="12" cy="12" r="9" opacity=".25" /><path d="M21 12a9 9 0 0 0-9-9" /></UiIcon>; }
export function ClipboardIcon(props: UiIconProps) { return <UiIcon {...props}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 9h6M9 13h6M9 17h3" /></UiIcon>; }
export function MailIcon(props: UiIconProps) { return <UiIcon {...props}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></UiIcon>; }
export function AlertTriangleIcon(props: UiIconProps) { return <UiIcon {...props}><path d="m12 3 9 17H3L12 3Z" /><path d="M12 9v4M12 17h.01" /></UiIcon>; }
export function LockIcon(props: UiIconProps) { return <UiIcon {...props}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></UiIcon>; }
export function ExternalLinkIcon(props: UiIconProps) { return <UiIcon {...props}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></UiIcon>; }
export function ChevronDownIcon(props: UiIconProps) { return <UiIcon {...props}><path d="m6 9 6 6 6-6" /></UiIcon>; }
export function ChevronUpIcon(props: UiIconProps) { return <UiIcon {...props}><path d="m18 15-6-6-6 6" /></UiIcon>; }
export function XIcon(props: UiIconProps) { return <UiIcon {...props}><path d="m6 6 12 12M18 6 6 18" /></UiIcon>; }
export function ArrowLeftIcon(props: UiIconProps) { return <UiIcon {...props}><path d="m15 18-6-6 6-6M9 12h10" /></UiIcon>; }
export function ArrowRightIcon(props: UiIconProps) { return <UiIcon {...props}><path d="m9 18 6-6-6-6M5 12h10" /></UiIcon>; }
