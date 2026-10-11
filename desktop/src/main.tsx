import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { MotionConfig } from 'motion/react';
import App from './App';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { preferences, useAppearance } from './preferences';

function Root() {
  useAppearance();
  const reduced = preferences.use(state => state.motion);
  return <MotionConfig reducedMotion={reduced === 'reduce' ? 'always' : 'user'}><ReactFlowProvider><App /></ReactFlowProvider></MotionConfig>;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Root /></React.StrictMode>,
);
