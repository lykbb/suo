import { AnimatePresence, motion } from 'motion/react';
import Icon from './Icon';
import { switchSession, togglePopup, toggleSessions } from './actions';
import { spring } from './motion';
import { app, hasContentOf, isWelcomeOf } from './state';
import './Toolbox.css';

// The flat version of the ribbon S: one ink colour, the orbit tucked behind the letter (the letter's
// halo is the title bar colour) and Suo's orange as the single ball on it.
export function BrandMark({ size = 30 }: { size?: number }) {
  return <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <ellipse className="brand-orbit" cx="16" cy="17" rx="13.4" ry="4.6" transform="rotate(-22 16 17)" />
    <text className="brand-letter" x="15.5" y="25.6" textAnchor="middle">S</text>
    <circle className="brand-dot" cx="3.6" cy="22" r="1.2" />
    <circle className="brand-ball" cx="28.4" cy="12" r="2.5" />
  </svg>;
}

export default function TitleBar() {
  const title = app.use(state => state.workspace?.title ?? '正在打开…');
  const sessionsOpen = app.use(state => state.popup === 'sessions');
  const canCreate = app.use(state => !state.sessionManaging);
  // The home page shows only the mark; the session switcher and layout appear once there is work.
  const working = app.use(hasContentOf);
  const home = app.use(isWelcomeOf);
  const reveal = { initial: { opacity: 0, x: -6 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, transition: { duration: 0.12 } }, transition: spring };
  return <header className="titlebar" data-tauri-drag-region>
    <div className="title-left" data-tauri-drag-region>
      <BrandMark size={34} />
      <AnimatePresence initial={false}>{working && <motion.button key="session" type="button" className={`session-title ${sessionsOpen ? 'open' : ''}`} disabled={!canCreate} aria-expanded={sessionsOpen} onClick={() => void toggleSessions()} {...reveal}>
        <span>{title}</span><Icon name="down" size={14} />
      </motion.button>}</AnimatePresence>
      {!home && <button type="button" className="new-session" title="新会话" aria-label="新会话" disabled={!canCreate} onClick={() => void switchSession()}><Icon name="compose" size={20} /></button>}
    </div>
    <div className="title-right">
      <button type="button" className="chip" disabled={!canCreate} onClick={() => togglePopup('skills')}><Icon name="sparkle" size={16} />技能</button>
      <button type="button" className="icon-button" title="设置" aria-label="设置" disabled={!canCreate} onClick={() => { app.set({ settingsTab: 'appearance' }); togglePopup('help'); }}><Icon name="settings" /></button>
    </div>
  </header>;
}
