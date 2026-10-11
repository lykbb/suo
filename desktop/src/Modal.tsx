import { useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon from './Icon';
import { closeModal, saveEditor, ungroup } from './actions';
import Settings from './Settings';
import { spring } from './motion';
import { app } from './state';
import Toolbox from './Toolbox';

function EditorBody() {
  // While the dialog animates out the editor is already cleared; keep showing the last one.
  const live = app.use(state => state.editor), last = useRef(live);
  if (live) last.current = live;
  const editor = live ?? last.current!;
  const kind = app.use(state => state.workspace?.nodes.find(node => node.id === editor.id)?.data.kind);
  return <>
    <label className="field-label" htmlFor="card-title">标题</label>
    <input id="card-title" autoFocus value={editor.title} maxLength={120} onChange={event => app.set({ editor: { ...editor, title: event.target.value } })} />
    {kind !== 'group' && <>
      <label className="field-label" htmlFor="card-content">内容</label>
      <textarea id="card-content" value={editor.content} maxLength={100000} onChange={event => app.set({ editor: { ...editor, content: event.target.value } })}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); saveEditor(); } }} />
    </>}
    <footer className="modal-foot">
      {kind === 'group' && <button type="button" className="chip" onClick={() => ungroup(editor.id)}>拆开分组</button>}
      <span className="quiet">⌘↩ 保存 · ⌘Z 撤销</span>
      <button type="button" className="chip" onClick={() => app.set({ editor: null })}>取消</button>
      <button type="button" className="accent-button" onClick={saveEditor}>保存</button>
    </footer>
  </>;
}

function Help() {
  return <Settings />;
}

export default function Modal() {
  const editor = app.use(state => state.editor), popup = app.use(state => state.popup);
  const managing = app.use(state => state.sessionManaging);
  const editingGroup = app.use(state => !!state.editor && state.workspace?.nodes.find(node => node.id === state.editor!.id)?.data.kind === 'group');
  const kind = editor && editingGroup ? 'editor' : popup === 'skills' || popup === 'help' ? popup : null;
  const title = editor ? '分组' : popup === 'skills' ? '产品工具箱' : '设置';
  return <AnimatePresence>{kind && <motion.div key="backdrop" className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.16 } }}
    onMouseDown={event => { if (event.target === event.currentTarget) closeModal(); }}>
    <motion.section key={kind} className="modal" inert={managing} role="dialog" aria-modal="true" aria-label={title}
      initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14 } }} transition={spring}>
      <header className="modal-head"><strong>{title}</strong><button type="button" className="icon-button" aria-label="关闭" onClick={closeModal}><Icon name="close" /></button></header>
      {kind === 'editor' ? <EditorBody /> : kind === 'skills' ? <Toolbox /> : <Help />}
    </motion.section>
  </motion.div>}</AnimatePresence>;
}
