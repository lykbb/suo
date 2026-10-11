import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Icon from './Icon';
import { removeAttachment } from './actions';
import { spring } from './motion';
import { app } from './state';
import type { Asset, Rect } from './types';

const KIND: Record<Asset['kind'], string> = { pdf: 'PDF', image: '图片', html: '网页', text: '文本', word: 'Word', spreadsheet: 'Excel', video: '视频', audio: '音频', binary: '文件' };
const extension = (name: string) => name.match(/\.([a-z0-9]{1,5})$/i)?.[1].toUpperCase();

// Staged files peek out from behind the composer's upper-left edge as a small fan of paper; hovering
// or focusing lifts and spreads them. On send each paper flies to the board as a card.
export function AttachmentFan({ composer }: { composer: Rect }) {
  const attachments = app.use(state => state.attachments);
  const [open, setOpen] = useState(false);
  const shown = attachments.slice(0, 3), middle = (shown.length - 1) / 2;
  return <div className="attachment-fan" style={{ left: composer.x + 28, top: composer.y - 48 }}
    onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}
    onFocus={() => setOpen(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <AnimatePresence>{shown.map((asset, index) => {
      const rotate = (index - middle) * (open ? 11 : 7);
      return <motion.div key={asset.id} className="attachment-slot" style={{ zIndex: index }}
        initial={{ opacity: 0, y: 56, rotate: 0 }} animate={{ opacity: 1, x: index * (open ? 70 : 26), y: open ? -34 : 0, rotate }}
        exit={{ opacity: 0, y: 56, transition: { duration: 0.16 } }} transition={spring}>
        <button type="button" className="attachment-paper" data-index={index} data-rotate={rotate} title={asset.name} aria-label={`预览 ${asset.name}`}
          onClick={() => app.set({ preview: asset })}>
          {asset.kind === 'image' && (asset.sourceUrl || asset.base64)
            ? <img src={asset.sourceUrl || `data:${asset.mime};base64,${asset.base64}`} alt="" />
            : <><span className="paper-kind">{extension(asset.name) ?? KIND[asset.kind]}</span><span className="paper-name">{asset.name}</span><i /><i /><i /></>}
        </button>
        <AnimatePresence>{open && <motion.button type="button" className="paper-remove" aria-label={`移除 ${asset.name}`} onClick={() => removeAttachment(asset.id)}
          initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={spring}>
          <Icon name="close" size={11} />
        </motion.button>}</AnimatePresence>
      </motion.div>;
    })}</AnimatePresence>
  </div>;
}

export function AttachmentChip() {
  const count = app.use(state => state.attachments.length);
  return <AnimatePresence initial={false}>{count > 0 && <motion.span key="chip" className="attachment-chip"
    initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={spring}>
    {count} 个文件
    <button type="button" aria-label="移除全部文件" title="移除全部文件" onClick={() => removeAttachment()}><Icon name="close" size={11} /></button>
  </motion.span>}</AnimatePresence>;
}
