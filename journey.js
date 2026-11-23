/* 채소팡 — optional, device-local journey stamps and visible world restoration.
 * This layer observes engine events. It never changes a board, score, RNG,
 * companion XP, inventory, or the server's authoritative ranking rules.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LumiJourney = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1, LEVEL_COUNT = 50;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const integer = (value, max = 1000000) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : 0;
  const levelNumber = value => Number.isInteger(value) ? Math.max(1, Math.min(LEVEL_COUNT, value)) : 1;
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  };
  const METRICS = freeze({
    clearedTotal: { label: '모은 빛모습', unit: '개', limit: 1000000 },
    maxCombo: { label: '최고 연쇄', unit: '연쇄', limit: 65 },
    specialsCreated: { label: '만든 특수 팡빛', unit: '개', limit: 10000 },
    specialsActivated: { label: '사용한 특수 팡빛', unit: '개', limit: 10000 },
    budsBloomed: { label: '깨운 봉오리', unit: '개', limit: 36 },
    layeredHits: { label: '첫 겹을 연 두 겹 봉오리', unit: '개', limit: 36 },
    lineActivated: { label: '사용한 가로·세로 팡빛', unit: '개', limit: 10000 },
    bombActivated: { label: '사용한 씨앗폭탄', unit: '개', limit: 10000 },
    rainbowActivated: { label: '사용한 무지개팡빛', unit: '개', limit: 10000 },
    feverEntries: { label: '햇살 합창(피버)', unit: '회', limit: 10000 }
  });
  const task = (level, title, metric, target, description, tip) => ({
    level, chapter: Math.ceil(level / 10), title, metric, target, description, tip,
    reward: '이 단계의 햇살 도장 1개', condition: '약속을 이루고 이 단계까지 클리어하면 도장을 간직해요.'
  });
  const TASKS = freeze([
    task(1, '첫 인사를 모아요', 'clearedTotal', 12, '빛모습 12개를 모아 첫 인사를 전해요.', '위쪽의 기본 수집 목표를 따라가면 자연스럽게 이룰 수 있어요.'),
    task(2, '다음 인사도 이어서', 'maxCombo', 2, '2연쇄로 두 친구의 인사를 이어 줘요.', '아래쪽에서 맞추면 떨어진 빛모습이 새 만남을 만들어요.'),
    task(3, '마당이 눈을 떠요', 'budsBloomed', 4, '중앙 봉오리 4개를 모두 깨워요.', '봉오리 바로 위의 빛모습을 맞춰요. 옆칸만 터져서는 열리지 않아요.'),
    task(4, '캐로의 긴 발자국', 'specialsCreated', 1, '특수 팡빛을 1개 만들어 길을 표시해요.', '같은 빛모습 4개를 한 줄로 이으면 가로·세로 팡빛이 생겨요.'),
    task(5, '한 겹씩 건네는 마음', 'layeredHits', 2, '두 겹 봉오리 2개의 첫 겹을 열어요.', '숫자 2가 있는 자리를 먼저 살펴봐요. 같은 칸을 한 번 더 맞추면 꽃이 피어요.'),
    task(6, '쉬어 가는 햇살', 'feverEntries', 1, '햇살 합창(피버)을 1번 맞이해요.', '빛모습을 모으면 피버가 차올라요. 다 차면 3턴 동안 매치 점수가 두 배예요.'),
    task(7, '보폭을 맞춰요', 'maxCombo', 2, '2연쇄로 포포의 걸음에 박자를 맞춰요.', '다음에 떨어질 자리까지 생각하며 아래쪽 매치를 찾아봐요.'),
    task(8, '한 줄의 용기', 'lineActivated', 1, '가로·세로 팡빛을 1개 사용해요.', '한 줄 팡빛을 옆 빛모습과 바꿔요. 봉오리와 같은 줄이면 더 좋아요.'),
    task(9, '그늘 아래 반짝임', 'budsBloomed', 8, '잎사귀 쉼터의 봉오리 8개를 깨워요.', '수집 목표를 마쳤다면 남은 봉오리 위를 찾아봐요.'),
    task(10, '지도에 남긴 두 빛', 'specialsActivated', 2, '특수 팡빛 2개로 첫 길에 표시를 남겨요.', '특수 팡빛끼리 가까이 두면 한 번에 이어서 터질 수 있어요.'),

    task(11, '물소리의 방향', 'lineActivated', 1, '한 줄 팡빛 1개로 물길의 방향을 찾아요.', '수로에 놓인 봉오리를 길게 가로지르는 줄을 골라봐요.'),
    task(12, '두 둑에 인사를', 'lineActivated', 2, '한 줄 팡빛 2개를 사용해 양쪽 둑에 인사해요.', '가로 팡빛으로 양쪽 둑을 함께 지나갈 수 있어요.'),
    task(13, '톡, 톡, 톡', 'maxCombo', 3, '3연쇄로 징검돌의 리듬을 이어 봐요.', '특수 팡빛 뒤에 이어질 낙하도 연쇄에 포함돼요.'),
    task(14, '웅덩이의 첫 물결', 'layeredHits', 2, '두 웅덩이의 두 겹 봉오리 2개를 먼저 열어요.', '멀리 떨어진 숫자 2를 한 번씩 풀어 두면 마무리가 쉬워져요.'),
    task(15, '아치를 잇는 빛', 'specialsCreated', 2, '특수 팡빛 2개를 만들어 아치에 불을 켜요.', '4개 매치, T·L자 교차, 5개 매치를 차근차근 찾아봐요.'),
    task(16, '물수제비의 휴식', 'feverEntries', 1, '햇살 합창(피버) 1번으로 물 위의 반짝임을 모아요.', '봉오리가 없는 쉼터예요. 목표 색을 모으면서 피버도 채워요.'),
    task(17, '폭포를 깨우는 선', 'lineActivated', 2, '한 줄 팡빛 2개로 폭포에 빛을 내려요.', '세로 팡빛을 중앙의 긴 봉오리 줄에 맞춰봐요.'),
    task(18, '만나는 물결', 'bombActivated', 1, '씨앗폭탄 1개로 두 물길의 만남을 축하해요.', 'T자나 L자 매치로 씨앗폭탄을 만들고 주변 3×3칸을 밝혀요.'),
    task(19, '쪽지를 보내는 세 빛', 'specialsActivated', 3, '특수 팡빛 3개로 쪽지를 친구에게 전해요.', '완료한 색보다 남은 목표 색을 활용하면 두 목표를 함께 이뤄요.'),
    task(20, '모두에게 같은 물빛', 'rainbowActivated', 1, '무지개팡빛 1개로 수로에 넓은 빛을 보내요.', '한 줄로 5개를 모아 만들어요. 가장 부족한 색과 바꾸면 그 색이 함께 반짝여요.'),

    task(21, '온실 문을 두드려요', 'maxCombo', 2, '2연쇄로 잠든 온실에 노크해요.', '구석 봉오리도 함께 살펴보며 가벼운 연쇄부터 시작해요.'),
    task(22, '계단 위 두 조각', 'specialsCreated', 2, '특수 팡빛 2개로 계단의 창 조각을 비춰요.', '아래 계단만 바라보지 말고 위쪽의 4개 매치도 찾아봐요.'),
    task(23, '금 간 틈의 빛', 'bombActivated', 1, '씨앗폭탄 1개로 겹 봉오리에 빛을 나눠요.', '폭탄은 바로 주변 3×3칸에 닿아요. 두 겹 봉오리 가까이에 놓아봐요.'),
    task(24, '두 기둥의 응원', 'lineActivated', 2, '한 줄 팡빛 2개로 온실 기둥을 밝혀요.', '가로줄로 양쪽을, 세로줄로 긴 기둥을 비출 수 있어요.'),
    task(25, '다른 모양의 반짝임', 'specialsActivated', 3, '특수 팡빛 3개로 창 조각들의 빛을 모아요.', '특수 팡빛의 종류는 자유예요. 지금 보드에 맞는 빛을 골라요.'),
    task(26, '작은 마음 한 모금', 'clearedTotal', 30, '빛모습 30개를 모으며 잠깐 쉬어 가요.', '세 가지 기본 목표를 따라가면 약속도 함께 완성돼요.'),
    task(27, '바람개비의 동그라미', 'bombActivated', 1, '씨앗폭탄 1개로 바람개비에 둥근 빛을 보내요.', '가운데 교차점에서 T·L자 매치를 찾아봐요.'),
    task(28, '구석까지 닿은 인사', 'maxCombo', 3, '3연쇄로 작은 싹에게도 인사를 전해요.', '연쇄를 만들고도 남은 구석 봉오리를 잊지 말아요.'),
    task(29, '창 너머 두 번의 햇살', 'feverEntries', 2, '햇살 합창(피버)을 2번 맞이해요.', '첫 피버의 3턴이 끝나면 다시 채울 수 있어요. 기본 목표도 같이 챙겨요.'),
    task(30, '우리 모양의 스펙트럼', 'rainbowActivated', 1, '무지개팡빛 1개로 서로 다른 창을 함께 비춰요.', '5개 매치를 찾으면 남은 목표 색에 연결해 봐요.'),

    task(31, '바람길의 첫 표식', 'lineActivated', 1, '한 줄 팡빛 1개로 과수원 입구를 표시해요.', '중앙의 가로 봉오리에 맞춰 한 줄 팡빛을 놓아봐요.'),
    task(32, '들리는 쪽으로 셋', 'maxCombo', 3, '3연쇄로 친구들의 목소리를 이어 줘요.', '위아래 끝의 봉오리를 살피면서 연쇄가 생길 자리를 찾아요.'),
    task(33, '높은 가지의 두 선', 'lineActivated', 2, '한 줄 팡빛 2개로 높은 가지까지 비춰요.', '두 겹 줄은 한 번에 사라지지 않아요. 같은 방향으로 두 번 빛을 건네요.'),
    task(34, '포테의 네 표식', 'layeredHits', 4, '두 겹 봉오리 4개의 첫 겹을 열어요.', '네 곳의 숫자 2를 먼저 풀어 두고 마무리할 길을 찾아봐요.'),
    task(35, '흔들려도 함께', 'specialsActivated', 4, '특수 팡빛 4개로 흔들리는 바람집을 밝혀요.', '보드 전체를 볼 수 있게 가로·세로 빛과 폭탄을 이어 써봐요.'),
    task(36, '나나의 따뜻한 쉼표', 'feverEntries', 1, '햇살 합창(피버) 1번을 함께 즐겨요.', '서두를 필요 없어요. 편한 매치를 모아도 햇살은 차올라요.'),
    task(37, '돌고 도는 빛고리', 'bombActivated', 1, '씨앗폭탄 1개로 오솔길에 둥근 표식을 남겨요.', '폭탄을 옮기면 도착한 자리의 주변 3×3칸에 빛이 퍼져요.'),
    task(38, '네 걸음, 같은 방향', 'maxCombo', 4, '4연쇄로 친구들의 걸음을 이어 줘요.', '아래쪽의 넓은 매치나 특수 팡빛 연쇄로 새 만남을 만들어봐요.'),
    task(39, '계획 밖의 무지개', 'rainbowActivated', 1, '무지개팡빛 1개로 새 약속에 색을 보태요.', '세 목표 중 가장 많이 남은 색을 무지개와 바꿔봐요.'),
    task(40, '리본을 밝힌 다섯 빛', 'specialsActivated', 5, '특수 팡빛 5개로 돌아갈 리본을 밝혀요.', '특수 팡빛끼리 이어 터뜨리면 각각 사용한 빛으로 세어요.'),

    task(41, '돌아온 발자국', 'maxCombo', 3, '3연쇄로 축제 마당에 첫 인사를 전해요.', '흩어진 봉오리를 찾으면서 아래쪽에 다음 만남을 준비해요.'),
    task(42, '환영문의 두 줄', 'lineActivated', 2, '한 줄 팡빛 2개로 환영문을 밝혀요.', '맨 위 봉오리가 남기 전에 그 줄을 지나는 빛을 만들어봐요.'),
    task(43, '매듭을 감싸는 빛', 'bombActivated', 2, '씨앗폭탄 2개로 리본 매듭에 빛을 모아요.', 'T·L자 매치를 살피고, 두 겹 봉오리가 많은 자리를 비춰요.'),
    task(44, '꽃다발의 두 햇살', 'feverEntries', 2, '햇살 합창(피버)을 2번 맞이해 꽃다발을 밝혀요.', '피버는 3턴이 끝난 뒤 다시 채워져요. 목표 색도 함께 모아요.'),
    task(45, '빈틈을 채운 네 빛', 'specialsActivated', 4, '특수 팡빛 4개로 등대 받침을 비춰요.', '겹 봉오리와 수집 목표를 함께 건드리는 특수 팡빛을 골라요.'),
    task(46, '같이 찍은 두 박자', 'maxCombo', 2, '2연쇄로 함께한 하루의 리듬을 남겨요.', '봉오리가 없는 쉬는 마당이에요. 가볍게 다음 매치를 찾아요.'),
    task(47, '길게 잇는 축제 리듬', 'lineActivated', 3, '한 줄 팡빛 3개로 축제 리본을 밝혀요.', '이미 열린 줄보다 봉오리가 남은 줄에 빛을 놓아봐요.'),
    task(48, '네 번 이어진 마음', 'maxCombo', 4, '4연쇄로 작은 마음들을 이어 줘요.', '폭탄의 위치와 낙하할 빛모습을 같이 살펴봐요.'),
    task(49, '등대 문 앞의 무지개', 'rainbowActivated', 1, '무지개팡빛 1개로 등대의 문을 비춰요.', '5개 매치를 만들고 끝까지 부족한 목표 색에 이어 줘요.'),
    task(50, '함께 켜는 마지막 빛', 'specialsActivated', 5, '특수 팡빛 5개로 등대에 햇살을 모아요.', '큰 연쇄만큼 남은 목표도 중요해요. 모두 채우면 마지막 도장을 간직해요.')
  ]);

  const project = (chapter, step, key, name, description, restoredText) => ({
    id: 'chapter-' + chapter + '-' + key, chapter, step, key, name, description, restoredText,
    level: (chapter - 1) * 10 + [3, 6, 10][step - 1], stars: [5, 12, 20][step - 1], stamps: [1, 2, 4][step - 1]
  });
  const PROJECTS = freeze([
    project(1, 1, 'path', '잎사귀 징검길', '접힌 지도 속 길에 작은 잎사귀 표식을 놓아요.', '포포가 펼친 지도 위에 캐로의 발자국이 나란히 남았어요.'),
    project(1, 2, 'shelter', '모두의 잎그늘', '친구 여섯이 쉴 수 있는 잎그늘을 펼쳐요.', '포포가 짐을 내려놓았어요. 이번에는 친구들이 함께 그늘을 만들었대요.'),
    project(1, 3, 'bridge', '같이 가는 다리', '새싹 마당에서 수로로 이어지는 작은 다리를 밝혀요.', '빠른 발과 느린 발이 같은 다리를 건너요. 돌아올 자리도 남겨 두었어요.'),
    project(2, 1, 'spring', '들리는 샘', '돌 아래 작은 물소리를 따라 샘의 입구를 밝혀요.', '토마의 작은 부탁에 친구들이 귀를 기울이자 숨은 샘이 모습을 드러냈어요.'),
    project(2, 2, 'waterwheel', '톡톡 물레방아', '마른 물레방아에 다시 반짝이는 물을 보내요.', '포테가 찾은 물길을 따라 물레방아가 톡, 톡 돌아가요.'),
    project(2, 3, 'bell', '물방울 종탑', '물방울 종을 달아 작은 목소리도 멀리 전해요.', '크게 외치지 않아도 괜찮아요. 가장 작은 종소리에도 모두 돌아봐요.'),
    project(3, 1, 'window', '조각빛 창', '모양이 다른 창 조각을 한자리에 모아요.', '루비가 기울어진 조각도 창에 넣었어요. 예상하지 못한 빛이 생겼대요.'),
    project(3, 2, 'pinwheel', '달빛 바람개비', '나나의 작은 바람개비에 빛을 돌려줘요.', '모두 다른 날개인데도 함께 돌아가요. 오늘의 리듬도 조금 달라서 좋아요.'),
    project(3, 3, 'greenhouse', '우리 모양의 온실', '서로 다른 창들이 반짝이는 온실을 완성해요.', '금 간 조각까지 한 창이 되었어요. 꼭 똑같지 않아도 빛은 이어져요.'),
    project(4, 1, 'sign', '목소리 이정표', '바람에도 잃어버리지 않을 이정표를 세워요.', '화살표 옆에 친구들의 이름을 적었어요. 부르면 돌아볼 수 있게요.'),
    project(4, 2, 'windhouse', '기다리는 바람집', '두려운 마음도 쉬어 갈 작은 바람집을 열어요.', '나나가 웃지 않아도 친구들은 곁에 있어요. 캐로도 한 박자 쉬어 가요.'),
    project(4, 3, 'ribbons', '여섯 색 리본길', '집으로 돌아갈 길에 여섯 색 리본을 이어 달아요.', '앞서가는 친구도 기다리는 친구도 리본 한쪽을 잡았어요. 이제 함께 돌아가요.'),
    project(5, 1, 'gate', '모두의 환영문', '모양과 보폭이 다른 친구 모두를 위한 문을 열어요.', '작은 친구도, 망토가 큰 친구도 편하게 지나가요. 비워 둔 자리는 새 친구의 몫이에요.'),
    project(5, 2, 'plaza', '함께 찍는 축제 마당', '같이 앉을 자리를 남긴 축제 마당을 꾸며요.', '반듯하지 않은 돌도 제자리를 찾았어요. 가장 멋진 포즈보다 함께 있는 사진을 찍어요.'),
    project(5, 3, 'lighthouse', '해바라기 등대 정원', '등대 둘레에 여섯 친구의 빛이 머무는 정원을 꾸며요.', '등대는 이미 친구들과 켰어요. 이제 그 아래에 내일도 함께 돌아올 작은 정원이 완성됐어요.')
  ]);

  function normalizeProfile(value, profile) {
    const valid = record(value) && value.version === VERSION && Array.isArray(value.stamps);
    return { version: VERSION, stamps: Array.from({ length: LEVEL_COUNT }, (_, i) => Boolean(valid && value.stamps[i] === true &&
      (!profile || i < integer(profile.unlocked, LEVEL_COUNT) && integer(profile.stars?.[i], 3) > 0))) };
  }
  function createRun(level, saved) {
    const id = levelNumber(level);
    const valid = record(saved) && saved.version === VERSION && saved.level === id;
    const source = valid && record(saved.metrics) ? saved.metrics : {};
    return {
      version: VERSION, level: id,
      metrics: Object.fromEntries(Object.entries(METRICS).map(([key, value]) => [key, integer(source[key], value.limit)])),
      // Clear scores strictly increase in the compatible engine. This cursor
      // rejects duplicate/replayed observations, including after a page reload.
      scoreCursor: valid ? integer(saved.scoreCursor, 1000000000) : 0
    };
  }
  function recordResult(run, result) {
    if (!record(run) || !result || result.valid !== true || !Array.isArray(result.events)) return run;
    const safe = createRun(run.level, run);
    run.metrics = safe.metrics; run.scoreCursor = safe.scoreCursor;
    let acceptedClear = false;
    const increment = (key, count) => { run.metrics[key] = Math.min(METRICS[key].limit, run.metrics[key] + count); };
    for (const event of result.events) {
      if (!record(event)) continue;
      if (event.kind === 'clear') {
        acceptedClear = false;
        const score = integer(event.score, 1000000000);
        if (!score || score <= run.scoreCursor) continue;
        run.scoreCursor = score; acceptedClear = true;
        const cells = Array.isArray(event.cells) ? event.cells : [];
        const created = Array.isArray(event.created) ? event.created : [];
        const activated = Array.isArray(event.activated) ? event.activated : [];
        increment('clearedTotal', cells.length + created.length);
        increment('specialsCreated', created.length);
        increment('specialsActivated', activated.length);
        increment('budsBloomed', Array.isArray(event.bloomedCells) ? event.bloomedCells.length : 0);
        increment('layeredHits', Array.isArray(event.budsHit) ? event.budsHit.filter(hit => hit?.before === 2 && hit.after === 1).length : 0);
        increment('lineActivated', activated.filter(cell => cell?.tile?.special === 'row' || cell?.tile?.special === 'col').length);
        increment('bombActivated', activated.filter(cell => cell?.tile?.special === 'bomb').length);
        increment('rainbowActivated', activated.filter(cell => cell?.tile?.special === 'rainbow').length);
        run.metrics.maxCombo = Math.max(run.metrics.maxCombo, integer(event.combo, METRICS.maxCombo.limit));
      } else if (event.kind === 'feverStart' && acceptedClear) {
        increment('feverEntries', 1); acceptedClear = false;
      }
    }
    return run;
  }
  const taskForLevel = level => TASKS[levelNumber(level) - 1];
  function status(level, run) {
    const task = taskForLevel(level), metrics = createRun(task.level, run).metrics;
    const current = metrics[task.metric];
    return { task, current, target: task.target, progress: Math.min(1, current / task.target), complete: current >= task.target };
  }
  function finish(profile, level, run, won) {
    const id = levelNumber(level), progress = status(id, run);
    if (!record(profile)) return { awarded: false, alreadyEarned: false, status: progress };
    profile.journey = normalizeProfile(profile.journey, profile);
    const alreadyEarned = profile.journey.stamps[id - 1];
    const awarded = !alreadyEarned && won === true && run?.level === id && id <= integer(profile.unlocked, LEVEL_COUNT) &&
      integer(profile.stars?.[id - 1], 3) > 0 && progress.complete;
    if (awarded) profile.journey.stamps[id - 1] = true;
    return { awarded, alreadyEarned, status: progress };
  }
  function getRestoration(profile, chapter) {
    const id = Number.isInteger(chapter) ? Math.max(1, Math.min(5, chapter)) : 1;
    const start = (id - 1) * 10, unlocked = integer(profile?.unlocked, LEVEL_COUNT);
    const earned = normalizeProfile(profile?.journey, profile);
    const stars = Array.from({ length: 10 }, (_, n) => start + n < unlocked ? integer(profile?.stars?.[start + n], 3) : 0).reduce((a, b) => a + b, 0);
    const stamps = earned.stamps.slice(start, start + 10).filter(Boolean).length;
    let previousRestored = true;
    const projects = PROJECTS.filter(p => p.chapter === id).map(p => {
      const requirements = [
        { label: p.level + '단계 클리어', current: unlocked >= p.level && integer(profile?.stars?.[p.level - 1], 3) > 0 ? 1 : 0, target: 1 },
        { label: '이 장에서 모은 별', current: stars, target: p.stars },
        { label: '이 장의 햇살 도장', current: stamps, target: p.stamps },
        ...(p.step > 1 ? [{ label: '이전 장소 복원', current: previousRestored ? 1 : 0, target: 1 }] : [])
      ].map(r => ({ ...r, complete: r.current >= r.target }));
      const restored = requirements.every(r => r.complete);
      previousRestored = restored;
      return { ...p, state: restored ? 'restored' : unlocked >= p.level ? 'growing' : 'locked',
        progress: unlocked <= start ? 0 : requirements.reduce((sum, r) => sum + Math.min(1, r.current / r.target), 0) / requirements.length,
        requirements };
    });
    return { chapter: id, stars, stamps, restored: projects.filter(p => p.state === 'restored').length, total: 3, projects };
  }
  const restorationSummary = profile => Array.from({ length: 5 }, (_, i) => getRestoration(profile, i + 1));
  function recommendLevel(profile, chapter) {
    const id = Number.isInteger(chapter) ? Math.max(1, Math.min(5, chapter)) : 1;
    const unlocked = integer(profile?.unlocked, LEVEL_COUNT) || 1;
    const start = (id - 1) * 10 + 1, end = Math.min(id * 10, unlocked);
    if (end < start) return unlocked;
    const state = getRestoration(profile, id), journey = normalizeProfile(profile?.journey, profile);
    const candidates = Array.from({ length: end - start + 1 }, (_, i) => {
      const level = start + i;
      return { level, stars: integer(profile?.stars?.[level - 1], 3), stamp: journey.stamps[level - 1] };
    });
    // A newly opened stage can advance the actual journey and its milestone.
    // Never point a player into a chapter that has not opened yet.
    const unplayed = candidates.find(candidate => !candidate.stars);
    if (unplayed) return unplayed.level;
    const next = state.projects.find(p => p.state !== 'restored');
    if (next && state.stars < next.stars) {
      const needsStamp = state.stamps < next.stamps;
      const improvable = candidates.filter(c => c.stars < 3).sort((a, b) =>
        (needsStamp ? Number(a.stamp) - Number(b.stamp) : 0) || a.stars - b.stars || a.level - b.level);
      if (improvable.length) return improvable[0].level;
    }
    const unkept = candidates.find(candidate => !candidate.stamp);
    if (unkept) return unkept.level;
    // Fully restored places can still offer a meaningful three-star replay.
    const unfinishedStars = candidates.filter(c => c.stars < 3).sort((a, b) => a.stars - b.stars || a.level - b.level);
    return unfinishedStars[0]?.level || end;
  }
  return freeze({ VERSION, LEVEL_COUNT, METRICS, TASKS, PROJECTS, normalizeProfile, createRun, recordResult, taskForLevel, status, finish, getRestoration, restorationSummary, recommendLevel });
});
