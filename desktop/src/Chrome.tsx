import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { AnimatePresence, motion } from 'motion/react';
import Icon from './Icon';
import { addCard, flush, frameBoard, groupSelected, pickFiles, manageSession, notice, switchSession, emptySessionTrash } from './actions';
import { fade, popover, reducedMotion, spring } from './motion';
import { app, isWelcomeOf } from './state';
import { native, request } from './bridge';
import type { WorkspaceSummary } from './types';

export function SelectionBar() {
  const count = app.use(state => state.workspace?.nodes.filter(node => node.selected && node.data.kind !== 'group').length ?? 0);
  return <AnimatePresence>{count >= 2 && <motion.div className="selection-actions" initial={{ opacity: 0, y: -8, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: -8, x: '-50%' }} transition={spring}>
    <span>已选 {count} 张</span>
    <button type="button" title="⌘G" onClick={groupSelected}><Icon name="group" size={15} />归为一组<kbd>⌘G</kbd></button>
  </motion.div>}</AnimatePresence>;
}

export function BottomStatus() {
  const status = app.use(state => state.saveStatus);
  return <AnimatePresence>{status === '保存失败' && <motion.div className="bottom-status" role="status"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
    <button type="button" className="save-status failed" onClick={() => void flush()}>保存失败 · 重试</button>
  </motion.div>}</AnimatePresence>;
}

export function ZoomControls() {
  const zoom = useStore(state => state.transform[2]);
  const flow = useReactFlow();
  const duration = () => reducedMotion() ? 0 : 200;
  return <div className="zoom-controls">
    <button type="button" aria-label="缩小" onClick={() => void flow.zoomOut({ duration: duration() })}><Icon name="minus" size={16} /></button>
    <span aria-live="off">{Math.round(zoom * 100)}%</span>
    <button type="button" aria-label="放大" onClick={() => void flow.zoomIn({ duration: duration() })}><Icon name="plus" size={16} /></button>
    <span className="zoom-divider" />
    <button type="button" aria-label="适配所有卡片" title="适配所有卡片" onClick={() => frameBoard()}><Icon name="fit" size={16} /></button>
  </div>;
}

export function CreateMenu() {
  const menu = app.use(state => state.menu);
  return <AnimatePresence>{menu && <motion.div key={`${menu.x}:${menu.y}`} className="popover create-menu" style={{ left: menu.x, top: menu.y, transformOrigin: 'top left' }} {...popover}>
    <p>在这里新建</p>
    <button type="button" onClick={() => addCard('note')}><Icon name="note" />便签</button>
    <button type="button" onClick={() => addCard('document')}><Icon name="file" />文档</button>
    <button type="button" onClick={() => void pickFiles()}><Icon name="import" />导入文件</button>
  </motion.div>}</AnimatePresence>;
}

