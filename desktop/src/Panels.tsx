import { lazy, memo, Suspense, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import FloatingPanel, { usePanelRect } from './FloatingPanel';
import Icon from './Icon';
import CardAppearance from './CardAppearance';
import BoardOrganizer from './BoardOrganizer';
import { AttachmentChip } from './Attachments';
import Preview from './Preview';
import ComposerOptions from './ComposerOptions';
import MessageError from './MessageError.tsx';
import SourceLinks from './SourceLinks.tsx';
import { sourceClick, sourceDoubleClick, sourcePointerDown } from './sourceLinkEvents';
import { SLASH_COMMANDS, addCard, canTravelDraft, chooseOption, closeReader, continueMessage, copyMessage, openDrawing, pickFiles, replyToCanvas, retry, send, stop, travelDraftHistory, update, updateDraft } from './actions';
import { editableMarkdown } from './editableMarkdown';
import { preferences } from './preferences';
import { popover, spring } from './motion';
import { app, hasContentOf, hasThreadOf, isWelcomeOf } from './state';
import type { Ask, Message } from './types';

const EMPTY: Message[] = [];
const DrawingPreview = lazy(() => import('./DrawingPreview'));

export function Toolbar() {
  const rect = usePanelRect('toolbar');
  const tool = app.use(state => state.tool);
  const tools = [['select', 'cursor', '选择与框选'], ['pan', 'hand', '平移画布（也可按住空格拖动）']] as const;
  return <FloatingPanel name="toolbar" label="工具栏" rect={rect} className="toolbar" enterFrom="left">
    {tools.map(([value, icon, label]) => <button type="button" key={value} className={`tool ${tool === value ? 'active' : ''}`} title={label} aria-label={label} aria-pressed={tool === value} onClick={() => app.set({ tool: value })}>
      {tool === value && <motion.span layoutId="tool-active" className="tool-highlight" transition={spring} />}
      <Icon name={icon} />
    </button>)}
    <span className="tool-divider" />
    <CardAppearance />
    <BoardOrganizer />
    <button type="button" className="tool" title="绘图" aria-label="绘图" onClick={openDrawing}><Icon name="pencil" /></button>
    <button type="button" className="tool" title="新建便签（N）" aria-label="新建便签" onClick={() => addCard('note')}><Icon name="note" /></button>
    <button type="button" className="tool" title="新建文档" aria-label="新建文档" onClick={() => addCard('document')}><Icon name="file" /></button>
    <button type="button" className="tool" title="导入资料" aria-label="导入资料" onClick={() => void pickFiles()}><Icon name="import" /></button>
  </FloatingPanel>;
}

// Replies share the document renderer, including verifiable web links.
const Reply = memo(function Reply({ text }: { text: string }) {
  const html = useMemo(() => editableMarkdown(text), [text]);
  return <div className="card-markdown message-markdown" onClick={sourceClick} onPointerDown={sourcePointerDown} onDoubleClick={sourceDoubleClick} dangerouslySetInnerHTML={{ __html: html }} />;
});

// Suo's question: one click answers it; typing in the composer works too.
function AskOptions({ id, ask, active }: { id: string; ask: Ask; active: boolean }) {
  return <div className="message-ask" role="group" aria-label={ask.question}>
    <p className="message-ask-question">{ask.question}</p>
    {ask.options.map(option => <button type="button" key={option.label} className={`message-ask-option ${ask.answered === option.label ? 'chosen' : ''}`}
      disabled={!active || !!ask.answered} onClick={() => void chooseOption(id, option.label)}>
      <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
      {ask.answered === option.label && <Icon name="check" size={14} />}
    </button>)}
    {active && !ask.answered && <p className="quiet message-ask-hint">也可以直接在输入框里回答</p>}
  </div>;
}

function Messages() {
  const messages = app.use(state => state.workspace?.messages ?? EMPTY);
  const busy = app.use(state => state.busy);
  const list = useRef<HTMLDivElement>(null), pinned = useRef(true), count = useRef(messages.length);
  // Follow the reply only while the reader is at the bottom; a new message always scrolls into view.
  useEffect(() => {
    const element = list.current, added = messages.length !== count.current;
    count.current = messages.length;
    if (element && (added || pinned.current)) { element.scrollTop = element.scrollHeight; pinned.current = true; }
  }, [messages]);
  if (!messages.length) return <div className="messages"><div className="thread-empty"><Icon name="message" size={22} /><p>资料放在左边，讨论留在这里。<br />选中卡片后，可以围绕它继续聊。</p></div></div>;
  return <div className="messages" ref={list} onScroll={event => { const element = event.currentTarget; pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48; }}>
    <AnimatePresence initial={false}>{messages.map(message => <motion.article key={message.id} className={`message ${message.role}`} tabIndex={0}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <div className="message-author">{message.role === 'user' ? '你' : 'Suo'}</div>
      {message.steps?.length ? <ul className="message-steps">{message.steps.map(step => <li key={step.id} className={`message-step ${step.status}`}>
        <span className="step-mark" aria-label={step.status === 'running' ? '进行中' : step.status === 'done' ? '已完成' : '未完成'} />
        <span>{step.label}{step.detail && step.status !== 'running' ? <small>{step.detail}</small> : null}</span>
      </li>)}</ul> : null}
      {message.text ? message.role === 'assistant' ? <Reply text={message.text} /> : <p>{message.text}</p> : message.error ? null : busy && message.id === messages.at(-1)?.id ? <span className="typing" aria-label="正在整理"><i /><i /><i /></span> : message.steps?.length || message.ask ? null : <p className="quiet">回复已停止</p>}
      {message.ask && <AskOptions id={message.id} ask={message.ask} active={!busy && message.id === messages.at(-1)?.id} />}
      {message.role === 'assistant' && <SourceLinks steps={message.steps} />}
      {message.error && <MessageError error={message.error} />}
      {message.cardIds?.length ? <span className="context-tag">引用 {message.cardIds.length} 张卡片</span> : null}
      {message.contextNote && <span className="context-tag context-note">{message.contextNote}</span>}
      {message.cancelled && <span className="stopped-label">已停止</span>}
      {(message.role === 'user' || !busy || message.id !== messages.at(-1)?.id) && <div className="message-actions">
        {(message.text || message.error) && <button type="button" className="message-action" title={message.role === 'user' ? '复制消息' : '复制回复'} aria-label={message.role === 'user' ? '复制消息' : '复制回复'} onClick={() => void copyMessage(message.id)}><Icon name="copy" size={15} /></button>}
        {message.text && !message.cancelled && <button type="button" className="message-action" title="放到画布" aria-label="放到画布" onClick={() => replyToCanvas(message.id)}><Icon name="note" size={15} /></button>}
        {message.role === 'assistant' && message.incomplete && message.id === messages.at(-1)?.id && <button type="button" className="message-action" title="继续回复" aria-label="继续回复" disabled={busy} onClick={() => void continueMessage(message.id)}><Icon name="redo" size={15} />继续</button>}
        {message.role === 'assistant' && (message.cancelled || message.error) && !message.incomplete && !message.retryConflict && message.id === messages.at(-1)?.id && <button type="button" className="message-action" title="重试" aria-label="重试" disabled={busy} onClick={() => void retry(message.id)}><Icon name="redo" size={15} /></button>}
      </div>}
    </motion.article>)}</AnimatePresence>
  </div>;
}

export function ThreadPanel() {
  const hasThread = app.use(hasThreadOf);
  const rect = usePanelRect('thread');
  return <AnimatePresence>{hasThread && <FloatingPanel key="thread" name="thread" label="对话" rect={rect} className="conversation" enterFrom="right">
    <header className="conversation-head">
      <div><strong>对话</strong></div>
      <button type="button" className="icon-button" title="收起对话" aria-label="收起对话" onClick={() => app.set({ threadOpen: false })}><Icon name="chevron" size={16} /></button>
    </header>
    <Messages />
  </FloatingPanel>}</AnimatePresence>;
}

export function OpenThreadButton() {
  const show = app.use(state => hasContentOf(state) && !state.threadOpen);
  return <AnimatePresence>{show && <motion.button type="button" className="chip open-thread" onClick={() => app.set({ threadOpen: true })}
    initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={spring}>
    <Icon name="message" size={15} />对话
  </motion.button>}</AnimatePresence>;
}

export function Composer() {
  const rect = usePanelRect('composer');
  const draft = app.use(state => state.workspace?.draft ?? '');
  const ready = app.use(state => !!state.workspace);
  const welcome = app.use(isWelcomeOf);
  const busy = app.use(state => state.busy);
  const staged = app.use(state => state.attachments.length);
  app.use(state => state.historyVersion);
  const sendKey = preferences.use(state => state.sendKey);
  const selectedCount = app.use(state => state.workspace?.nodes.filter(node => node.selected && node.data.kind !== 'group').length ?? 0);
  const canSend = busy || !!draft.trim() || staged > 0;
  const slash = draft.startsWith('/') ? SLASH_COMMANDS.filter(([command]) => command.startsWith(draft.trim())) : [];
  // Mounted once the session is loaded, so it starts where it belongs instead of gliding there.
  if (!ready) return null;
  return <FloatingPanel name="composer" label="输入框" rect={rect} className={`composer ${welcome ? 'composer-home' : ''}`}>
    <div className="composer-input">
      <AttachmentChip />
      <textarea value={draft} aria-label="消息" placeholder={welcome ? '说说你的想法，或拖入资料…' : '接着说，或选中卡片后继续讨论'}
        onChange={event => updateDraft(event.target.value)}
        onKeyDown={event => {
          if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z' && !event.nativeEvent.isComposing) { event.preventDefault(); travelDraftHistory(event.shiftKey); return; }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && (sendKey === 'enter' || event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); }
        }} />
    </div>
    <div className="composer-foot">
      <div className="composer-left">
        <ComposerOptions />
        <button type="button" className="message-action" title="撤销草稿修改 ⌘Z" aria-label="撤销草稿修改" disabled={!canTravelDraft(false)} onClick={() => travelDraftHistory(false)}><Icon name="undo" size={14} /></button>
        <button type="button" className="message-action" title="恢复草稿修改 ⇧⌘Z" aria-label="恢复草稿修改" disabled={!canTravelDraft(true)} onClick={() => travelDraftHistory(true)}><Icon name="redo" size={14} /></button>
        <AnimatePresence mode="wait" initial={false}>
          {!welcome && selectedCount > 0 && <motion.span key="selected" className="context-label" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.14 }}>
            已引用 {selectedCount} 张卡片
          </motion.span>}
        </AnimatePresence>
      </div>
      <motion.button type="button" className={`send ${canSend ? 'ready' : ''} ${busy ? 'stop' : ''}`} aria-label={busy ? '停止回复' : '发送消息'}
        disabled={!canSend} whileTap={{ scale: 0.9 }} transition={spring} onClick={() => void (busy ? stop() : send())}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={busy ? 'stop' : 'arrow'} className="send-icon" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} transition={spring}>
            <Icon name={busy ? 'stop' : 'arrow'} size={18} />
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </div>
    <AnimatePresence>{slash.length > 0 && <motion.div key="slash" className="slash-menu" {...popover}>
      {slash.map(([command, label]) => <button type="button" key={command} onClick={() => void send(command)}><code>{command}</code><span>{label}</span></button>)}
    </motion.div>}</AnimatePresence>
  </FloatingPanel>;
}

export function ReaderPanel() {
  const asset = app.use(state => state.preview), rect = usePanelRect('reader');
  const sketch = app.use(state => state.sketchPreview);
  return asset || sketch ? <FloatingPanel key="reader" name="reader" label="文件阅读" rect={rect} className="reader-panel">
    <header className="conversation-head"><strong title={asset?.name}>{asset?.name ?? '草图'}</strong>{sketch && <button type="button" className="chip" onClick={openDrawing}>编辑草图</button>}<button type="button" className="icon-button" aria-label="关闭文件阅读" onClick={closeReader}><Icon name="close" /></button></header>
    {asset ? <Preview key={asset.id} asset={asset} /> : <div className="sketch-reader"><Suspense fallback={<p className="quiet">正在打开草图…</p>}><DrawingPreview /></Suspense></div>}
  </FloatingPanel> : null;
}
