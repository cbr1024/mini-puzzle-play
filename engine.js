/* Lumi Garden — dependency-free, deterministic match-three rules. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./rewards.js') : root.LumiRewards);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LumiEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Rewards) {
  'use strict';

  if (!Rewards) throw new Error('LumiRewards must load before LumiEngine.');

  const cloneTile = tile => tile ? { id: tile.id, type: tile.type, special: tile.special || null } : null;
  const key = p => `${p.r},${p.c}`;
  const equal = (a, b) => a.r === b.r && a.c === b.c;
  const color = tile => tile && tile.special !== 'rainbow' ? tile.type : null;
  const copyBoard = board => board.map(row => row.map(cloneTile));

  const STATE_VERSION = 3;
  const LEGACY_STATE_VERSION = 2;
  const SPECIALS = [null, 'row', 'col', 'bomb', 'rainbow'];
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

  function randomGenerator(seed, restoredState) {
    let value = typeof seed === 'number' ? seed >>> 0 : 2166136261;
    if (typeof seed !== 'number') {
      for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
    }
    if (restoredState !== undefined) value = restoredState >>> 0;
    const next = function () {
      value = (value + 0x6D2B79F5) >>> 0;
      let t = value;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    next.getState = () => value >>> 0;
    return next;
  }

  function normalizeObjectives(objectives, types) {
    if (objectives === undefined) return [];
    if (!Array.isArray(objectives) || objectives.length > types) throw new TypeError('Objectives must be a bounded array.');
    const seen = new Set();
    return objectives.map(objective => {
      if (!objective || !integer(objective.type, 0, types - 1) || !integer(objective.target, 1, 1000000) || seen.has(objective.type)) {
        throw new TypeError('Each objective needs a unique valid type and a positive integer target.');
      }
      seen.add(objective.type);
      return { type: objective.type, target: objective.target };
    });
  }

  function normalizeBuds(buds, rows, cols) {
    const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
    if (buds === undefined) return grid;
    if (!Array.isArray(buds)) throw new TypeError('Buds must be a grid or coordinate array.');
    if (buds.length && Array.isArray(buds[0])) {
      if (buds.length !== rows || buds.some(row => !Array.isArray(row) || row.length !== cols || row.some(hp => !integer(hp, 0, 2)))) throw new TypeError('Invalid bud grid.');
      return buds.map(row => row.slice());
    }
    if (buds.length > rows * cols) throw new TypeError('Too many buds.');
    for (const bud of buds) {
      if (!bud || !integer(bud.r, 0, rows - 1) || !integer(bud.c, 0, cols - 1) || !integer(bud.hp, 1, 2) || grid[bud.r][bud.c]) throw new TypeError('Invalid or duplicate bud coordinate.');
      grid[bud.r][bud.c] = bud.hp;
    }
    return grid;
  }

  /** Return connected match groups. Intersecting horizontal/vertical runs merge. */
  function findMatches(board) {
    const rows = board.length;
    const cols = rows ? board[0].length : 0;
    const runs = [];
    for (const direction of ['row', 'col']) {
      const outer = direction === 'row' ? rows : cols;
      const inner = direction === 'row' ? cols : rows;
      for (let a = 0; a < outer; a++) {
        let start = 0;
        while (start < inner) {
          const at = n => direction === 'row' ? { r: a, c: n } : { r: n, c: a };
          const p = at(start);
          const type = color(board[p.r][p.c]);
          let end = start + 1;
          if (type !== null) while (end < inner) {
            const q = at(end);
            if (color(board[q.r][q.c]) !== type) break;
            end++;
          }
          if (type !== null && end - start >= 3) {
            runs.push({ direction, type, cells: Array.from({ length: end - start }, (_, n) => at(start + n)) });
          }
          start = end;
        }
      }
    }
    const groups = [];
    for (const run of runs) {
      const keys = new Set(run.cells.map(key));
      const joined = groups.filter(group => group.type === run.type && group.cells.some(p => keys.has(key(p))));
      if (!joined.length) {
        groups.push({ type: run.type, cells: run.cells.map(p => ({ ...p })), runs: [run] });
      } else {
        const group = joined[0];
        group.runs.push(run);
        for (const other of joined.slice(1)) {
          group.runs.push(...other.runs);
          group.cells.push(...other.cells);
          groups.splice(groups.indexOf(other), 1);
        }
        group.cells.push(...run.cells);
        group.cells = Array.from(new Map(group.cells.map(p => [key(p), p])).values());
      }
    }
    return groups;
  }

  class Game {
    constructor(options = {}) {
      this.rows = options.rows ?? 6;
      this.cols = options.cols ?? 6;
      this.types = options.types ?? 6;
      if (![this.rows, this.cols].every(n => Number.isInteger(n) && n >= 3 && n <= 12)) throw new RangeError('Board dimensions must be integers from 3 to 12.');
      if (!Number.isInteger(this.types) || this.types < 3 || this.types > 12) throw new RangeError('Use 3–12 tile types.');
      this.moves = Number.isFinite(options.moves) ? Math.max(0, Math.floor(options.moves)) : 24;
      this.target = Number.isFinite(options.target) ? Math.max(1, Math.floor(options.target)) : 3500;
      if (!integer(this.moves, 0, 10000) || !integer(this.target, 1, 1000000000000)) throw new RangeError('Moves or score target are out of range.');
      this.initialMoves = this.moves;
      this.scoringVersion = options.scoringVersion ?? Rewards.SCORING_VERSION;
      if (![2, Rewards.SCORING_VERSION].includes(this.scoringVersion)) throw new TypeError('Unsupported scoring version.');
      this._schemaVersion = this.scoringVersion === 2 ? LEGACY_STATE_VERSION : STATE_VERSION;
      this.buddy = Rewards.normalizeBuddy(this.scoringVersion === 2 ? undefined : options.buddy);
      if (this.buddy.type >= this.types) throw new TypeError('Buddy color is unavailable on this board.');
      this.perks = Rewards.perks(this.buddy, this.target);
      this.requireScore = options.requireScore === undefined ? true : options.requireScore;
      if (typeof this.requireScore !== 'boolean') throw new TypeError('requireScore must be boolean.');
      this.objectives = normalizeObjectives(options.objectives, this.types);
      this.collected = Array(this.types).fill(0);
      this.buds = normalizeBuds(options.buds, this.rows, this.cols);
      this._initialBuds = this.buds.map(row => row.slice());
      this.budsGoal = this.buds.flat().filter(hp => hp > 0).length;
      this.bloomed = 0;
      this.feverCharge = 0;
      this.feverTurns = 0;
      this.score = this.perks.startScore;
      this._scoreParts = { matchScore: 0, buddyStartBonus: this.perks.startScore, buddyMatchBonus: 0, buddyFeverBonus: 0,
        moveBonus: 0, efficiencyBonus: 0, settled: false };
      this.combo = 0;
      this.won = false;
      this.over = this.moves === 0;
      this.seed = options.seed ?? Math.floor(Math.random() * 0xffffffff);
      if (!(typeof this.seed === 'string' && this.seed.length <= 256 || typeof this.seed === 'number' && Number.isFinite(this.seed))) throw new TypeError('Seed must be a finite number or short string.');
      this._random = randomGenerator(this.seed);
      this._uid = 0;
      this.board = [];
      this._generateStableBoard();
    }

    _tile(type) { return { id: `lumi-${++this._uid}`, type: type ?? Math.floor(this._random() * this.types), special: null }; }
    _inside(p) { return p && Number.isInteger(p.r) && Number.isInteger(p.c) && p.r >= 0 && p.c >= 0 && p.r < this.rows && p.c < this.cols; }
    _adjacent(a, b) { return this._inside(a) && this._inside(b) && Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1; }
    _swap(a, b) { [this.board[a.r][a.c], this.board[b.r][b.c]] = [this.board[b.r][b.c], this.board[a.r][a.c]]; }
    _event(kind, extra = {}) { return { kind, ...this.snapshot(), ...extra }; }

    snapshot() {
      return {
        board: copyBoard(this.board), score: this.score, moves: this.moves, target: this.target,
        won: this.won, over: this.over, combo: this.combo, requireScore: this.requireScore,
        collected: this.collected.slice(), objectives: this.objectives.map(objective => ({ ...objective, current: this.collected[objective.type] })),
        buds: this.buds.map(row => row.slice()), budsGoal: this.budsGoal, bloomed: this.bloomed,
        feverCharge: this.feverCharge, feverTurns: this.feverTurns, stars: this.stars,
        scoringVersion: this.scoringVersion, buddy: { ...this.buddy }, perks: { ...this.perks },
        starThresholds: Rewards.starThresholds(this.target), nextStar: Rewards.nextStar(this.score, this.target),
        scoreBreakdown: { ...this._scoreParts, total: this.score, moveValue: this.scoringVersion === 2 ? 0 : Rewards.moveValue(this.target), remainingMoves: this.moves }
      };
    }

    get stars() {
      if (!this.won) return 0;
      return Math.max(1, this.scoringVersion === 2
        ? [0.55, 1, 1.65].filter(ratio => this.score >= this.target * ratio).length
        : Rewards.starThresholds(this.target).filter(threshold => this.score >= threshold).length);
    }

    _goalsMet() {
      const collectionDone = this.objectives.every(objective => this.collected[objective.type] >= objective.target);
      const budsDone = this.bloomed >= this.budsGoal;
      const scoreRequired = this.requireScore || (!this.objectives.length && !this.budsGoal);
      return collectionDone && budsDone && (!scoreRequired || this.score >= this.target);
    }

    /** Only stable model states are saved. Playback frames are never resumable. */
    exportState() {
      const data = {
        version: this._schemaVersion, rows: this.rows, cols: this.cols, types: this.types,
        initialMoves: this.initialMoves, moves: this.moves, target: this.target,
        requireScore: this.requireScore, objectives: this.objectives.map(objective => ({ ...objective })),
        board: copyBoard(this.board), score: this.score, combo: this.combo,
        collected: this.collected.slice(), initialBuds: this._initialBuds.map(row => row.slice()),
        buds: this.buds.map(row => row.slice()), budsGoal: this.budsGoal, bloomed: this.bloomed,
        feverCharge: this.feverCharge, feverTurns: this.feverTurns,
        won: this.won, over: this.over, stars: this.stars,
        seed: this.seed, rngState: this._random.getState(), uid: this._uid
      };
      // Keep V2 byte-for-byte shape when resuming an old ranking checkpoint.
      // The old round finishes under its original rules; new rounds use V4.
      if (this._schemaVersion === STATE_VERSION) Object.assign(data, {
        scoringVersion: this.scoringVersion, buddy: { ...this.buddy },
        scoreBreakdown: { ...this._scoreParts }
      });
      Game.fromState(data);
      return data;
    }

    static fromState(data) {
      const fail = message => { throw new TypeError(`Invalid Lumi save: ${message}`); };
      if (!data || typeof data !== 'object' || Array.isArray(data) || ![LEGACY_STATE_VERSION, STATE_VERSION].includes(data.version)) fail('unsupported version');
      const legacy = data.version === LEGACY_STATE_VERSION;
      if (!integer(data.rows, 3, 12) || !integer(data.cols, 3, 12) || !integer(data.types, 3, 12)) fail('dimensions');
      if (!integer(data.initialMoves, 0, 10000) || !integer(data.moves, 0, data.initialMoves) || !integer(data.target, 1, 1000000000000)) fail('moves/target');
      if (!integer(data.score, 0, legacy ? 1000000000000 : Number.MAX_SAFE_INTEGER) || !integer(data.combo, 0, 65) || !integer(data.uid, data.rows * data.cols, 1000000000)) fail('score/counter');
      if (!integer(data.rngState, 0, 0xffffffff) || !(typeof data.seed === 'string' && data.seed.length <= 256 || typeof data.seed === 'number' && Number.isFinite(data.seed))) fail('random state');
      if (typeof data.requireScore !== 'boolean' || typeof data.won !== 'boolean' || typeof data.over !== 'boolean') fail('status');
      if (!Array.isArray(data.collected) || data.collected.length !== data.types || data.collected.some(n => !integer(n, 0, 1000000000))) fail('collection counts');
      const collectedTotal = data.collected.reduce((sum, count) => sum + count, 0);
      if (!integer(data.feverCharge, 0, 100) || !integer(data.feverTurns, 0, 3) || (data.feverTurns > 0 ? data.feverCharge !== 100 : data.feverCharge === 100)) fail('fever state');
      const game = Object.create(Game.prototype);
      game.rows = data.rows; game.cols = data.cols; game.types = data.types;
      game.initialMoves = data.initialMoves; game.moves = data.moves; game.target = data.target;
      game._schemaVersion = data.version;
      game.scoringVersion = legacy ? 2 : data.scoringVersion;
      if (!legacy && game.scoringVersion !== Rewards.SCORING_VERSION) fail('scoring version');
      game.buddy = Rewards.normalizeBuddy(legacy ? undefined : data.buddy);
      if (game.buddy.type >= game.types || !legacy && !data.buddy) fail('buddy');
      game.perks = Rewards.perks(game.buddy, game.target);
      if (legacy) game._scoreParts = { matchScore: data.score, buddyStartBonus: 0, buddyMatchBonus: 0, buddyFeverBonus: 0, moveBonus: 0, efficiencyBonus: 0, settled: false };
      else {
        const parts = data.scoreBreakdown;
        const fields = ['matchScore', 'buddyStartBonus', 'buddyMatchBonus', 'buddyFeverBonus', 'moveBonus', 'efficiencyBonus'];
        if (!parts || typeof parts !== 'object' || Array.isArray(parts) || fields.some(name => !integer(parts[name], 0, Number.MAX_SAFE_INTEGER)) || typeof parts.settled !== 'boolean') fail('score breakdown');
        game._scoreParts = Object.fromEntries(fields.map(name => [name, parts[name]]));
        game._scoreParts.settled = parts.settled;
        if (fields.reduce((sum, name) => sum + parts[name], 0) !== data.score || parts.buddyStartBonus !== game.perks.startScore) fail('score breakdown total');
        if (parts.buddyMatchBonus > Math.ceil((data.collected[game.buddy.type] || 0) * 1920 * game.perks.matchPercent / 100)) fail('buddy match score');
        if (parts.buddyFeverBonus > Math.floor(parts.matchScore * game.perks.feverScorePercent / 100)) fail('buddy fever score');
        if (parts.settled !== data.won) fail('completion payment state');
        if (!parts.settled && (parts.moveBonus || parts.efficiencyBonus)) fail('premature completion bonus');
        if (parts.settled) {
          const expected = Rewards.completionBonus({ score: parts.matchScore + parts.buddyStartBonus + parts.buddyMatchBonus + parts.buddyFeverBonus, target: game.target, moves: game.moves });
          if (parts.moveBonus !== expected.moveBonus || parts.efficiencyBonus !== expected.efficiencyBonus) fail('completion bonus');
          const scoreRequired = data.requireScore || (!data.objectives?.length && !data.budsGoal);
          if (scoreRequired && expected.scoreBefore < game.target) fail('bonus cannot complete a score objective');
        }
      }
      if (game._scoreParts.matchScore < collectedTotal * 60 || game._scoreParts.matchScore > collectedTotal * 2400) fail('collection/score consistency');
      game.requireScore = data.requireScore;
      game.objectives = normalizeObjectives(data.objectives, data.types);
      if (!Array.isArray(data.objectives)) fail('missing objectives');
      game.collected = data.collected.slice();
      if (!Array.isArray(data.initialBuds) || !Array.isArray(data.buds) || data.initialBuds.length !== data.rows || data.buds.length !== data.rows) fail('missing bud grids');
      game._initialBuds = normalizeBuds(data.initialBuds, data.rows, data.cols);
      game.buds = normalizeBuds(data.buds, data.rows, data.cols);
      game.budsGoal = game._initialBuds.flat().filter(hp => hp > 0).length;
      game.bloomed = 0;
      for (let r = 0; r < game.rows; r++) for (let c = 0; c < game.cols; c++) {
        if (game.buds[r][c] > game._initialBuds[r][c]) fail('bud layers increased');
        if (game._initialBuds[r][c] && !game.buds[r][c]) game.bloomed++;
      }
      if (data.budsGoal !== game.budsGoal || data.bloomed !== game.bloomed) fail('bud counters');
      if (game._initialBuds.flat().reduce((sum, hp) => sum + hp, 0) - game.buds.flat().reduce((sum, hp) => sum + hp, 0) > collectedTotal) fail('bud hits exceed matches');
      const ids = new Set();
      if (!Array.isArray(data.board) || data.board.length !== game.rows) fail('board rows');
      game.board = data.board.map(row => {
        if (!Array.isArray(row) || row.length !== game.cols) fail('board columns');
        return row.map(tile => {
          if (!tile || typeof tile !== 'object' || typeof tile.id !== 'string' || !/^lumi-[1-9][0-9]*$/.test(tile.id) || !integer(Number(tile.id.slice(5)), 1, data.uid) || ids.has(tile.id)) fail('tile IDs');
          if (!integer(tile.type, 0, game.types - 1) || !SPECIALS.includes(tile.special)) fail('tile value');
          ids.add(tile.id);
          return cloneTile(tile);
        });
      });
      game.score = data.score; game.combo = data.combo;
      game.feverCharge = data.feverCharge; game.feverTurns = data.feverTurns;
      game.seed = data.seed; game._uid = data.uid; game._random = randomGenerator(data.seed, data.rngState);
      game.won = game._goalsMet(); game.over = !game.won && game.moves === 0;
      if (game.won !== data.won || game.over !== data.over || game.stars !== data.stars) fail('inconsistent outcome');
      if (game.findMatches().length || (!game.won && !game.over && !game._legalMoves().length)) fail('board is not settled/playable');
      return game;
    }

    findMatches() { return findMatches(this.board); }

    _generateStableBoard() {
      for (let attempt = 0; attempt < 500; attempt++) {
        this.board = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
          const forbidden = new Set();
          if (c > 1 && color(this.board[r][c - 1]) === color(this.board[r][c - 2])) forbidden.add(color(this.board[r][c - 1]));
          if (r > 1 && color(this.board[r - 1][c]) === color(this.board[r - 2][c])) forbidden.add(color(this.board[r - 1][c]));
          const choices = Array.from({ length: this.types }, (_, t) => t).filter(t => !forbidden.has(t));
          this.board[r][c] = this._tile(choices[Math.floor(this._random() * choices.length)]);
        }
        if (this._legalMoves().length) return;
      }
      // A guaranteed ABA / BAB pattern fits any supported board; fill around it
      // while rejecting initial triples. This also handles unusually large palettes.
      this.board = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
      const motif = [[0, 1, 0], [2, 0, 2]];
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        const preferred = r < 2 && c < 3 ? motif[r][c] : (r + c) % this.types;
        let type = preferred;
        for (let n = 0; n < this.types; n++) {
          type = (preferred + n) % this.types;
          if (c > 1 && color(this.board[r][c - 1]) === type && color(this.board[r][c - 2]) === type) continue;
          if (r > 1 && color(this.board[r - 1][c]) === type && color(this.board[r - 2][c]) === type) continue;
          break;
        }
        this.board[r][c] = this._tile(type);
      }
    }

    _legalMoves() {
      const moves = [];
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        const from = { r, c };
        for (const to of [{ r: r + 1, c }, { r, c: c + 1 }]) {
          if (!this._inside(to)) continue;
          const first = this.board[r][c];
          const second = this.board[to.r][to.c];
          if (!first || !second) continue;
          if (first.special || second.special) {
            moves.push({ from: { ...from }, to: { ...to } });
            continue;
          }
          this._swap(from, to);
          const matched = this.findMatches().some(group => group.cells.some(p => equal(p, from) || equal(p, to)));
          this._swap(from, to);
          if (matched) moves.push({ from: { ...from }, to: { ...to } });
        }
      }
      return moves;
    }

    legalMoves() { return this.won || this.over ? [] : this._legalMoves(); }

    hint() {
      let best = null;
      let maximum = -1;
      for (const move of this.legalMoves()) {
        const first = this.board[move.from.r][move.from.c];
        const second = this.board[move.to.r][move.to.c];
        this._swap(move.from, move.to);
        const groups = this.findMatches();
        let value = groups.reduce((sum, group) => sum + group.cells.length * group.cells.length, 0);
        // Hints favour unfinished collection goals and unopened ground, while
        // still rewarding larger matches and special-piece opportunities.
        for (const group of groups) {
          const objective = this.objectives.find(goal => goal.type === group.type);
          if (objective) value += Math.min(group.cells.length, Math.max(0, objective.target - this.collected[group.type])) * 10;
          for (const p of group.cells) if (this.buds[p.r][p.c]) value += 12;
        }
        if (first.special === 'rainbow' || second.special === 'rainbow') value += 80;
        else if (first.special || second.special) value += 40;
        this._swap(move.from, move.to);
        if (value > maximum) { maximum = value; best = move; }
      }
      return best;
    }

    play(from, to) {
      if (this.won || this.over || !this._adjacent(from, to)) return { valid: false, events: [], reason: this.won || this.over ? 'finished' : 'not-adjacent' };
      const a = { r: from.r, c: from.c };
      const b = { r: to.r, c: to.c };
      const feverWasActive = this.feverTurns > 0;
      const previousCombo = this.combo;
      this.combo = 0;
      this._swap(a, b);
      const events = [this._event('swap', { from: a, to: b })];
      const first = this.board[a.r][a.c];
      const second = this.board[b.r][b.c];
      const groups = this.findMatches();
      const special = first.special || second.special;
      if (!special && !groups.some(group => group.cells.some(p => equal(p, a) || equal(p, b)))) {
        this._swap(a, b);
        // Rejected input must preserve the complete stable checkpoint. Ranked
        // action journals intentionally record only accepted game actions.
        this.combo = previousCombo;
        events.push(this._event('invalid', { from: a, to: b }));
        return { valid: false, events, reason: 'no-match' };
      }
      this.moves--;
      if (special) {
        const initial = [a, b];
        const rainbow = new Map();
        if (first.special === 'rainbow' && second.special === 'rainbow') {
          for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) initial.push({ r, c });
          rainbow.set(key(a), null);
          rainbow.set(key(b), null);
        } else {
          if (first.special === 'rainbow') rainbow.set(key(a), second.type);
          if (second.special === 'rainbow') rainbow.set(key(b), first.type);
        }
        this._clear(initial, [], events, rainbow);
        this._fall(events);
        this._cascade(events);
      } else {
        this._cascade(events, [b, a]);
      }
      this._finishTurn(events, feverWasActive);
      return { valid: true, events };
    }

    _creationFor(group, preferred) {
      const longest = Math.max(...group.runs.map(run => run.cells.length));
      const directions = new Set(group.runs.map(run => run.direction));
      const special = longest >= 5 ? 'rainbow' : directions.size > 1 ? 'bomb' : longest === 4 ? group.runs[0].direction : null;
      if (!special) return null;
      const eligible = group.cells.filter(p => this.board[p.r][p.c] && !this.board[p.r][p.c].special);
      if (!eligible.length) return null;
      let position = preferred.find(p => eligible.some(q => equal(p, q)));
      if (!position && directions.size > 1) position = eligible.find(p => group.runs.filter(run => run.cells.some(q => equal(p, q))).length > 1);
      position = position || eligible[Math.floor(eligible.length / 2)];
      return { r: position.r, c: position.c, tile: { ...this.board[position.r][position.c], special } };
    }

    _cascade(events, preferred = []) {
      for (let chain = 0; chain < 64; chain++) {
        const groups = this.findMatches();
        if (!groups.length) return;
        const created = groups.map(group => this._creationFor(group, preferred)).filter(Boolean);
        this._clear(groups.flatMap(group => group.cells), created, events);
        this._fall(events);
        preferred = [];
      }
      // Guard against pathological RNG/cascade loops without leaving a matched board.
      this._reshuffle(events);
    }

    _clear(initial, created, events, rainbowTargets = new Map()) {
      const protectedCells = new Set(created.map(key));
      const queue = initial.map(p => ({ r: p.r, c: p.c }));
      const removed = new Set();
      const cells = [];
      const activated = [];
      for (let i = 0; i < queue.length; i++) {
        const p = queue[i];
        const id = key(p);
        if (!this._inside(p) || removed.has(id) || protectedCells.has(id)) continue;
        const tile = this.board[p.r][p.c];
        if (!tile) continue;
        removed.add(id);
        cells.push({ ...p, tile: cloneTile(tile) });
        if (!tile.special) continue;
        activated.push({ ...p, tile: cloneTile(tile) });
        if (tile.special === 'row') {
          for (let c = 0; c < this.cols; c++) queue.push({ r: p.r, c });
        } else if (tile.special === 'col') {
          for (let r = 0; r < this.rows; r++) queue.push({ r, c: p.c });
        } else if (tile.special === 'bomb') {
          for (let r = p.r - 1; r <= p.r + 1; r++) for (let c = p.c - 1; c <= p.c + 1; c++) queue.push({ r, c });
        } else if (tile.special === 'rainbow') {
          const type = rainbowTargets.has(id) ? rainbowTargets.get(id) : this._mostCommonColor();
          if (type !== null) for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
            if (this.board[r][c] && this.board[r][c].type === type) queue.push({ r, c });
          }
        }
      }
      const budsHit = [];
      const bloomedCells = [];
      // Transforming a matched spirit into a special still collects that spirit
      // and hits the ground once. The new special survives on top of the bud.
      for (const p of [...cells, ...created]) {
        this.collected[p.tile.type]++;
        const before = this.buds[p.r][p.c];
        if (before > 0) {
          const after = before - 1;
          this.buds[p.r][p.c] = after;
          budsHit.push({ r: p.r, c: p.c, before, after });
          if (!after) {
            this.bloomed++;
            bloomedCells.push({ r: p.r, c: p.c });
          }
        }
      }
      for (const p of cells) this.board[p.r][p.c] = null;
      for (const p of created) this.board[p.r][p.c] = cloneTile(p.tile);
      this.combo++;
      const multiplier = Math.min(this.combo, 8);
      const feverMultiplier = this.feverTurns > 0 ? 2 : 1;
      const baseScoreDelta = (cells.length * 60 + created.length * 120 + activated.length * 90) * multiplier * feverMultiplier;
      const selectedBase = cells.filter(cell => cell.tile.type === this.buddy.type).length * 60 +
        created.filter(cell => cell.tile.type === this.buddy.type).length * 120;
      const buddyScoreDelta = Math.floor(selectedBase * multiplier * feverMultiplier * this.perks.matchPercent / 100);
      const buddyFeverDelta = feverMultiplier > 1 ? Math.floor(baseScoreDelta * this.perks.feverScorePercent / 100) : 0;
      const scoreDelta = baseScoreDelta + buddyScoreDelta + buddyFeverDelta;
      this.score += scoreDelta;
      this._scoreParts.matchScore += baseScoreDelta;
      this._scoreParts.buddyMatchBonus += buddyScoreDelta;
      this._scoreParts.buddyFeverBonus += buddyFeverDelta;
      let startedFever = false;
      if (!this.feverTurns) {
        this.feverCharge = Math.min(100, this.feverCharge + cells.length * 4 + created.length * 8);
        if (this.feverCharge === 100) { this.feverTurns = 3; startedFever = true; }
      }
      events.push(this._event('clear', {
        cells, created: created.map(p => ({ r: p.r, c: p.c, tile: cloneTile(p.tile) })),
        activated, scoreDelta, baseScoreDelta, buddyScoreDelta, buddyFeverDelta, combo: this.combo, budsHit, bloomedCells, feverMultiplier
      }));
      if (startedFever) events.push(this._event('feverStart'));
    }

    _mostCommonColor() {
      const totals = Array(this.types).fill(0);
      for (const row of this.board) for (const tile of row) if (tile && tile.special !== 'rainbow') totals[tile.type]++;
      return totals.indexOf(Math.max(...totals));
    }

    _fall(events) {
      for (let c = 0; c < this.cols; c++) {
        const survivors = [];
        for (let r = this.rows - 1; r >= 0; r--) if (this.board[r][c]) survivors.push(this.board[r][c]);
        for (let r = this.rows - 1, n = 0; r >= 0; r--, n++) this.board[r][c] = n < survivors.length ? survivors[n] : this._tile();
      }
      events.push(this._event('fall'));
    }

    _reshuffle(events) {
      const original = this.board.flat().filter(Boolean);
      for (let attempt = 0; attempt < 250 && original.length === this.rows * this.cols; attempt++) {
        const tiles = original.slice();
        for (let i = tiles.length - 1; i > 0; i--) {
          const j = Math.floor(this._random() * (i + 1));
          [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
        }
        this.board = Array.from({ length: this.rows }, (_, r) => tiles.slice(r * this.cols, (r + 1) * this.cols));
        if (!this.findMatches().length && this._legalMoves().length) {
          events.push(this._event('shuffle'));
          return;
        }
      }
      const specials = original.filter(tile => tile.special).map(cloneTile);
      this._generateStableBoard();
      for (let n = 0; n < specials.length; n++) {
        const r = Math.floor(n / this.cols);
        const c = n % this.cols;
        this.board[r][c].special = specials[n].special;
      }
      events.push(this._event('shuffle'));
    }

    _finishTurn(events, consumeFever = false) {
      if (consumeFever && this.feverTurns > 0) {
        this.feverTurns--;
        if (!this.feverTurns) {
          this.feverCharge = 0;
          events.push(this._event('feverEnd'));
        }
      }
      this.won = this._goalsMet();
      this.over = !this.won && this.moves <= 0;
      if (this.won && this.scoringVersion !== 2 && !this._scoreParts.settled) {
        const bonus = Rewards.completionBonus({ score: this.score, target: this.target, moves: this.moves });
        this._scoreParts.moveBonus = bonus.moveBonus;
        this._scoreParts.efficiencyBonus = bonus.efficiencyBonus;
        this._scoreParts.settled = true;
        this.score = bonus.total;
        events.push(this._event('completionBonus', { ...bonus, scoreDelta: bonus.totalBonus }));
      }
      if (this.won || this.over) events.push(this._event('finish'));
      else if (!this._legalMoves().length) this._reshuffle(events);
    }

    shuffle() {
      if (this.won || this.over) return { valid: false, events: [], reason: 'finished' };
      const events = [];
      this.combo = 0;
      this._reshuffle(events);
      return { valid: true, events };
    }

    blast(position) {
      if (this.won || this.over || !this._inside(position)) return { valid: false, events: [], reason: 'unavailable' };
      const events = [];
      const cells = [];
      this.combo = 0;
      for (let r = position.r - 1; r <= position.r + 1; r++) for (let c = position.c - 1; c <= position.c + 1; c++) cells.push({ r, c });
      this._clear(cells, [], events);
      this._fall(events);
      this._cascade(events);
      this._finishTurn(events);
      return { valid: true, events };
    }
  }

  return { Game, findMatches };
});
