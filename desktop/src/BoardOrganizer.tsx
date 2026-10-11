import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { send } from './actions';
import { arrangeCurrentBoard } from './boardOrganize';
import { app } from './state';
import './BoardOrganizer.css';

export default function BoardOrganizer() {
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [regroup, setRegroup] = useState(false);
  const blocked = app.use(state => state.busy || state.sessionManaging || !state.workspace?.nodes.length);
  useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target) && !button.current?.contains(event.target)) setPosition(null); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setPosition(null); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keyboard, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keyboard, true); };
  }, [position]);
  const smart = () => {
    setPosition(null);
    const instruction = '请智能归类当前画布。先读取完整画布目录与必要内容，使用 board_organize 的 classify 模式一次提交仅含稳定元素 ID 的完整分组关系，由本地布局算法计算位置。复用已有卡片和分组，禁止新建卡片、删除内容或逐张猜坐标。';
    void send(instruction + (regroup ? '我明确允许重新归类并调整现有分组关系，但保留所有内容和原分组容器。' : '保留现有分组及嵌套关系，仅将未分组卡片归类。'), { land: false, preserveDraft: true, boardTask: { mode: 'classify', allowRegroup: regroup } });
  };
  return <>
    <button ref={button} type="button" className="tool" title="整理画布" aria-label="整理画布" aria-haspopup="dialog" aria-expanded={!!position} disabled={blocked}
      onClick={() => { if (position) { setPosition(null); return; } const rect = button.current!.getBoundingClientRect(); setRegroup(false); setPosition({ left: Math.max(8, Math.min(rect.right + 12, window.innerWidth - 252)), top: Math.max(8, Math.min(rect.top, window.innerHeight - 156)) }); }}><Icon name="layout" /></button>
    {position && createPortal(<div ref={panel} className="board-organizer" style={position} role="dialog" aria-label="整理画布">
      <button type="button" disabled={blocked} onClick={() => { setPosition(null); arrangeCurrentBoard(); }}><Icon name="layout" /><span>整齐排列</span></button>
      <button type="button" disabled={blocked} onClick={smart}><Icon name="sparkle" /><span>智能归类</span></button>
      <label><input type="checkbox" checked={regroup} onChange={event => setRegroup(event.target.checked)} />重新归类（会调整原分组）</label>
    </div>, document.body)}
  </>;
}
