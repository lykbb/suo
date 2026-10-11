import type { Card, PanelName, PanelLayers } from './types';

const finiteOrder = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
export function orderCards(nodes: Card[], id?: string, pinned?: boolean): Card[] {
  const sorted = [...nodes].sort((a, b) => finiteOrder(a.data.layerOrder) - finiteOrder(b.data.layerOrder));
  const target = id ? sorted.find(node => node.id === id) : undefined;
  if (target) { sorted.splice(sorted.indexOf(target), 1); sorted.push(target); }
  const ranks = new Map(sorted.map((node, index) => [node.id, index + 1]));
  return nodes.map(node => {
    const pin = node.id === id && pinned !== undefined ? pinned : !!node.data.pinned;
    const order = ranks.get(node.id)!;
    const zIndex = node.data.kind === 'group' && !pin ? -1 : (pin ? 10000 : 0) + order;
    if (node.zIndex === zIndex && node.data.layerOrder === order && !!node.data.pinned === pin) return node;
    return { ...node, zIndex, data: { ...node.data, pinned: pin, layerOrder: order } };
  });
}

export function orderPanels(layers: PanelLayers = {}, name: PanelName, pinned?: boolean): PanelLayers {
  const names: PanelName[] = ['toolbar', 'thread', 'composer', 'reader', 'drawing'];
  names.sort((a, b) => finiteOrder(layers[a]?.order) - finiteOrder(layers[b]?.order));
  names.splice(names.indexOf(name), 1); names.push(name);
  return Object.fromEntries(names.map((key, index) => [key, {
    pinned: key === name && pinned !== undefined ? pinned : !!layers[key]?.pinned,
    order: index + 1,
  }]));
}

export function panelZ(layers: PanelLayers | undefined, name: PanelName) {
  const fixed = { toolbar: 25, composer: 24, thread: 23 };
  if (name in fixed) return fixed[name as keyof typeof fixed];
  const layer = layers?.[name];
  // Drawing stays below conversation controls even when focused or pinned.
  if (name === 'drawing') return layer?.pinned ? 11 : 10;
  return (layer?.pinned ? 18 : 12) + Math.max(0, Math.min(3, finiteOrder(layer?.order)));
}
