/* Lumi Garden — local progress, one atomic save, no network or telemetry. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(root, node ? require('./engine.js') : root.LumiEngine, node ? require('./levels.js') : root.LumiLevels, node ? require('./rewards.js') : root.LumiRewards, node ? require('./journey.js') : root.LumiJourney);
  if (node) module.exports = api;
  if (root) root.LumiProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, engine, initialLevels, rewards, journey) {
  'use strict';

  const KEY = 'lumi-garden-v3';
  const PREVIOUS_KEY = 'lumi-garden-v2';
  const LEGACY_KEY = 'lumi-garden-best';
  const VERSION = 3;
  const LIMITS = Object.freeze({ score: 1000000000, collected: 10000000, combo: 65, attempts: 100000 });
  const BONDS = rewards.BONDS;

  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const levelCount = () => (initialLevels || root.LumiLevels)?.length || 50;
  const validInt = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const boundedInt = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
  const vector = (value, length, maximum) => Array.from({ length }, (_, i) => boundedInt(Array.isArray(value) ? value[i] : undefined, 0, 0, maximum));
  const freezeTree = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freezeTree(child);
      Object.freeze(value);
    }
    return value;
  };

  function defaults() {
    const count = levelCount();
    return {
      profile: {
        unlocked: 1, stars: Array(count).fill(0), bestScores: Array(count).fill(0),
        totalCollected: Array(6).fill(0), selectedBuddy: 0, maxCombo: 0,
        buddyClearXp: Array(6).fill(0), verifiedBuddyXp: Array(6).fill(0), verifiedBuddyPlayerId: null,
        buddyMemoryLevels: Array(6).fill(1),
        seenSpecials: { row: false, col: false, bomb: false, rainbow: false },
        storySeen: { prologue: false, openings: Array(5).fill(false), endings: Array(5).fill(false) },
        journey: journey.normalizeProfile(),
        attempts: Array(count).fill(0), hasSeenTutorial: false, bestScore: 0
      },
      settings: { music: true, sfx: true, haptics: true, volume: 0.45 },
      session: null
    };
  }

  function matchesLevel(game, saved, level) {
    const levels = initialLevels || root.LumiLevels;
    const definition = Array.isArray(levels) ? levels.find(item => item.id === level) : null;
    if (!definition) return false;
    if (game.rows !== 6 || game.cols !== 6 || game.types !== 6 || game.requireScore !== false || game.initialMoves !== definition.moves || game.target !== definition.target) return false;
    const goalKey = goals => goals.map(goal => `${goal.type}:${goal.target}`).sort().join('|');
    if (goalKey(game.objectives) !== goalKey(definition.objectives)) return false;
    const expectedBuds = Array.from({ length: 6 }, () => Array(6).fill(0));
    for (const bud of definition.buds) expectedBuds[bud.r][bud.c] = bud.hp;
    return JSON.stringify(saved.initialBuds) === JSON.stringify(expectedBuds);
  }

  function normalizeSession(value, profile) {
    if (!record(value) || !validInt(value.level, 1, levelCount()) || value.level > profile.unlocked ||
        !validInt(value.shuffles, 0, 2) || !validInt(value.blasts, 0, 2) || !validInt(value.maxCombo, 0, LIMITS.combo)) return null;
    const api = engine || root.LumiEngine;
    if (!api || !api.Game || typeof api.Game.fromState !== 'function') return null;
    try {
      const game = api.Game.fromState(value.game);
      if (game.won || game.over || !matchesLevel(game, value.game, value.level)) return null;
      // Save consumers receive an immutable game payload, independent of both
      // their input and the store's memory. Their live Game is restored separately.
      return {
        level: value.level, game: freezeTree(game.exportState()),
        shuffles: value.shuffles, blasts: value.blasts, maxCombo: value.maxCombo,
        // Preserve the exact old session shape until the new observer exists.
        // Old runs do not acquire invented evidence for unseen past actions.
        ...(value.journey === undefined ? {} : { journey: freezeTree(journey.createRun(value.level, value.journey)) })
      };
    } catch (_) {
      return null;
    }
  }

  function normalize(data) {
    const output = defaults();
    if (!record(data) || data.version !== undefined && data.version !== VERSION && data.version !== 2) return output;
    const source = record(data.profile) ? data.profile : {};
    const profile = output.profile;
    const count = levelCount(), previous = data.version === 2;
    const oldLimit = previous ? Math.min(12, count) : count;
    profile.unlocked = boundedInt(source.unlocked, 1, 1, oldLimit);
    profile.stars = vector(vector(source.stars, oldLimit, 3), count, 3);
    profile.bestScores = vector(vector(source.bestScores, oldLimit, LIMITS.score), count, LIMITS.score);
    profile.totalCollected = vector(source.totalCollected, 6, LIMITS.collected);
    profile.buddyClearXp = vector(source.buddyClearXp, 6, LIMITS.collected);
    profile.verifiedBuddyPlayerId = typeof source.verifiedBuddyPlayerId === 'string' && /^player_[A-Za-z0-9_-]{16}$/.test(source.verifiedBuddyPlayerId) ? source.verifiedBuddyPlayerId : null;
    profile.verifiedBuddyXp = profile.verifiedBuddyPlayerId ? vector(source.verifiedBuddyXp, 6, LIMITS.collected) : Array(6).fill(0);
    profile.buddyMemoryLevels = Array.from({ length: 6 }, (_, type) => {
      const saved = Array.isArray(source.buddyMemoryLevels) ? source.buddyMemoryLevels[type] : undefined;
      return validInt(saved, 1, 5) ? saved : 1;
    });
    rememberMemories(profile);
    const seen = record(source.seenSpecials) ? source.seenSpecials : {};
    profile.seenSpecials = Object.fromEntries(['row','col','bomb','rainbow'].map(kind => [kind, seen[kind] === true]));
    // V5 story flags are optional presentation data. Existing V2/V3 saves,
    // character type slots, live sessions and ranking identities stay intact.
    const story = record(source.storySeen) ? source.storySeen : {};
    profile.storySeen = {
      prologue: story.prologue === true,
      openings: Array.from({ length: 5 }, (_, i) => Array.isArray(story.openings) && story.openings[i] === true),
      endings: Array.from({ length: 5 }, (_, i) => Array.isArray(story.endings) && story.endings[i] === true)
    };
    profile.journey = journey.normalizeProfile(source.journey, profile);
    profile.selectedBuddy = boundedInt(source.selectedBuddy, 0, 0, 5);
    profile.maxCombo = boundedInt(source.maxCombo, 0, 0, LIMITS.combo);
    profile.attempts = vector(vector(source.attempts, oldLimit, LIMITS.attempts), count, LIMITS.attempts);
    // V2 could not represent an unlocked level 13. Completing its last garden
    // carries that earned unlock into the expanded collection.
    if (previous && count > 12 && profile.stars[11] > 0) profile.unlocked = Math.max(profile.unlocked, 13);
    profile.hasSeenTutorial = source.hasSeenTutorial === true;
    profile.bestScore = Math.max(boundedInt(source.bestScore, 0, 0, LIMITS.score), ...profile.bestScores);
    const settings = record(data.settings) ? data.settings : {};
    output.settings.music = typeof settings.music === 'boolean' ? settings.music : true;
    output.settings.sfx = typeof settings.sfx === 'boolean' ? settings.sfx : true;
    output.settings.haptics = typeof settings.haptics === 'boolean' ? settings.haptics : true;
    output.settings.volume = typeof settings.volume === 'number' && Number.isFinite(settings.volume) ? Math.max(0, Math.min(1, settings.volume)) : 0.45;
    output.session = previous && data.session?.level > 12 ? null : normalizeSession(data.session, profile);
    return output;
  }

  function bond(total) {
    const count = boundedInt(total, 0, 0, LIMITS.collected);
    let index = 0;
    while (index + 1 < BONDS.length && count >= BONDS[index + 1].at) index++;
    const current = BONDS[index];
    const next = BONDS[index + 1]?.at ?? null;
    return {
      level: index + 1, label: current.label, next,
      progress: next === null ? 1 : (count - current.at) / (next - current.at)
    };
  }

  function buddyTotal(profile, type, verified = false) {
    if (!record(profile) || !validInt(type, 0, 5)) return 0;
    if (verified) return boundedInt(profile.verifiedBuddyXp?.[type], 0, 0, LIMITS.collected);
    return Math.max(boundedInt(profile.verifiedBuddyXp?.[type], 0, 0, LIMITS.collected), Math.min(LIMITS.collected,
      boundedInt(profile.totalCollected?.[type], 0, 0, LIMITS.collected) + boundedInt(profile.buddyClearXp?.[type], 0, 0, LIMITS.collected)));
  }

  // Stories are cosmetic keepsakes. A new league identity may reset its own
  // verified perks, but must never lock a story this device already earned.
  function memoryLevel(profile, type) {
    if (!record(profile) || !validInt(type, 0, 5)) return 1;
    const saved = Array.isArray(profile.buddyMemoryLevels) ? profile.buddyMemoryLevels[type] : undefined;
    return Math.max(validInt(saved, 1, 5) ? saved : 1, rewards.bond(buddyTotal(profile, type)).level);
  }

  function rememberMemories(profile) {
    if (!record(profile)) return Array(6).fill(1);
    profile.buddyMemoryLevels = Array.from({ length: 6 }, (_, type) => memoryLevel(profile, type));
    return profile.buddyMemoryLevels;
  }

  // Verified XP is a cache for presentation, never an input accepted by the
  // ranking server. Older asynchronous responses cannot undo newer rewards.
  function applyCompanions(profile, companions) {
    if (!record(profile) || !record(companions) || typeof companions.playerId !== 'string' || !/^player_[A-Za-z0-9_-]{16}$/.test(companions.playerId) ||
        !Array.isArray(companions.xp) || companions.xp.length !== 6 || !companions.xp.every(value => validInt(value, 0, LIMITS.collected))) return false;
    const samePlayer = profile.verifiedBuddyPlayerId === companions.playerId;
    rememberMemories(profile);
    const previous = samePlayer ? vector(profile.verifiedBuddyXp, 6, LIMITS.collected) : Array(6).fill(0);
    profile.verifiedBuddyPlayerId = companions.playerId;
    profile.verifiedBuddyXp = companions.xp.map((value, type) => Math.max(previous[type], value));
    rememberMemories(profile);
    return true;
  }

  // A completion receipt is immutable. Its delayed weekly snapshot must not
  // undo a reward claim or replace the current week after a rollover.
  function mergeWeekly(current, incoming) {
    const valid = value => record(value) && /^\d{4}-\d{2}-\d{2}$/.test(value.weekKey) && validInt(value.clears, 0, Number.MAX_SAFE_INTEGER) && Array.isArray(value.goals);
    const copy = value => value ? { ...value, goals: value.goals.map(goal => ({ ...goal, reward: { ...goal.reward } })) } : null;
    if (!valid(incoming)) return valid(current) ? copy(current) : null;
    if (!valid(current) || incoming.weekKey > current.weekKey) return copy(incoming);
    if (incoming.weekKey < current.weekKey) return copy(current);
    const previous = new Map(current.goals.map(goal => [goal.id, goal]));
    const merged = copy(incoming);
    merged.clears = Math.max(current.clears, incoming.clears);
    merged.goals = incoming.goals.map(goal => {
      const before = previous.get(goal.id);
      if (!before) return { ...goal, reward: { ...goal.reward } };
      const claimed = before.claimed || goal.claimed;
      const claim = before.claimed ? before : goal;
      return { ...goal, reward: { ...goal.reward }, progress: Math.max(before.progress || 0, goal.progress || 0),
        ready: before.ready || goal.ready, claimed: !!claimed,
        claimedBuddyType: claimed ? claim.claimedBuddyType : null, claimedAt: claimed ? claim.claimedAt : null };
    });
    return merged;
  }

  /** Inject a Storage-like object for isolated tests or other local containers. */
  function createStore(storage, options = {}) {
    const useBrowserStorage = arguments.length === 0;
    let memory = null;
    let memoryIsNewer = false;
    let baseline = null, baselineKnown = false, loadAttempted = false, lastError = null;
    const canWrite = () => {
      const guard = options.writeGuard || root.LumiSession?.current;
      return !guard || (typeof guard === 'function' ? guard() : guard.canWrite());
    };
    const conflict = code => {
      lastError = code;
      memoryIsNewer = false;
      options.onConflict?.(code);
      if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('lumi:storage-conflict', { detail: { code, source: 'progress' } }));
      }
      return false;
    };
    const resolveStorage = () => {
      const current = useBrowserStorage ? root.localStorage : storage;
      if (!current || typeof current.getItem !== 'function' || typeof current.setItem !== 'function') throw new Error('Local storage unavailable');
      return current;
    };
    const fromMemory = () => memory === null ? defaults() : normalize(JSON.parse(memory));
    const serialize = data => JSON.stringify({ version: VERSION, profile: data.profile, settings: data.settings, session: data.session });

    function load() {
      loadAttempted = true;
      // A failed write leaves the previous persistent value intact. Never let
      // that older value replace the newer in-memory turn on a subsequent load.
      if (memoryIsNewer) return fromMemory();
      try {
        const current = resolveStorage();
        const stored = current.getItem(KEY);
        baseline = stored ?? null; baselineKnown = true; lastError = null;
        let data;
        if (stored !== null && stored !== undefined) {
          try { data = normalize(JSON.parse(stored)); } catch (_) { data = defaults(); }
        } else {
          const previous = current.getItem(PREVIOUS_KEY);
          if (previous !== null && previous !== undefined) {
            let old;
            try { old = JSON.parse(previous); } catch (_) { old = null; }
            const supported = record(old) && (old.version === undefined || old.version === 2);
            data = normalize(supported ? { ...old, version: 2 } : null);
            if (supported) {
              data.migrationNotice = old.session && !data.session
                ? '기존 별과 친구 기록을 가져왔어요. 새로워진 정원은 처음부터 시작해요.'
                : '기존 정원과 친구 기록을 그대로 가져왔어요.';
            }
          } else {
            data = defaults();
            const legacy = current.getItem(LEGACY_KEY);
            if (typeof legacy === 'string' && legacy.trim() !== '') {
              const parsed = Number(legacy);
              data.profile.bestScore = boundedInt(parsed, 0, 0, LIMITS.score);
            }
          }
        }
        memory = serialize(data);
        return data;
      } catch (_) {
        return fromMemory();
      }
    }

    function save(data) {
      let serialized;
      try { serialized = serialize(normalize(data)); }
      catch (_) { return false; }
      memory = serialized;
      try {
        if (!canWrite()) return conflict('SESSION_NOT_OWNER');
        const current = resolveStorage(), existing = current.getItem(KEY) ?? null;
        if (baselineKnown && existing !== baseline) return conflict('STORAGE_CONFLICT');
        if (!baselineKnown && (memoryIsNewer || loadAttempted) && existing !== null) return conflict('STORAGE_CONFLICT');
        baseline = existing; baselineKnown = true;
        // One key and one setItem: profile, settings, and stable game commit
        // together. The session guard serializes browser writers; the baseline
        // check also rejects stale pagehide and independently loaded containers.
        current.setItem(KEY, serialized);
        baseline = serialized; baselineKnown = true; lastError = null;
        memoryIsNewer = false;
        return true;
      } catch (_) {
        lastError = 'STORAGE_UNAVAILABLE';
        memoryIsNewer = true;
        return false;
      }
    }

    return { load, save, getLastError: () => lastError };
  }

  const store = createStore();
  return { KEY, PREVIOUS_KEY, VERSION, BONDS, defaults, normalize, bond, buddyTotal, memoryLevel, rememberMemories, applyCompanions, mergeWeekly, createStore, load: store.load, save: store.save, getLastError: store.getLastError };
});
