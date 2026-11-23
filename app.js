/* Chaeso Pang V6 — every little match leaves a trace in the Sunpatch. */
(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  let sessionInterrupted=false, interruptSession=()=>{};
  function blockSession(reason='blocked') {
    sessionInterrupted=true;interruptSession();
    const notice=$('session-notice');
    $('session-title').textContent=reason==='blocked'?'다른 창에서 함께 놀고 있어요':'새로운 정원 기록을 불러올게요';
    $('session-description').textContent=reason==='blocked'
      ?'기록을 안전하게 간직하려고 한 창에서만 플레이해요. 다른 게임 창을 닫은 뒤 다시 불러와 주세요.'
      :'다른 창의 기록이나 새로 저장된 진행을 확인했어요. 최신 기록을 불러오면 안전하게 이어갈 수 있어요.';
    document.querySelector('.app-shell').inert=true;
    $('modal-backdrop').inert=true;
    notice.hidden=false;document.body.style.overflow='hidden';
    $('session-reload').focus({preventScroll:true});
  }
  $('session-reload').addEventListener('click',()=>location.reload());
  $('session-notice').addEventListener('keydown',event=>{
    if(event.key==='Tab'){event.preventDefault();$('session-reload').focus();}
  });
  const sessionGuard=LumiSession.createGuard({onChange:state=>{
    if(state.status==='lost')blockSession(state.reason||'lost');
  }});
  LumiSession.current=sessionGuard;
  if(!await sessionGuard.acquire()){blockSession('blocked');return;}
  window.addEventListener('lumi:storage-conflict',()=>blockSession('conflict'));
  window.addEventListener('pageshow',event=>{if(event.persisted)blockSession('resume');});
  const icon = id => '<svg class="icon" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  const esc = text => String(text).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const wait = ms => new Promise(resolve => setTimeout(resolve, motion.matches ? Math.min(ms, 20) : ms));
  const same = (a,b) => Boolean(a && b && a.r === b.r && a.c === b.c);
  const neighbors = (a,b) => Math.abs(a.r-b.r) + Math.abs(a.c-b.c) === 1;
  const initial = LumiProgress.load();
  const profile = initial.profile;
  const settings = initial.settings;
  const TOTAL = LumiLevels.length;
  const ranking = new LumiRanking({baseUrl:LumiConfig.rankingApiBase,timeoutMs:LumiConfig.rankingTimeout});
  let rankRun=null, rankSubmission=null, rankStartIssue=null, rankRequest=0, rankFetch=0, rankRetry=null, rankScope="campaign", rankPeriod="week", rankStage=1;
  let sidebarSignature="", scoreTarget=-1, reactionSequence=0;
  LumiMobile.setHaptics(settings.haptics);
  const fx = new LumiFX({canvas:$('effects'),ambientCanvas:$('ambient'),boardEl:$('board')});
  const audio = new LumiAudio();
  let uid = 0;
  const art = (type, mood = 'idle') => LumiArt.sprite(type, 'ui-' + (++uid), mood);
  let game, level = 1, busy = false, blastMode = false, shuffles = 2, blasts = 2, maxCombo = 0;
  let storedSession = initial.session, modalType = null, pendingModal = null, returnFocus = null;
  let epoch = 0, hintTimer, toastTimer, buddyTimer, comboAnimation, comboTimer, scoreAnimation;
  let shownScore = 0, goalsSignature = '', storageNotice = false, lastFever = false, resultDetails = {};
  let companionSignature='', companionAnimation=null, reactionUntil=0, reactionPriority=0, coachTimer=null, coachCheckTimer=null, coachKind=null, coachVisibleSince=null, newSpecial=null;
  let weeklyState=null, claimBusy=false, recoveryBusy=false, weeklyRecipient=profile.selectedBuddy, lastLowWarning=-1, friendshipAnimation=null;
  let journeyRun=null, journeySignature='';
  const view = new LumiBoard({
    board:$('board'),tiles:$('tiles'),budLayer:$('bud-layer'),cells:$('board-cells'),wrap:$('board-wrap'),fx,
    onChoose:choose, onSwap:swap, onInteract:unlockAudio,
    onCue:(kind,event)=>{if(kind==='impact'){
      if(event.activated.length || event.created.length)audio.play('special',event.combo);
      else if(audio.playMatch){
        const counts=Array(6).fill(0);for(const cell of event.cells)counts[cell.tile.type]++;
        audio.playMatch(counts.indexOf(Math.max(...counts)),event.combo,Math.min(1.5,1+event.cells.length/36));
      }else audio.play('match',event.combo);
      LumiMobile.feedback(event.activated.length?'special':'light');
      if(event.bloomedCells.length)audio.play('bloom');
      collectionTrails(event);hud(event);
    }},
    onEscape:() => { blastMode=false; view.select(null); controls(); setHint(); scheduleHint(); }
  });
  interruptSession=()=>{
    epoch++;busy=true;modalType=null;clearHints();dismissSpecialCoach();
    clearTimeout(buddyTimer);clearTimeout(comboTimer);cancelAnimationFrame(scoreAnimation);
    comboAnimation?.cancel();companionAnimation?.cancel();view.setDisabled(true);
    fx.setPaused(true);audio.suspend(true);
  };

  function unlockAudio() { if(!sessionInterrupted)audio.unlock(); }
  function applyAudio() {
    audio.setMusicEnabled(settings.music); audio.setSfxEnabled(settings.sfx);
    audio.setVolume(settings.volume); audio.setEnabled(settings.music || settings.sfx);
    const enabled=settings.music || settings.sfx;
    $('sound-button').innerHTML=icon(enabled?'sound':'muted');
    $('sound-button').setAttribute('aria-label',enabled?'전체 소리 끄기':'전체 소리 켜기');
    $('sound-button').setAttribute('aria-pressed',String(enabled));
  }
  applyAudio();
  document.addEventListener('pointerdown',unlockAudio,{passive:true});
  document.addEventListener('keydown',event=>{if(['Enter',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))unlockAudio();});

  function persist() {
    if(sessionInterrupted || !sessionGuard.canWrite())return false;
    LumiProgress.rememberMemories(profile);
    const okay=LumiProgress.save({profile,settings,session:storedSession});
    if(!okay && !storageNotice) { storageNotice=true; toast('이 브라우저에서는 기록을 보관할 수 없어요',3500); }
    return okay;
  }
  function rememberSession() {
    storedSession=game && !game.won && !game.over ? {level,game:game.exportState(),shuffles,blasts,maxCombo,journey:LumiJourney.createRun(level,journeyRun)} : null;
    persist();
  }
  function toast(text,duration=2300) {
    clearTimeout(toastTimer); $('board-toast').textContent=text; $('board-toast').classList.add('visible');
    toastTimer=setTimeout(()=>$('board-toast').classList.remove('visible'),duration);
  }
  function setHint(text) {
    $('play-hint').textContent=text || (blastMode?'꽃비를 내릴 친구를 톡! 주변 3×3칸이 꽃피어요':'같은 빛모습 3개를 나란히 모아보세요');
  }
  function controls() {
    const ended=game && (game.won || game.over);
    view.setDisabled(sessionInterrupted || busy || Boolean(modalType) || ended);
    view.setBlastMode(blastMode);
    $('hint-button').disabled=busy || ended;
    $('shuffle-button').disabled=busy || ended || shuffles<1;
    $('blast-button').disabled=busy || ended || blasts<1;
    $('shuffle-count').textContent=shuffles; $('blast-count').textContent=blasts;
    $('shuffle-button').setAttribute('aria-label','보드 섞기, '+shuffles+'회 남음');
    $('blast-button').setAttribute('aria-label','마법 터뜨리기, '+blasts+'회 남음');
    $('blast-button').setAttribute('aria-pressed',String(blastMode));
    $('blast-button').classList.toggle('active',blastMode);
    $('board').setAttribute('aria-busy',String(busy));
    const finished=Boolean(ended && !busy);
    $('finish-dock').hidden=!finished;
    document.body.classList.toggle('has-finished',finished);
    if(finished){
      $('finish-dock-title').textContent=game.won?'정원이 활짝 피었어요!':'조금만 더, 함께 해봐요';
      $('finish-dock-stars').innerHTML=game.won?starMarkup(game.stars):icon('heart');
      $('finish-next').innerHTML=(game.won?(level<TOTAL?'다음 단계로':'햇살밭 지도 보기'):'다시 도전')+' <span aria-hidden="true">→</span>';
    }
  }
  function pulse(node) {
    if(!node || motion.matches) return;
    node.animate([{transform:'scale(1)'},{transform:'scale(1.17)',offset:.4},{transform:'scale(1)'}],{duration:270,easing:'ease-out'}).finished.catch(()=>{});
  }
  function prepareGoals(snapshot) {
    const signature=snapshot.objectives.map(g=>g.type+':'+g.target).join('|')+'|'+snapshot.budsGoal;
    if(signature===goalsSignature)return;
    goalsSignature=signature;
    $('mission-goals').innerHTML=snapshot.objectives.map(g=>'<div class="mission-goal" id="goal-'+g.type+'"><span class="goal-art">'+art(g.type)+'</span><strong>'+g.target+'</strong></div>').join('')+
      (snapshot.budsGoal?'<div class="mission-goal" id="goal-buds"><span class="goal-art goal-bud">'+icon('flower')+'</span><strong>'+snapshot.budsGoal+'</strong></div>':'');
    $('mission-goals').classList.toggle('many',snapshot.objectives.length+(snapshot.budsGoal?1:0)>=4);
  }
  function updateGoal(node,remaining,label) {
    if(!node)return;
    const before=node.dataset.remaining;
    node.dataset.remaining=remaining;
    node.classList.toggle('done',remaining===0);
    node.setAttribute('aria-label',label+(remaining===0?' 완료':', '+remaining+'개 남음'));
    node.querySelector('strong').innerHTML=remaining===0?icon('check'):String(remaining);
    if(before!==undefined && before!==String(remaining))pulse(node);
  }
  function hud(snapshot,instant=false) {
    prepareGoals(snapshot);
    for(const goal of snapshot.objectives) updateGoal($('goal-'+goal.type),Math.max(0,goal.target-goal.current),LumiArt.names[goal.type]+'의 팡빛 모으기');
    if(snapshot.budsGoal)updateGoal($('goal-buds'),Math.max(0,snapshot.budsGoal-snapshot.bloomed),'꽃봉오리 피우기');
    const from=shownScore,to=snapshot.score,start=performance.now();
    if (to!==scoreTarget || instant) {
    scoreTarget=to; cancelAnimationFrame(scoreAnimation);
    const tick=now=>{
      const p=instant || motion.matches?1:Math.min(1,(now-start)/300);
      shownScore=from+(to-from)*(1-Math.pow(1-p,3)); $('score').textContent=fmt(shownScore);
      if(p<1)scoreAnimation=requestAnimationFrame(tick);
    }; tick(start);
    }
    $('moves').textContent=snapshot.moves; $('moves').classList.toggle('low',snapshot.moves<=5 && !snapshot.won);
    const thresholds=snapshot.starThresholds||LumiRewards.starThresholds(snapshot.target);
    const benchmark=thresholds[2];
    $('progress-fill').style.width=Math.min(100,snapshot.score/benchmark*100)+'%';
    $('score-progress').setAttribute('aria-valuemax',Math.round(benchmark));
    $('score-progress').setAttribute('aria-valuenow',Math.min(snapshot.score,Math.round(benchmark)));
    document.querySelectorAll('.progress-star').forEach((n,i)=>{
      const earned=snapshot.won?i<snapshot.stars:!snapshot.over&&snapshot.score>=thresholds[i];
      const wasEarned=n.classList.contains('earned');
      n.classList.toggle('earned',earned);n.style.left=(thresholds[i]/benchmark*100)+'%';
      n.querySelector('small').textContent=fmt(thresholds[i]);
      n.setAttribute('aria-label','별 '+(i+1)+'개 점수선 '+fmt(thresholds[i])+'점'+(earned?(snapshot.won?' · 획득':' · 점수선 도달'):''));
      if(earned&&!wasEarned&&!instant)pulse(n.querySelector('svg'));
    });
    const failed=snapshot.over&&!snapshot.won;
    const next=failed?null:snapshot.won?(snapshot.stars<3?{stars:snapshot.stars+1,remaining:Math.max(0,thresholds[snapshot.stars]-snapshot.score)}:null):LumiRewards.nextStar(snapshot.score,snapshot.target);
    $('next-star').innerHTML=failed?'<strong>미션을 완성하면 별을 받아요.</strong> 다시 함께 도전해요'
      :next?'별 <strong>'+next.stars+'개</strong>까지 <strong>'+fmt(next.remaining)+'점</strong>'
      :snapshot.won?'<strong>별 3개 획득!</strong> 새로운 최고 기록에 도전해요'
      :'<strong>별 3개 점수선 도달!</strong> 남은 미션을 완성해요';
    $('score-progress').setAttribute('aria-valuetext',fmt(snapshot.score)+'점, '+(failed?'미션 미완성, 획득한 별 0개':next?'별 '+next.stars+'개까지 '+fmt(next.remaining)+'점':snapshot.won?'별 3개 획득':'별 3개 점수선 도달, 미션 완료 필요'));
    const active=snapshot.feverTurns>0&&!snapshot.won&&!snapshot.over;
    $('fever-title').textContent=active?'햇살 합창 · 피버!':'햇살 합창 · 피버';
    $('fever-caption').textContent=active?snapshot.feverTurns+'턴 남음 · 매치 점수 두 배':'충전 '+Math.round(snapshot.feverCharge)+'% · 완충하면 3턴';
    $('fever-multiplier').textContent=active?'×2':Math.round(snapshot.feverCharge)+'%';
    $('fever-fill').style.width=(active?100:snapshot.feverCharge)+'%';
    $('fever-progress').setAttribute('aria-valuenow',active?100:snapshot.feverCharge);
    $('fever-progress').setAttribute('aria-label',active?'피버 '+snapshot.feverTurns+'턴 남음':'피버 게이지');
    document.body.classList.toggle('is-fever',active);
    if(active!==lastFever){lastFever=active;fx.fever(active);audio.setFever(active);}
    $('combo-record').textContent='BEST ×'+maxCombo;
    updateCompanion();
  }
  function companionXp(type,verified=Boolean(ranking.getIdentity()?.id===profile.verifiedBuddyPlayerId && rankRun)) {
    return LumiProgress.buddyTotal(profile,type,verified);
  }
  function updateCompanion() {
    const type=profile.selectedBuddy,c=LumiArt.characters[type],bond=LumiRewards.bond(companionXp(type));
    const active=game?.scoringVersion===4?game.buddy:null,changed=active && active.type!==type;
    const signature=[type,bond.level,bond.progress,changed,active?.tier].join('|');
    if(signature===companionSignature)return;companionSignature=signature;
    $('companion-button').style.setProperty('--buddy-color',c.color);
    $('companion-button').style.setProperty('--buddy-light',c.lightColor);
    $('companion-avatar').innerHTML=art(type,'happy');
    $('companion-name').textContent=c.name;
    $('companion-level').textContent=game?.scoringVersion===2?'새 혜택은 다음 정원부터':changed?'다음 판부터 함께':'Lv.'+(active?.tier||bond.level)+' · '+LumiRewards.BONDS[(active?.tier||bond.level)-1].label;
    $('companion-button').setAttribute('aria-label',c.name+' 동행 친구, '+$('companion-level').textContent+(changed?', 이번 판 응원과 클리어 XP는 '+LumiArt.names[active.type]+'에게':'')+', 친밀도와 혜택 보기');
    if(performance.now()>reactionUntil)$('companion-message').textContent=companionIdleMessage();
  }
  function companionIdleMessage() {
    const active=game?.scoringVersion===4?game.buddy:null;
    return active && active.type!==profile.selectedBuddy?'이번 판 응원·XP는 '+LumiArt.names[active.type]+'에게!':LumiArt.characters[profile.selectedBuddy].tagline;
  }
  function syncRewards(payload) {
    if(!payload || sessionInterrupted)return;
    if(payload.companions?.playerId && payload.companions.playerId!==ranking.getIdentity()?.id)return;
    if(payload.companions)LumiProgress.applyCompanions(profile,payload.companions);
    if(payload.weekly)weeklyState=LumiProgress.mergeWeekly(weeklyState,payload.weekly);
    persist();sidebars();updateCompanion();
  }
  function sidebars() {
    const type=profile.selectedBuddy,c=LumiArt.characters[type],bond=LumiRewards.bond(companionXp(type));
    const signature=[type,bond.level,level,profile.unlocked,profile.stars.join(','),profile.journey?.stamps.join(',')].join('|');
    if(signature===sidebarSignature)return; sidebarSignature=signature;
    $('brand-friend').innerHTML=art(type,'happy');
    $('portrait-spirit').innerHTML=art(type);
    $('friend-name').textContent=c.name; $('friend-en').textContent=c.en;
    $('friend-tagline').textContent=c.tagline; $('friend-bond').textContent=bond.label;
    $('friend-card').setAttribute('aria-label',c.name+'와 인사하기');
    $('friend-card').style.background='radial-gradient(circle at 50% 32%,#fffcf7,'+c.lightColor+' 74%)';
    $('total-stars').textContent=profile.stars.reduce((a,b)=>a+b,0);
    const completed=profile.stars.filter(n=>n>0).length;
    $('journey-count').textContent=completed+' / '+TOTAL;
    $('journey-fill').style.width=(completed/TOTAL*100)+'%';
    $('journey-tip').textContent=LumiStory.chapterForLevel(level).goal;
    const places=LumiJourney.restorationSummary(profile).reduce((n,c)=>n+c.restored,0);
    $('world-sidebar-count').textContent=places+' / 15 장소에 돌아온 햇살';
    const start=Math.min(TOTAL-5,Math.floor((level-1)/5)*5+1);
    $('mini-path').innerHTML=Array.from({length:6},(_,n)=>{
      const id=start+n,done=profile.stars[id-1]>0,locked=id>profile.unlocked;
      return '<button class="mini-node '+(id===level?'current':done?'complete':'')+'" data-level="'+id+'" '+(locked?'disabled':'')+' aria-label="'+id+'번 정원 '+(locked?'잠김':LumiLevels[id-1].title)+'">'+(locked?icon('lock'):done?icon('check'):id)+'</button>';
    }).join('');
    $('mini-path').querySelectorAll('button').forEach(n=>n.addEventListener('click',()=>showModal('level',{id:Number(n.dataset.level)})));
    $('little-trio').innerHTML=[1,4,5].map(t=>art(t,'happy')).join('');
    updateCompanion();
  }
  function buddy(mood,line,kind='match') {
    const response=LumiStory.characters[profile.selectedBuddy]?.reactions?.[kind];
    const voice=Array.isArray(response)?response[(reactionSequence++)%response.length]:response;
    if(voice && kind!=='selected')line=(kind==='danger'?game.moves+'번 남았어. ':'')+voice;
    const priorities={match:1,greet:2,special:3,combo:4,fever:5,danger:6,lose:8,clear:8,selected:9};
    const priority=priorities[kind]||1,now=performance.now();
    if(now<reactionUntil && priority<reactionPriority)return;
    reactionPriority=priority;reactionUntil=now+(kind==='match'?850:1700);
    clearTimeout(buddyTimer); $('portrait-spirit').innerHTML=art(profile.selectedBuddy,mood);
    const avatar=$('companion-avatar');avatar.innerHTML=art(profile.selectedBuddy,mood);
    if(line)$('friend-speech').textContent=line;
    if(line)$('companion-message').textContent=line;
    $('companion-button').dataset.reaction=kind;
    const start=companionAnimation?getComputedStyle(avatar).transform:'none';companionAnimation?.cancel();
    if(!motion.matches){
      const lift=kind==='clear'||kind==='combo'?9:kind==='lose'?2:kind==='match'?3:6;
      companionAnimation=avatar.animate([
        {transform:start==='none'?'translateY(0) scale(1)':start},
        {transform:'translateY(2px) scale(1.08,.92)',offset:.16},
        {transform:'translateY(-'+lift+'px) scale(.96,1.04) rotate(-4deg)',offset:.43},
        {transform:'translateY(0) scale(1.04,.97) rotate(2deg)',offset:.76},
        {transform:'translateY(0) scale(1) rotate(0)'}
      ],{duration:kind==='match'?420:680,easing:'cubic-bezier(.25,.7,.28,1)'});
      companionAnimation.finished.catch(()=>{});
      if(priority>=3){const rect=avatar.getBoundingClientRect();fx.companion?.(rect.x+rect.width/2,rect.y+rect.height/2,LumiArt.colors[profile.selectedBuddy],kind==='clear'?2:1);}
    }
    buddyTimer=setTimeout(()=>{
      reactionUntil=0;reactionPriority=0;$('portrait-spirit').innerHTML=art(profile.selectedBuddy);
      avatar.innerHTML=art(profile.selectedBuddy);$('companion-message').textContent=companionIdleMessage();
      delete $('companion-button').dataset.reaction;
    },kind==='clear'?4200:2700);
  }
  function acknowledgeSpecialCoach() {
    if(coachKind&&!profile.seenSpecials[coachKind]){profile.seenSpecials[coachKind]=true;persist();}
  }
  function dismissSpecialCoach(acknowledged=false) {
    if(acknowledged)acknowledgeSpecialCoach();
    clearTimeout(coachTimer);clearTimeout(coachCheckTimer);coachKind=null;coachVisibleSince=null;
    $('special-coach').hidden=true;view.clearSpecialHighlight?.();
  }
  function inspectSpecialCoach() {
    clearTimeout(coachCheckTimer);
    const coach=$('special-coach');
    if(coach.hidden||!coachKind||sessionInterrupted)return;
    const viewport=window.visualViewport,top=viewport?.offsetTop||0,bottom=top+(viewport?.height||window.innerHeight);
    const boardRect=$('board-wrap').getBoundingClientRect();
    coach.style.bottom=Math.max(8,Math.min(Math.max(8,boardRect.height-coach.offsetHeight-8),boardRect.bottom-bottom+12))+'px';
    const rect=coach.getBoundingClientRect();
    const visible=!document.hidden&&!modalType&&rect.width>0&&rect.height>0&&rect.top>=top&&rect.bottom<=bottom&&rect.left>=0&&rect.right<=window.innerWidth;
    if(visible){
      if(coachVisibleSince===null)coachVisibleSince=performance.now();
      if(performance.now()-coachVisibleSince>=900)acknowledgeSpecialCoach();
    }else coachVisibleSince=null;
    coachCheckTimer=setTimeout(inspectSpecialCoach,180);
  }
  function showSpecialCoach(item) {
    if(!item || profile.seenSpecials[item.kind] || game.won || game.over)return;
    const copy={row:['가로 팡빛을 만들었어요!','이웃과 바꾸면 가로 한 줄이 팡!'],col:['세로 팡빛을 만들었어요!','이웃과 바꾸면 세로 한 줄이 팡!'],bomb:['씨앗 폭탄을 만들었어요!','이웃과 바꾸면 주변 3×3칸이 팡!'],rainbow:['무지개 빛모습을 만들었어요!','이웃과 바꾸면 그 친구 색이 모두 팡!']}[item.kind];
    if(!copy)return;
    const position=game.board.flatMap((row,r)=>row.map((tile,c)=>({tile,r,c}))).find(p=>p.tile.id===item.id);
    if(!position)return;
    dismissSpecialCoach();coachKind=item.kind;
    $('coach-title').textContent=copy[0];$('coach-description').textContent=copy[1];
    $('coach-symbol').innerHTML=LumiArt.special(item.kind,'coach-'+(++uid));
    $('special-coach').hidden=false;
    view.highlightSpecial?.(position);inspectSpecialCoach();
    coachTimer=setTimeout(()=>dismissSpecialCoach(),6500);
  }
  function clearHints(){clearTimeout(hintTimer);view.clearHints();}
  function scheduleHint() {
    clearTimeout(hintTimer);
    if(!game || game.won || game.over || busy || modalType || blastMode || document.hidden)return;
    hintTimer=setTimeout(()=>showHint(false),profile.hasSeenTutorial?9000:2000);
  }
  function showHint(manual=true) {
    if(busy || modalType || game.won || game.over)return;
    clearHints();blastMode=false;view.select(null);controls();setHint();
    const pair=LumiHints.hint(game);if(!pair)return;
    view.showHint(pair);
    if(manual){audio.play('hint');toast('반짝이는 두 친구를 바꿔보세요');}
    else if(!profile.hasSeenTutorial)toast('친구를 톡톡 누르거나, 옆으로 밀어봐요!',3000);
    hintTimer=setTimeout(()=>{view.clearHints();scheduleHint();},4500);
  }
  function combo(number,fever=false) {
    const words=['팡!','빛이 톡톡!','팡빛 물결!','햇살이 활짝!','모두 함께 팡!'];
    $('combo-label').textContent=fever?'햇살 합창!':words[Math.min(number-1,4)];
    $('combo-caption').textContent=fever?'지금부터 · 다음 교환 3회까지 ×2':number+'연쇄 · 마음을 잇는 팡빛';
    clearTimeout(comboTimer);comboAnimation?.cancel();
    const display=$('combo-display');display.style.removeProperty('opacity');display.style.removeProperty('transform');
    if(motion.matches){
      display.style.opacity='1';display.style.transform='none';
      comboTimer=setTimeout(()=>{display.style.removeProperty('opacity');display.style.removeProperty('transform');},1100);
      return;
    }
    comboAnimation=$('combo-display').animate([
      {opacity:0,transform:'translateY(8px) scale(.55) rotate(-7deg)'},
      {opacity:1,transform:'translateY(0) scale(1.08) rotate(2deg)',offset:.2},
      {opacity:1,transform:'translateY(-2px) scale(1) rotate(0)',offset:.6},
      {opacity:0,transform:'translateY(-26px) scale(1.03)'}
    ],{duration:1000,easing:'cubic-bezier(.2,.8,.3,1)'});
    comboAnimation.finished.catch(()=>{});
  }
  function collectionTrails(event) {
    const used=new Map();
    for(const p of [...event.cells,...event.created]){
      const target=$('goal-'+p.tile.type);
      if(!target || (used.get(p.tile.type)||0)>=3)continue;
      used.set(p.tile.type,(used.get(p.tile.type)||0)+1);
      const from=view.center(p.r,p.c),rect=target.getBoundingClientRect();
      fx.trail(from.x,from.y,rect.x+rect.width/2,rect.y+rect.height/2,LumiArt.colors[p.tile.type],'star');
    }
    const budsTarget=$('goal-buds');
    if(budsTarget)for(const p of event.bloomedCells.slice(0,3)){
      const from=view.center(p.r,p.c),rect=budsTarget.getBoundingClientRect();
      fx.trail(from.x,from.y,rect.x+rect.width/2,rect.y+rect.height/2,'#e7a3c6','petal');
    }
  }
  function commitTurn(before,action,valid) {
    const placesBefore=game.won?LumiJourney.restorationSummary(profile).flatMap(c=>c.projects.filter(p=>p.state==='restored').map(p=>p.id)):[];
    if(rankRun && action && valid && !ranking.commitAction(action,game.exportState())) {
      rankRun=null;ranking.abandonRun();toast('이번 판은 연습 기록으로 남겨요');
    }
    for(let i=0;i<6;i++)profile.totalCollected[i]+=Math.max(0,game.collected[i]-before[i]);
    profile.maxCombo=Math.max(profile.maxCombo,maxCombo);
    profile.bestScore=Math.max(profile.bestScore,game.score);
    if(game.collected.some((n,i)=>n>before[i]))profile.hasSeenTutorial=true;
    if(game.won){
      const friendType=game.scoringVersion===4?game.buddy.type:profile.selectedBuddy;
      const clearXp=LumiRewards.clearXp({stars:game.stars});
      profile.buddyClearXp[friendType]+=clearXp;
      const afterXp=profile.totalCollected[friendType]+profile.buddyClearXp[friendType],gainedXp=game.collected[friendType]+clearXp;
      const beforeXp=Math.max(0,afterXp-gainedXp),verifiedXp=profile.verifiedBuddyXp?.[friendType]||0;
      const previous=profile.bestScores[level-1];
      const previousStars=profile.stars[level-1];
      profile.stars[level-1]=Math.max(previousStars,game.snapshot().stars);
      profile.bestScores[level-1]=Math.max(previous,game.score);
      profile.unlocked=Math.max(profile.unlocked,Math.min(TOTAL,level+1));
      resultDetails={newBest:game.score>previous,starsAdded:profile.stars[level-1]-previousStars,
        friendship:{buddyType:friendType,beforeXp,afterXp,displayBeforeXp:Math.max(verifiedXp,beforeXp),displayAfterXp:LumiProgress.buddyTotal(profile,friendType,false),memoryBeforeLevel:Math.max(profile.buddyMemoryLevels?.[friendType]||1,LumiRewards.bond(Math.max(verifiedXp,beforeXp)).level),collectedXp:game.collected[friendType],clearXp,gainedXp}};
      resultDetails.journey=LumiJourney.finish(profile,level,journeyRun,true);
      resultDetails.restored=LumiJourney.restorationSummary(profile).flatMap(c=>c.projects.filter(p=>p.state==='restored'&&!placesBefore.includes(p.id)).map(p=>({...p,chapter:c.chapter})));
    }
    if(game.won && rankRun) {
      const submittingEpoch=epoch;rankSubmission={status:'sending'};
      ranking.finishRun().then(reply=>{
        if(reply.result)syncRewards(reply.result);
        if(submittingEpoch!==epoch)return;
        rankSubmission=reply.result?{status:'verified',result:reply.result}:{status:reply.queued?'queued':'error',error:reply.error};
        updateRankStatus();updateResultRanking();updateFriendshipResult();
      }).catch(error=>{if(submittingEpoch===epoch){rankSubmission={status:'error',error};updateResultRanking();updateFriendshipResult();}});
    } else if(game.over) {rankRun=null;ranking.abandonRun();}
    rememberSession();sidebars();updateRankStatus();updateJourneyHUD();
    const placeState=LumiJourney.getRestoration(profile,Math.ceil(level/10));view.setChapter?.(placeState.chapter,placeState.restored,Boolean(profile.stars[placeState.chapter*10-1]));
  }
  async function playResult(result,before,action=null) {
    if(!result.events.length){scheduleHint();return;}
    const turnEpoch=epoch,focus=view.focusedPosition();
    busy=true;clearHints();dismissSpecialCoach();newSpecial=null;view.select(null);blastMode=false;controls();
    if(result.valid)LumiJourney.recordResult(journeyRun,result);
    try {
      for(const event of result.events){
        if(turnEpoch!==epoch)return;
        if(event.kind==='swap'){audio.play('swap');await view.render(event,'swap');}
        else if(event.kind==='invalid'){audio.play('invalid');await view.render(event,'invalid');toast('세 친구가 모이면 자리를 바꿀 수 있어요',1700);}
        else if(event.kind==='clear'){
          maxCombo=Math.max(maxCombo,event.combo);
          if(event.combo>1)combo(event.combo);
          if(event.combo>=4)buddy('excited',event.combo+'연쇄! 우리 정말 잘 맞는다!','combo');
          else if(event.activated.length)buddy('excited','반짝! 우리 마법이 터졌어!','special');
          else buddy('happy',event.combo>1?event.combo+'연쇄! 행복이 이어져!':'좋아! 마음이 한 뼘 가까워졌어.','match');
          if(!newSpecial){const made=event.created.find(p=>!profile.seenSpecials[p.tile.special]);if(made)newSpecial={kind:made.tile.special,id:made.tile.id};}
          await view.clear(event);
        }
        else if(event.kind==='fall'){await view.render(event,'fall');}
        else if(event.kind==='shuffle'){audio.play('shuffle');toast('산들바람이 새로운 만남을 데려와요');await view.render(event,'shuffle');}
        else if(event.kind==='feverStart'){audio.play('feverStart');combo(3,true);buddy('excited','피버 타임! 지금은 점수 두 배!','fever');}
        else if(event.kind==='feverEnd'){audio.play('feverEnd');}
        else if(event.kind==='completionBonus'){
          const from=$('moves').getBoundingClientRect(),to=$('score').getBoundingClientRect();
          toast('남은 '+event.movesRemaining+'회 → 보너스 +'+fmt(event.scoreDelta)+'점',2300);
          audio.play('collect');fx.bonus?.(from.x+from.width/2,from.y+from.height/2,to.x+to.width/2,to.y+to.height/2,event.scoreDelta);
          buddy('excited','남겨 둔 여유도 반짝이는 선물이야!','clear');
          hud(event);await wait(850);
        }
        hud(event);
      }
    } catch(error) {
      console.error('Lumi animation recovered:',error);await view.render(game.snapshot());
    }
    if(turnEpoch!==epoch)return;
    const snapshot=game.snapshot();hud(snapshot);commitTurn(before,action,result.valid);
    const turnCombo=Math.max(0,...result.events.filter(event=>event.kind==='clear').map(event=>event.combo||0));
    $('announcer').textContent=fmt(snapshot.score)+'점, '+snapshot.moves+'회 남음. '+(turnCombo>1?turnCombo+'연쇄. ':'')+snapshot.objectives.map(g=>LumiArt.names[g.type]+' '+Math.max(0,g.target-g.current)+'개 남음').join(', ');
    if(snapshot.won || snapshot.over){
      pendingModal=null;
      setHint(snapshot.won?'우리의 작은 정원이 활짝 피었어요!':'괜찮아요. 새로운 만남이 기다리고 있어요');
      await wait(520);
      if(turnEpoch!==epoch)return;
      busy=false;controls();
      if(snapshot.won){audio.play('win');LumiMobile.feedback('win');fx.confetti();if(resultDetails.restored?.length)fx.worldRestore?.(Math.ceil(level/10));buddy('excited','너랑 함께여서 오늘도 행복했어!','clear');}
      else{audio.play('lose');buddy('sleep','조금 쉬었다, 다시 같이 해보자.','lose');}
      showModal(snapshot.won?'win':'lose');
    } else {
      busy=false;controls();
      if(focus)view.focusAt(focus);
      if(pendingModal){const next=pendingModal;pendingModal=null;showModal(next.type,next.data);}
      else{
        setHint();scheduleHint();showSpecialCoach(newSpecial);
        if(snapshot.moves<=3&&snapshot.moves!==lastLowWarning){lastLowWarning=snapshot.moves;buddy('wink',snapshot.moves+'번 남았어. 남은 목표부터 같이 보자!','danger');}
      }
    }
  }
  function choose(position) {
    if(sessionInterrupted || busy || modalType || game.won || game.over || !sessionGuard.canWrite())return;
    clearHints();dismissSpecialCoach();
    if(blastMode){
      if(blasts<1)return;
      const before=game.collected.slice();blasts--;audio.play('special');playResult(game.blast(position),before,{kind:'blast',position:{...position}});
    } else if(same(view.selected,position)){view.select(null);scheduleHint();}
    else if(view.selected && neighbors(view.selected,position))swap(view.selected,position);
    else{view.select(position);audio.play('select');scheduleHint();}
  }
  function swap(from,to) {
    if(sessionInterrupted || busy || modalType || game.won || game.over || !sessionGuard.canWrite())return;
    const before=game.collected.slice();LumiMobile.feedback();playResult(game.play(from,to),before,{kind:'swap',from:{...from},to:{...to}});
  }

  async function startGarden(id,restore=null) {
    if(sessionInterrupted || !sessionGuard.canWrite())return;
    epoch++;busy=true;modalType=null;pendingModal=null;blastMode=false;goalsSignature='';rankSubmission=null;rankStartIssue=null;rankRun=null;
    const loadingEpoch=epoch;$('board-wrap').classList.add('board-loading');
    clearHints();dismissSpecialCoach();clearTimeout(toastTimer);clearTimeout(comboTimer);comboAnimation?.cancel();
    $('combo-display').style.removeProperty('opacity');$('combo-display').style.removeProperty('transform');fx.clear();view.reset();
    newSpecial=null;lastLowWarning=-1;reactionUntil=0;reactionPriority=0;resultDetails={};journeySignature='';
    $('board-toast').classList.remove('visible');
    level=Math.max(1,Math.min(profile.unlocked,id));
    const definition=LumiLevels[level-1];
    $('stage-title').textContent=definition.title;controls();
    if(restore){
      game=LumiEngine.Game.fromState(restore.game);shuffles=restore.shuffles;blasts=restore.blasts;maxCombo=restore.maxCombo;
      rankRun=ranking.restoreRun(game.exportState());
      if(game.scoringVersion!==LumiRewards.SCORING_VERSION){ranking.abandonRun();rankRun=null;}
    } else {
      profile.attempts[level-1]++;
      let startedRun=null;
      try {startedRun=await ranking.startRun(level,{buddyType:profile.selectedBuddy});} catch(error) {
        if(loadingEpoch!==epoch)return;
        if(['RULESET_CHANGED','QUEUE_FULL','INVALID_TOKEN'].includes(error.code))rankStartIssue={code:error.code,message:error.message};
        ranking.abandonRun();
      }
      if(loadingEpoch!==epoch)return;
      rankRun=startedRun;
      if(startedRun)syncRewards(startedRun);
      game=new LumiEngine.Game({...definition,buddy:{type:profile.selectedBuddy,tier:LumiRewards.bond(companionXp(profile.selectedBuddy,false)).level},...(rankRun?.options||{}),rows:6,cols:6,types:6,requireScore:false,seed:rankRun?.seed??((Date.now()^Math.floor(Math.random()*0xffffffff))>>>0)});
      if(rankRun && !ranking.bindState(game.exportState())){ranking.abandonRun();rankRun=null;}
      shuffles=2;blasts=2;maxCombo=0;
    }
    journeyRun=LumiJourney.createRun(level,restore?.journey);
    const placeState=LumiJourney.getRestoration(profile,Math.ceil(level/10));view.setChapter?.(placeState.chapter,placeState.restored,Boolean(profile.stars[placeState.chapter*10-1]));
    $('stage-title').textContent=definition.title;
    $('stage-title').dataset.stageSummary='STAGE '+String(level).padStart(2,'0')+' · '+definition.difficultyLabel;
    $('stage-title').setAttribute('aria-label',level+'단계, '+definition.title+', '+definition.difficultyLabel);
    $('board-wrap').classList.remove('board-loading');
    $('stage-subtitle').textContent=LumiStory.stageForLevel(level).action;
    $('difficulty-badge').textContent=definition.difficultyLabel||'산책';
    $('difficulty-badge').dataset.difficulty=definition.difficulty||'normal';
    rankStage=level;updateRankStatus();
    $('chapter-number').textContent='STAGE '+String(level).padStart(2,'0');
    setHint();sidebars();hud(game.snapshot(),true);updateJourneyHUD();controls();rememberSession();
    const gardenEpoch=epoch;
    await view.render(game.snapshot(),'entry');
    if(gardenEpoch!==epoch)return;
    busy=false;controls();scheduleHint();
    if(rankStartIssue)toast(rankStartIssue.message,4500);
    else if(initial.migrationNotice){toast(initial.migrationNotice,3800);initial.migrationNotice=null;}
    else if(restore)toast(game.scoringVersion===LumiRewards.SCORING_VERSION?'친구들이 기다렸어요. 이어서 놀아볼까요?':'기존 판을 이어가요. 새 보너스와 랭킹은 다음 판부터!',4000);
    else if(game.budsGoal)toast(definition.buds.some(b=>b.hp>1)?'두 겹 봉오리는 같은 자리에서 두 번, 톡톡!':'봉오리 위에서 빛모습을 모으면 꽃이 피어요',3000);
    if(pendingModal){const next=pendingModal;pendingModal=null;showModal(next.type,next.data);}
    else if(!restore)buddy('wink',game.perks.startScore?'오늘의 응원 선물 +'+fmt(game.perks.startScore)+'점!':LumiArt.characters[profile.selectedBuddy].tagline,'selected');
    if(!modalType){
      const chapter=LumiStory.chapterForLevel(level);
      if(!profile.storySeen.prologue)showModal('story',{phase:'prologue'});
      else if(!restore && (level-1)%10===0 && !profile.storySeen.openings[chapter.id-1])showModal('story',{chapter:chapter.id,phase:'opening'});
    }
  }

  // Dialogs are actual game features, not links to placeholder pages.
  function modalButton(text,action,primary=false) {
    const node=document.createElement('button');node.className=primary?'primary-button':'secondary-button';
    node.textContent=text;node.addEventListener('click',()=>{audio.play('button');action();});$('modal-actions').appendChild(node);
  }
  function closeModal() {
    if(sessionInterrupted||recoveryBusy)return;
    $('modal-backdrop').hidden=true;modalType=null;
    document.querySelector('.app-shell').inert=false;document.body.style.overflow='';
    document.body.classList.remove('modal-open');
    fx.setPaused(document.hidden);audio.suspend(document.hidden);
    controls();
    if(game && (game.won||game.over))revealFinishActions();
    else if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
    else if(game && !game.won && !game.over)view.focusAt({r:0,c:0});
    scheduleHint();
  }
  function revealFinishActions() {
    const expectedEpoch=epoch;
    requestAnimationFrame(()=>{
      if(sessionInterrupted||expectedEpoch!==epoch||modalType||busy||!game||!(game.won||game.over))return;
      $('finish-dock').scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
      $('finish-next').focus({preventScroll:true});
    });
  }
  function openGarden(id) { closeModal();startGarden(id).then(()=>{if(!modalType)view.focusAt({r:0,c:0});}); }
  function modalHeader(eyebrow,title,mood='idle',type=profile.selectedBuddy) {
    $('modal-eyebrow').textContent=eyebrow;$('modal-title').textContent=title;
    $('modal-art').innerHTML=type===null?'':art(type,mood);
  }
  function showModal(type,data={}) {
    if(sessionInterrupted||recoveryBusy)return;
    if(busy){pendingModal={type,data};return;}
    const wasOpen=Boolean(modalType);
    if(!wasOpen)returnFocus=document.activeElement;
    clearHints();dismissSpecialCoach();modalType=type;view.select(null);blastMode=false;controls();
    $('modal').className='modal';$('modal-content').replaceChildren();$('modal-actions').replaceChildren();
    $('modal-art').style.display='';$('modal-art').innerHTML='';
    $('modal').scrollTop=0;
    if(type==='help') helpModal();
    else if(type==='score-info') scoreInfoModal();
    else if(type==='pause') {
      modalHeader('TAKE A LITTLE BREATH','잠깐, 몽글몽글 쉬어요','sleep');
      $('modal-content').innerHTML='<p>서두르지 않아도 괜찮아요.<br>친구들이 여기서 기다릴게요.</p><p class="save-note">지금까지의 진행은 자동으로 저장됐어요.</p>';
      modalButton('이어서 놀기',closeModal,true);
      modalButton('이 정원 새로 시작',()=>showModal('restart'));
      audio.suspend(true);
    }
    else if(type==='restart') {
      modalHeader('A FRESH LITTLE START','새롭게 만나볼까요?','wink');
      $('modal-content').innerHTML='<p>현재 판의 미션과 횟수가 초기화돼요.<br>모은 별과 친구 친밀도는 그대로 간직해요.</p>';
      modalButton('새로 시작하기',()=>openGarden(level),true);modalButton('계속 놀기',closeModal);
    }
    else if(type==='win' || type==='lose') resultModal(type==='win');
    else if(type==='map') mapModal(data.chapter);
    else if(type==='ranking') rankingModal();
    else if(type==='ranking-recovery') rankingRecoveryModal();
    else if(type==='level') levelModal(data.id);
    else if(type==='album') albumModal();
    else if(type==='character') characterModal(data.type);
    else if(type==='storybook') storybookModal();
    else if(type==='story') storyModal(data);
    else if(type==='promise') promiseModal(data.level||level);
    else if(type==='world') worldModal(data.chapter||Math.ceil(level/10));
    else if(type==='journal') journalModal(data.chapter||Math.ceil(level/10));
    else if(type==='relations') relationsModal(data.type);
    else if(type==='world-guide') worldGuideModal();
    else if(type==='settings') settingsModal();
    $('modal-backdrop').hidden=false;
    $('modal-content').scrollTop=0;
    document.querySelector('.app-shell').inert=true;document.body.style.overflow='hidden';document.body.classList.add('modal-open');
    if(type!=='win')fx.setPaused(true);else fx.setPaused(false);
    requestAnimationFrame(()=>{
      if(sessionInterrupted||modalType!==type)return;
      const memory=type==='character'&&Number.isInteger(data.memoryTier)?$('memory-'+data.type+'-'+data.memoryTier):null;
      if(memory){
        memory.open=true;memory.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
        memory.querySelector('summary').focus({preventScroll:true});
      }else ($('modal-actions').querySelector('button')||$('modal-close')).focus({preventScroll:true});
    });
  }
  function updateRankStatus() {
    const active=Boolean(rankRun);
    const recovery=ranking.getRecoveryState();
    $('rank-mode').textContent=recovery.required?'리그 연결 확인':active?'랭킹 도전':rankStartIssue?.code==='RULESET_CHANGED'?'업데이트 필요':ranking.pendingCount?'제출 대기 '+ranking.pendingCount:'연습 플레이';
    $('rank-mode').classList.toggle('connected',active);
    $('rank-mode').setAttribute('aria-label',active?'서버 검증 랭킹 도전 중':rankStartIssue?.message||'랭킹 상태와 기록 보기');
    $('header-ranking').classList.toggle('has-pending',ranking.pendingCount>0);
  }
  function updateResultRanking() {
    const panel=$('result-ranking');if(!panel)return;
    if(rankSubmission?.status==='verified') {
      const r=rankSubmission.result;
      panel.innerHTML=icon('trophy')+'<div><strong>검증된 기록이 등록됐어요</strong><small>이 정원 주간 '+(r.weeklyStageRank?fmt(r.weeklyStageRank)+'위':'집계 중')+' · 전체 모험 '+(r.weeklyCampaignRank?fmt(r.weeklyCampaignRank)+'위':'집계 중')+'</small></div>';
      panel.dataset.state='verified';
    } else if(rankSubmission?.status==='sending') {
      panel.innerHTML='<span class="mini-spinner"></span><div><strong>기록을 확인하고 있어요</strong><small>완료되면 랭킹에 반영돼요.</small></div>';
    } else if(rankSubmission?.status==='queued') {
      panel.innerHTML=icon('trophy')+'<div><strong>연결되면 기록을 제출해요</strong><small>이 기기에 제출할 기록을 보관했어요.</small></div>';
    } else if(rankSubmission?.status==='error') {
      panel.innerHTML=icon('help')+'<div><strong>이번 기록을 등록하지 못했어요</strong><small>'+esc(rankSubmission.error?.message||'정원 기록은 이 기기에 남아 있어요.')+'</small></div>';
    } else {
      panel.innerHTML=icon('flower')+'<div><strong>이 기기에 남긴 정원 기록</strong><small>'+(rankRun?'정원을 완성하면 랭킹에 도전할 수 있어요.':'연결된 상태에서 새 정원을 시작하면 랭킹에 참여해요.')+'</small></div>';
    }
  }
  async function retryRankings() {
    if(sessionInterrupted||!ranking.pendingCount||rankRetry)return;
    try {
      rankRetry=ranking.flushPending();
      const reply=await rankRetry;
      if(sessionInterrupted)return;
      updateRankStatus();
      if(reply.authRequired&&modalType==='ranking'){loadRanking(rankRequest);return;}
      if(reply.submitted.length){
        for(const result of reply.submitted)syncRewards(result);
        const current=reply.submitted.find(result=>result.runId===rankRun?.runId);
        if(current){rankSubmission={status:'verified',result:current};updateResultRanking();updateFriendshipResult();}
        toast('보관한 기록 '+reply.submitted.length+'개를 랭킹에 반영했어요');
        if(modalType==='ranking')loadRanking(rankRequest);
      }
    } catch(_) {} finally {rankRetry=null;}
  }
  function rankRow(entry,own=false) {
    if(!entry)return '';
    return '<li class="rank-row '+(own||entry.isYou?'is-you':'')+'"><span class="rank-position '+(entry.rank<=3?'medal-'+entry.rank:'')+'">'+(entry.rank===1?icon('crown'):entry.rank)+'</span><span class="rank-avatar">'+art(Math.abs(entry.nickname.split('').reduce((a,c)=>a+c.charCodeAt(0),0))%6,'happy')+'</span><span class="rank-person"><strong>'+esc(entry.nickname)+(entry.isYou?'<i>나</i>':'')+'</strong><small>'+(rankScope==='campaign'?entry.completedStages+'개 정원 · 별 '+entry.stars:'검증된 최고 기록')+'</small></span><strong class="rank-points">'+fmt(entry.score)+'<small>점</small></strong></li>';
  }
  function renderCompetition(result) {
    const own=result.own,rival=result.rival,card=$('ranking-competition');
    const state=own?(rival?'chasing':'leader'):'unranked';card.dataset.state=state;
    let headline,caption;
    if(rival){
      headline=result.rivalTied?(own.rank===1?'단독 1위까지':'공동 '+own.rank+'위에서 앞서기까지'):'<span>'+fmt(rival.rank)+'위까지</span>';
      headline+=' <strong>'+fmt(result.pointsToOvertake)+'점</strong>';
      caption=esc(rival.nickname)+' · '+fmt(rival.score)+'점';
    }else if(own){headline=result.totalPlayers>1?'지금은 우리가 <strong>1위!</strong>':'<strong>첫 기록의 주인공!</strong>';caption=result.totalPlayers>1?'최고 기록을 높여 자리를 지켜봐요.':'다른 친구가 참여하면 순위 경쟁이 시작돼요.';}
    else{headline='<strong>우리의 첫 순위를 만들어봐요</strong>';caption='정원 하나를 완성하면 리그에 이름이 올라가요.';}
    card.innerHTML='<div class="competition-top"><span>'+icon('trophy')+(rankPeriod==='week'?'이번 주':'전체 기간')+' · '+(rankScope==='campaign'?'전체 모험':'정원 '+String(rankStage).padStart(2,'0'))+'</span><b>'+(own?fmt(own.rank)+'위':'기록 대기')+'</b></div>'+
      '<div class="competition-gap">'+headline+'</div><p class="competition-rival">'+caption+'</p>'+
      '<div class="competition-score"><span>내 기록</span><strong>'+fmt(own?.score||0)+'<small>점</small></strong></div>';
    const candidates=LumiLevels.filter(d=>d.id<=profile.unlocked && profile.stars[d.id-1]<3);
    const candidate=(rankScope==='stage'&&rankStage<=profile.unlocked?LumiLevels[rankStage-1]:candidates.find(d=>profile.stars[d.id-1]>0)||candidates[0]||LumiLevels[Math.min(TOTAL,profile.unlocked)-1]);
    if(candidate){
      const suggestion=document.createElement('button');suggestion.className='rank-recommendation';
      suggestion.innerHTML='<span>'+icon('spark')+'다음 도전 · '+String(candidate.id).padStart(2,'0')+' '+esc(candidate.title)+'</span><strong>'+(profile.stars[candidate.id-1]===0?'첫 클리어 도전':'최고 기록 도전')+' →</strong>';
      suggestion.addEventListener('click',()=>showModal('level',{id:candidate.id}));card.appendChild(suggestion);
    }
  }
  function renderWeekly(available=true) {
    const panel=$('weekly-panel');if(!panel)return;
    if(!weeklyState || !available){panel.innerHTML='<div class="weekly-head"><strong>'+icon('heart')+' 이번 주의 작은 약속</strong></div><p class="weekly-status">연결되면 주간 목표와 받을 선물을 확인할 수 있어요.</p>';return;}
    panel.innerHTML='<div class="weekly-head"><div><strong>'+icon('heart')+' 이번 주의 작은 약속</strong><small>정원 완성 '+fmt(weeklyState.clears)+'회 · 클리어할수록 가까워져요</small></div></div>'+
      '<label class="weekly-recipient">선물 받을 친구<select id="weekly-buddy" aria-label="주간 선물 받을 친구">'+LumiArt.characters.map((c,i)=>'<option value="'+i+'" '+(i===weeklyRecipient?'selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select></label>'+
      weeklyState.goals.map(g=>'<div class="weekly-goal '+(g.claimed?'claimed':'')+'"><div class="weekly-goal-head"><strong>'+esc(g.label)+'</strong><span>'+Math.min(g.target,g.progress)+' / '+g.target+'</span></div><div class="weekly-track" role="progressbar" aria-label="'+esc(g.label)+'" aria-valuemin="0" aria-valuemax="'+g.target+'" aria-valuenow="'+Math.min(g.target,g.progress)+'"><span style="width:'+Math.min(100,g.progress/g.target*100)+'%"></span></div><div class="weekly-reward"><span>'+icon('heart')+'친밀도 <strong>+'+g.reward.amount+'</strong>'+(g.claimed?'<small>'+esc(LumiArt.names[g.claimedBuddyType??weeklyRecipient])+'에게 전달했어요</small>':'')+'</span><button class="weekly-claim" data-goal-id="'+esc(g.id)+'" '+(g.claimed||!g.ready||claimBusy?'disabled':'')+'>'+(g.claimed?'받았어요 ✓':g.ready?'선물 받기':(g.target-g.progress)+'회 더 완성')+'</button></div></div>').join('')+
      '<p class="weekly-status" id="weekly-status" role="status">선물로 올라간 친구 혜택은 다음 정원부터 적용돼요.</p>';
    $('weekly-buddy').addEventListener('change',e=>{weeklyRecipient=Number(e.target.value);});
    panel.querySelectorAll('[data-goal-id]').forEach(button=>button.addEventListener('click',()=>claimWeeklyGift(button.dataset.goalId,weeklyState.weekKey)));
  }
  async function claimWeeklyGift(goalId,weekKey) {
    if(claimBusy)return;claimBusy=true;const request=rankRequest,type=weeklyRecipient;renderWeekly();
    try{
      const response=await ranking.claimWeekly(goalId,type,weekKey);syncRewards(response);
      if(modalType!=='ranking'||request!==rankRequest)return;
      renderWeekly();const recipient=response.claim.buddyType;
      $('weekly-status').textContent=response.claimedNow?LumiArt.names[recipient]+'에게 선물을 전했어요! 다음 정원부터 새 혜택을 만나봐요.':'이미 '+LumiArt.names[recipient]+'에게 전달한 선물이에요.';
      audio.play('collect');pulse($('weekly-panel'));
    }catch(error){if(modalType==='ranking'&&request===rankRequest&&$('weekly-status')){$('weekly-status').textContent=error.message||'연결 후 다시 받아주세요. 선물은 중복 지급되지 않아요.';if(ranking.getRecoveryState().required)loadRanking(request);}}
    finally{claimBusy=false;if(modalType==='ranking'&&$('weekly-panel'))$('weekly-panel').querySelectorAll('[data-goal-id]').forEach(button=>{const goal=weeklyState?.goals.find(g=>g.id===button.dataset.goalId);button.disabled=!goal?.ready||goal.claimed;});}
  }
  function rankingModal() {
    const request=++rankRequest;
    $('modal').classList.add('wide','ranking-modal');modalHeader('SUNPATCH LEAGUE','우리의 반짝이는 순위','happy',null);
    const identity=ranking.getIdentity();
    $('modal-content').innerHTML=
      '<div class="rank-segments" role="group" aria-label="랭킹 범위"><button data-scope="campaign" aria-pressed="'+(rankScope==='campaign')+'">전체 모험</button><button data-scope="stage" aria-pressed="'+(rankScope==='stage')+'">정원별</button></div>'+
      '<div class="rank-period" role="group" aria-label="랭킹 기간"><button data-period="week" aria-pressed="'+(rankPeriod==='week')+'">이번 주</button><button data-period="all" aria-pressed="'+(rankPeriod==='all')+'">전체 기간</button><span id="ranking-population"></span></div>'+
      (rankScope==='stage'?'<label class="rank-stage-select"><span>정원 선택</span><select id="ranking-stage" aria-label="랭킹 정원">'+LumiLevels.map(d=>'<option value="'+d.id+'" '+(d.id===rankStage?'selected':'')+'>'+String(d.id).padStart(2,'0')+' · '+esc(d.title)+'</option>').join('')+'</select></label>':'')+
      '<div id="ranking-competition" class="competition-card"><div class="ranking-loading"><span class="mini-spinner"></span>다음 도전을 찾고 있어요</div></div>'+
      '<section id="weekly-panel" class="weekly-panel" aria-label="주간 목표와 보상"></section>'+
      '<div class="ranking-section-heading"><strong>정원의 반짝이는 친구들</strong><span>최고 기록 TOP 50</span></div>'+
      '<div id="ranking-results" class="ranking-results" aria-live="polite"><div class="ranking-loading"><span class="mini-spinner"></span>반짝이는 기록을 불러와요</div></div>'+
      '<div id="ranking-own"></div><p class="ranking-reset" id="ranking-reset"></p><p class="ranking-legacy" id="ranking-legacy"></p>'+
      '<details class="ranking-profile"><summary>'+icon('settings')+'랭킹 이름 · 기록 안내</summary><form id="nickname-form"><label for="nickname-input">다른 친구에게 보이는 이름</label><div><input id="nickname-input" name="nickname" maxlength="16" minlength="2" autocomplete="off" spellcheck="false" value="'+esc(identity?.nickname||'')+'" placeholder="정원에서 사용할 이름" required><button type="submit">저장</button></div><p id="nickname-status" role="status"></p></form><p>전체 모험은 정원별 최고 점수의 합이에요. 같은 정원을 반복해도 점수는 중복 가산되지 않아요. 완성한 정원의 검증된 기록만 반영돼요.</p><p>이번 주는 월요일 오전 9시(한국 시간)에 새로 시작해요. 시작한 주의 기록으로 집계되며 72시간 안에 제출해야 해요.</p></details>';
    $('modal-actions').replaceChildren();
    modalButton(game?.won?'결과로 돌아가기':'정원으로 돌아가기',()=>game?.won?showModal('win'):closeModal(),true);
    for(const button of $('modal-content').querySelectorAll('[data-scope]'))button.addEventListener('click',()=>{rankScope=button.dataset.scope;rankingModal();});
    for(const button of $('modal-content').querySelectorAll('[data-period]'))button.addEventListener('click',()=>{rankPeriod=button.dataset.period;rankingModal();});
    $('ranking-stage')?.addEventListener('change',e=>{rankStage=Number(e.target.value);rankingModal();});
    $('nickname-form').addEventListener('submit',async e=>{
      e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
      try {
        const name=$('nickname-input').value.trim();
        if(ranking.getIdentity())await ranking.setNickname(name);else await ranking.register(name);
        if(modalType!=='ranking'||request!==rankRequest)return;
        $('nickname-status').textContent='이 이름으로 만나요!';
        loadRanking(request);
      }catch(error){if(modalType==='ranking'&&request===rankRequest&&$('nickname-status'))$('nickname-status').textContent=error.message||'이름을 저장하지 못했어요.';}
      finally{if(button.isConnected)button.disabled=false;}
    });
    renderWeekly();loadRanking(request);
  }
  async function loadRanking(request) {
    const fetchId=++rankFetch;
    try {
      if(ranking.pendingCount)retryRankings();
      await ranking.register();
      const [result,account]=await Promise.all([ranking.leaderboard({scope:rankScope,period:rankPeriod,level:rankStage}),ranking.getProfile()]);
      if(modalType!=='ranking'||request!==rankRequest||fetchId!==rankFetch)return;
      syncRewards(result);syncRewards(account);
      $('ranking-population').textContent=fmt(result.totalPlayers)+'명 참여';
      $('ranking-results').innerHTML=result.entries.length?'<ol class="ranking-list">'+result.entries.map(e=>rankRow(e)).join('')+'</ol>':'<div class="ranking-empty"><span>'+icon('trophy')+'</span><strong>첫 번째 반짝임을 기다려요</strong><p>정원을 완성하고 첫 기록을 남겨보세요.</p></div>';
      renderCompetition(result);renderWeekly();
      $('ranking-own').innerHTML=result.neighbors?.length>1?'<div class="own-rank-label">내 주변의 라이벌</div><ol class="ranking-list ranking-neighbors">'+result.neighbors.map(e=>rankRow(e,e.isYou)).join('')+'</ol>':'';
      $('ranking-legacy').textContent=(rankStartIssue?.code==='RULESET_CHANGED'?rankStartIssue.message+' ':'')+(account.legacyStats?.records?'이전 점수 규칙의 '+account.legacyStats.completedStages+'개 정원 기록과 해금은 보관 중이에요. 새 리그는 새 점수 규칙으로 도전해요.':'');
      const weekEnd=new Date(result.week.endsAt);
      $('ranking-reset').textContent=rankPeriod==='week'?'새 주의 시작 · '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'}).format(weekEnd):'정원별 최고 기록을 계속 간직해요.';
      updateRankStatus();
    }catch(error){
      if(modalType!=='ranking'||request!==rankRequest||fetchId!==rankFetch)return;
      const recovery=ranking.getRecoveryState();
      if(recovery.required){
        $('ranking-results').innerHTML='<div class="ranking-empty offline"><span>'+icon('help')+'</span><strong>리그 계정의 연결을 확인해 주세요</strong><p>서버가 저장된 계정을 확인하지 못했어요.<br>기기 진행과 대기 기록은 그대로 보관하고 있어요.</p><button id="recover-ranking" class="secondary-button">리그 연결 방법 보기</button></div>';
        $('ranking-own').replaceChildren();$('ranking-reset').textContent='다시 연결할 때 기존 기록의 보관 방법을 먼저 안내해요.';
        $('ranking-competition').innerHTML='<strong>정원과 친구의 기억은 그대로예요</strong><p>계정을 확인한 뒤 새 리그 도전을 시작해요.</p>';renderWeekly(false);updateRankStatus();
        $('recover-ranking').addEventListener('click',()=>showModal('ranking-recovery'));return;
      }
      $('ranking-results').innerHTML='<div class="ranking-empty offline"><span>'+icon('flower')+'</span><strong>잠시 연결을 기다리고 있어요</strong><p>정원은 계속 즐길 수 있어요.<br>연결되면 다른 친구들의 기록을 만나봐요.</p>'+(ranking.pendingCount?'<small>제출을 기다리는 기록 '+ranking.pendingCount+'개</small>':'')+'<button id="retry-ranking" class="secondary-button">다시 연결하기</button></div>';
      $('ranking-own').replaceChildren();$('ranking-reset').textContent='연습 기록은 이 기기에 저장돼요.';
      $('ranking-competition').innerHTML='<strong>연결되면 다음 라이벌을 만나요</strong><p>플레이 기록은 이 기기에 보관해요.</p>';renderWeekly(false);
      $('retry-ranking').addEventListener('click',rankingModal);
    }
  }
  function rankingRecoveryModal() {
    const recovery=ranking.getRecoveryState();
    if(!recovery.required){rankingModal();return;}
    modalHeader('SUNPATCH LEAGUE','리그를 다시 연결할까요?','wink');
    $('modal-content').innerHTML='<p><strong>'+esc(recovery.nickname||'기존 리그 친구')+'</strong> 계정을 서버에서 확인하지 못했어요.</p>'+
      '<p>새 리그 계정을 연결하면 기존 계정 정보와 대기 기록 '+fmt(recovery.pendingCount)+'건을 이 기기에 따로 보관해요. 기존 기록을 새 계정의 점수로 옮기지는 않아요.</p>'+
      '<p class="save-note">정원 해금·별·친구의 기억은 유지돼요. 현재 판은 연습 기록으로 마무리하고, 다음 정원부터 새 계정으로 도전해요.</p><p id="recovery-status" class="save-note" role="status"></p>';
    modalButton('기존 기록 보관하고 새로 연결',async()=>{
      if(recoveryBusy)return;
      recoveryBusy=true;$('modal-close').disabled=true;
      $('recovery-status').textContent='기존 기록을 안전하게 보관하고 새 계정을 연결하고 있어요.';
      const buttons=[...$('modal-actions').querySelectorAll('button')];buttons.forEach(button=>{button.disabled=true;});
      const request=++rankRequest;
      try{
        await ranking.reconnectIdentity({confirmed:true});
        if(sessionInterrupted)return;
        rankRun=null;rankSubmission=null;rankStartIssue=null;weeklyState=null;sidebarSignature='';companionSignature='';
        persist();sidebars();updateRankStatus();
        try{syncRewards(await ranking.getProfile());}catch(_){}
        if(sessionInterrupted)return;
        recoveryBusy=false;$('modal-close').disabled=false;
        if(modalType==='ranking-recovery'&&request===rankRequest)showModal('ranking');
        toast('기존 기록을 보관했어요. 다음 정원부터 새 리그로 만나요',3500);
      }catch(error){
        if(modalType==='ranking-recovery'&&$('recovery-status'))$('recovery-status').textContent=error.message||'계정을 바꾸지 못했어요. 기존 기록을 유지했어요.';
      }finally{recoveryBusy=false;$('modal-close').disabled=false;buttons.forEach(button=>{if(button.isConnected)button.disabled=false;});}
    },true);
    modalButton('지금은 기존 기록 유지',()=>showModal('ranking'));
  }

  function helpModal() {
    modalHeader('LITTLE MATCHES, BIG HAPPINESS','같이 놀면 더 반짝여요','happy',0);
    $('modal').classList.add('help');
    $('modal-content').innerHTML='<p>이웃한 빛모습을 밀거나 하나씩 눌러 바꿔요.<br><strong>목표 색 팡빛과 봉오리를 모두 채우면 성공!</strong></p>'+
      '<div class="help-rules">'+
      '<div class="help-rule"><span>3</span><span><strong>같은 빛모습 3개</strong>이 만나면 팡!<br>연쇄가 이어질수록 점수가 올라가요.</span></div>'+
      '<div class="help-rule"><span>4</span><span><strong>4개는 한 줄 팡빛, 5개는 무지개.</strong><br>특수 빛모습은 이웃과 바꾸면 바로 발동!</span></div>'+
      '<div class="help-rule"><span>✿</span><span><strong>꽃봉오리 위에서 매치</strong>하면 꽃이 피어요.<br>두 겹 봉오리는 두 번. T·L 매치는 3×3 폭탄!</span></div>'+
      '<div class="help-rule"><span>×2</span><span><strong>햇살 합창! 충전 직후부터 매치 점수 두 배.</strong><br>남은 연쇄와 다음 교환 3회에 적용돼요.<br>힌트는 무제한, 바람·꽃비는 각각 2번!</span></div></div>'+
      '<p class="help-bonus"><strong>남은 이동도 점수가 돼요.</strong><br>10회 이상 남기고 완성하면 별 3개!<br>친구 친밀도 혜택은 새 정원을 시작할 때 적용돼요.</p>'+
      '<p class="keyboard-note">방향키: 이동 · Enter/Space: 선택<br>Shift + 방향키: 바로 교환 · Esc: 닫기</p>';
    modalButton('친구들과 놀러 가기',closeModal,true);modalButton('햇살밭의 작은 약속들',()=>showModal('world-guide'));
  }
  function starMarkup(count,large=false) {
    return Array.from({length:3},(_,i)=>'<svg class="'+(i<count?'earned':'')+'" style="--delay:'+(.12+i*.14)+'s" aria-hidden="true"><use href="#i-star"/></svg>').join('');
  }
  function scoreInfoModal() {
    modalHeader('EVERY MOVE COUNTS','여유 있게, 더 반짝이게','happy',4);
    const targets=LumiRewards.starThresholds(game.target),rate=LumiRewards.moveValue(game.target);
    $('modal-content').innerHTML='<div class="star-guide">'+targets.map((target,i)=>'<div>'+icon('star')+'<strong>별 '+(i+1)+'개</strong><span>'+fmt(target)+'점</span></div>').join('')+'</div>'+
      '<p>미션을 완성하면 별 1개는 꼭 받아요.<br>별 2·3개는 보너스까지 더한 최종 점수로 정해져요.</p>'+
      '<div class="bonus-guide"><strong>이 정원은 남은 이동 1회마다 +'+fmt(rate)+'점</strong><p>10회 이상 남기고 완성하면 별 3개까지 부족한 점수도 선물해요. 이 추가 점수는 결과창에 따로 보여요.</p></div>'+
      '<p class="save-note">친구의 시작·매치 보너스도 총점에 포함돼요.<br>진행 중이던 이전 버전의 판은 기존 규칙으로 마무리해요.</p>';
    modalButton('좋아, 같이 모아보자!',closeModal,true);
  }
  function friendshipReward() {
    return rankSubmission?.result?.friendshipReward||resultDetails.friendship;
  }
  function updateFriendshipResult() {
    const node=$('result-friendship'),reward=friendshipReward();
    if(!node || !reward)return;
    const verified=Boolean(rankSubmission?.result?.friendshipReward);
    const {buddyType,beforeXp,afterXp,gainedXp}=reward,c=LumiArt.characters[buddyType];
    const displayBefore=verified?beforeXp:reward.displayBeforeXp??beforeXp,displayAfter=verified?afterXp:reward.displayAfterXp??afterXp;
    const before=LumiRewards.bond(displayBefore),after=LumiRewards.bond(displayAfter),up=after.level>before.level;
    const memoryBefore=resultDetails.friendship?.memoryBeforeLevel??LumiRewards.bond(resultDetails.friendship?.displayBeforeXp??displayBefore).level;
    const memoryAfter=LumiProgress.memoryLevel(profile,buddyType);
    const next=LumiRewards.BONDS[after.level];
    const pending=['sending','queued'].includes(rankSubmission?.status);
    const signature=[buddyType,beforeXp,afterXp,displayBefore,displayAfter,memoryBefore,memoryAfter,verified,pending].join('|');
    if(node.dataset.signature===signature)return;node.dataset.signature=signature;
    friendshipAnimation?.cancel();
    node.innerHTML='<div class="friendship-result-head"><span class="friendship-result-avatar">'+art(buddyType,up?'excited':'happy')+'</span><div><small>'+esc(c.name)+' · '+(verified?'리그 친밀도':'친구 친밀도')+'</small><strong>'+(up?'Lv.'+after.level+' '+after.label+'!':'Lv.'+after.level+' '+after.label)+'</strong></div><b>+'+fmt(gainedXp)+' XP</b></div>'+
      '<div class="friendship-result-meter" role="progressbar" aria-label="'+esc(c.name)+' 친밀도" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(after.progress*100)+'"><span style="width:'+after.progress*100+'%"></span></div>'+
      '<div class="friendship-result-detail"><span>팡빛 모으기 +'+fmt(reward.collectedXp)+' · 클리어 +'+fmt(reward.clearXp)+'</span><span>'+fmt(displayAfter)+(after.next?' / '+after.next:'')+'</span></div>'+
      '<p class="friendship-perk '+(up?'unlocked':'')+'">'+icon(up?'spark':'heart')+'<span><strong>'+(up?'새 혜택 · ':'')+esc(after.perkLabel)+'</strong>'+esc(after.perkDescription)+(up?' 다음 정원부터 적용돼요.':'')+'</span></p>'+
      (next?'<small class="friendship-next">다음 선물 · Lv.'+(after.level+1)+' '+esc(next.perkLabel)+'</small>':'<small class="friendship-next">모든 친구 혜택이 열렸어요!</small>')+
      (!verified?'<small class="friendship-verification">'+(pending?'연결 후 검증되면 리그 친밀도에도 반영돼요.':'이번 판 +'+fmt(gainedXp)+' XP는 기기에 적립했어요. 리그는 연결된 플레이로 성장해요.')+(displayAfter>afterXp?' 보관된 '+fmt(displayAfter)+' XP와 열린 혜택은 유지돼요.':'')+'</small>':'');
    if(memoryAfter>memoryBefore){
      const memory=LumiStory.characters[reward.buddyType].memories[memoryAfter-1];
      const note=document.createElement('button');note.className='friendship-memory';
      note.innerHTML=icon('book')+'<span>새 추억 · '+esc(memory.title)+'</span>';
      note.addEventListener('click',()=>showModal('character',{type:reward.buddyType,memoryTier:memory.tier}));node.appendChild(note);
    }
    if(!motion.matches){
      const fill=node.querySelector('.friendship-result-meter span');
      const frames=up?[{width:(before.progress*100)+'%'},{width:'100%',offset:.45},{width:'0%',offset:.46},{width:(after.progress*100)+'%'}]:[{width:(before.progress*100)+'%'},{width:(after.progress*100)+'%'}];
      friendshipAnimation=fill.animate(frames,{duration:up?1300:900,easing:'cubic-bezier(.22,.8,.25,1)'});friendshipAnimation.finished.catch(()=>{});
      if(up)pulse(node.querySelector('.friendship-result-avatar'));
    }
  }
  function resultModal(win) {
    const snapshot=game.snapshot(),stars=snapshot.stars,parts=snapshot.scoreBreakdown;
    $('modal').classList.add('result-modal');
    modalHeader(win?'STAGE '+String(level).padStart(2,'0')+' · IN FULL BLOOM':'A NEW LITTLE CHANCE',win?(level===TOTAL?'우리 정원이 완성됐어요!':'행복이 활짝 피었어요!'):'조금만 더, 할 수 있어요',win?'excited':'sleep',game.scoringVersion===4?game.buddy.type:profile.selectedBuddy);
    const goals=game.snapshot().objectives.map(g=>'<span>'+art(g.type,win?'happy':'idle')+(g.current>=g.target?icon('check'):Math.max(0,g.target-g.current)+' 남음')+'</span>').join('')+
      (game.budsGoal?'<span>'+icon('flower')+(game.bloomed>=game.budsGoal?icon('check'):(game.budsGoal-game.bloomed)+' 남음')+'</span>':'');
    const missing=Math.max(0,LumiRewards.starThresholds(game.target)[2]-game.score);
    $('modal-content').innerHTML=(win?'<div class="result-stars" aria-label="별 '+stars+'개 획득">'+starMarkup(stars,true)+'</div>':'')+
      '<div class="result-score">'+fmt(game.score)+'</div><span class="result-caption">우리 함께 모은 반짝임</span>'+
      (win && resultDetails.newBest?'<div class="new-record">'+icon('crown')+'이 정원의 새로운 최고 기록!</div>':'')+
      (win?'<div class="result-star-feedback '+(stars===3?'complete':'')+'">'+icon('star')+'<strong>'+(stars===3?'별 3개, 눈부신 정원 완성!':'별 3개까지 '+fmt(missing)+'점 부족!')+'</strong></div>':'')+
      (parts?'<dl class="score-breakdown"><div><dt>퍼즐 · 연쇄 점수</dt><dd>'+fmt(parts.matchScore)+'</dd></div>'+
        (parts.buddyStartBonus+parts.buddyMatchBonus+(parts.buddyFeverBonus||0)?'<div><dt>친구의 응원 보너스</dt><dd>+'+fmt(parts.buddyStartBonus+parts.buddyMatchBonus+(parts.buddyFeverBonus||0))+'</dd></div>':'')+
        (win&&snapshot.scoringVersion===4?'<div class="bonus-row"><dt>남은 이동 보너스<small>'+game.moves+'회 × '+fmt(parts.moveValue)+'점</small></dt><dd>+'+fmt(parts.moveBonus)+'</dd></div>':'')+
        (parts.efficiencyBonus?'<div class="bonus-row"><dt>10회 여유 클리어 선물</dt><dd>+'+fmt(parts.efficiencyBonus)+'</dd></div>':'')+'</dl>':'')+
      '<div class="result-detail"><div><span>남은 횟수</span><strong>'+game.moves+'</strong></div><div><span>최고 연쇄</span><strong>×'+maxCombo+'</strong></div><div><span>피운 꽃</span><strong>'+game.bloomed+'</strong></div></div>'+
      '<div class="result-goals">'+goals+'</div>'+journeyResultCard(win)+(win?chapterResultCard()+'<div id="result-friendship" class="result-friendship"></div>':'<p>남은 목표를 먼저 보고, 특수 빛모습을 가까이 옮겨봐요.</p>');
    wireStoryLinks();wireWorldLinks();
    if(win && level<TOTAL)modalButton('다음 단계로 →',()=>openGarden(level+1),true);
    else modalButton(win?'햇살밭 지도 둘러보기':'다시 만나러 가기',()=>win?showModal('map'):openGarden(level),true);
    const rankPanel=document.createElement('div');rankPanel.id='result-ranking';rankPanel.className='result-ranking';$('modal-content').appendChild(rankPanel);updateResultRanking();
    if(win)modalButton('내 랭킹 확인',()=>showModal('ranking'));
    modalButton(win?'이 정원 한 번 더':'햇살밭 지도 보기',()=>win?openGarden(level):showModal('map'));
    updateFriendshipResult();
  }
  function storyScene(chapter,types) {
    return '<div class="story-diorama scene-chapter-'+chapter+'" aria-hidden="true"><span class="story-sun"></span><span class="story-cloud cloud-one"></span><span class="story-cloud cloud-two"></span><span class="story-hill hill-one"></span><span class="story-hill hill-two"></span><span class="story-lighthouse"><i>'+icon('flower')+'</i><b></b><em></em></span><span class="story-seed seed-one">'+icon('spark')+'</span><span class="story-seed seed-two">'+icon('spark')+'</span><div class="story-cast">'+types.map((type,i)=>'<span style="--cast-order:'+i+'">'+art(type,'happy')+'</span>').join('')+'</div></div>';
  }
  function worldVignette(chapterId,cast=true) {
    const chapter=LumiStory.chapters[chapterId-1],state=LumiJourney.getRestoration(profile,chapterId);
    if(!LumiArt.landmark)return storyScene(chapterId,cast?chapter.spotlight:[]);
    return '<div class="world-vignette" data-world-chapter="'+chapterId+'" data-restored="'+state.restored+'">'+
      '<span class="world-vignette-art" role="img" aria-label="'+esc(chapter.title)+', 세 곳 중 '+state.restored+'곳 복원">'+LumiArt.landmark(chapterId,state.restored,'world-'+(++uid),state.projects.map(p=>p.state==='restored'),Boolean(profile.stars[chapterId*10-1]))+'</span>'+
      (cast?'<div class="world-vignette-cast" aria-hidden="true">'+chapter.spotlight.map(type=>art(type,'happy')).join('')+'</div>':'')+
      '<span class="world-vignette-label">'+icon('leaf')+esc(chapter.title)+' <b>'+state.restored+' / 3</b></span></div>';
  }
  function chapterTabs(chapterId,attribute) {
    return '<div class="chapter-tabs world-tabs" role="tablist" aria-label="햇살밭 지역">'+LumiStory.chapters.map(c=>'<button role="tab" aria-selected="'+(chapterId===c.id)+'" '+attribute+'="'+c.id+'" aria-label="'+c.id+'장 '+esc(c.title)+'"><span>'+String(c.id).padStart(2,'0')+'</span><small>'+esc(['새싹','수로','온실','과수원','축제'][c.id-1])+'</small></button>').join('')+'</div>';
  }
  function updateJourneyHUD() {
    if(!journeyRun)return;
    const status=LumiJourney.status(level,journeyRun),earned=Boolean(profile.journey?.stamps[level-1]);
    const signature=[level,status.current,status.complete,earned].join('|');
    if(signature===journeySignature)return;
    const changed=Boolean(journeySignature);journeySignature=signature;
    $('promise-title').textContent=status.task.title;
    $('promise-caption').textContent=earned?'햇살 약속 · 도장 간직 중':status.complete?'약속 달성 · 클리어하면 도장!':'햇살 약속 · 선택 목표';
    $('promise-count').innerHTML=earned?icon('check')+' 도장':fmt(Math.min(status.current,status.target))+' / '+fmt(status.target);
    $('promise-fill').style.width=(earned?100:Math.min(100,status.progress*100))+'%';
    $('promise-button').classList.toggle('complete',status.complete||earned);
    $('promise-button').setAttribute('aria-label','이번 이야기와 햇살 약속: '+status.task.description+', '+Math.min(status.current,status.target)+' / '+status.target+(earned?', 도장 획득':status.complete?', 이 판을 클리어하면 도장을 받아요':', 선택 목표'));
    if(changed&&status.complete&&!earned)pulse($('promise-count'));
  }
  function promiseCard(id,run=null) {
    const status=LumiJourney.status(id,run),earned=Boolean(profile.journey?.stamps[id-1]);
    const displayed=earned?status.target:Math.min(status.current,status.target);
    return '<section class="promise-detail '+(earned?'earned':'')+'"><div class="promise-detail-heading"><span class="promise-seal">'+icon(earned?'check':'leaf')+'</span><div><small>선택 목표 · 햇살 약속</small><h3>'+esc(status.task.title)+'</h3></div><b>'+ (earned?'도장 보관 중':Math.min(status.current,status.target)+' / '+status.target)+'</b></div><p>'+esc(status.task.description)+'</p><div class="promise-detail-track" role="progressbar" aria-label="'+(earned?'간직한 햇살 약속 도장':'이번 판 햇살 약속')+'" aria-valuemin="0" aria-valuemax="'+status.target+'" aria-valuenow="'+displayed+'"><span style="width:'+(earned?100:status.progress*100)+'%"></span></div><p class="promise-tip">'+icon('bulb')+esc(status.task.tip)+'</p><small class="promise-rule">'+(earned?'이 단계의 도장은 이미 간직했어요. 다시 도전해도 도장 수는 늘지 않아요.':'이번 판에서 약속을 이루고 클리어하면 도장 1개! 도장은 햇살밭 복원에 쓰여요.')+'<br>약속을 놓쳐도 다음 단계로 갈 수 있어요.</small></section>';
  }
  function stageStoryCard(id,after=false) {
    const story=LumiStory.stageForLevel(id),friend=LumiArt.characters[story.speaker];
    return '<article class="stage-story-card" style="--story-friend:'+friend.lightColor+'"><span class="stage-story-avatar" aria-hidden="true">'+art(story.speaker,after?'happy':'idle')+'</span><div><small>'+esc(friend.name)+'의 빛씨앗 일기 · '+String(id).padStart(2,'0')+'</small><strong>'+esc(story.place)+'</strong><p>'+esc(after?story.after:story.before)+'</p></div></article>';
  }
  function promiseModal(id) {
    id=Math.max(1,Math.min(profile.unlocked,Math.floor(Number(id)||level)));
    const def=LumiLevels[id-1],story=LumiStory.stageForLevel(id);
    $('modal').classList.add('promise-modal');
    modalHeader('A LITTLE PROMISE · '+String(id).padStart(2,'0'),def.title,'happy',null);
    $('modal-content').innerHTML=worldVignette(def.chapter)+stageStoryCard(id)+
      '<div class="story-play-link"><span>'+icon('spark')+'이번에 함께 할 일</span><strong>'+esc(story.action)+'</strong><p>목표 색의 팡빛을 모두 모으'+(def.buds.length?'고 잠든 봉오리를 모두 깨우':'')+'면 다음 길이 열려요.</p></div>'+
      promiseCard(id,id===level?journeyRun:null)+
      '<button class="world-text-link" id="promise-world">'+icon('leaf')+'도장이 바꾸는 햇살밭 보기 <span>→</span></button>';
    $('promise-world').addEventListener('click',()=>showModal('world',{chapter:def.chapter}));
    modalButton(id===level&&!game.won&&!game.over?'약속 기억하고 계속하기':'이 단계 만나보기',()=>id===level&&!game.won&&!game.over?closeModal():showModal('level',{id}),true);
    modalButton('햇살밭 일기 모아보기',()=>showModal('journal',{chapter:def.chapter}));
  }
  function journeyResultCard(win) {
    const status=LumiJourney.status(level,journeyRun),earned=Boolean(profile.journey?.stamps[level-1]),awarded=resultDetails.journey?.awarded;
    const title=awarded?'햇살 약속 도장을 받았어요!':earned?'간직한 약속 위에, 새로운 추억':status.complete?'약속은 이뤘어요. 다음에는 클리어까지!':'다음에는 이 약속도 함께해요';
    return (win?stageStoryCard(level,true):'')+
      '<button class="result-promise '+(awarded?'new-stamp':'')+'" data-promise-level="'+level+'"><span class="result-promise-seal">'+icon(awarded||earned?'check':'leaf')+'</span><span><strong>'+title+'</strong><small>'+esc(status.task.title)+' · '+Math.min(status.current,status.target)+' / '+status.target+'</small></span><b aria-hidden="true">›</b></button>'+
      (resultDetails.restored?.length?'<button class="restoration-earned" data-world-chapter="'+Math.ceil(level/10)+'">'+icon('spark')+'<span><small>햇살밭에 생긴 변화</small><strong>'+resultDetails.restored.map(p=>esc(p.name)).join(' · ')+'</strong><span>우리의 손길로 돌아왔어요. 보러 가기 →</span></span></button>':'');
  }
  function nextJourneyLevel(chapterId) {
    return LumiJourney.recommendLevel(profile,chapterId);
  }
  function worldModal(chapterId) {
    $('modal-actions').replaceChildren();
    chapterId=Math.max(1,Math.min(5,Math.floor(Number(chapterId)||1)));
    const chapter=LumiStory.chapters[chapterId-1],state=LumiJourney.getRestoration(profile,chapterId);
    const all=LumiJourney.restorationSummary(profile),total=all.reduce((n,c)=>n+c.restored,0);
    $('modal').classList.add('world-modal');
    modalHeader('OUR SUNPATCH · '+total+' / 15','우리 손으로 밝힌 햇살밭','happy',null);
    $('modal-content').innerHTML=chapterTabs(chapterId,'data-world-tab')+worldVignette(chapterId)+
      '<div class="world-status"><span>'+icon('star')+'<b>'+state.stars+'</b> / 30 별</span><span>'+icon('leaf')+'<b>'+state.stamps+'</b> / 10 약속</span><span>'+icon('flower')+'<b>'+state.restored+'</b> / 3 장소</span></div>'+
      '<p class="world-intent">'+esc(chapter.goal)+'</p><p class="world-hint">이야기로 되찾은 장소를 별과 도장으로 더 풍성하게 꾸며요. 모은 별과 도장은 사라지지 않고, 조건을 채우면 꾸밈이 자동으로 완성돼요.</p>'+
      '<div class="restoration-projects">'+state.projects.map((p,i)=>'<article class="restoration-project '+p.state+'"><span class="restoration-number">'+(p.state==='restored'?icon('check'):String(i+1).padStart(2,'0'))+'</span><div class="restoration-project-body"><small>'+(p.state==='restored'?'우리의 꾸밈 완성':'함께 가꾸는 장소')+'</small><h3>'+esc(p.name)+'</h3><p>'+esc(p.state==='restored'?p.restoredText:p.description)+'</p><div class="restoration-requirements">'+p.requirements.map(r=>'<span class="'+(r.complete?'done':'')+'">'+icon(r.complete?'check':'lock')+esc(r.label)+' <b>'+r.current+' / '+r.target+'</b></span>').join('')+'</div><div class="restoration-track" role="progressbar" aria-label="'+esc(p.name)+' 복원" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(p.progress*100)+'"><span style="width:'+p.progress*100+'%"></span></div></div></article>').join('')+'</div>'+
      '<div class="world-note">'+icon('heart')+'이곳의 도장과 복원 풍경은 이 기기에 간직해요.</div>';
    $('modal-content').querySelectorAll('[data-world-tab]').forEach(n=>n.addEventListener('click',()=>worldModal(Number(n.dataset.worldTab))));
    const next=nextJourneyLevel(chapterId);
    modalButton(state.restored===3?'이 장의 추억 다시 만나기':profile.unlocked<(chapterId-1)*10+1?'지금 열린 길부터 함께하기':'햇살을 모으러 가기',()=>showModal('level',{id:next}),true);
    modalButton('이 지역의 일기',()=>showModal('journal',{chapter:chapterId}));
    modalButton('지금 퍼즐로 돌아가기',closeModal);
  }
  function journalModal(chapterId) {
    $('modal-actions').replaceChildren();
    chapterId=Math.max(1,Math.min(5,Math.floor(Number(chapterId)||1)));
    $('modal').classList.add('journal-modal');
    modalHeader('FIFTY LITTLE MEMORIES','빛씨앗 여행 일기','happy',null);
    $('modal-content').innerHTML=chapterTabs(chapterId,'data-journal-tab')+worldVignette(chapterId)+
      '<p class="journal-intro">걸어온 길은 이야기로, 지킨 약속은 작은 도장으로 남아요.</p><div class="journal-pages">'+LumiStory.stages.filter(s=>s.chapter===chapterId).map(s=>{
        const complete=profile.stars[s.level-1]>0,available=s.level<=profile.unlocked,stamp=Boolean(profile.journey?.stamps[s.level-1]);
        if(!available)return '<div class="journal-page locked"><span>'+String(s.level).padStart(2,'0')+'</span><strong>아직 펼치지 않은 하루</strong>'+icon('lock')+'</div>';
        return '<details class="journal-page" '+(s.level===level?'open':'')+'><summary><span>'+String(s.level).padStart(2,'0')+'</span><strong>'+esc(s.title)+'</strong><b>'+icon(stamp?'leaf':complete?'check':'book')+'</b></summary><div class="journal-page-body">'+stageStoryCard(s.level)+'<div class="journal-after"><small>'+(complete?'함께 지나온 뒤':'아직 이어 쓰는 중')+'</small><p>'+esc(complete?s.after:'이 단계를 클리어하면 다음 이야기가 기록돼요.')+'</p></div><button data-promise-level="'+s.level+'" class="journal-promise">'+icon(stamp?'check':'leaf')+esc(LumiJourney.taskForLevel(s.level).title)+(stamp?' · 도장 획득':' · 약속 보기')+'<span>→</span></button></div></details>';
      }).join('')+'</div>';
    $('modal-content').querySelectorAll('[data-journal-tab]').forEach(n=>n.addEventListener('click',()=>journalModal(Number(n.dataset.journalTab))));
    wireWorldLinks();modalButton('우리의 햇살밭 보기',()=>showModal('world',{chapter:chapterId}),true);modalButton('지금 모험으로 돌아가기',closeModal);
  }
  function worldGuideModal() {
    $('modal').classList.add('world-guide-modal');
    modalHeader('A SMALL WORLD, A SHARED HEART','햇살밭의 작은 약속들','happy',null);
    $('modal-content').innerHTML=worldVignette(1)+
      '<div class="world-rule-intro"><strong>'+esc(LumiStory.brand.tagline)+'</strong><p>'+esc(LumiStory.world.playerRole)+'</p></div><div class="world-glossary">'+LumiStory.glossary.map((g,i)=>'<details '+(i===0?'open':'')+'><summary><span>'+icon(i%2?'leaf':'spark')+'</span><strong>'+esc(g.term)+'</strong><b>+</b></summary><p>'+esc(g.meaning)+'</p><div>'+esc(g.play)+'</div></details>').join('')+'</div>';
    modalButton('친구들의 이야기 만나기',()=>showModal('album'),true);modalButton('지금 모험으로 돌아가기',closeModal);
  }
  function relationsModal(type) {
    const focus=Number.isInteger(type)&&type>=0&&type<6?type:null;
    const pairs=LumiStory.relations.filter(r=>focus===null||r.a===focus||r.b===focus);
    $('modal').classList.add('relations-modal');
    modalHeader('SIX FRIENDS, FIFTEEN CONNECTIONS',focus===null?'우리가 서로에게 주는 힘':LumiArt.names[focus]+'와 친구들','happy',null);
    $('modal-content').innerHTML='<p class="relations-intro">좋아하는 것도, 서툰 것도 서로 달라요.<br>함께 놀 때 새로운 이야기가 시작됩니다.</p><div class="relationship-list">'+pairs.map(r=>'<details class="relationship-pair"><summary><span class="relationship-portraits" aria-hidden="true">'+art(r.a,'happy')+art(r.b,'wink')+'</span><span><small>'+esc(LumiArt.names[r.a])+' × '+esc(LumiArt.names[r.b])+'</small><strong>'+esc(r.name)+'</strong></span><b>+</b></summary><div class="relationship-prose"><p>'+esc(r.tension)+'</p><p>'+esc(r.payoff)+'</p><div>'+[r.a,r.b].map(t=>'<button data-world-friend="'+t+'">'+esc(LumiArt.names[t])+' 만나기 →</button>').join('')+'</div></div></details>').join('')+'</div>';
    wireWorldLinks();modalButton('여섯 친구 도감',()=>showModal('album'),true);modalButton('지금 모험으로 돌아가기',closeModal);
  }
  function playCharacterLight(type,button) {
    audio.unlock();audio.playMatch?.(type,2,1);LumiMobile.feedback('light');
    const sprite=button.querySelector('.character-pop-art');
    button.getAnimations().forEach(a=>a.cancel());
    if(sprite&&!motion.matches){sprite.getAnimations().forEach(a=>a.cancel());sprite.animate([{transform:'scale(1)'},{transform:'scale(1.09,.91)',offset:.2},{transform:'translateY(-8px) scale(.96,1.05)',offset:.48},{transform:'scale(1.035,.98)',offset:.78},{transform:'scale(1)'}],{duration:620,easing:'cubic-bezier(.22,.8,.24,1)'}).finished.catch(()=>{});}
    const markers=[...button.querySelectorAll('.character-pop-light')];
    markers.forEach((n,i)=>{
      n.getAnimations().forEach(a=>a.cancel());
      const angle=(i/markers.length)*Math.PI*2,x=Math.cos(angle)*72,y=Math.sin(angle)*58;
      n.animate(motion.matches?[{opacity:0},{opacity:1,offset:.3},{opacity:0}]:[{opacity:0,transform:'translate(0,0) scale(.3)'},{opacity:1,transform:'translate('+x*.65+'px,'+y*.65+'px) scale(1.1)',offset:.4},{opacity:0,transform:'translate('+x+'px,'+y+'px) scale(.6) rotate(40deg)'}],{duration:motion.matches?250:620,delay:motion.matches?0:i*12,easing:'cubic-bezier(.18,.65,.25,1)'}).finished.catch(()=>{});
    });
  }
  function characterLightMarkup(type) {
    const c=LumiArt.characters[type];
    const motif=type===1?'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="4" ry="8" transform="rotate(24 12 12)" fill="currentColor" stroke="none"/></svg>':type===5?'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="10" cy="9" r="1.3" fill="currentColor" stroke="none"/></svg>':type===4?'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3A9 9 0 1 0 21 18 11 11 0 0 1 19 3Z" fill="currentColor" stroke="none"/></svg>':icon(['leaf','spark','heart','star','spark','flower'][type]);
    return '<button class="character-pop" id="character-pop" style="--produce-color:'+c.color+';--produce-light:'+c.lightColor+'" aria-label="'+esc(c.name)+'의 '+esc(['초록','주황','사과 빨강','토마토 다홍','노랑','크림빛'][type])+' 팡빛과 소리 느껴보기"><span class="character-pop-art">'+art(type,'happy')+'</span><span class="character-pop-lights" aria-hidden="true">'+Array.from({length:8},()=>'<span class="character-pop-light">'+motif+'</span>').join('')+'</span><span class="character-pop-caption">'+icon('spark')+'톡! '+esc(c.name)+'의 팡빛을 느껴봐요</span></button>';
  }
  function wireWorldLinks() {
    $('modal-content').querySelectorAll('[data-promise-level]').forEach(n=>n.addEventListener('click',()=>showModal('promise',{level:Number(n.dataset.promiseLevel)})));
    $('modal-content').querySelectorAll('[data-world-chapter]').forEach(n=>{if(n.tagName==='BUTTON')n.addEventListener('click',()=>showModal('world',{chapter:Number(n.dataset.worldChapter)}));});
    $('modal-content').querySelectorAll('[data-world-friend]').forEach(n=>n.addEventListener('click',()=>showModal('character',{type:Number(n.dataset.worldFriend)})));
  }
  function storybookModal() {
    $('modal').classList.add('storybook-modal');
    modalHeader('THE SUNPATCH CHRONICLES','햇살밭 이야기','happy',null);
    const restored=LumiStory.chapters.filter(c=>profile.stars[c.id*10-1]>0).length;
    $('modal-content').innerHTML=worldVignette(Math.ceil(level/10))+
      '<div class="world-intro"><strong>우리는 밭뭉치!</strong><p>과일과 채소에 빛씨앗이 깃들어 깨어난 친구들. 흩어진 빛씨앗을 찾아 함께 여행해요.</p><button id="story-prologue" class="story-inline-button">'+icon('book')+'처음 이야기 다시 읽기</button></div>'+
      '<div class="storybook-progress"><span>해바라기 등대의 빛</span><strong>'+restored+' / 5</strong><div><span style="width:'+restored*20+'%"></span></div></div>'+
      '<div class="world-hub-links"><button id="storybook-world">'+icon('leaf')+'<span><strong>우리의 햇살밭</strong><small>별과 도장으로 가꾸는 15곳</small></span><b>›</b></button><button id="storybook-journal">'+icon('book')+'<span><strong>빛씨앗 여행 일기</strong><small>50번의 만남, 50개의 작은 약속</small></span><b>›</b></button><button id="storybook-guide">'+icon('spark')+'<span><strong>햇살밭의 작은 약속들</strong><small>팡빛과 씨앗 거울은 무엇일까요?</small></span><b>›</b></button></div>'+
      '<div class="story-chapters">'+LumiStory.chapters.map(c=>{
        const available=profile.unlocked>=(c.id-1)*10+1,complete=profile.stars[c.id*10-1]>0;
        return '<article class="story-chapter '+(complete?'complete':'')+'"><span class="chapter-seal">'+(complete?icon('flower'):String(c.id).padStart(2,'0'))+'</span><div><small>STAGE '+((c.id-1)*10+1)+'–'+c.id*10+'</small><h3>'+esc(c.title)+'</h3><p>'+esc(c.summary)+'</p><div class="story-chapter-actions"><button data-story-opening="'+c.id+'" '+(available?'':'disabled')+'>'+icon(available?'book':'lock')+(available?'이야기 읽기':((c.id-1)*10+1)+'단계에서 열려요')+'</button>'+(complete?'<button data-story-ending="'+c.id+'">'+icon('spark')+'빛씨앗의 기억</button>':'')+'</div><span class="story-keepsake">'+icon(complete?'check':'lock')+esc(c.keepsake.name)+(complete?' · 간직한 추억':' · '+c.id*10+'단계 완료 시')+'</span></div></article>';
      }).join('')+'</div>';
    $('story-prologue').addEventListener('click',()=>showModal('story',{phase:'prologue'}));
    $('storybook-world').addEventListener('click',()=>showModal('world'));
    $('storybook-journal').addEventListener('click',()=>showModal('journal'));
    $('storybook-guide').addEventListener('click',()=>showModal('world-guide'));
    wireStoryLinks();modalButton('빛씨앗 찾으러 가기',closeModal,true);modalButton('밭뭉치 친구들',()=>showModal('album'));
  }
  function wireStoryLinks() {
    $('modal-content').querySelectorAll('[data-story-opening]').forEach(n=>n.addEventListener('click',()=>showModal('story',{chapter:Number(n.dataset.storyOpening),phase:'opening'})));
    $('modal-content').querySelectorAll('[data-story-ending]').forEach(n=>n.addEventListener('click',()=>showModal('story',{chapter:Number(n.dataset.storyEnding),phase:'ending'})));
  }
  function storyModal(data={}) {
    const prologue=data.phase==='prologue',chapter=LumiStory.chapters[Math.max(0,Math.min(4,(Number(data.chapter)||1)-1))];
    const ending=data.phase==='ending';
    if(!prologue && (profile.unlocked<(chapter.id-1)*10+1 || ending && !profile.stars[chapter.id*10-1])){storybookModal();return;}
    const page=prologue?LumiStory.prologue:ending?chapter.ending:chapter.opening;
    $('modal').classList.add('story-modal');
    modalHeader(prologue?LumiStory.prologue.eyebrow:'CHAPTER '+String(chapter.id).padStart(2,'0')+' · '+(ending?'OUR LITTLE KEEPSAKE':'A NEW LITTLE JOURNEY'),page.title,'happy',null);
    $('modal-content').innerHTML=worldVignette(prologue?1:chapter.id)+'<div class="story-prose">'+page.body.map(p=>'<p>'+esc(p)+'</p>').join('')+'</div>'+
      (prologue?'<div class="story-world-rule">'+icon('spark')+'<p>퍼즐 속 친구는 씨앗 거울에 비친 <strong>빛모습</strong>이에요. 셋이 만나면 각자의 색으로 <strong>팡빛</strong>을 나누고, 친구는 우리 곁에 남아요.</p></div>':ending?'<div class="keepsake-card">'+icon('flower')+'<div><small>우리의 추억을 간직했어요</small><strong>'+esc(chapter.keepsake.name)+'</strong><p>'+esc(chapter.keepsake.description)+'</p></div></div>':'<div class="story-mission"><span>이번 여행의 약속</span><strong>'+esc(chapter.goal)+'</strong></div>');
    if(prologue){profile.storySeen.prologue=true;}
    else profile.storySeen[ending?'endings':'openings'][chapter.id-1]=true;
    persist();
    const justFinished=ending && level===chapter.id*10 && game?.won;
    modalButton(prologue?LumiStory.prologue.cta:justFinished?(level<TOTAL?'다음 단계로 →':'햇살밭 지도 보기'):'지금 모험으로 돌아가기',()=>justFinished?(level<TOTAL?openGarden(level+1):showModal('map')):closeModal(),true);
    if(prologue&&!profile.storySeen.openings[0])modalButton('포포와 캐로의 첫 출발 읽기',()=>showModal('story',{chapter:1,phase:'opening'}));
    modalButton('이야기 모아보기',()=>showModal('storybook'));
  }
  function chapterResultCard() {
    const chapter=LumiStory.chapterForLevel(level);
    if(level%10!==0){
      const moment=chapter.milestones.find(m=>m.level===level);
      return moment?'<div class="chapter-moment">'+icon('book')+'<div><small>우리 여행의 한 장면</small><strong>'+esc(moment.title)+'</strong><p>'+esc(moment.text)+'</p></div></div>':'';
    }
    return '<button class="chapter-result" data-story-ending="'+chapter.id+'">'+icon('flower')+'<span><small>'+chapter.id+'장 · '+(level===TOTAL?'해바라기 등대를 밝혔어요':'빛씨앗을 찾았어요')+'</small><strong>'+esc(chapter.keepsake.name)+'</strong><span>'+esc(chapter.ending.title)+' →</span></span></button>';
  }
  function memoryMarkup(type,bond) {
    const character=LumiStory.characters[type];
    return '<section class="character-memories"><div class="memories-heading"><h3>둘만의 작은 기억</h3><span>'+bond.level+' / 5</span></div><p class="memory-note">한 번 가까워진 마음은, 어느 모드에서도 간직해요.</p>'+character.memories.map(m=>m.tier<=bond.level?'<details class="memory-entry" id="memory-'+type+'-'+m.tier+'" '+(m.tier===bond.level?'open':'')+'><summary><span>Lv.'+m.tier+'</span><strong>'+esc(m.title)+'</strong>'+icon('heart')+'</summary><p>'+esc(m.text)+'</p></details>':'<div class="memory-entry locked"><span>Lv.'+m.tier+'</span>'+icon('lock')+'<span>친해지면 꺼내 줄 이야기</span></div>').join('')+'</section>';
  }
  function mapModal(chapterId=Math.ceil(level/10)) {
    $('modal-actions').replaceChildren();
    chapterId=Math.max(1,Math.min(5,chapterId));
    const chapter=LumiLevels.chapters[chapterId-1];
    $('modal').classList.add('wide','garden-map');modalHeader('FIFTY LITTLE ADVENTURES','빛씨앗을 찾아, 50단계','happy',null);
    $('modal-content').innerHTML='<div class="chapter-tabs" role="tablist" aria-label="정원 챕터">'+LumiLevels.chapters.map(c=>'<button role="tab" aria-selected="'+(c.id===chapterId)+'" data-chapter="'+c.id+'" aria-label="'+c.id+'장 '+esc(c.title)+'"><span>'+String(c.id).padStart(2,'0')+'</span><small>'+((c.id-1)*10+1)+'–'+(c.id*10)+'</small></button>').join('')+'</div>'+
      '<div class="chapter-intro" style="--chapter-color:'+chapter.color+'"><span>CHAPTER '+String(chapterId).padStart(2,'0')+'</span><h3>'+esc(chapter.title)+'</h3><p>'+esc(chapter.subtitle)+'</p></div><div class="map-grid map-fifty">'+LumiLevels.filter(d=>d.chapter===chapterId).map(def=>{
        const locked=def.id>profile.unlocked;
        return '<button class="map-level '+(def.id===level?'current':'')+' '+def.difficulty+'" data-level="'+def.id+'" '+(locked?'disabled':'')+' aria-label="'+def.id+'번 '+esc(def.title)+', '+(locked?'잠김':profile.stars[def.id-1]+'별')+(profile.journey?.stamps[def.id-1]?', 햇살 도장 획득':'')+'"><strong>'+String(def.id).padStart(2,'0')+'</strong><span class="map-stars">'+(locked?icon('lock'):starMarkup(profile.stars[def.id-1]))+'</span>'+(profile.journey?.stamps[def.id-1]?'<span class="map-promise-stamp" aria-hidden="true">'+icon('leaf')+'</span>':'')+(def.difficulty!=='normal'?'<small>'+esc(def.difficultyLabel)+'</small>':'')+'</button>';
      }).join('')+'</div><div class="map-legend"><span>● 산책</span><span class="hard">● 도전</span><span class="expert">● 대모험</span></div><p class="save-note">별 '+profile.stars.reduce((a,b)=>a+b,0)+' / '+(TOTAL*3)+' · '+profile.stars.filter(n=>n>0).length+' / '+TOTAL+' 정원 완료</p>';
    $('modal-content').querySelectorAll('[data-chapter]').forEach(n=>n.addEventListener('click',()=>mapModal(Number(n.dataset.chapter))));
    $('modal-content').querySelectorAll('.map-level').forEach(n=>n.addEventListener('click',()=>{audio.play('button');showModal('level',{id:Number(n.dataset.level)});}));
    const lore=LumiStory.chapters[chapterId-1];
    const storyPanel=document.createElement('div');storyPanel.className='map-story';
    storyPanel.innerHTML='<span class="map-story-art">'+art(lore.spotlight[0],'happy')+'</span><div><small>햇살지기의 이번 약속</small><strong>'+esc(lore.goal)+'</strong><button data-story-opening="'+chapterId+'" '+(profile.unlocked<(chapterId-1)*10+1?'disabled':'')+'>'+icon('book')+'이 장의 이야기</button></div>';
    $('modal-content').querySelector('.chapter-intro').after(storyPanel);wireStoryLinks();
    const town=document.createElement('button');town.className='map-world-preview';
    const restored=LumiJourney.getRestoration(profile,chapterId);
    town.innerHTML=worldVignette(chapterId,false)+'<span><strong>우리가 바꾸는 '+esc(chapter.title)+'</strong><small>복원 '+restored.restored+' / 3 · 약속 '+restored.stamps+' / 10</small></span><b>›</b>';
    town.addEventListener('click',()=>showModal('world',{chapter:chapterId}));
    $('modal-content').querySelector('.chapter-intro').after(town);
    modalButton('햇살밭 이야기 모아보기',()=>showModal('storybook'));
    modalButton('지금 정원으로 돌아가기',closeModal,true);
  }
  function levelModal(id) {
    if(!Number.isInteger(id) || id<1 || id>profile.unlocked){showModal('map');return;}
    const def=LumiLevels[id-1];
    modalHeader('STAGE '+String(id).padStart(2,'0'),def.title,'happy',def.objectives[0].type);
    $('modal-content').innerHTML=stageStoryCard(id)+'<div class="level-preview-goals">'+
      def.objectives.map(g=>'<span>'+art(g.type)+g.target+'</span>').join('')+
      (def.buds.length?'<span>'+icon('flower')+def.buds.length+'</span>':'')+
      '</div><div class="level-info">이동 '+def.moves+'번 · 최고 기록 '+fmt(profile.bestScores[id-1])+'점</div>'+
      '<p class="level-strategy"><strong>'+esc(def.difficultyLabel)+' · '+('●'.repeat(def.rating||1))+'</strong><br>'+esc(def.recommendedSkill||def.intent||'세 친구의 만남을 찾아보세요.')+'</p>'+
      '<div class="result-stars">'+starMarkup(profile.stars[id-1])+'</div>'+promiseCard(id,id===level?journeyRun:null);
    if(id===level && !game.won && !game.over)modalButton('이어서 놀기',closeModal,true);
    else modalButton('이 정원에서 놀기',()=>openGarden(id),true);
    modalButton('햇살밭 지도로',()=>showModal('map'));
  }
  function albumModal() {
    $('modal').classList.add('album');modalHeader('MEET THE BATMUNGCHI','우리는 밭뭉치!','idle',null);
    $('modal-content').innerHTML='<p>햇살밭에서 태어난 과일·채소 친구들.<br>마음이 가까워질수록 작은 비밀을 들려줘요.</p><div class="album-grid">'+LumiArt.characters.map((c,i)=>{
      const xp=companionXp(i,false),bond=LumiRewards.bond(xp),benefit=LumiRewards.bond(companionXp(i));
      return '<button class="album-card '+(profile.selectedBuddy===i?'selected':'')+'" data-type="'+i+'" style="--friend-light:'+c.lightColor+'" aria-label="'+esc(c.name)+', '+esc(c.species)+', '+bond.label+'"><span class="album-art">'+art(i,i===profile.selectedBuddy?'happy':'idle')+'</span><strong>'+esc(c.name)+'</strong><small>'+esc(c.species)+' · '+c.en+'</small><span class="friend-bond">'+icon('heart')+'Lv.'+bond.level+' · '+fmt(xp)+' XP</span><span class="album-perk">'+(rankRun?'리그 Lv.'+benefit.level+' · ':'')+esc(benefit.level===1?'첫 만남':benefit.perkLabel)+'</span></button>';
    }).join('')+'</div>';
    $('modal-content').querySelectorAll('.album-card').forEach(n=>n.addEventListener('click',()=>{audio.play('select');showModal('character',{type:Number(n.dataset.type)});}));
    const relations=document.createElement('button');relations.className='world-text-link';relations.innerHTML=icon('heart')+'여섯 친구, 열다섯 가지 사이 <span>→</span>';relations.addEventListener('click',()=>showModal('relations'));$('modal-content').appendChild(relations);
    modalButton('정원으로 돌아가기',closeModal,true);
  }
  function characterModal(type) {
    const c=LumiArt.characters[type];if(!c){showModal('album');return;}
    const lore=LumiStory.characters[type];
    const total=companionXp(type),bond=LumiRewards.bond(total),local=companionXp(type,false),memoryBond={level:LumiProgress.memoryLevel(profile,type)};
    const verified=Boolean(rankRun && profile.verifiedBuddyPlayerId===ranking.getIdentity()?.id);
    $('modal').classList.add('character-modal');
    modalHeader(c.species+' · BATMUNGCHI',c.name,'happy',null);
    $('modal-content').innerHTML=characterLightMarkup(type)+
      '<span class="character-tag" style="--friend-light:'+c.lightColor+'">'+esc(c.tagline)+'</span>'+
      '<p>'+esc(lore.personality)+'</p><div class="character-story">'+esc(lore.story)+'</div>'+
      '<div class="character-traits">'+c.signature.split(',').map(t=>'<span>'+esc(t.trim())+'</span>').join('')+'</div>'+
      '<dl class="character-heart"><div><dt>작은 꿈</dt><dd>'+esc(lore.want)+'</dd></div><div><dt>아직 서툰 것</dt><dd>'+esc(lore.flaw)+'</dd></div><div><dt>친구에게 주는 힘</dt><dd>'+esc(lore.gift)+'</dd></div></dl>'+
      '<button class="character-relationship" id="relationship-friend"><span>'+art(lore.relationship.with,'happy')+'</span><span><small>'+esc(LumiArt.names[lore.relationship.with])+'와의 이야기</small>'+esc(lore.relationship.text)+'</span></button>'+
      '<div class="bond-meter"><div class="bond-head"><strong>'+icon('heart')+(verified?'리그 ':'')+'Lv.'+bond.level+' '+bond.label+'</strong><span>'+fmt(total)+(bond.next===null?'':' / '+bond.next)+'</span></div><div class="bond-track"><span style="width:'+bond.progress*100+'%"></span></div></div>'+
      '<p class="bond-description">'+(bond.next===null?'모든 응원 혜택이 열렸어요. 오래오래 함께해요!':'다음 선물까지 '+fmt(bond.next-total)+' XP · 팡빛 모으기 + 정원 클리어로 모아요.')+'</p>'+
      '<div class="perk-ladder">'+LumiRewards.BONDS.map((b,i)=>'<div class="perk-step '+(i<bond.level?'unlocked':'')+' '+(i===bond.level-1?'current':'')+'"><span class="perk-level">'+(i<bond.level?icon('check'):icon('lock'))+'Lv.'+(i+1)+'</span><div><strong>'+esc(b.perkLabel)+'</strong><p>'+esc(b.perkDescription)+'</p><small>'+(b.at?fmt(b.at)+' XP':'우리의 첫 만남')+'</small></div></div>').join('')+'</div>'+
      '<p class="perk-note">친구 혜택은 정원을 시작할 때 정해져요. 플레이 중 친구를 바꾸거나 레벨이 오르면 다음 정원부터 새 혜택이 적용돼요.'+(game?.scoringVersion===4?' 이번 판 응원과 클리어 XP는 '+esc(LumiArt.names[game.buddy.type])+'에게 전해요.':'')+'</p>'+
      '<p class="save-note">'+(verified?'리그 친밀도 '+fmt(total)+' XP · 연결된 정원 완성과 주간 선물로 모아요.':'친구 친밀도 '+fmt(total)+' XP · 기기와 리그에서 가장 가까워진 마음을 간직해요.')+(verified&&local>total?'<br>추억은 '+fmt(local)+' XP, Lv.'+memoryBond.level+'까지 그대로 열려 있어요.':'')+'</p>'+memoryMarkup(type,memoryBond);
    $('relationship-friend').addEventListener('click',()=>showModal('character',{type:lore.relationship.with}));
    $('character-pop').addEventListener('click',()=>playCharacterLight(type,$('character-pop')));
    const links=document.createElement('button');links.className='world-text-link';links.innerHTML=icon('heart')+esc(c.name)+'와 다섯 친구의 이야기 <span>→</span>';links.addEventListener('click',()=>showModal('relations',{type}));$('relationship-friend').after(links);
    modalButton(profile.selectedBuddy===type?'지금 함께하는 친구':'오늘은 '+c.name+'와 함께!',()=>{
      profile.selectedBuddy=type;weeklyRecipient=type;persist();sidebars();updateCompanion();closeModal();buddy('wink',c.tagline,'selected');audio.play('collect');
    },true);
    modalButton('다른 친구 만나보기',()=>showModal('album'));
  }
  function settingsModal() {
    modalHeader('MAKE YOURSELF AT HOME','내게 꼭 맞는 정원','wink',3);
    $('modal-content').innerHTML='<div class="settings-list">'+
      '<label class="setting-row"><span><strong>신나는 정원 음악</strong><small>Sunbeam Parade · 오리지널 16마디 루프</small></span><input class="switch" id="music-setting" type="checkbox" '+(settings.music?'checked':'')+' aria-label="배경 음악"></label>'+
      '<label class="setting-row"><span><strong>반짝반짝 효과음</strong><small>매치, 연쇄, 꽃피는 순간의 작은 소리</small></span><input class="switch" id="sfx-setting" type="checkbox" '+(settings.sfx?'checked':'')+' aria-label="효과음"></label>'+
      '<label class="setting-row"><span><strong>손끝의 작은 반짝임</strong><small>교환과 매치의 가벼운 진동</small></span><input class="switch" id="haptics-setting" type="checkbox" '+(settings.haptics?'checked':'')+' aria-label="진동 피드백"></label>'+
      '<label class="volume-row"><input id="volume-setting" type="range" min="0" max="100" step="1" value="'+Math.round(settings.volume*100)+'" aria-label="전체 음량"><output id="volume-value">'+Math.round(settings.volume*100)+'%</output></label></div>'+
      '<div class="settings-stat"><div><small>최고 점수</small><strong>'+fmt(profile.bestScore)+'</strong></div><div><small>최고 연쇄</small><strong>×'+profile.maxCombo+'</strong></div></div>'+
      '<p class="save-note">정원과 친밀도는 이 브라우저에 자동 저장돼요.<br>기기의 동작 줄이기 설정을 따릅니다.</p>';
    $('music-setting').addEventListener('change',e=>{settings.music=e.target.checked;applyAudio();unlockAudio();persist();});
    $('sfx-setting').addEventListener('change',e=>{settings.sfx=e.target.checked;applyAudio();unlockAudio();if(settings.sfx)audio.play('button');persist();});
    $('volume-setting').addEventListener('input',e=>{settings.volume=Number(e.target.value)/100;audio.setVolume(settings.volume);$('volume-value').textContent=e.target.value+'%';});
    $('volume-setting').addEventListener('change',persist);
    $('haptics-setting').addEventListener('change',e=>{settings.haptics=e.target.checked;LumiMobile.setHaptics(settings.haptics);LumiMobile.feedback();persist();});
    modalButton('이대로 좋아요',closeModal,true);
  }

  $('hint-button').addEventListener('click',()=>showHint(true));
  $('coach-dismiss').addEventListener('click',()=>dismissSpecialCoach(true));
  $('score-help').addEventListener('click',()=>showModal('score-info'));
  $('companion-button').addEventListener('click',()=>showModal('character',{type:profile.selectedBuddy}));
  $('finish-next').addEventListener('click',()=>game.won?(level<TOTAL?openGarden(level+1):showModal('map')):openGarden(level));
  $('finish-retry').addEventListener('click',()=>openGarden(level));
  $('finish-map').addEventListener('click',()=>showModal('map'));
  $('finish-result').addEventListener('click',()=>showModal(game.won?'win':'lose'));
  $('shuffle-button').addEventListener('click',()=>{
    if(sessionInterrupted || busy || modalType || shuffles<1 || game.won || game.over || !sessionGuard.canWrite())return;
    const before=game.collected.slice();shuffles--;playResult(game.shuffle(),before,{kind:'shuffle'});
  });
  $('blast-button').addEventListener('click',()=>{
    if(sessionInterrupted || busy || modalType || blasts<1 || game.won || game.over || !sessionGuard.canWrite())return;
    clearHints();view.select(null);blastMode=!blastMode;controls();setHint();audio.play('select');
    if(blastMode)toast('어디에 꽃비를 내려볼까요?');else scheduleHint();
  });
  for(const id of ['ranking-button','header-ranking','rank-mode'])$(id).addEventListener('click',()=>showModal('ranking'));
  $('pause-button').addEventListener('click',()=>showModal(game.won?'win':game.over?'lose':'pause'));
  $('help-button').addEventListener('click',()=>showModal('help'));
  $('story-button').addEventListener('click',()=>showModal('storybook'));
  $('promise-button').addEventListener('click',()=>showModal('promise'));
  $('side-world-button').addEventListener('click',()=>showModal('world'));
  $('settings-button').addEventListener('click',()=>showModal('settings'));
  for(const id of ['brand-button','stars-button','stage-map-button','map-button'])$(id).addEventListener('click',()=>showModal('map'));
  for(const id of ['album-button','side-album-button'])$(id).addEventListener('click',()=>showModal('album'));
  $('friend-card').addEventListener('click',()=>{
    const lines=[LumiArt.characters[profile.selectedBuddy].tagline,'너랑 함께면 매일이 소풍 같아!','작은 행복도, 같이 모아보자.','잘하고 있어. 우리 천천히 가자!'];
    buddy('wink',lines[Math.floor(Math.random()*lines.length)],'greet');audio.play('select');
    pulse($('friend-card'));
  });
  $('sound-button').addEventListener('click',()=>{
    const enabled=settings.music || settings.sfx;settings.music=!enabled;settings.sfx=!enabled;
    applyAudio();unlockAudio();persist();if(!enabled)audio.play('button');
  });
  $('modal-close').addEventListener('click',closeModal);
  $('modal-backdrop').addEventListener('click',e=>{if(e.target===$('modal-backdrop'))closeModal();});
  document.addEventListener('keydown',e=>{
    if(!modalType)return;
    if(e.key==='Escape'){e.preventDefault();closeModal();}
    if(e.key==='Tab'){
      const focusable=[...$('modal').querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary')].filter(n=>!n.hidden&&n.getClientRects().length);
      const first=focusable[0],last=focusable.at(-1);
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  document.addEventListener('visibilitychange',()=>{
    if(sessionInterrupted){fx.setPaused(true);audio.suspend(true);return;}
    fx.setPaused(document.hidden || Boolean(modalType && modalType!=='win'));
    audio.suspend(document.hidden || modalType==='pause');
    if(document.hidden)clearHints();else scheduleHint();
  });
  window.addEventListener('pagehide',()=>{persist();sessionGuard.release();});
  window.addEventListener('lumi:back',()=>modalType?closeModal():showModal('pause'));
  window.addEventListener('lumi:app-state',e=>{if(sessionInterrupted){fx.setPaused(true);audio.suspend(true);return;}persist();audio.suspend(!e.detail.active||modalType==='pause');fx.setPaused(!e.detail.active||Boolean(modalType&&modalType!=='win'));if(!e.detail.active)clearHints();else{scheduleHint();retryRankings();}});
  window.addEventListener('online',retryRankings);
  retryRankings();
  await startGarden(initial.session?.level || profile.unlocked,initial.session);
})().catch(error=>{
  console.error('Chaeso Pang startup:',error);
  window.LumiSession?.current?.release();
  const notice=document.getElementById('session-notice');
  if(notice){
    document.getElementById('session-title').textContent='정원을 다시 불러와 주세요';
    document.getElementById('session-description').textContent='게임을 시작하는 중 연결이나 화면 준비를 마치지 못했어요. 저장된 기록을 다시 확인할게요.';
    document.querySelector('.app-shell').inert=true;
    document.getElementById('modal-backdrop').inert=true;
    notice.hidden=false;
  }
});
