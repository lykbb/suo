const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
};

export function assertSaveRequest(requestId, expectedVersion) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('无效的保存版本。');
  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/u.test(requestId))) throw new Error('无效的保存请求。');
}

export function savedContent(state) {
  const { version, updatedAt, saveReceipt, ...content } = state;
  return JSON.stringify(canonical({ ...content, draftAttachments: content.draftAttachments ?? [] }));
}

export function committedReplay(current, requested, expectedVersion, requestId) {
  if (!requestId || current?.saveReceipt?.id !== requestId) return false;
  if (current.saveReceipt.baseVersion !== expectedVersion || savedContent(current) !== savedContent(requested)) throw new Error('同一个保存请求包含不同内容，请重新打开会话后再保存。');
  return true;
}

export function committedState(state, version, requestId, baseVersion) {
  const { saveReceipt: previousReceipt, ...content } = state;
  return { ...content, draftAttachments: content.draftAttachments ?? [], version, updatedAt: new Date().toISOString(), ...(requestId ? { saveReceipt: { id: requestId, baseVersion } } : {}) };
}

export function workspaceAssetIds(state) {
  return [...(state.nodes ?? []).flatMap(node => node.data?.asset?.id ? [node.data.asset.id] : []), ...(state.draftAttachments ?? []).flatMap(asset => asset?.id ? [asset.id] : [])];
}