export function SessionMenu() {
  const panel = useRef<HTMLDivElement>(null);
  const open = app.use(state => state.popup === 'sessions');
  useEffect(() => {
    if (!open) return;
    const dismiss = () => { if (app.get().popup === 'sessions') app.set({ popup: '' }); };
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || panel.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.session-title, .welcome-history')) return;
      dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); dismiss();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', dismiss);
    };
  }, [open]);
  const sessions = app.use(state => state.sessions);
  const currentId = app.use(state => state.workspace?.id);
  const managing = app.use(state => state.sessionManaging);
  const [actionsId, setActionsId] = useState('');
  const [renaming, setRenaming] = useState('');
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState('');
  const [trashed, setTrashed] = useState(false);
  const [trash, setTrash] = useState<WorkspaceSummary[]>([]);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [loadingTrash, setLoadingTrash] = useState(false);
  useEffect(() => {
    if (!open) { setActionsId(''); setRenaming(''); setDeleting(''); setTrashed(false); setPurgeConfirm(false); }
  }, [open]);
  useEffect(() => {
    if (!open || !trashed) return;
    let cancelled = false;
    setLoadingTrash(true);
    request<WorkspaceSummary[]>('workspace.trash').then(value => { if (!cancelled) setTrash(value); }).catch(error => { if (!cancelled) notice(String(error)); }).finally(() => { if (!cancelled) setLoadingTrash(false); });
    return () => { cancelled = true; };
  }, [open, trashed, sessions]);
  const apply = async (id: string, change: Parameters<typeof manageSession>[1]) => {
    if (await manageSession(id, change)) { setActionsId(''); setRenaming(''); setDeleting(''); }
  };
  const home = app.use(isWelcomeOf);
  return <AnimatePresence>{open && <motion.div key="sessions" ref={panel} className={`popover session-menu ${home ? 'from-home' : ''}`} role="dialog" aria-label="会话列表"
    style={{ transformOrigin: home ? 'bottom center' : 'top left' }} initial={popover.initial}
    animate={{ ...popover.animate, transition: { ...fade, duration: 0.14 } }}
    exit={{ ...popover.exit, pointerEvents: 'none', transition: { duration: 0.08 } }}>
    <div className="popover-heading">{trashed ? '回收站' : '会话'}<button type="button" className="icon-button" aria-label="关闭会话列表" onClick={() => app.set({ popup: '' })}><Icon name="close" size={15} /></button></div>
    <div className="session-list">{(trashed ? trash : sessions).map(item => <div className={`session-row ${item.id === currentId && !trashed ? 'chosen' : ''}`} key={item.id}>
      <div className="session-row-main">
        {renaming === item.id ? <form className="session-rename" onSubmit={event => { event.preventDefault(); void apply(item.id, { title: name }); }}>
          <input autoFocus aria-label="会话名称" value={name} maxLength={120} disabled={managing} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setRenaming(''); } }} />
          <button type="submit" disabled={managing || !name.trim()} aria-label="保存会话名称"><Icon name="check" size={16} /></button>
          <button type="button" disabled={managing} aria-label="取消重命名" onClick={() => setRenaming('')}><Icon name="close" size={16} /></button>
        </form> : <>
          <button type="button" className="session-open" disabled={managing || trashed} onClick={() => void switchSession(item.id)}>
            <Icon name={item.pinned && !trashed ? 'pin' : 'message'} size={16} /><span>{item.title}</span><small>{new Date(item.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</small>
          </button>
          {trashed ? <button type="button" className="session-restore" disabled={managing} onClick={() => void apply(item.id, { restore: true, version: item.version })}>恢复</button>
            : <button type="button" className="session-more" disabled={managing} aria-label={`${item.title}的会话选项`} aria-expanded={actionsId === item.id} onClick={() => { setActionsId(actionsId === item.id ? '' : item.id); setDeleting(''); }}><Icon name="more" size={16} /></button>}
        </>}
      </div>
      {!trashed && actionsId === item.id && renaming !== item.id && (deleting === item.id ? <div className="session-confirm">
        <p>将“{item.title}”移入回收站？</p><div><button type="button" disabled={managing} onClick={() => setDeleting('')}>取消</button><button type="button" className="danger" disabled={managing} onClick={() => void apply(item.id, { remove: true })}>移入回收站</button></div>
      </div> : <div className="session-actions">
        <button type="button" disabled={managing} onClick={() => { setRenaming(item.id); setName(item.title); }}><Icon name="pencil" size={14} />重命名</button>
        <button type="button" disabled={managing} onClick={() => void apply(item.id, { pinned: !item.pinned })}><Icon name="pin" size={14} />{item.pinned ? '取消置顶' : '置顶'}</button>
        <button type="button" className="danger" disabled={managing} onClick={() => setDeleting(item.id)}><Icon name="trash" size={14} />删除</button>
      </div>)}
    </div>)}</div>
    {trashed && <p className="session-empty" role="status">{loadingTrash ? '正在读取…' : !trash.length ? '回收站是空的' : '删除的会话可以在这里恢复。'}</p>}
    {trashed && !!trash.length && (purgeConfirm ? <div className="session-confirm"><p>{native ? '以下会话及未共享附件将移入系统废纸篓：' : '以下会话及未共享附件将永久移除，无法恢复：'}</p><ul>{trash.map(item => <li key={item.id}>{item.title}</li>)}</ul><div><button type="button" disabled={managing} onClick={() => setPurgeConfirm(false)}>取消</button><button type="button" className="danger" disabled={managing} onClick={() => void emptySessionTrash(trash).then(done => { if (done) { setTrash([]); setPurgeConfirm(false); } })}>确认清空</button></div></div> : <button type="button" className="session-trash-toggle danger" disabled={managing || loadingTrash} onClick={() => setPurgeConfirm(true)}><Icon name="trash" size={14} />清空回收站</button>)}
    <button type="button" className="session-trash-toggle" disabled={managing} onClick={() => { setTrashed(!trashed); setActionsId(''); setRenaming(''); setDeleting(''); }}><Icon name={trashed ? 'back' : 'trash'} size={14} />{trashed ? '返回会话' : '回收站'}</button>
  </motion.div>}</AnimatePresence>;
}

export function DropOverlay() {
  const show = app.use(state => state.dragOver), home = app.use(isWelcomeOf);
  return <AnimatePresence>{show && <motion.div className="drop-overlay" initial={{ opacity: 0, scale: 0.99 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={fade}>
    <Icon name="import" size={32} /><strong>{home ? '松开文件，先放进输入框' : '松开文件，放到画布上'}</strong><span>文档、图片、PDF · 单个文件最多 200 MB</span>
  </motion.div>}</AnimatePresence>;
}

export function Toast() {
  const toast = app.use(state => state.toast);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => app.set({ toast: '' }), 4500); return () => clearTimeout(timer); }, [toast]);
  return <AnimatePresence>{toast && <motion.div key={toast} className="toast" role="status" aria-live="polite"
    initial={{ opacity: 0, y: 8, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 4, x: '-50%', transition: { duration: 0.14 } }} transition={spring}>
    <Icon name="check" size={16} /><span>{toast}</span>
  </motion.div>}</AnimatePresence>;
}
