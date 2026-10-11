import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { motion } from 'motion/react';
import Icon from './Icon';
import Preview, { DocumentText } from './Preview';
import { beginGroupResize, cancelGroupResize, commitCard, endGroupResize, exportCard, focusCard, groupResizeCancelled, pinCard, openCard, measureImage, previewGroupResize, record, saveEditor, takeEntrance } from './actions';
import { app } from './state';
import { flight, spring } from './motion';
import type { Card, Rect } from './types';
import './CardContent.css';
import { clearTextSelection } from './selection';
import { CardTags } from './CardAppearance';
import { cardMetadataStyle, normalizeCardColor } from './cardMetadata';
import { editableMarkdown } from './editableMarkdown';
import { sourceClick, sourceDoubleClick, sourcePointerDown } from './sourceLinkEvents';
import './SourceLinks.css';
import { groupResizeMinimum } from './grouping';
const DrawingPreview = lazy(() => import('./DrawingPreview'));

function variantOf(data: Card['data']) {
  if (data.kind === 'drawing') return 'drawing';
  if (data.asset) return 'file';
  if (data.kind === 'document') return 'document';
  return data.source === 'demo' ? 'suo' : 'note';
}
// Notes show their Markdown (lists, bold, tables) like documents do, but stay draggable by their text.
const NoteText = memo(function NoteText({ text }: { text: string }) {
  const html = useMemo(() => editableMarkdown(text), [text]);
  return <div className="card-body card-body-markdown" onClick={sourceClick} onPointerDown={sourcePointerDown} onDoubleClick={sourceDoubleClick} dangerouslySetInnerHTML={{ __html: html }} />;
});
function CardEditor({ id, title, content, document }: { id: string; title: string; content: string; document: boolean }) {
  const titleRef = useRef<HTMLInputElement>(null), bodyRef = useRef<HTMLTextAreaElement>(null), changed = useRef(false);
  useEffect(() => { const area = bodyRef.current; area?.focus(); area?.setSelectionRange(area.value.length, area.value.length); }, []);
  const change = () => {
    const next = { id, title: titleRef.current?.value ?? title, content: bodyRef.current?.value ?? content };
    commitCard(id, next.title, next.content, !changed.current);
    changed.current = true;
    app.set({ editor: next });
  };
  return <div className="card-edit" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) { event.preventDefault(); saveEditor(); }
  }}>
    <header className="card-heading editor-heading">
      <Icon name={document ? 'book' : 'note'} size={14} />
      <input ref={titleRef} className="card-edit-title nodrag nopan" defaultValue={title} onChange={change} maxLength={120} aria-label={document ? '文档标题' : '便签标题'} />
      <button type="button" className="card-action nodrag nopan" aria-label="完成编辑" title="完成编辑" onClick={saveEditor}><Icon name="check" size={15} /></button>
    </header>
    <textarea ref={bodyRef} className="card-edit-body nodrag nopan nowheel" defaultValue={content} onChange={change} maxLength={100000}
      placeholder={document ? '在这里开始写文档…' : '写下你的想法…'} aria-label={document ? '文档内容' : '便签内容'} />
  </div>;
}
export const CardNode = memo(function CardNode({ id, data, selected, dragging }: NodeProps<Card>) {
  const editing = app.use(state => state.editor?.id === id);
  const [entrance] = useState(() => takeEntrance(id)), [entered, setEntered] = useState(entrance === undefined);
  const from = entrance?.from, variant = variantOf(data);
  const media = !!data.asset && ['image', 'pdf', 'video', 'audio', 'html'].includes(data.asset.kind);
  const image = data.asset?.kind === 'image';
  const ratio = typeof data.imageAspectRatio === 'number' && data.imageAspectRatio > 0 ? data.imageAspectRatio : 1;
  const activate = useCallback((event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => focusCard(id, event.shiftKey || event.metaKey || event.ctrlKey), [id]);
  const open = useCallback(() => { focusCard(id); openCard(id); }, [id]);
  const imageSize = useCallback((width: number, height: number) => measureImage(id, width, height), [id]);
  useEffect(() => { if (editing && !selected && !dragging) saveEditor(); }, [editing, selected, dragging]);
  return <>
    <NodeResizer isVisible={!!selected && !dragging} keepAspectRatio={image} minWidth={image ? 64 * Math.min(1, ratio) : data.kind === 'drawing' ? 380 : data.asset ? 250 : 200} minHeight={image ? 64 / Math.max(1, ratio) : data.kind === 'drawing' ? 240 : data.asset ? 180 : 130}
      handleClassName="card-resize-handle" lineClassName="card-resize-line" onResizeStart={() => record()} />
    <Handle type="target" position={Position.Left} />
    <motion.article className={`work-card ${variant} ${selected ? 'selected' : ''} ${editing ? 'editing' : ''} ${media ? 'media-card' : ''} ${image ? 'image-card' : ''}`}
      style={cardMetadataStyle(data.color)} data-custom-color={normalizeCardColor(data.color)}
      onPointerDownCapture={event => { if (!(event.target as Element).closest('a[data-source-link]')) activate(event); }}
      tabIndex={data.kind === 'drawing' ? 0 : undefined}
      aria-label={data.kind === 'drawing' ? '草图预览' : undefined}
      onKeyDown={event => { if (event.target === event.currentTarget && data.kind === 'drawing' && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); open(); } }}
      initial={!entrance ? false : from ? { opacity: 0, x: from.x, y: from.y, scale: from.scale, rotate: from.rotate } : { opacity: 0, scale: 0.94, y: 12 }}
      animate={{ opacity: 1, scale: dragging ? 1.025 : 1, x: 0, y: 0, rotate: 0 }}
      transition={!entered && entrance ? { ...(from ? flight : spring), delay: entrance.delay, opacity: { duration: 0.18, delay: entrance.delay } } : spring}
      onAnimationComplete={() => { if (!entered) setEntered(true); }}
      onDoubleClick={event => { event.stopPropagation(); if (!(event.target as Element).closest('a, button, input, textarea, video, audio')) { event.preventDefault(); clearTextSelection(); open(); } }}>
      {editing && !data.asset ? <CardEditor id={id} title={data.title} content={data.content} document={variant === 'document'} /> : <>
        {image ? <><button type="button" className={`image-pin card-action nodrag nopan ${data.pinned ? 'active' : ''}`} aria-label={data.pinned ? '取消图片置顶' : '置顶图片'} aria-pressed={!!data.pinned} title={data.pinned ? '取消置顶' : '置顶'} onClick={() => pinCard(id)}><Icon name="pin" size={15} /></button></> : <header className="card-heading">
          <button type="button" className={`card-action card-pin nodrag nopan ${data.pinned ? 'active' : ''}`} aria-label={data.pinned ? '取消卡片置顶' : '置顶卡片'} aria-pressed={!!data.pinned} title={data.pinned ? '取消置顶' : '置顶'} onClick={() => pinCard(id)}><Icon name="pin" size={14} /></button>
          <span className="card-title">{variant === 'drawing' ? <Icon name="pencil" size={14} /> : variant === 'file' ? <Icon name="file" size={14} /> : variant === 'document' ? <Icon name="book" size={14} /> : null}{data.title || '新便签'}</span>
          {data.asset ? <button type="button" className="card-action nodrag nopan" aria-label="放大阅读" title="放大阅读" onClick={open}><Icon name="fit" size={14} /></button>
            : variant === 'suo' ? <span className="suo-mark" title="由 Suo 生成">Suo</span> : variant === 'document' ? <span className="card-actions"><button type="button" className="card-action nodrag nopan" aria-label="导出为 Markdown" title="导出为 Markdown" onClick={() => void exportCard(id)}><Icon name="export" size={14} /></button><button type="button" className="card-action nodrag nopan" aria-label="编辑文档" title="编辑文档" onClick={open}><Icon name="note" size={14} /></button></span> : null}
        </header>}
        {data.kind === 'drawing' ? <div className="sketch-preview"><Suspense fallback={<div className="sketch-preview-empty" role="status">正在打开预览…</div>}><DrawingPreview /></Suspense></div>
          : data.asset ? <Preview key={data.asset.id} asset={data.asset} compact onActivate={activate} onOpen={open} onImageSize={imageSize} />
          : variant === 'document' && data.content ? <DocumentText text={data.content} markdown compact editable onActivate={activate} onOpen={open} />
          : data.content ? <NoteText text={data.content} />
          : <p className="card-body empty">{variant === 'document' ? '双击开始写文档' : '双击写下你的想法'}</p>}
      </>}
      <CardTags tags={data.tags}/>
    </motion.article>
    <Handle type="source" position={Position.Right} />
  </>;
});
export const GroupNode = memo(function GroupNode({ id, data, selected }: NodeProps<Card>) {
  const [entrance] = useState(() => takeEntrance(id));
  const nodes = app.use(state => state.workspace?.nodes ?? []);
  const minimum = useMemo(() => groupResizeMinimum(nodes, id), [nodes, id]);
  const begin = useCallback(() => beginGroupResize(id), [id]);
  const preview = useCallback((_: unknown, rect: Rect) => previewGroupResize(id, rect), [id]);
  const end = useCallback(() => endGroupResize(id), [id]);
  const shouldResize = useCallback(() => !groupResizeCancelled(id), [id]);
  useEffect(() => {
    const cancel = () => { cancelGroupResize(id); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && cancelGroupResize(id)) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener('keydown', escape, true);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchcancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchcancel', cancel);
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, [id]);
  return <>
    <NodeResizer isVisible={!!selected} minWidth={minimum.width} minHeight={minimum.height} handleClassName="card-resize-handle" lineClassName="card-resize-line"
      onResizeStart={begin} onResize={preview} onResizeEnd={end} shouldResize={shouldResize} />
    {/* Links to a group (made by Suo or by dragging) need these to be drawn. */}
    <Handle type="target" position={Position.Left} />
    <motion.div className={`card-group ${selected ? 'selected' : ''}`} initial={entrance === undefined ? false : { opacity: 0, scale: 0.98 }}
      style={cardMetadataStyle(data.color)} data-custom-color={normalizeCardColor(data.color)}
      animate={{ opacity: 1, scale: 1 }} transition={spring} onDoubleClick={event => { event.stopPropagation(); if (!(event.target as Element).closest('button, input')) openCard(id); }}>
      <div className="card-group-heading"><span>{data.title}</span></div><CardTags tags={data.tags}/>
    </motion.div>
    <Handle type="source" position={Position.Right} />
  </>;
});
