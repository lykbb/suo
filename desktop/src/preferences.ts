import { useEffect } from 'react';
import { createStore } from './store';

export type Preferences = { theme: 'system' | 'light' | 'dark'; background: 'dots' | 'grid' | 'plain'; motion: 'system' | 'reduce'; sendKey: 'enter' | 'modifier-enter' };
const defaults: Preferences = { theme: 'light', background: 'plain', motion: 'system', sendKey: 'enter' };
export function normalizePreferences(value: Partial<Preferences> = {}): Preferences {
  return {
    theme: ['system', 'light', 'dark'].includes(value.theme ?? '') ? value.theme! : defaults.theme,
    background: ['dots', 'grid', 'plain'].includes(value.background ?? '') ? value.background! : defaults.background,
    motion: value.motion === 'reduce' ? 'reduce' : 'system',
    sendKey: value.sendKey === 'modifier-enter' ? 'modifier-enter' : 'enter',
  };
}
function load() { try { return normalizePreferences(JSON.parse(localStorage.getItem('suo-preferences') ?? '{}')); } catch { return defaults; } }
export const preferences = createStore<Preferences>(load());
export function setPreference(patch: Partial<Preferences>) {
  preferences.set(normalizePreferences({ ...preferences.get(), ...patch }));
  try { localStorage.setItem('suo-preferences', JSON.stringify(preferences.get())); } catch { /* Preferences still apply for this session. */ }
}
export function useAppearance() {
  const theme = preferences.use(state => state.theme), motion = preferences.use(state => state.motion);
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? system.matches ? 'dark' : 'light' : theme; };
    apply(); system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => { document.documentElement.dataset.motion = motion; }, [motion]);
}
