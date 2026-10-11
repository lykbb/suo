import { useEffect, useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { AttachmentFan } from './Attachments';
import { startWith, toggleSessions } from './actions';
import { request } from './bridge';
import { welcomeComposer } from './geometry';
import { spring } from './motion';
import { app, isWelcomeOf } from './state';
import type { ModelCatalog } from './types';

const sequence: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } } };
const rise: Variants = { hidden: { opacity: 0, y: 10 }, shown: { opacity: 1, y: 0, transition: spring } };

// The three things Suo is for, as one-click starts that fill the composer.
const starts = [
  { label: '拆解需求', prompt: '帮我拆解这个需求：' },
  { label: '整理资料', prompt: '帮我整理这些资料，提炼关键洞察和待验证的问题。', files: true },
  { label: '写立项方案', prompt: '帮我写一份产品立项方案，主题是：' },
];

function greeting(hour = new Date().getHours()) {
  if (hour >= 5 && hour < 11) return '早上好';
  if (hour >= 11 && hour < 13) return '中午好';
  if (hour >= 13 && hour < 18) return '下午好';
  return '晚上好';
}

export default function Welcome() {
  const visible = app.use(isWelcomeOf);
  const stage = app.use(state => state.stage);
  const others = app.use(state => state.sessions.filter(item => item.id !== state.workspace?.id).length);
  const composer = welcomeComposer(stage.width, stage.height);
  // A first-time user is pointed to the model settings before the first message fails.
  const [unconfigured, setUnconfigured] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    const load = () => { request<ModelCatalog>('models.list').then(value => { if (live) setUnconfigured(!value.models.length); }).catch(() => {}); };
    load(); window.addEventListener('suo-models-changed', load);
    return () => { live = false; window.removeEventListener('suo-models-changed', load); };
  }, [visible]);
  return <AnimatePresence>{visible && <motion.section key="welcome" className="welcome"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2, ease: [0.2, 0, 0, 1] } }}>
    <motion.div className="welcome-head" style={{ bottom: stage.height - composer.y + 92 }} variants={sequence} initial="hidden" animate="shown">
      <motion.h1 variants={rise}>造梦人，{greeting()}！我是 Suo</motion.h1>
      <motion.p variants={rise}>今天想做点什么</motion.p>
    </motion.div>
    <AttachmentFan composer={composer} />
    <motion.div className="welcome-starts" style={{ top: composer.y + composer.height + 20 }}
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.2 }}>
      {starts.map(start => <button type="button" key={start.label} className="start-chip" onClick={() => startWith(start.prompt, start.files)}>{start.label}</button>)}
    </motion.div>
    {unconfigured && <button type="button" className="welcome-setup" style={{ top: composer.y + composer.height + 70 }} onClick={() => app.set({ popup: 'help', settingsTab: 'models' })}>还没有连接模型 · 去添加</button>}
    {others > 0 && <button type="button" className="welcome-history" onClick={() => void toggleSessions()}>继续之前的会话 · {others}</button>}
  </motion.section>}</AnimatePresence>;
}
