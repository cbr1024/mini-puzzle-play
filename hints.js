/* Goal-aware guidance only. The deterministic scoring/replay engine is unchanged. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./engine.js') : root.LumiEngine);
  if (node) module.exports = api;
  if (root) root.LumiHints = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Engine) {
  'use strict';

  const point = p => ({ r: p.r, c: p.c });
  const moveCopy = move => move ? { from: point(move.from), to: point(move.to) } : null;
  const sameMove = (a, b) => a && b &&
    ((a.from.r === b.from.r && a.from.c === b.from.c && a.to.r === b.to.r && a.to.c === b.to.c) ||
     (a.from.r === b.to.r && a.from.c === b.to.c && a.to.r === b.from.r && a.to.c === b.from.c));

  function usable(game) {
    if (!Engine?.Game || !(game instanceof Engine.Game) || game.won || game.over || game.moves < 1) return false;
    const { rows, cols, board, buds, types, collected } = game;
    return Number.isInteger(rows) && rows >= 3 && rows <= 12 && Number.isInteger(cols) && cols >= 3 && cols <= 12 &&
      Array.isArray(board) && board.length === rows && board.every(row => Array.isArray(row) && row.length === cols &&
        row.every(tile => tile && Number.isInteger(tile.type) && tile.type >= 0 && tile.type < types &&
          [null, undefined, 'row', 'col', 'bomb', 'rainbow'].includes(tile.special))) &&
      Array.isArray(buds) && buds.length === rows && buds.every(row => Array.isArray(row) && row.length === cols &&
        row.every(hp => Number.isInteger(hp) && hp >= 0 && hp <= 2)) &&
      Array.isArray(collected) && collected.length === types && collected.every(n => Number.isSafeInteger(n) && n >= 0) &&
      Array.isArray(game.objectives) && game.objectives.every(goal => Number.isInteger(goal.type) && goal.type >= 0 &&
        goal.type < types && Number.isSafeInteger(goal.target) && goal.target > 0) &&
      Number.isFinite(game.score) && Number.isFinite(game.target) && game._scoreParts && game.buddy && game.perks;
  }

  // Reuse the real first-clear rules on an isolated copy. No play(), fall(),
  // cascade(), new Game(), future board generation, or random draw occurs here.
  // Every mutable field touched by _clear is independently owned by the copy.
  function immediateSpecialScore(game, move) {
    if (!move || !game._adjacent(move.from, move.to)) return null;
    const a = point(move.from), b = point(move.to);
    if (!game.board[a.r][a.c].special && !game.board[b.r][b.c].special) return null;
    const trial = Object.assign(Object.create(Object.getPrototypeOf(game)), game, {
      board: game.board.map(row => row.map(tile => ({ ...tile }))),
      buds: game.buds.map(row => row.slice()),
      collected: game.collected.slice(),
      _scoreParts: { ...game._scoreParts },
      combo: 0,
      moves: game.moves - 1,
      _random() { throw new Error('Hints must not inspect future randomness.'); }
    });
    trial._swap(a, b);
    const first = trial.board[a.r][a.c], second = trial.board[b.r][b.c];
    const initial = [a, b], targets = new Map(), key = p => p.r + ',' + p.c;
    if (first.special === 'rainbow' && second.special === 'rainbow') {
      for (let r = 0; r < trial.rows; r++) for (let c = 0; c < trial.cols; c++) initial.push({ r, c });
      targets.set(key(a), null); targets.set(key(b), null);
    } else {
      if (first.special === 'rainbow') targets.set(key(a), second.type);
      if (second.special === 'rainbow') targets.set(key(b), first.type);
    }
    trial._clear(initial, [], [], targets);
    return trial._goalsMet() ? trial.score : null;
  }

  function hint(game) {
    if (!usable(game)) return null;
    const fallback = game.hint();
    // Keep an already winning engine hint, including its stable tie ordering.
    if (fallback && immediateSpecialScore(game, fallback) !== null) return moveCopy(fallback);
    let winner = null, score = -Infinity;
    for (let r = 0; r < game.rows; r++) for (let c = 0; c < game.cols; c++) {
      const from = { r, c };
      for (const to of [{ r: r + 1, c }, { r, c: c + 1 }]) {
        if (!game._inside(to) || sameMove(fallback, { from, to })) continue;
        const projected = immediateSpecialScore(game, { from, to });
        if (projected !== null && projected > score) {
          score = projected; winner = { from: point(from), to: point(to) };
        }
      }
    }
    return winner || moveCopy(fallback);
  }

  return Object.freeze({ hint });
});
