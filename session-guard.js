/* One active garden writer per browser origin. No game or identity data lives here. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LumiSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const KEY = 'lumi.garden.writer.v1', LOCK = 'lumi-garden-active-writer';

  function createGuard(options = {}) {
    const now = options.now || Date.now;
    const schedule = options.setTimeout || root.setTimeout.bind(root);
    const cancel = options.clearTimeout || root.clearTimeout.bind(root);
    const ttl = Math.max(1000, options.ttl || 60000);
    const settle = options.settleMs === undefined ? 100 : Math.max(0, options.settleMs);
    const owner = options.owner || (root.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
    let storage, locks;
    try { storage = options.storage === undefined ? root.localStorage : options.storage; } catch { storage = null; }
    try { locks = options.locks === undefined ? root.navigator?.locks : options.locks; } catch { locks = null; }
    let status = 'idle', reason = null, timer = null, unlock = null, pending = null, generation = 0, held = false;
    const notify = (next, why = null) => {
      const changed = status !== next || reason !== why;
      status = next; reason = why;
      if (changed) options.onChange?.({ status, reason });
    };
    const read = () => {
      if (!storage) throw new Error('Storage unavailable');
      const raw = storage.getItem(KEY);
      if (!raw) return null;
      try {
        const value = JSON.parse(raw);
        return typeof value.owner === 'string' && Number.isFinite(value.expires) ? value : null;
      } catch { return null; }
    };
    const write = () => storage.setItem(KEY, JSON.stringify({ owner, expires: now() + ttl }));
    const stop = () => { if (timer !== null) cancel(timer); timer = null; };
    function lose(why) {
      stop(); held = false;
      if (unlock) { const done = unlock; unlock = null; done(); }
      notify('lost', why);
      return false;
    }
    function canWrite() {
      if (status === 'memory') return true;
      if (status !== 'owner') return false;
      try {
        const lease = read();
        if (!lease && held) return true;
        if (!lease || lease.owner !== owner || !held && lease.expires <= now()) return lose('ownership-changed');
        return true;
      } catch {
        // A held Web Lock still excludes another writer if storage is denied.
        if (held) return true;
        return lose('storage-unavailable');
      }
    }
    function heartbeat() {
      stop();
      if (!canWrite()) return;
      try {
        // Never resurrect a lease another window replaced, even after a long sleep.
        const lease = read();
        if ((!lease && !held) || lease && lease.owner !== owner) return lose('ownership-changed');
        write();
      } catch { if (!held) return lose('storage-unavailable'); }
      timer = schedule(heartbeat, Math.floor(ttl / 3));
    }
    async function fallback(epoch) {
      try {
        const lease = read();
        if (lease && lease.owner !== owner && lease.expires > now()) { notify('blocked', 'another-window'); return false; }
        write();
      } catch {
        if (epoch !== generation) return false;
        notify('memory', 'storage-unavailable'); return true;
      }
      await new Promise(resolve => schedule(resolve, settle));
      if (epoch !== generation) return false;
      try {
        const lease = read();
        if (!lease || lease.owner !== owner || lease.expires <= now()) { notify('blocked', 'another-window'); return false; }
      } catch { notify('blocked', 'storage-unavailable'); return false; }
      notify('owner'); heartbeat(); return true;
    }
    async function acquire() {
      if (canWrite()) return true;
      if (pending) return pending;
      const epoch = ++generation;
      pending = (async () => {
        if (!locks?.request) return fallback(epoch);
        return new Promise(resolve => {
          let answered = false;
          const answer = value => { if (!answered) { answered = true; resolve(value); } };
          let request;
          try {
            request = locks.request(LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
              if (epoch !== generation) { answer(false); return; }
              if (!lock) { notify('blocked', 'another-window'); answer(false); return; }
              held = true;
              try { write(); } catch { /* Web Lock still provides exclusion. */ }
              notify('owner');
              const holding = new Promise(done => { unlock = done; });
              heartbeat(); answer(true);
              await holding;
              held = false;
            });
          } catch { request = Promise.reject(new Error('Locks unavailable')); }
          Promise.resolve(request).catch(async () => {
            if (epoch !== generation) { answer(false); return; }
            if (answered) { lose('lock-unavailable'); return; }
            answer(await fallback(epoch));
          });
        });
      })().finally(() => { pending = null; });
      return pending;
    }
    function release() {
      ++generation; stop();
      try { if (read()?.owner === owner) storage.removeItem?.(KEY); } catch {}
      if (unlock) { const done = unlock; unlock = null; done(); }
      held = false; notify('idle', 'released');
    }
    return { acquire, canWrite, release, get status() { return status; }, get reason() { return reason; } };
  }
  return { KEY, createGuard, current: null };
});
