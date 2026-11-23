/* Native lifecycle and small tactile cues; the web version remains standalone. */
(function (root) {
  'use strict';
  let enabled = true, lastFeedback = 0;
  const cap = root.Capacitor;
  const native = Boolean(cap?.isNativePlatform?.());
  const plugin = name => native ? (cap?.Plugins?.[name] || cap?.registerPlugin?.(name) || null) : null;
  const Haptics = plugin('Haptics'), App = plugin('App'), Orientation = plugin('ScreenOrientation');
  const quiet = promise => Promise.resolve(promise).catch(() => {});
  const emit = (name, detail) => root.dispatchEvent(new CustomEvent(name, {detail}));

  if (native) {
    document.documentElement.classList.add('native-app');
    quiet(Orientation?.lock({orientation:'portrait'}));
    quiet(App?.addListener('appStateChange', state => emit('lumi:app-state', {active:state.isActive})));
    quiet(App?.addListener('backButton', () => emit('lumi:back')));
  }
  root.LumiMobile = {
    native,
    setHaptics(value) { enabled = Boolean(value); },
    feedback(kind='light') {
      if (!enabled || document.hidden) return;
      const now=performance.now();
      if (now-lastFeedback<75) return;
      lastFeedback=now;
      if (Haptics) {
        if (kind==='win') quiet(Haptics.notification({type:'SUCCESS'}));
        else quiet(Haptics.impact({style:kind==='special'?'MEDIUM':'LIGHT'}));
      } else if (navigator.vibrate && matchMedia('(pointer:coarse)').matches) {
        navigator.vibrate(kind==='win'?[10,40,18]:kind==='special'?12:7);
      }
    }
  };
  // Fit only the board. The mission/score/companion HUD keeps its full readable
  // width; short screens scroll rather than reducing six touch cells below
  // their intended size. Safe-area padding is already part of the shell.
  let fitFrame=0,fitObserver=null;
  function fit() {
    cancelAnimationFrame(fitFrame);
    fitFrame=requestAnimationFrame(()=>{
      fitFrame=0;
      const shell=document.querySelector('.app-shell'),game=document.querySelector('.game'),board=document.querySelector('.board-wrap');
      if(!shell||!game||!board)return;
      shell.style.removeProperty('--mobile-board-width');
      if(root.innerWidth>959){shell.style.removeProperty('--board-fit-size');return;}
      const css=getComputedStyle(shell),rect=game.getBoundingClientRect(),boardRect=board.getBoundingClientRect();
      const number=value=>Number.parseFloat(value)||0;
      const header=document.querySelector('.app-header')?.getBoundingClientRect().height||0;
      const footer=document.querySelector('.page-footer')?.getBoundingClientRect().height||0;
      const layout=document.querySelector('.game-layout'),layoutCss=layout?getComputedStyle(layout):null;
      const pads=number(css.paddingTop)+number(css.paddingBottom)+(layoutCss?number(layoutCss.paddingTop)+number(layoutCss.paddingBottom):0);
      const availableWidth=Math.min(420,game.clientWidth,shell.clientWidth-number(css.paddingLeft)-number(css.paddingRight));
      const viewportHeight=root.visualViewport?.height||root.innerHeight;
      const availableHeight=viewportHeight-header-footer-pads-(rect.height-boardRect.height)-8;
      const minimum=Math.min(308,availableWidth);
      const value=Math.floor(Math.max(minimum,Math.min(availableWidth,availableHeight)))+'px';
      if(shell.style.getPropertyValue('--board-fit-size')!==value)shell.style.setProperty('--board-fit-size',value);
    });
  }
  root.LumiMobile.fit=fit;
  root.addEventListener('resize',fit,{passive:true});
  root.visualViewport?.addEventListener('resize',fit,{passive:true});
  document.addEventListener('DOMContentLoaded',()=>{
    fit();requestAnimationFrame(fit);
    if(root.ResizeObserver){fitObserver=new root.ResizeObserver(fit);const game=document.querySelector('.game');if(game)fitObserver.observe(game);}
  });
})(window);
