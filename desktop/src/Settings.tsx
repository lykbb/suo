import Icon from './Icon';
import ModelSettings from './ModelSettings';
import { resetLayout } from './actions';
import { app } from './state';
import { preferences, setPreference } from './preferences';
import './Settings.css';

const tabs = [['appearance', '外观'], ['models', '模型'], ['input', '操作与布局'], ['about', '关于']] as const;
// A setting's value sits right against its arrow whatever the length of the options, so every row
// lines up on the right; the system list still opens on click and from the keyboard.
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <span className="settings-choice"><span>{options.find(([key]) => key === value)?.[1] ?? value}</span><Icon name="down" size={15} />
    <select aria-label={label} value={value} onChange={event => onChange(event.target.value as T)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></span>;
}
export default function Settings() {
  const tab = app.use(state => state.settingsTab);
  const prefs = preferences.use(state => state);
  return <div className="settings-layout">
    <nav className="settings-nav" aria-label="设置分类">{tabs.map(([id, title]) => <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} onClick={() => app.set({ settingsTab: id })}>{title}</button>)}</nav>
    <div className="settings-content">
      {tab === 'appearance' ? <section aria-label="外观设置"><h2>外观</h2>
        <label className="settings-row"><span>主题</span><Choice label="主题" value={prefs.theme} onChange={theme => setPreference({ theme })} options={[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']]} /></label>
        <label className="settings-row"><span>画布背景</span><Choice label="画布背景" value={prefs.background} onChange={background => setPreference({ background })} options={[['dots', '点阵'], ['grid', '网格'], ['plain', '纯色']]} /></label>
        <label className="settings-row"><span>动态效果</span><Choice label="动态效果" value={prefs.motion} onChange={motion => setPreference({ motion })} options={[['system', '跟随系统'], ['reduce', '减少动态效果']]} /></label>
      </section> : tab === 'models' ? <ModelSettings /> : tab === 'input' ? <section aria-label="操作与布局设置"><h2>操作与布局</h2>
        <label className="settings-row"><span>发送消息</span><Choice label="发送消息快捷键" value={prefs.sendKey} onChange={sendKey => setPreference({ sendKey })} options={[['enter', 'Enter'], ['modifier-enter', '⌘ / Ctrl + Enter']]} /></label>
        <div className="settings-row"><span>工作台布局</span><button type="button" className="chip" onClick={resetLayout}>恢复默认布局</button></div>
      </section> : <section aria-label="关于 Suo"><h2>Suo</h2><p>版本 0.1.0</p><p className="quiet">资料、草图与对话，在同一张工作台上。</p></section>}
    </div>
  </div>;
}
