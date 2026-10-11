import type { CSSProperties } from 'react';
const paths: Record<string, string> = {
  // Marks of the built-in skills.
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z',
  chip: 'M8 8h8v8H8zM10 4v4m4-4v4m-4 8v4m4-4v4M4 10h4m-4 4h4m8-4h4m-4 4h4',
  scale: 'M12 4v16M8 20h8M5 8h14M5 8l-3 6a3 3 0 006 0L5 8zm14 0l-3 6a3 3 0 006 0l-3-6z',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 12.5l9 5 9-5M3 16.5l9 5 9-5',
  chart: 'M4 20h16M7 16v-4m5 4V8m5 8v-6',
  target: 'M12 3a9 9 0 110 18 9 9 0 010-18zm0 4a5 5 0 110 10 5 5 0 010-10zm0 4a1 1 0 110 2 1 1 0 010-2z',
  flag: 'M5 21V4m0 0h11l-2.5 4L16 12H5',
  prd: 'M6 3h9l4 4v14H6V3zm9 0v4h4M9 12h7M9 16h7M9 8h3',
  users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3 20a6 6 0 0112 0M16 4.5a3.5 3.5 0 010 6.5M18 14.5a5 5 0 013 5.5',
  compass: 'M12 3a9 9 0 110 18 9 9 0 010-18zm3.5 5.5l-2 5-5 2 2-5 5-2z',
  compose: 'M13 4H7a3 3 0 00-3 3v10a3 3 0 003 3h10a3 3 0 003-3v-6M15 4l3-2 4 4-2 3-7 7-4 1 1-4 5-6zm2 0l3 3', trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7', more: 'M5 12h.01M12 12h.01M19 12h.01',
  pencil: 'M4 16l12-12 4 4-12 12-5 1 1-5zm10-10l4 4', pin: 'M9 3h6l-1 6 4 4v2H6v-2l4-4-1-6zm3 12v6', back: 'M19 12H5m6-6l-6 6 6 6',
  cursor: 'M4 3l6 17 3-7 7-3L4 3z', hand: 'M8 11V5a2 2 0 014 0v5-3a2 2 0 014 0v3-1a2 2 0 014 0v6c0 4-3 7-7 7-3 0-5-1-7-4l-3-4a2 2 0 013-3l2 2z',
  note: 'M4 3h16v12l-5 6H4V3zm11 18v-6h5', file: 'M5 3h9l5 5v13H5V3zm9 0v6h5',
  link: 'M8 7h2m4 10h2M8 7l8 10M5 4a3 3 0 110 6 3 3 0 010-6zm14 10a3 3 0 110 6 3 3 0 010-6z',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', arrow: 'M12 19V5m-6 6l6-6 6 6', chevron: 'M9 5l7 7-7 7', down: 'M7 10l5 5 5-5',
  star: 'M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6z', lock: 'M7 10V7a5 5 0 0110 0v3M5 10h14v11H5V10zm7 4v3',
  unlock: 'M7 10V7a5 5 0 019-3M5 10h14v11H5V10zm7 4v3', grip: 'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01',
  resize: 'M8 20h12V8m-9 9l9-9m-4 12l4-4', close: 'M6 6l12 12M6 18L18 6', fit: 'M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5',
  message: 'M4 4h16v13H9l-5 4V4z', copy: 'M9 9h11v11H9V9zM5 15H4V4h11v1', undo: 'M8 5l-5 5 5 5m-5-5h11a6 6 0 016 6', redo: 'M16 5l5 5-5 5m5-5H10a6 6 0 00-6 6',
  settings: 'M18.6 10.1L21 10.2v3.6l-2.4.1-.6 1.5 1.7 1.7-2.6 2.6-1.7-1.7-1.5.6-.1 2.4h-3.6l-.1-2.4-1.5-.6-1.7 1.7-2.6-2.6 1.7-1.7-.6-1.5-2.4-.1v-3.6l2.4-.1.6-1.5-1.7-1.7 2.6-2.6 1.7 1.7 1.5-.6.1-2.4h3.6l.1 2.4 1.5.6 1.7-1.7 2.6 2.6-1.7 1.7zM12 9a3 3 0 110 6 3 3 0 010-6z',
  sparkle: 'M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9L11 3zm7 11l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14z',
  clip: 'M20 11.5l-7.6 7.6a5 5 0 01-7.1-7.1l8.3-8.3a3.3 3.3 0 014.7 4.7l-8.3 8.3a1.7 1.7 0 01-2.4-2.4l7.6-7.6',
  layout: 'M4 4h16v16H4V4zm0 5h16M10 9v11', import: 'M12 4v11m-4-4l4 4 4-4M5 19h14', export: 'M12 15V4M8 8l4-4 4 4M5 19h14',
  group: 'M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M8 8h8v8H8V8z', check: 'M5 12l4 4L19 6', stop: 'M6 6h12v12H6V6z',
  search: 'M10 3a7 7 0 110 14 7 7 0 010-14zm5 12l6 6', book: 'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3V4zm9 2v16',
  globe: 'M12 2a10 10 0 110 20 10 10 0 010-20zm0 0c-6 6-6 14 0 20 6-6 6-14 0-20zM3 8h18M3 16h18',
};
export default function Icon({ name, size = 18, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true"><path d={paths[name] ?? paths.note} /></svg>;
}
