import { sourceLinks } from './sourceLinks.ts';
import { sourceClick, sourceDoubleClick, sourcePointerDown } from './sourceLinkEvents';
import type { ToolStep } from './types';
import './SourceLinks.css';

export default function SourceLinks({ steps }: { steps?: ToolStep[] }) {
  const sources = sourceLinks(steps);
  if (!sources.length) return null;
  return <div className="message-sources" aria-label="来源" onClick={sourceClick} onPointerDown={sourcePointerDown} onDoubleClick={sourceDoubleClick}>
    <span>来源：</span>{sources.map(source => <a key={source.url} href={source.url} title={source.url} data-source-link="true" className="nodrag nopan" target="_blank" rel="noopener noreferrer">{source.title}</a>)}
  </div>;
}
