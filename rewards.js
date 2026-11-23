/* Lumi Garden — shared, deterministic progression and scoring policy. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LumiRewards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCORING_VERSION = 4;
  const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
  const freezeTree = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freezeTree); Object.freeze(value); }
    return value;
  };
  const BONDS = freezeTree([
    { at: 0, label: '첫 만남', perkLabel: '함께하는 첫걸음', perkDescription: '친밀도 30부터 시작 점수 보너스가 열려요.' },
    { at: 30, label: '친해지는 중', perkLabel: '다정한 출발', perkDescription: '새 정원을 시작할 때 기준 점수의 2%를 선물해요.' },
    { at: 80, label: '포근한 친구', perkLabel: '반짝이는 응원', perkDescription: '시작 점수 2% + 피버 중 기본 득점 8% 증가.' },
    { at: 160, label: '마음의 단짝', perkLabel: '마음이 통하는 매치', perkDescription: '시작 점수 2% + 피버 중 기본 득점 8% + 동행 친구 블록 점수 5% 증가.' },
    { at: 300, label: '평생 친구', perkLabel: '우리의 작은 기적', perkDescription: '시작 점수 4% + 피버 중 기본 득점 12% + 동행 친구 블록 점수 8% 증가.' }
  ]);
  const WEEKLY_GOALS = freezeTree([
    { id: 'bloom-3', label: '이번 주 3번 꽃피우기', target: 3, reward: { kind: 'buddyXp', amount: 30 } },
    { id: 'bloom-8', label: '이번 주 8번 꽃피우기', target: 8, reward: { kind: 'buddyXp', amount: 60 } }
  ]);

  function bond(xp) {
    const count = typeof xp === 'number' && Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
    let index = 0;
    while (index + 1 < BONDS.length && count >= BONDS[index + 1].at) index++;
    const current = BONDS[index], next = BONDS[index + 1]?.at ?? null;
    return { level: index + 1, label: current.label, current: current.at, next,
      progress: next === null ? 1 : (count - current.at) / (next - current.at),
      perkLabel: current.perkLabel, perkDescription: current.perkDescription };
  }

  function normalizeBuddy(value) {
    if (value === undefined || value === null) return Object.freeze({ type: 0, tier: 1 });
    if (typeof value !== 'object' || Array.isArray(value) || !integer(value.type, 0, 5) || !integer(value.tier, 1, 5) ||
        Object.keys(value).some(key => !['type', 'tier'].includes(key))) throw new TypeError('Buddy needs a valid type and earned tier.');
    return Object.freeze({ type: value.type, tier: value.tier });
  }

  function validTarget(target) {
    if (!integer(target, 1, 1000000000000)) throw new RangeError('Invalid score target.');
    return target;
  }

  function starThresholds(target) {
    validTarget(target);
    // Integer arithmetic avoids floating-point surprises at milestone boundaries.
    return [Math.ceil(target * 55 / 100), target, Math.ceil(target * 165 / 100)];
  }

  function nextStar(score, target) {
    const thresholds = starThresholds(target);
    const index = thresholds.findIndex(threshold => score < threshold);
    return index < 0 ? null : { stars: index + 1, threshold: thresholds[index], remaining: thresholds[index] - score };
  }

  function moveValue(target) {
    return Math.ceil(validTarget(target) * 6 / 1000) * 10;
  }

  function completionBonus({ score, target, moves }) {
    if (!integer(score, 0, Number.MAX_SAFE_INTEGER) || !integer(moves, 0, 10000)) throw new RangeError('Invalid completion values.');
    const perMove = moveValue(target), moveBonus = moves * perMove;
    const efficiencyBonus = moves >= 10 ? Math.max(0, starThresholds(target)[2] - score - moveBonus) : 0;
    const totalBonus = moveBonus + efficiencyBonus, total = score + totalBonus;
    if (!Number.isSafeInteger(total)) throw new RangeError('Score exceeds the safe integer range.');
    return { scoreBefore: score, moveValue: perMove, movesRemaining: moves, moveBonus, efficiencyBonus, totalBonus, total };
  }

  function perks(value, target) {
    const buddy = normalizeBuddy(value);
    validTarget(target);
    const startPercent = buddy.tier >= 5 ? 4 : buddy.tier >= 2 ? 2 : 0;
    return Object.freeze({
      type: buddy.type, tier: buddy.tier, startPercent,
      startScore: Math.ceil(target * startPercent / 1000) * 10,
      feverScorePercent: buddy.tier >= 5 ? 12 : buddy.tier >= 3 ? 8 : 0,
      matchPercent: buddy.tier >= 5 ? 8 : buddy.tier >= 4 ? 5 : 0
    });
  }

  function clearXp({ stars } = {}) {
    if (!integer(stars, 1, 3)) throw new RangeError('A cleared garden needs one to three stars.');
    return 12 + stars * 4;
  }

  return Object.freeze({ SCORING_VERSION, BONDS, WEEKLY_GOALS, bond, normalizeBuddy, starThresholds, nextStar, moveValue, completionBonus, perks, clearXp });
});
