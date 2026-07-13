export class CloudConflictError extends Error {
  constructor(message = '本地和云端数据都发生了变化，已停止自动覆盖。') {
    super(message);
    this.name = 'CloudConflictError';
  }
}

/**
 * Decide which side is authoritative without touching storage or the network.
 * @param {{remoteRevision:number|null, localRevision:number, dirty:boolean, hasLocalData:boolean}} state
 * @returns {'none'|'download'|'create'|'upload'|'conflict'}
 */
export function resolveSyncAction(state) {
  const remoteRevision = Number.isFinite(state.remoteRevision)
    ? Number(state.remoteRevision)
    : null;
  const localRevision = Math.max(0, Number(state.localRevision) || 0);

  if (remoteRevision === null) {
    return state.hasLocalData ? 'create' : 'none';
  }

  if (localRevision === 0) {
    return state.hasLocalData ? 'conflict' : 'download';
  }

  if (remoteRevision > localRevision) {
    return state.dirty ? 'conflict' : 'download';
  }

  if (remoteRevision < localRevision) {
    return 'conflict';
  }

  return state.dirty ? 'upload' : 'none';
}

