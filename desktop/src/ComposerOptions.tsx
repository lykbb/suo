import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Icon from './Icon';
import { addCard, focusComposer, openDrawing, pickFiles, update } from './actions';
import { request } from './bridge';
import { popover } from './motion';
import { app } from './state';
import type { ModelCatalog, ModelChoice } from './types';
import './ComposerOptions.css';

const TOOLS = [
  { command: '/draw', title: '绘图', detail: '自由绘制图形与流程', icon: 'pencil', run: openDrawing },
  { command: '/note', title: '新建便签', detail: '记下一个想法', icon: 'note', run: () => addCard('note') },
  { command: '/document', title: '新建文档', detail: '展开写一份工作底稿', icon: 'file', run: () => addCard('document') },
  { command: '/import', title: '导入资料', detail: '添加文档、图片或 PDF', icon: 'clip', run: () => void pickFiles() },
  { command: '/help', title: '设置', detail: '管理模型连接', icon: 'settings', run: () => app.set({ popup: 'help', settingsTab: 'models' }) },
];
const sameModel = (a: { provider: string; id: string } | undefined, b: ModelChoice) => a?.provider === b.provider && a.id === b.id;
const tokens = (value?: number) => value === undefined ? '未设置' : value.toLocaleString('zh-CN');

function ControlIcon({ tools = false }: { tools?: boolean }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={tools ? 'M4 7h4m4 0h8M4 17h8m4 0h4M8 4v6m8 4v6' : 'M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5M3 16l9 5 9-5'} />
  </svg>;
}

export default function ComposerOptions() {
  const [menu, setMenu] = useState<'model' | 'tools' | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const choice = app.use(state => state.workspace?.model);
  const sessionId = app.use(state => state.workspace?.id);
  const busy = app.use(state => state.busy);
  const container = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  const label = catalog?.models.find(model => sameModel(choice, model))?.name ?? choice?.id ?? 'Best';
  const automaticModel = catalog?.models.find(model => sameModel(catalog?.selected, model)) ?? catalog?.models[0];

  useEffect(() => { setMenu(null); }, [sessionId]);
  useEffect(() => { const changed = () => { setCatalog(null); setRefresh(value => value + 1); }; window.addEventListener('suo-models-changed', changed); return () => window.removeEventListener('suo-models-changed', changed); }, []);
  useEffect(() => { if (busy) setMenu(null); }, [busy]);
  useEffect(() => {
    const open = () => { if (!busy) { trigger.current = modelTrigger.current; setMenu('model'); } };
    window.addEventListener('suo-open-model-selector', open);
    return () => window.removeEventListener('suo-open-model-selector', open);
  }, [busy]);
  useEffect(() => {
    if (menu !== 'model') return;
    let cancelled = false;
    setLoading(true); setError('');
    request<ModelCatalog>('models.list').then(value => { if (!cancelled) setCatalog(value); })
      .catch(() => { if (!cancelled) setError('模型配置暂时读不到，请稍后重试。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [menu, refresh]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setMenu(null); };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); setMenu(null); trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, [menu]);
  function toggle(value: 'model' | 'tools', button: HTMLButtonElement) {
    trigger.current = button;
    setMenu(current => current === value ? null : value);
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }
  function select(model?: ModelChoice) {
    update(workspace => ({ ...workspace, model: model ? { provider: model.provider, id: model.id } : undefined }));
    setMenu(null); focusComposer();
  }
  return <div className="composer-options" ref={container}>
    <button type="button" className={`composer-control ${menu === 'tools' ? 'open' : ''}`} aria-label="选择工具" aria-haspopup="dialog" aria-expanded={menu === 'tools'} aria-controls="composer-tools" disabled={busy} onClick={event => toggle('tools', event.currentTarget)}>
      <ControlIcon tools /><span>工具</span>
    </button>
    <button type="button" ref={modelTrigger} className={`composer-control model-control ${menu === 'model' ? 'open' : ''}`} aria-label="选择模型" title={choice ? `${choice.provider} / ${choice.id}` : 'Best：自动使用已配置的默认模型'} aria-haspopup="dialog" aria-expanded={menu === 'model'} aria-controls="composer-models" disabled={busy} onClick={event => toggle('model', event.currentTarget)}>
      <ControlIcon /><span>{label}</span><Icon name="down" size={12} />
    </button>
    <AnimatePresence>{menu && <motion.div key={menu} id={menu === 'model' ? 'composer-models' : 'composer-tools'} ref={panel} className="composer-popover" role="dialog" aria-label={menu === 'model' ? '模型选择' : '工具菜单'} onKeyDown={keyboard}
      {...(reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } } : popover)}>
      <header className="composer-popover-head"><strong>{menu === 'model' ? '选择模型' : '工具'}</strong></header>
      {menu === 'model' ? <>
        <div className="composer-options-list" aria-busy={loading}>
          {loading ? <p className="option-empty" role="status">正在读取模型配置…</p> : error ? <div className="option-empty" role="alert">{error}<button type="button" className="option-retry" onClick={() => setRefresh(value => value + 1)}>重试</button></div> : <>
            <button type="button" className={`composer-option ${!choice ? 'selected' : ''}`} aria-pressed={!choice} onClick={() => select()}>
              <span className="option-icon"><ControlIcon /></span><span className="option-copy"><strong>Best</strong><small>{automaticModel ? `自动使用 ${automaticModel.name}` : '自动使用已配置的默认模型'}</small></span>{!choice && <Icon name="check" size={15} />}
            </button>
            {catalog?.models.map(model => <button type="button" key={`${model.provider}/${model.id}`} className={`composer-option ${sameModel(choice, model) ? 'selected' : ''}`} aria-pressed={sameModel(choice, model)} onClick={() => select(model)}>
              <span className="option-icon"><ControlIcon /></span><span className="option-copy"><strong>{model.name}</strong><small>{model.provider}</small><small>上下文 {tokens(model.contextWindow)} · 输出 {tokens(model.maxTokens)}</small></span>{sameModel(choice, model) && <Icon name="check" size={15} />}
            </button>)}
            {!catalog?.models.length && <p className="option-empty">还没有模型，先添加连接。</p>}
            {!!choice && !catalog?.models.some(model => sameModel(choice, model)) && <p className="option-empty">之前选择的模型已不在配置中，请重新选择。</p>}
          </>}
        </div>
        <button type="button" className="option-retry" onClick={() => { setMenu(null); app.set({ popup: 'help', settingsTab: 'models' }); }}>管理模型连接</button>
      </> : <div className="composer-options-list">{TOOLS.map(tool => <button type="button" className="composer-option" key={tool.command} onClick={() => { setMenu(null); tool.run(); }}>
        <span className="option-icon"><Icon name={tool.icon} size={16} /></span><span className="option-copy"><strong>{tool.title}</strong><small>{tool.detail}</small></span><code>{tool.command}</code>
      </button>)}</div>}
    </motion.div>}</AnimatePresence>
  </div>;
}
