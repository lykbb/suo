import ModelSettings from './ModelSettings';
import { resetLayout } from './actions';
import { app } from './state';
import { preferences, setPreference } from './preferences';
import './Settings.css';

const tabs = [['appearance', '外观'], ['models', '模型'], ['input', '操作与布局'], ['about', '关于']] as const;
export default function Settings() {
  const tab = app.use(state => state.settingsTab);
  const prefs = preferences.use(state => state);
  return <div className="settings-layout">
    <nav className="settings-nav" aria-label="设置分类">{tabs.map(([id, title]) => <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} onClick={() => app.set({ settingsTab: id })}>{title}</button>)}</nav>
    <div className="settings-content">
      {tab === 'appearance' ? <section aria-label="外观设置"><h2>外观</h2>
        <label className="settings-row"><span>主题</span><select aria-label="主题" value={prefs.theme} onChange={event => setPreference({ theme: event.target.value as typeof prefs.theme })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
        <label className="settings-row"><span>画布背景</span><select aria-label="画布背景" value={prefs.background} onChange={event => setPreference({ background: event.target.value as typeof prefs.background })}><option value="dots">点阵</option><option value="grid">网格</option><option value="plain">纯色</option></select></label>
        <label className="settings-row"><span>动态效果</span><select aria-label="动态效果" value={prefs.motion} onChange={event => setPreference({ motion: event.target.value as typeof prefs.motion })}><option value="system">跟随系统</option><option value="reduce">减少动态效果</option></select></label>
      </section> : tab === 'models' ? <ModelSettings /> : tab === 'input' ? <section aria-label="操作与布局设置"><h2>操作与布局</h2>
        <label className="settings-row"><span>发送消息</span><select aria-label="发送消息快捷键" value={prefs.sendKey} onChange={event => setPreference({ sendKey: event.target.value as typeof prefs.sendKey })}><option value="enter">Enter</option><option value="modifier-enter">⌘ / Ctrl + Enter</option></select></label>
        <div className="settings-row"><span>工作台布局</span><button type="button" className="chip" onClick={resetLayout}>恢复默认布局</button></div>
      </section> : <section aria-label="关于 Suo"><h2>Suo</h2><p>版本 0.1.0</p><p className="quiet">资料、草图与对话，在同一张工作台上。</p></section>}
    </div>
  </div>;
}
