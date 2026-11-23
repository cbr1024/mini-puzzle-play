/* Lumi Garden — real rankings, with an atomic local journal and honest offline mode. */
(function (root) {
  'use strict';
  const IDENTITY_KEY = 'lumi.ranking.identity.v1';
  const STATE_KEY = 'lumi.ranking.journal.v1';
  const ARCHIVE_PREFIX = 'lumi.ranking.archived-account.v1.';
  const validIdentity = value => value && /^[A-Za-z0-9_-]{43}$/.test(value.token || '') && typeof value.player?.id === 'string';
  const rewards = typeof module === 'object' && module.exports ? require('./rewards.js') : root.LumiRewards;
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const stable = value => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  };

  class RankingError extends Error {
    constructor(code, message, status = 0) {
      super(message); this.name = 'RankingError'; this.code = code; this.status = status;
      this.retryable = !status || status === 408 || status === 429 || status >= 500;
      this.authRequired = status === 401;
    }
  }

  function nativePlatform() {
    try {
      return !!(root.Capacitor && (root.Capacitor.isNativePlatform?.() || root.Capacitor.getPlatform?.() && root.Capacitor.getPlatform() !== 'web'));
    } catch { return false; }
  }

  function apiBase(value) {
    const explicit = typeof value === 'string' && value.trim();
    if (!explicit && (nativePlatform() || !root.location || !/^https?:$/.test(root.location.protocol))) return null;
    try {
      const url = new URL(explicit || '/api/ranking', root.location && root.location.href || undefined);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const local = host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
      if (explicit && url.protocol !== 'https:' && !local) return null;
      if (url.pathname === '/') url.pathname = '/api/ranking';
      return url.href.replace(/\/$/, '');
    } catch { return null; }
  }

  class LumiRanking {
    constructor(options = {}) {
      this.baseUrl = apiBase(options.baseUrl ?? root.LumiConfig?.rankingApiBase ?? '');
      this.timeoutMs = Math.max(250, Number(options.timeoutMs || root.LumiConfig?.rankingTimeout || 1800));
      this._Game = options.Game || root.LumiEngine?.Game;
      this._fetch = options.fetch || root.fetch?.bind(root);
      this.ruleset = options.ruleset ?? root.LumiConfig?.ruleset ?? null;
      this._writeGuard = options.writeGuard || null;
      this._baselines = new Map();
      this._conflicted = false;
      this._accountGeneration = 0;
      this._storageAvailable = true;
      try { this._storage = options.storage || root.localStorage; } catch { this._storage = null; this._storageAvailable = false; }
      this._identity = this._load(IDENTITY_KEY, null);
      if (!validIdentity(this._identity)) this._identity = null;
      const stored = this._load(STATE_KEY, null);
      this._state = stored && stored.version === 1 && Array.isArray(stored.pending) && stored.pending.length <= 20
        ? stored : { version: 1, current: null, pending: [], lastResult: null };
      // The optional inline identity makes an explicit reconnection and its new
      // empty journal ONE atomic write. The old identity key remains a mirror.
      if (validIdentity(this._state.identity)) this._identity = clone(this._state.identity);
      if (!Array.isArray(this._state.rejected)) this._state.rejected = [];
      this._state.archives = (Array.isArray(this._state.archives) ? this._state.archives : [])
        .filter(item => item && typeof item.key === 'string' && item.key.startsWith(ARCHIVE_PREFIX) && typeof item.playerId === 'string' && Number.isInteger(item.pendingCount) && item.pendingCount >= 0 && item.pendingCount <= 21)
        .map(item => ({ key: item.key, playerId: item.playerId, pendingCount: item.pendingCount, createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0 }));
      if (this._state.current && typeof this._state.current === 'object') this._state.current.completed = this._state.current.completed === true;
      if (this._state.authError?.code !== 'INVALID_TOKEN') this._state.authError = null;
      this._registering = null;
      this._flushing = null;
      this._startGeneration = 0;
      this._reconnecting = null;
    }

    get storageAvailable() { return this._storageAvailable; }
    get pendingCount() { return this._state.pending.length + (this._state.current?.completed ? 1 : 0); }
    get configured() { return !!this.baseUrl; }
    getIdentity() { return this._identity ? clone(this._identity.player) : null; }
    getCurrentRun() { return this._state.current ? clone(this._state.current.run) : null; }
    getRejectedRecords() { return clone(this._state.rejected); }
    getRecoveryState() {
      const required = Boolean(this._identity && this._state.authError && this._state.authError.playerId === this._identity.player.id);
      return { required: Boolean(required), code: required ? this._state.authError.code : null,
        playerId: this._identity?.player.id || null, nickname: this._identity?.player.nickname || '',
        pendingCount: this.pendingCount,
        archivedCount: this._state.archives.reduce((count, item) => count + (Number(item.pendingCount) || 0), 0) };
    }

    _load(key, fallback) {
      try {
        if (!this._storage) { this._storageAvailable = false; return fallback; }
        const raw = this._storage.getItem(key);
        this._baselines.set(key, raw ?? null);
        if (!raw || raw.length > 1024 * 1024) return fallback;
        try { return JSON.parse(raw); } catch { return fallback; }
      } catch { this._storageAvailable = false; return fallback; }
    }

    _conflict(code = 'STORAGE_CONFLICT') {
      this._conflicted = true;
      if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('lumi:storage-conflict', { detail: { code, source: 'ranking' } }));
      }
      return new RankingError(code, '다른 창의 새 기록을 보호하고 있어요. 이 창을 새로 열어 이어가 주세요.', 409);
    }

    _assertWritable() {
      const guard = this._writeGuard || root.LumiSession?.current;
      if (this._conflicted) throw this._conflict();
      if (guard && !(typeof guard === 'function' ? guard() : guard.canWrite())) throw this._conflict('SESSION_NOT_OWNER');
      if (!this._storage) return;
      for (const key of [IDENTITY_KEY, STATE_KEY]) {
        let actual;
        try { actual = this._storage.getItem(key) ?? null; }
        catch { this._storageAvailable = false; return; }
        if (actual !== (this._baselines.get(key) ?? null)) throw this._conflict();
        if (!this._baselines.has(key)) this._baselines.set(key, actual);
      }
    }

    _save() {
      try {
        this._assertWritable();
        if (!this._storage) throw new Error('No storage');
        this._state.identity = clone(this._identity);
        const serialized = JSON.stringify(this._state);
        this._storage.setItem(STATE_KEY, serialized);
        this._baselines.set(STATE_KEY, serialized);
        // A failed mirror write cannot split the authoritative identity/journal.
        try {
          const identity = JSON.stringify(this._identity);
          if (identity !== this._baselines.get(IDENTITY_KEY)) {
            this._storage.setItem(IDENTITY_KEY, identity);
            this._baselines.set(IDENTITY_KEY, identity);
          }
        } catch {}
        this._storageAvailable = true;
        return true;
      } catch (error) {
        if (!['STORAGE_CONFLICT', 'SESSION_NOT_OWNER'].includes(error.code)) this._storageAvailable = false;
        return false;
      }
    }

    async _request(route, options = {}) {
      this._assertWritable();
      if (!this.baseUrl || !this._fetch) throw new RankingError('RANKING_OFFLINE', '랭킹 서버가 연결되지 않아 연습 모드로 플레이해요.');
      const controller = new AbortController();
      const parentSignal = options.signal;
      const abort = () => controller.abort();
      if (parentSignal?.aborted) throw new RankingError('REQUEST_ABORTED', '랭킹 연결을 중단했어요.');
      parentSignal?.addEventListener('abort', abort, { once: true });
      const timeout = root.setTimeout(abort, Math.max(100, options.timeoutMs || this.timeoutMs));
      const requestPlayerId = options.auth !== false ? this._identity?.player.id : null;
      const accountGeneration = this._accountGeneration;
      const headers = { Accept: 'application/json' };
      if (options.data !== undefined) headers['Content-Type'] = 'application/json';
      if (options.auth !== false && this._identity) headers.Authorization = 'Bearer ' + this._identity.token;
      try {
        const response = await this._fetch(this.baseUrl + route, { method: options.method || 'GET', headers,
          body: options.data === undefined ? undefined : JSON.stringify(options.data), signal: controller.signal,
          credentials: 'omit', cache: 'no-store', redirect: 'error' });
        let value;
        try { value = await response.json(); } catch { throw new RankingError('INVALID_RESPONSE', '랭킹 서버 응답을 확인할 수 없어요.'); }
        if (requestPlayerId && (this._identity?.player.id !== requestPlayerId || accountGeneration !== this._accountGeneration)) throw new RankingError('ACCOUNT_CHANGED', '계정이 바뀌어 이전 응답을 적용하지 않았어요.', 409);
        if (!response.ok) {
          const error = new RankingError(value?.error?.code || 'SERVER_ERROR', value?.error?.message || '랭킹 서버에 연결하지 못했어요.', response.status);
          if (error.authRequired && requestPlayerId) {
            this._state.authError = { code: 'INVALID_TOKEN', playerId: requestPlayerId };
            this._save();
          }
          throw error;
        }
        if (requestPlayerId && this._identity?.player.id !== requestPlayerId) throw new RankingError('ACCOUNT_CHANGED', '계정이 바뀌어 이전 응답을 적용하지 않았어요.', 409);
        if (requestPlayerId && (value?.player && value.player.id !== requestPlayerId || value?.companions && value.companions.playerId !== requestPlayerId)) {
          throw new RankingError('INVALID_RESPONSE', '이 계정의 기록인지 확인할 수 없어요.', 409);
        }
        this._assertWritable();
        if (requestPlayerId && this._state.authError?.playerId === requestPlayerId) { this._state.authError = null; this._save(); }
        return value;
      } catch (error) {
        if (error instanceof RankingError) throw error;
        throw new RankingError(controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR', '연결이 원활하지 않아요. 기록을 보관하고 다시 시도할게요.');
      } finally {
        root.clearTimeout(timeout); parentSignal?.removeEventListener('abort', abort);
      }
    }

    async register(name, requestOptions = {}) {
      this._assertWritable();
      if (this._identity) {
        if (name && name !== this._identity.player.nickname) return this.setNickname(name);
        return this.getIdentity();
      }
      if (!this._registering) this._registering = (async () => {
        const value = await this._request('/register', { ...requestOptions, method: 'POST', auth: false,
          data: name === undefined ? {} : { nickname: name } });
        if (!/^[A-Za-z0-9_-]{43}$/.test(value.token || '') || !value.player?.id) throw new RankingError('INVALID_RESPONSE', '랭킹 계정을 만들지 못했어요.');
        this._identity = { token: value.token, player: value.player };
        this._save(IDENTITY_KEY, this._identity);
        return this.getIdentity();
      })().finally(() => { this._registering = null; });
      return this._registering;
    }

    async health() { return this._request('/health', { auth: false }); }

    async getProfile() {
      await this.register();
      const value = await this._request('/me');
      if (value.player?.id === this._identity?.player.id) { this._identity.player = value.player; this._save(IDENTITY_KEY, this._identity); }
      return value;
    }

    async setNickname(name) {
      if (!this._identity) return this.register(name);
      const value = await this._request('/nickname', { method: 'PATCH', data: { nickname: name } });
      if (value.player?.id !== this._identity.player.id) throw new RankingError('INVALID_RESPONSE', '닉네임을 확인하지 못했어요.');
      this._identity.player = value.player; this._save(IDENTITY_KEY, this._identity);
      return this.getIdentity();
    }

    async startRun(level, options = {}) {
      this._assertWritable();
      if (!Number.isInteger(level) || level < 1) throw new RankingError('INVALID_LEVEL', '정원 번호를 확인해 주세요.', 400);
      const buddyType = options.buddyType === undefined ? 0 : options.buddyType;
      if (!Number.isInteger(buddyType) || buddyType < 0 || buddyType > 5) throw new RankingError('INVALID_BUDDY', '함께할 친구를 확인해 주세요.', 400);
      const generation = ++this._startGeneration;
      const deadline = Date.now() + (options.timeoutMs || this.timeoutMs);
      if (this._state.pending.length >= 20 || this._state.current?.completed) {
        await this.flushPending();
        if (this._state.pending.length >= 20 || this._state.current?.completed) throw new RankingError('QUEUE_FULL', '등록 대기 기록을 먼저 연결해 보내 주세요. 보관한 기록은 그대로 두고 연습 모드로 플레이해요.', 409);
      }
      await this.register(undefined, { signal: options.signal, timeoutMs: Math.max(100, deadline - Date.now()) });
      const run = await this._request('/runs', { method: 'POST', data: { level, buddyType }, signal: options.signal,
        timeoutMs: Math.max(100, deadline - Date.now()) });
      if (generation !== this._startGeneration) throw new RankingError('REQUEST_SUPERSEDED', '새 플레이가 시작되어 이전 연결을 마쳤어요.');
      if (!run?.runId || run.level !== level || !run.options || typeof run.seed !== 'string' || !run.ruleset) throw new RankingError('INVALID_RESPONSE', '플레이 정보를 확인하지 못했어요.');
      if (this.ruleset && run.ruleset !== this.ruleset) throw new RankingError('RULESET_CHANGED', '앱과 서버의 퍼즐 규칙이 달라 연습 모드로 플레이해요. 최신 버전으로 다시 열어 주세요.', 409);
      if (root.LumiLevels?.revision && run.levelRevision !== root.LumiLevels.revision) throw new RankingError('RULESET_CHANGED', '앱과 서버의 정원 버전이 달라 연습 모드로 플레이해요.', 409);
      if (run.options.scoringVersion !== rewards.SCORING_VERSION) throw new RankingError('RULESET_CHANGED', '앱과 서버의 점수 규칙이 달라 연습 모드로 플레이해요.', 409);
      let checkpoint = null;
      if (this._Game) checkpoint = stable(new this._Game({ ...run.options, seed: run.seed }).exportState());
      this._state.current = { run: clone(run), actions: [], checkpoint, updatedAt: Date.now() };
      this._save();
      return clone(run);
    }

    bindState(engineState) {
      try { this._assertWritable(); } catch { return false; }
      const current = this._state.current;
      if (!current || current.completed || current.actions.length || engineState?.seed !== current.run.seed) return false;
      try {
        const checkpoint = stable(engineState);
        if (current.checkpoint && checkpoint !== current.checkpoint) return false;
        current.checkpoint = checkpoint; current.updatedAt = Date.now(); return this._save();
      } catch { return false; }
    }

    commitAction(action, engineState) {
      try { this._assertWritable(); } catch { return false; }
      const current = this._state.current;
      if (!current || current.completed || !['swap', 'shuffle', 'blast'].includes(action?.kind) || engineState?.seed !== current.run.seed || current.actions.length >= 128) return false;
      try {
        const next = { ...current, actions: [...current.actions, clone(action)], checkpoint: stable(engineState), updatedAt: Date.now() };
        this._state.current = next;
        return this._save();
      } catch { return false; }
    }

    restoreRun(engineState) {
      const current = this._state.current;
      if (!current?.checkpoint || current.completed || !this._identity || current.run.player?.id !== this._identity.player.id) return null;
      if (this.ruleset && current.run.ruleset !== this.ruleset) return null;
      if (current.run.options?.scoringVersion !== rewards.SCORING_VERSION) return null;
      try { return stable(engineState) === current.checkpoint ? clone(current.run) : null; } catch { return null; }
    }

    abandonRun() {
      try { this._assertWritable(); } catch { return false; }
      this._startGeneration++;
      if (!this._state.current?.completed) this._state.current = null;
      return this._save();
    }

    async leaderboard({ scope = 'campaign', period = 'all', level = 1 } = {}) {
      const query = new URLSearchParams({ scope, period, level: String(level) });
      return this._request('/leaderboard?' + query.toString());
    }

    async claimWeekly(goalId, buddyType, weekKey) {
      this._assertWritable();
      if (!rewards.WEEKLY_GOALS.some(goal => goal.id === goalId) || !Number.isInteger(buddyType) || buddyType < 0 || buddyType > 5 || !/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) {
        throw new RankingError('INVALID_CLAIM', '받을 친구와 주간 목표를 확인해 주세요.', 400);
      }
      await this.register();
      return this._request('/weekly/claim', { method: 'POST', data: { goalId, buddyType, weekKey } });
    }

    async finishRun() {
      this._assertWritable();
      const current = this._state.current;
      if (!current) return { queued: false, result: null, error: { code: 'NO_RANKED_RUN', message: '이번 플레이는 연습 모드예요.' } };
      const runId = current.run.runId;
      if (!this._state.pending.some(item => item.run.runId === runId)) {
        if (this._state.pending.length >= 20) {
          // Keep the completed current run as a bounded overflow slot. It cannot
          // be abandoned/replaced and flushPending promotes it when room opens.
          current.completed = true;
          const durable = this._save();
          return { queued: durable, memoryPending: !durable, overflow: true, result: null,
            ...(!durable ? { error: { code: 'STORAGE_UNAVAILABLE', message: '기기 저장이 차단되어 이번 완료를 보관하지 못했어요. 앱을 닫기 전에 연결을 복구해 주세요.' } } : {}) };
        }
        this._state.pending.push({ run: current.run, actions: current.actions, queuedAt: Date.now() });
      }
      // Moving current -> pending is ONE storage write before any asynchronous request.
      this._state.current = null;
      const durable = this._save() && this._storageAvailable;
      const report = await this.flushPending();
      const result = report.submitted.find(item => item.runId === runId) || (this._state.lastResult?.runId === runId ? this._state.lastResult : null);
      const rejection = report.rejected.find(item => item.runId === runId);
      const pending = this._state.pending.some(item => item.run.runId === runId);
      if (pending && !durable) return { queued: false, memoryPending: true, result: clone(result),
        error: { code: 'STORAGE_UNAVAILABLE', message: '기기 저장이 차단되어 기록을 보관하지 못했어요. 앱을 닫기 전에 연결을 복구해야 등록할 수 있어요.' } };
      return { queued: pending, result: clone(result),
        ...(rejection ? { error: { code: rejection.code, message: rejection.message } } : {}) };
    }

    async flushPending() {
      if (!this._flushing) this._flushing = this._flush().finally(() => { this._flushing = null; });
      return this._flushing;
    }

    async _flush() {
      this._assertWritable();
      const report = { submitted: [], rejected: [], remaining: this.pendingCount, offline: false, authRequired: false };
      if (!this._identity && this.pendingCount) { report.offline = true; return report; }
      const accountGeneration = this._accountGeneration;
      const promote = () => {
        const current = this._state.current;
        if (current?.completed && this._state.pending.length < 20) {
          if (!this._state.pending.some(item => item.run.runId === current.run.runId)) this._state.pending.push({ run: current.run, actions: current.actions, queuedAt: Date.now() });
          this._state.current = null; this._save();
        }
      };
      promote();
      const visited = new Set();
      for (let count = 0; count < 21; count++) {
        const pending = this._state.pending.find(item => !visited.has(item.run.runId));
        if (!pending || accountGeneration !== this._accountGeneration) break;
        visited.add(pending.run.runId);
        try {
          if (pending.run.player?.id && pending.run.player.id !== this._identity.player.id) throw new RankingError('ACCOUNT_CHANGED', '이전 계정의 기록을 다른 계정으로 등록하지 않아요.', 409);
          const result = await this._request('/finish', { method: 'POST', data: { runId: pending.run.runId, actions: pending.actions } });
          if (result.runId !== pending.run.runId || result.verified !== true || !Number.isInteger(result.score)) throw new RankingError('INVALID_RESPONSE', '랭킹 등록 결과를 확인하지 못했어요.');
          this._state.pending = this._state.pending.filter(item => item.run.runId !== pending.run.runId);
          this._state.lastResult = result; this._save(); report.submitted.push(clone(result));
          promote();
        } catch (error) {
          if (accountGeneration !== this._accountGeneration || ['ACCOUNT_CHANGED', 'STORAGE_CONFLICT', 'SESSION_NOT_OWNER'].includes(error.code)) break;
          if (error.authRequired) { report.authRequired = true; break; }
          if (error.retryable !== false) { report.offline = true; break; }
          this._state.pending = this._state.pending.filter(item => item.run.runId !== pending.run.runId);
          this._state.rejected = [...this._state.rejected.filter(item => item.runId !== pending.run.runId), {
            runId: pending.run.runId, level: pending.run.level, ruleset: pending.run.ruleset,
            code: error.code, message: error.message, rejectedAt: Date.now()
          }].slice(-20);
          this._save(); report.rejected.push({ runId: pending.run.runId, code: error.code, message: error.message });
          promote();
        }
      }
      report.remaining = this.pendingCount;
      return report;
    }

    async reconnectIdentity({ confirmed = false } = {}) {
      if (!confirmed) throw new RankingError('CONFIRM_RECONNECT', '기존 리그 기록을 따로 보관하고 새 리그 계정을 시작할지 확인해 주세요.', 409);
      if (this._reconnecting) return this._reconnecting;
      this._assertWritable();
      if (!this.getRecoveryState().required) throw new RankingError('RECONNECT_NOT_REQUIRED', '현재 리그 계정은 다시 연결할 필요가 없어요.', 409);
      this._startGeneration++; this._accountGeneration++;
      this._reconnecting = (async () => {
        const oldPlayerId = this._identity.player.id;
        const value = await this._request('/register', { method: 'POST', auth: false, data: { nickname: this._identity.player.nickname } });
        if (!validIdentity({ token: value.token, player: value.player })) throw new RankingError('INVALID_RESPONSE', '새 리그 계정을 확인하지 못했어요.');
        this._assertWritable();
        if (this._identity.player.id !== oldPlayerId) throw new RankingError('ACCOUNT_CHANGED', '계정이 바뀌어 연결을 다시 확인해 주세요.', 409);
        const archivedCount = this.pendingCount;
        const archiveKey = ARCHIVE_PREFIX + oldPlayerId + '.' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        const identity = { token: value.token, player: value.player };
        const next = { version: 1, identity, current: null, pending: [], lastResult: null, rejected: [], authError: null,
          archives: [...this._state.archives, { key: archiveKey, playerId: oldPlayerId, pendingCount: archivedCount, createdAt: Date.now() }] };
        try {
          if (!this._storage) throw new Error('No storage');
          this._storage.setItem(archiveKey, JSON.stringify({ version: 1, identity: this._identity, state: this._state }));
          const serialized = JSON.stringify(next);
          this._storage.setItem(STATE_KEY, serialized);
          this._baselines.set(STATE_KEY, serialized);
        } catch {
          this._storageAvailable = false;
          throw new RankingError('STORAGE_UNAVAILABLE', '기존 계정 기록을 안전하게 보관하지 못해 계정을 바꾸지 않았어요. 저장 공간을 확인해 주세요.');
        }
        this._identity = identity; this._state = next; this._storageAvailable = true;
        this._save();
        return { player: this.getIdentity(), archivedPlayerId: oldPlayerId, archivedCount };
      })().finally(() => { this._reconnecting = null; });
      return this._reconnecting;
    }
  }

  root.LumiRanking = LumiRanking;
  root.LumiRankingError = RankingError;
  if (typeof module !== 'undefined' && module.exports) module.exports = { LumiRanking, RankingError, apiBase, stable };
})(typeof window !== 'undefined' ? window : globalThis);
