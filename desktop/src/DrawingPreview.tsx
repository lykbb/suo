import './drawingSetup';
import { useEffect, useState } from 'react';
import { exportToSvg } from '@excalidraw/excalidraw';
import { app } from './state';
import { visibleDrawingElements } from './drawingModel';
import Icon from './Icon';

export default function DrawingPreview() {
  const drawing = app.use(state => state.workspace?.drawing);
  const [preview, setPreview] = useState<{ drawing: typeof drawing; url: string; error?: boolean }>();
  const elements = visibleDrawingElements(drawing);
  useEffect(() => {
    if (!elements.length) return;
    let cancelled = false, url = '';
    void exportToSvg({
      elements, files: drawing?.files ?? {},
      appState: { ...drawing?.appState, exportBackground: true, exportWithDarkMode: false },
      exportPadding: 24, renderEmbeddables: false,
    }).then((svg: SVGSVGElement) => {
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' }));
      setPreview({ drawing, url });
    }).catch(() => { if (!cancelled) setPreview({ drawing, url: '', error: true }); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [drawing]);
  if (!elements.length) return <div className="sketch-preview-empty"><Icon name="pencil" size={26} /><span>双击开始绘制</span></div>;
  if (preview?.drawing !== drawing) return <div className="sketch-preview-empty" role="status">正在生成预览…</div>;
  if (preview?.error) return <div className="sketch-preview-empty">预览暂时不可用</div>;
  return <img className="sketch-preview-image" src={preview?.url} alt="草图预览" draggable={false} />;
}
