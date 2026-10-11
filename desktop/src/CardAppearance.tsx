import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { saveEditor, updateCardMetadata } from './actions';
import { app } from './state';
import { CARD_COLORS, MAX_CARD_TAGS, MAX_TAG_LENGTH, cardMetadataStyle, normalizeCardColor, readCardTags } from './cardMetadata';
import type { CardData } from './types';
import './CardAppearance.css';

export function CardTags({ tags }: { tags: unknown }) {
  const values = readCardTags(tags);
  return values.length ? <div className="card-tags" aria-label="卡片标签">{values.map(tag => <span key={tag} title={tag}>{tag}</span>)}</div> : null;
}

function PaletteIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3a9 9 0 100 18h1a2 2 0 001.7-3c-.5-.8 0-2 1-2H18a3 3 0 003-3A10 10 0 0012 3z"/><path d="M7.5 10h.01M10 6.8h.01M15 7.5h.01M17.5 11h.01" strokeWidth="2.5"/>
  </svg>;
}

export default function CardAppearance() {
  const workspaceId = app.use(state => state.workspace?.id ?? '');
  const nodes = app.use(state => state.workspace?.nodes);
  const selected = nodes?.filter(node => node.selected) ?? [];
  const card = selected.length === 1 ? selected[0] : undefined;
  if (!card) return <button type="button" className="tool toolbar-appearance" disabled aria-label="颜色与标签"
    title={selected.length ? '请先只选中一张卡片' : '选中卡片后设置颜色与标签'}><PaletteIcon /></button>;
  return <AppearanceEditor key={`${workspaceId}:${card.id}`} id={card.id} data={card.data} />;
}

function AppearanceEditor({ id, data }: { id: string; data: CardData }) {
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), tagInput = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [custom, setCustom] = useState(''), [tag, setTag] = useState(''), [error, setError] = useState('');
  const tags = readCardTags(data.tags), color = normalizeCardColor(data.color) ?? '';
  const close = () => { setPosition(null); setError(''); };
  useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !button.current?.contains(event.target)) close();
    };
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close(); button.current?.focus(); return;
      }
      if (!target || !panel.current?.contains(target)) return;
      event.stopPropagation();
      if (event.key === 'Tab') {
        const controls = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')];
        const current = controls.indexOf(document.activeElement as HTMLElement);
        if (controls.length && (event.shiftKey ? current <= 0 : current === controls.length - 1)) {
          event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0].focus();
        }
      }
      if (!target.closest('input,textarea,[contenteditable=true]') &&
        (event.key === 'Backspace' || event.key === 'Delete' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a'))) event.preventDefault();
    };
    panel.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    const moved = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', keyboard, true);
    document.addEventListener('wheel', moved, { capture: true, passive: true });
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', keyboard, true);
      document.removeEventListener('wheel', moved, true);
      window.removeEventListener('resize', close);
    };
  }, [position]);
  const open = () => {
    if (position) { close(); return; }
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    saveEditor();
    setCustom(color); setTag(''); setError('');
    const left = rect.right + 12 + 288 <= innerWidth - 12 ? rect.right + 12 : rect.left - 12 - 288;
    setPosition({ left: Math.max(12, Math.min(left, innerWidth - 300)), top: Math.max(12, Math.min(rect.top, innerHeight - 370)) });
  };
  const addTag = () => {
    const next = tag.trim().replace(/\s+/gu, ' ');
    if (!next) return;
    if (tags.some(value => value.toLocaleLowerCase() === next.toLocaleLowerCase())) { setError('这个标签已经添加。'); return; }
    if (tags.length >= MAX_CARD_TAGS) { setError('每张卡片最多 8 个标签。'); return; }
    if (updateCardMetadata(id, { tags: [...tags, next] })) { setTag(''); setError(''); tagInput.current?.focus(); }
  };
  return <>
    <button ref={button} type="button" className={`tool toolbar-appearance ${position ? 'active' : ''}`}
      aria-label="颜色与标签" title="颜色与标签" aria-haspopup="dialog" aria-expanded={!!position} onClick={open}>
      <PaletteIcon />
    </button>
    {position && createPortal(<div ref={panel} className="card-appearance-popover nodrag nopan nowheel" role="dialog" aria-label="颜色与标签设置" style={{ ...position, maxHeight: `calc(100dvh - ${position.top + 12}px)` }}
      onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <header><strong>颜色与标签</strong><button type="button" className="icon-button" aria-label="关闭颜色与标签" onClick={close}><Icon name="close" size={15}/></button></header>
      <fieldset><legend>卡片颜色</legend><div className="card-color-options">{CARD_COLORS.map(option => <button type="button" key={option.name}
        className={`card-color-swatch ${color === option.value ? 'chosen' : ''}`} style={{ ...cardMetadataStyle(option.value), background: option.value ? 'var(--card-fill)' : 'var(--surface)' }} data-custom-color={option.value || undefined}
        aria-label={option.name} aria-pressed={color === option.value} title={option.name} onClick={() => { updateCardMetadata(id, { color: option.value || null }); setCustom(option.value); setError(''); }}>
        {color === option.value && <Icon name="check" size={14}/>}</button>)}</div></fieldset>
      <form className="card-custom-color" onSubmit={event => { event.preventDefault(); const next = normalizeCardColor(custom); if (!next) { setError('请输入有效颜色，例如 #DBEAFE。'); return; } updateCardMetadata(id, { color: next }); setCustom(next); setError(''); }}>
        <input id={`color-${id}`} aria-label="自定义颜色" value={custom} placeholder="#DBEAFE" maxLength={7} spellCheck={false} onChange={event => setCustom(event.target.value)}/>
        <button type="submit" aria-label="应用自定义颜色" title="应用颜色"><Icon name="check" size={15}/></button>
      </form>
      <fieldset className="card-tag-editor"><legend>标签 <small>{tags.length}/{MAX_CARD_TAGS}</small></legend>
        {!!tags.length && <div className="card-tag-list">{tags.map(value => <span key={value}>{value}<button type="button" aria-label={`移除标签 ${value}`} title="移除标签" onClick={() => { if (updateCardMetadata(id, { tags: tags.filter(item => item !== value) })) tagInput.current?.focus({ preventScroll: true }); }}><Icon name="close" size={12}/></button></span>)}</div>}
        <form onSubmit={event => { event.preventDefault(); addTag(); }}>
          <input ref={tagInput} aria-label="新标签" value={tag} maxLength={MAX_TAG_LENGTH} placeholder="输入标签，按 Enter 添加" onChange={event => { setTag(event.target.value); setError(''); }}/>
          <button type="submit" disabled={!tag.trim()} aria-label="添加标签" title="添加标签"><Icon name="plus" size={16}/></button>
        </form>
      </fieldset>
      {error && <p className="card-metadata-error" role="status">{error}</p>}
    </div>, document.body)}
  </>;
}
