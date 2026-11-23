/* LUMI GARDEN v4 — continuous, time-based board motion. No layout in the frame loop. */
(function (root) {
  'use strict';
  const same = (a,b) => !!(a && b && a.r === b.r && a.c === b.c);
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  const smooth = value => { const t=clamp(value,0,1); return t*t*(3-2*t); };
  const smoothest = value => { const t=clamp(value,0,1); return t*t*t*(t*(t*6-15)+10); };
  // A C2 envelope brings the last few subpixels to rest without a final-frame
  // snap. Retargeting before the tail still preserves the exact live velocity.
  const settle = (time,duration) => 1-smoothest((time-(duration-Math.min(90,duration*.28)))/Math.min(90,duration*.28));
  const lerp = (a,b,t) => a+(b-a)*t;
  const clock = () => root.performance?.now?.() ?? Date.now();
  const pose = (x=0,y=0,sx=1,sy=1,a=0,o=1) => ({x,y,sx,sy,a,o,vx:0,vy:0,vsx:0,vsy:0,va:0,vo:0});
  const channels=['x','y','sx','sy','a','o'];
  const velocityKeys=['vx','vy','vsx','vsy','va','vo'];
  const transform = state => `translate3d(${state.x.toFixed(3)}px,${state.y.toFixed(3)}px,0) rotate(${state.a.toFixed(3)}deg) scale(${state.sx.toFixed(4)},${state.sy.toFixed(4)})`;
  const TIMING=Object.freeze({swapGate:150,swapTail:330,invalidGate:165,invalidTail:360,popGate:168,popTail:238,landingGate:46,landingTail:236,dragTail:155,selectionTail:340});
  // Exact damped harmonic motion, expressed in pixels and milliseconds.
  function spring(from,to,velocity,t,omega=.027,zeta=.74) {
    const d=from-to;
    if(zeta>=1) return to+(d+(velocity+omega*d)*t)*Math.exp(-omega*t);
    const wd=omega*Math.sqrt(1-zeta*zeta),decay=Math.exp(-zeta*omega*t);
    return to+decay*(d*Math.cos(wd*t)+(velocity+zeta*omega*d)/wd*Math.sin(wd*t));
  }
  function springTrajectory(from,to,{duration=330,delay=0,omega=.027,zeta=.74,stretch=0}={}) {
    return elapsed=> {
      const t=clamp(elapsed-delay,0,duration);
      if(elapsed<delay) return {...from};
      if(t>=duration) return {...to};
      const result={...to};
      const tail=settle(t,duration);
      channels.forEach((key,i)=>result[key]=to[key]+(spring(from[key],to[key],from[velocityKeys[i]] || 0,t,omega,zeta)-to[key])*tail);
      if(stretch) { const e=Math.pow(Math.sin(Math.PI*clamp(t/150,0,1)),2)*stretch; result.sx+=e; result.sy-=e*.65; }
      return result;
    };
  }
  function fallTrajectory(from,to,{delay=0,tilt=0}={}) {
    const distance=Math.max(1,to.y-from.y),flight=clamp(Math.sqrt(2*distance/.0074),125,360);
    const v0=clamp(from.vy || 0,-.7,distance/flight*.45),gravity=2*(distance-v0*flight)/(flight*flight);
    const impact=v0+gravity*flight,stretch=clamp(impact*.055,.035,.125),energy=clamp(impact/1.8,.25,1);
    const duration=delay+flight+TIMING.landingTail;
    const sample=elapsed=> {
      const t=elapsed-delay;
      if(t<=0) return {...from};
      if(elapsed>=duration) return {...to};
      const x=spring(from.x,to.x,from.vx || 0,t,.034,.9);
      if(t<flight) {
        const u=t/flight,blend=smooth(u),sx=lerp(from.sx,1-stretch*.46,blend),sy=lerp(from.sy,1+stretch,blend);
        return {...to,x,y:from.y+v0*t+.5*gravity*t*t,sx,sy,a:lerp(from.a,tilt*Math.sin(Math.PI*u),blend),o:lerp(from.o,1,smooth(t/65))};
      }
      const land=t-flight;
      const tail=settle(land,TIMING.landingTail);
      const sy=1+(spring(1+stretch,1,-(.009+energy*.005),land,.043,.58)-1)*tail;
      return {...to,x:to.x+(x-to.x)*tail,y:to.y+spring(0,0,Math.min(.25,impact*.17),land,.041,.56)*tail,sx:1+(1-sy)*.46,sy,a:spring(0,0,tilt*.035,land,.035,.68)*tail,o:1};
    };
    return {sample,duration,gate:delay+flight+TIMING.landingGate,flight,impact};
  }
  function popTrajectory(from,{delay=0}={}) {
    return elapsed=> {
      const t=elapsed-delay;
      if(t<=0) return {...from};
      const driftX=(from.vx || 0)*t*Math.exp(-t/32),driftY=(from.vy || 0)*t*Math.exp(-t/28);
      let sx,sy,lift;
      if(t<48) { const u=smooth(t/48); sx=lerp(from.sx,1.12,u);sy=lerp(from.sy,.9,u);lift=2*u; }
      else if(t<88) { const u=smooth((t-48)/40);sx=lerp(1.12,1.19,u);sy=lerp(.9,1.17,u);lift=lerp(2,-3,u); }
      else { const u=clamp((t-88)/150,0,1),shrink=1-(1-u)*(1-u);sx=lerp(1.19,.025,shrink);sy=lerp(1.17,.045,shrink);lift=-3-9*smooth(u); }
      return {...from,x:from.x+driftX,y:from.y+driftY+lift,sx,sy,a:from.a+9*smooth(t/238),o:from.o*(1-smooth((t-94)/144))};
    };
  }
  const specialNames = { row:'가로 팡빛', col:'세로 팡빛', bomb:'씨앗 폭탄', rainbow:'무지개 팡빛' };
  let nextInstance = 0;

  class LumiBoard {
    constructor({board,tiles,budLayer,cells,wrap,fx,onChoose,onSwap,onInteract,onEscape,onCue}) {
      if (!board || !tiles || !cells) throw new TypeError('LumiBoard requires board, tiles, and cells elements.');
      this.board=board; this.tiles=tiles; this.budLayer=budLayer; this.cells=cells; this.wrap=wrap || board;
      this.fx=fx; this.onChoose=onChoose; this.onSwap=onSwap; this.onInteract=onInteract; this.onEscape=onEscape; this.onCue=onCue;
      this.nodes=new Map(); this.tileNodes=this.nodes; this.budNodes=new Map(); this.rowNodes=[];
      this.rows=6; this.cols=6; this.cellSize=52; this.step=56;
      this.chapter=1; this.restoredCount=0; this.chapterCleared=false; this._landmarkSignature="";
      this.selected=null; this.pointer=null; this.snapshot=null; this.disabled=false; this.blastMode=false;
      this._instance=++nextInstance; this._epoch=0; this._renderVersion=0;
      this._tracks=new Map(); this._animations=this._tracks; this._states=new Map(); this._retiring=new Set(); this._cues=new Set(); this._raf=0;
      this._focus={r:0,c:0}; this._suppressClickUntil=0; this._disposed=false;
      this.media=root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : {matches:false};
      this._buildGrid(); this._bindInput(); this.measure();
      this._onResize=() => this.measure();
      this._onMotion=() => { this._releasePointer('cancel'); this._finishAll(); this._snapNodes(); };
      if (root.ResizeObserver) { this.resizeObserver=new root.ResizeObserver(this._onResize); this.resizeObserver.observe(this.board); }
      root.addEventListener('resize',this._onResize,{passive:true});
      this.media.addEventListener?.('change',this._onMotion);
    }

    get reducedMotion() { return !!this.media.matches; }

    setChapter(chapter=1,restoredCount=0,chapterCleared=false) {
      const id=clamp(Math.floor(Number(chapter)||1),1,5),count=clamp(Math.floor(Number(restoredCount)||0),0,3);
      const signature=id+':'+count+':'+Boolean(chapterCleared);
      if(signature===this._landmarkSignature)return;
      this._landmarkSignature=signature;this.chapter=id;this.restoredCount=count;this.chapterCleared=Boolean(chapterCleared);
      this.board.dataset.chapter=String(id);this.wrap.dataset.chapter=String(id);
      if(document.body){document.body.dataset.chapter=String(id);document.body.dataset.worldRestored=String(count);}
      const world=document.querySelector?.('.world');
      if(world && root.LumiArt.landmark) {
        let landscape=world.querySelector('.chapter-landscape');
        if(!landscape){landscape=document.createElement('div');landscape.className='chapter-landscape';landscape.setAttribute('aria-hidden','true');world.appendChild(landscape);}
        landscape.innerHTML=root.LumiArt.landmark(id,count,`lb${this._instance}-world-${id}`,undefined,this.chapterCleared);
      }
      if(this.snapshot)this._renderBuds(this.snapshot);
    }

    _buildGrid() {
      this.cells.replaceChildren(); this.tiles.replaceChildren(); this.rowNodes=[];
      this.cells.setAttribute('aria-hidden','true');
      this.tiles.setAttribute('role','rowgroup');
      this.board.setAttribute('role','grid');
      this.board.tabIndex=-1;
      this.board.setAttribute('aria-rowcount',String(this.rows));
      this.board.setAttribute('aria-colcount',String(this.cols));
      const fragment=document.createDocumentFragment();
      for (let r=0;r<this.rows;r++) {
        const row=document.createElement('div');
        row.setAttribute('role','row'); row.setAttribute('aria-rowindex',String(r+1));
        row.style.display='contents'; row.dataset.row=String(r); this.rowNodes.push(row); this.tiles.appendChild(row);
        for(let c=0;c<this.cols;c++) {
          const cell=document.createElement('span'); cell.className='board-cell';
          cell.dataset.r=String(r); cell.dataset.c=String(c); fragment.appendChild(cell);
        }
      }
      this.cells.appendChild(fragment);
    }

    _inside(p) { return !!(p && Number.isInteger(p.r) && Number.isInteger(p.c) && p.r>=0 && p.r<this.rows && p.c>=0 && p.c<this.cols); }
    _position(r,c) { return {x:c*this.step,y:r*this.step}; }
    _nodeAt(p) { const tile=this._inside(p) && this.snapshot?.board[p.r]?.[p.c]; return tile ? this.nodes.get(tile.id) || null : null; }
    _targetPosition(target) {
      const node=target?.closest?.('.tile');
      if (!node || !this.tiles.contains(node)) return null;
      const p={r:Number(node.dataset.r),c:Number(node.dataset.c)};
      return this._inside(p) ? p : null;
    }
    center(r,c) {
      const rect=this.board.getBoundingClientRect();
      // Browser zoom and any parent scaling also apply to effects coordinates.
      const scale=this.board.clientWidth ? rect.width/this.board.clientWidth : 1;
      return {x:rect.left+(c*this.step+this.cellSize/2)*scale,y:rect.top+(r*this.step+this.cellSize/2)*scale};
    }

    measure() {
      if(this._disposed) return;
      const width=this.board.clientWidth;
      if(!width) return;
      const style=root.getComputedStyle(this.cells);
      const gap=parseFloat(style.columnGap || style.gap) || 0;
      const size=Math.max(1,(width-gap*(this.cols-1))/this.cols);
      const changed=Math.abs(size-this.cellSize)>.1 || Math.abs(size+gap-this.step)>.1;
      this.cellSize=size; this.step=size+gap;
      this.board.style.setProperty('--cell',`${size}px`);
      this.board.style.setProperty('--step',`${this.step}px`);
      if(changed) { this._releasePointer('hold'); this._finishAll(); this._snapNodes(); }
      this.fx?.resize?.();
    }

    _home(node) {
      const p=this._position(Number(node.dataset.r)||0,Number(node.dataset.c)||0);
      const selected=node.classList.contains('tile') && same(this.selected,{r:Number(node.dataset.r),c:Number(node.dataset.c)});
      return pose(p.x,p.y-(selected?3.5:0),selected?1.07:1,selected?1.07:1);
    }
    _snapNodes() {
      for(const node of this.nodes.values()) {
        this._write(node,this._home(node)); node.classList.remove('moving','dragging');
      }
      for(const node of this.budNodes.values()) this._write(node,this._home(node));
    }

    _write(node,state) {
      this._states.set(node,{...state});
      node.style.transform=transform(state);
      node.style.opacity=String(clamp(state.o,0,1));
    }
    _stateAt(node,time=clock()) {
      const track=this._tracks.get(node);
      if(!track) return {...(this._states.get(node) || this._home(node))};
      const t=clamp(time-track.start,0,track.duration),state={...track.sample(t)};
      const before=Math.max(0,t-.4),after=Math.min(track.duration,t+.4),dt=after-before;
      if(dt>0) {
        const a=track.sample(before),b=track.sample(after);
        channels.forEach((key,i)=>state[velocityKeys[i]]=(b[key]-a[key])/dt);
      }
      return state;
    }
    _stopTrack(node) {
      const track=this._tracks.get(node); if(!track) return;
      this._tracks.delete(node); track.resolve(); track.settledResolve();
    }
    _motion(node,build) {
      const start=clock(),from=this._stateAt(node,start); this._stopTrack(node);
      const spec=build(from),duration=Math.max(0,spec.duration || 0),final=spec.final || spec.sample(duration);
      if(this.reducedMotion || duration===0) { this._write(node,final); spec.finish?.(); return Promise.resolve(); }
      this._write(node,from); node.classList.add('moving');
      let resolve,settledResolve;
      const gatePromise=new Promise(done=>resolve=done),settled=new Promise(done=>settledResolve=done);
      this._tracks.set(node,{...spec,node,start,duration,final,gate:clamp(spec.gate ?? duration,0,duration),resolve,settledResolve,settled,gateResolved:false,epoch:this._epoch});
      this._ensureFrame(); return gatePromise;
    }
    _springNode(node,target,options={}) {
      const duration=options.duration || 330,delay=options.delay || 0;
      return this._motion(node,from=>({sample:springTrajectory(from,target,{...options,duration,delay}),duration:duration+delay,gate:(options.gate ?? duration)+delay,final:target,finish:options.finish}));
    }
    _ensureFrame() {
      if(this._raf || this._disposed) return;
      this._raf=root.requestAnimationFrame(time=>this._frame(time));
    }
    _frame(time) {
      this._raf=0;
      for(const cue of [...this._cues]) if(time>=cue.at) {
        this._cues.delete(cue);
        if(cue.epoch===this._epoch) { try {cue.run();}catch(error){root.console?.warn?.('Lumi visual cue skipped:',error);} }
      }
      for(const [node,track] of [...this._tracks]) {
        if(this._tracks.get(node)!==track) continue;
        const elapsed=clamp(time-track.start,0,track.duration);
        this._write(node,elapsed>=track.duration?track.final:track.sample(elapsed));
        if(!track.gateResolved && elapsed>=track.gate) { track.gateResolved=true; track.resolve(); }
        if(elapsed>=track.duration) {
          this._tracks.delete(node); track.resolve(); track.settledResolve(); node.classList.remove('moving');
          if(track.epoch===this._epoch) track.finish?.();
          if(this.nodes.get(node.dataset.id)===node && node.dataset.mood==='excited' && !node.classList.contains('selected'))this._mood(node,'idle');
        }
      }
      if(this._tracks.size || this._cues.size) this._ensureFrame();
    }
    _cue(delay,run) {
      if(this.reducedMotion) { run(); return; }
      this._cues.add({at:clock()+delay,run,epoch:this._epoch}); this._ensureFrame();
    }
    _finishAll() {
      if(this._raf) root.cancelAnimationFrame(this._raf); this._raf=0;
      for(const [node,track] of [...this._tracks]) {
        this._write(node,track.final); this._stopTrack(node); node.classList.remove('moving');
        if(track.epoch===this._epoch) track.finish?.();
      }
      this._cues.clear();
    }
    _forget(node) {
      this._stopTrack(node); this._states.delete(node); this._retiring.delete(node);
      if(this.nodes.get(node.dataset.id)===node) this.nodes.delete(node.dataset.id);
      node.remove();
    }
    async whenSettled() {
      const epoch=this._epoch;
      while(this._tracks.size && epoch===this._epoch) await Promise.all([...this._tracks.values()].map(track=>track.settled));
    }

    _paint(node,tile,mood='idle') {
      const prefix=`lb${this._instance}-g${this._epoch}-${tile.id}-${tile.special || 'normal'}`;
      let art=node.querySelector('.tile-art');
      if(!art) { art=document.createElement('span'); art.className='tile-art'; node.appendChild(art); }
      art.innerHTML=root.LumiArt.sprite(tile.type,`${prefix}-${mood}`,mood);
      node.querySelector('.tile-special')?.remove();
      if(tile.special) {
        const special=document.createElement('span'); special.className='tile-special';
        special.innerHTML=root.LumiArt.special(tile.special,`${prefix}-effect`); node.appendChild(special);
        node.style.setProperty('--special-color',({row:'#c68b22',col:'#258eaa',bomb:'#a05ed2',rainbow:'#ce6da5'})[tile.special]||'#c68b22');
      }
      node.dataset.type=String(tile.type); node.dataset.special=tile.special || ''; node.dataset.mood=mood;
      node.style.setProperty('--produce-color',root.LumiArt.colors[tile.type]);
      node.style.setProperty('--produce-light',root.LumiArt.characters[tile.type].lightColor);
      const hash=String(tile.id).split('').reduce((value,character)=>(value*31+character.charCodeAt(0))>>>0,0);
      node.style.setProperty('--delay',`${-(hash%29)*.19}s`);
    }

    _mood(node,mood) {
      if(!node || node.dataset.mood===mood) return;
      const art=node.querySelector('.tile-art');
      const p=`lb${this._instance}-g${this._epoch}-${node.dataset.id}-${node.dataset.special || 'normal'}-${mood}`;
      if(art) art.innerHTML=root.LumiArt.sprite(Number(node.dataset.type),p,mood);
      node.dataset.mood=mood;
    }

    _create(tile,r,c) {
      const node=document.createElement('button'); node.type='button'; node.className='tile';
      node.id=`lumi-board-${this._instance}-piece-${tile.id}`;
      node.dataset.id=tile.id; node.dataset.r=String(r); node.dataset.c=String(c);
      node.setAttribute('role','gridcell'); node.setAttribute('aria-selected','false');
      node.setAttribute('aria-disabled',String(this.disabled)); node.tabIndex=-1;
      this._paint(node,tile); this.tiles.appendChild(node); this.nodes.set(tile.id,node);
      return node;
    }

    _renderBuds(snapshot) {
      if(!this.budLayer) return;
      const keep=new Set();
      for(let r=0;r<this.rows;r++) for(let c=0;c<this.cols;c++) {
        const hp=Number(snapshot.buds?.[r]?.[c]) || 0;
        if(hp<=0) continue;
        const key=`${r}:${c}`; keep.add(key); let node=this.budNodes.get(key); const isNew=!node;
        if(!node) {
          node=document.createElement('div'); node.className='bud'; node.dataset.r=String(r); node.dataset.c=String(c);
          node.setAttribute('aria-hidden','true'); const label=document.createElement('span'); label.className='bud-count';
          node.appendChild(label); this.budLayer.appendChild(node); this.budNodes.set(key,node);
        }
        if(node.dataset.chapter!==String(this.chapter)) {
          let emblem=node.querySelector('.bud-emblem');
          if(!emblem){emblem=document.createElement('span');emblem.className='bud-emblem';node.appendChild(emblem);}
          emblem.innerHTML=root.LumiArt.bud?.(this.chapter,`lb${this._instance}-g${this._epoch}-bud-${r}-${c}`)||'';
          node.dataset.chapter=String(this.chapter);
        }
        node.classList.toggle('double',hp>1); node.dataset.hp=String(hp);
        node.firstElementChild.textContent=hp>1?'2':'';
        if(isNew || !this._tracks.has(node)) this._write(node,this._home(node));
      }
      for(const [key,node] of this.budNodes) if(!keep.has(key)) { this.budNodes.delete(key); if(!this._retiring.has(node)) this._forget(node); }
    }

    async render(snapshot,kind='static') {
      if(!snapshot?.board || this._disposed) return;
      const epoch=this._epoch,keep=new Set(),pending=[],newCounts=Array(this.cols).fill(0);
      this._renderVersion++; this.snapshot=snapshot;
      for(let c=0;c<this.cols;c++) for(let r=0;r<this.rows;r++) {
        const tile=snapshot.board[r]?.[c]; if(tile && !this.nodes.has(tile.id)) newCounts[c]++;
      }
      for(let r=0;r<this.rows;r++) for(let c=0;c<this.cols;c++) {
        const tile=snapshot.board[r]?.[c]; if(!tile) continue;
        keep.add(tile.id); let node=this.nodes.get(tile.id); const isNew=!node;
        const moved=isNew || Number(node.dataset.r)!==r || Number(node.dataset.c)!==c;
        if(!node) node=this._create(tile,r,c);
        else if(Number(node.dataset.type)!==tile.type || node.dataset.special!==(tile.special || '')) this._paint(node,tile);
        node.dataset.r=String(r); node.dataset.c=String(c);
        node.setAttribute('aria-rowindex',String(r+1)); node.setAttribute('aria-colindex',String(c+1));
        const bud=Number(snapshot.buds?.[r]?.[c]) || 0;
        node.setAttribute('aria-label',(r+1)+'행 '+(c+1)+'열, '+root.LumiArt.names[tile.type]+(tile.special?', '+(specialNames[tile.special] || tile.special):'')+(bud?', 꽃봉오리 '+bud+'겹, '+(root.LumiArt.chapterBuds?.[this.chapter-1]||'새싹 봉오리'):''));
        node.setAttribute('aria-disabled',String(this.disabled));
        node.tabIndex=same(this._focus,{r,c})?0:-1;
        const active=same(this.selected,{r,c});
        node.classList.toggle('selected',active); node.setAttribute('aria-selected',String(active));
        const target=this._home(node);
        if(isNew) {
          const start=kind==='entry'||kind==='fall'
            ? pose(target.x,(r-newCounts[c])*this.step-this.cellSize*.24,1,1,0,0)
            : {...target};
          this._write(node,start);
        }
        if(this.reducedMotion) {
          this._stopTrack(node); this._write(node,target); node.classList.remove('moving');
        } else if(kind==='static' && moved) {
          this._stopTrack(node); this._write(node,target);
        } else if((kind==='entry'||kind==='fall') && moved) {
          const delay=(isNew?Math.max(0,newCounts[c]-1-r)*11:0)+c*(kind==='entry'?5:3);
          pending.push(this._motion(node,from=> {
            const flight=fallTrajectory(from,target,{delay,tilt:(c%2?1:-1)*1.8});
            return {...flight,final:target};
          }));
        } else if(kind==='shuffle') {
          const middle=(this.board.clientWidth-this.cellSize)/2;
          pending.push(this._motion(node,from=> {
            const gathered=pose(middle+(c-2.5)*4,middle+(r-2.5)*3,.72,.72,c%2?7:-7,1);
            const spread=springTrajectory(gathered,target,{duration:390,omega:.025,zeta:.8});
            return {duration:540,gate:420,final:target,sample:t=> {
              if(t>=150) return spread(t-150);
              const u=smooth(t/150),s={...from};
              channels.forEach(key=>s[key]=lerp(from[key],gathered[key],u)); return s;
            }};
          }));
        } else if(moved) {
          pending.push(this._springNode(node,target,{
            duration:kind==='invalid'?TIMING.invalidTail:TIMING.swapTail,
            gate:kind==='invalid'?TIMING.invalidGate:TIMING.swapGate,
            omega:kind==='invalid'?.026:.028,zeta:.76,
            stretch:kind==='swap'?.045:0
          }));
        }
        // Unchanged pieces retain live landing and special-creation tails.
      }
      for(const [id,node] of [...this.nodes]) if(!keep.has(id)) {
        this.nodes.delete(id); if(!this._retiring.has(node)) this._forget(node);
      }
      this._renderBuds(snapshot);
      // ARIA ownership follows logical rows without moving live DOM elements.
      for(let r=0;r<this.rows;r++) this.rowNodes[r].setAttribute('aria-owns',
        snapshot.board[r].filter(Boolean).map(tile=>this.nodes.get(tile.id)?.id).filter(Boolean).join(' '));
      if(![...this.nodes.values()].some(node=>node.tabIndex===0)) {
        const first=this.nodes.values().next().value;
        if(first) { first.tabIndex=0; this._focus={r:Number(first.dataset.r),c:Number(first.dataset.c)}; }
      }
      await Promise.all(pending);
      if(epoch!==this._epoch) return;
    }

    async clear(event) {
      if(this._disposed) return;
      const epoch=this._epoch,pending=[],removed=event.cells || [],created=event.created || [],activated=event.activated || [];
      const scored=[...removed,...created],origin=scored[0] || {r:0,c:0}; let x=0,y=0;
      for(const p of scored) { const point=this.center(p.r,p.c); x+=point.x; y+=point.y; }
      for(const p of removed) {
        const node=this.nodes.get(p.tile.id);
        const delay=Math.min(36,Math.hypot(p.r-origin.r,p.c-origin.c)*7);
        this._cue(82+delay,()=> {
          const point=this.center(p.r,p.c);
          this.fx?.burst?.(point.x,point.y,root.LumiArt.colors[p.tile.type],Math.min(1.5,.72+(event.combo || 1)*.12),p.tile.type);
        });
        if(node) {
          // Keep the original SVG: rebuilding every matched face was a source
          // of parsing/rasterization stalls on larger clears.
          this.nodes.delete(p.tile.id); this._retiring.add(node); node.classList.add('retiring');
          if(document.activeElement===node)this.board.focus({preventScroll:true});
          node.tabIndex=-1;node.setAttribute('aria-hidden','true');
          pending.push(this._motion(node,from=>({
            sample:popTrajectory(from,{delay}),duration:TIMING.popTail+delay,gate:TIMING.popGate+delay,
            finish:()=>this._forget(node)
          })));
        }
      }
      for(const p of created) {
        const node=this.nodes.get(p.tile.id); if(!node) continue;
        this._paint(node,p.tile,'excited');
        this._motion(node,from=> {
          const home=this._home(node);
          const position=springTrajectory(from,home,{duration:420,omega:.026,zeta:.8});
          return {duration:420,gate:0,final:home,sample:t=> {
            const state=position(t);
            if(t<55) {
              const u=smooth(t/55); state.sx=lerp(from.sx,.88,u); state.sy=lerp(from.sy,.84,u);
            } else if(t<125) {
              const u=smooth((t-55)/70); state.sx=lerp(.88,1.18,u); state.sy=lerp(.84,1.18,u);
            } else {
              state.sx=spring(1.18,1,0,t-125,.034,.65); state.sy=state.sx;
            }
            return state;
          },finish:()=>this._mood(node,same(this.selected,p)?'wink':'idle')};
        });
        this._cue(115,()=> {
          const point=this.center(p.r,p.c);
          this.fx?.shockwave?.(point.x,point.y,root.LumiArt.colors[p.tile.type],{type:p.tile.type,rainbow:p.tile.special==='rainbow'});
        });
      }
      this._cue(82,()=> {
        this.onCue?.('impact',event);
        for(const p of activated) {
          const point=this.center(p.r,p.c);
          if(p.tile.special==='row'||p.tile.special==='col') this.fx?.beam?.(point.x,point.y,p.tile.special,root.LumiArt.colors[p.tile.type]);
          else this.fx?.shockwave?.(point.x,point.y,root.LumiArt.colors[p.tile.type],{type:p.tile.type,rainbow:p.tile.special==='rainbow'});
        }
        if(scored.length && event.scoreDelta) this.fx?.score?.(x/scored.length,y/scored.length-this.cellSize*.3,
          '+'+Math.round(event.scoreDelta).toLocaleString('ko-KR'),event.feverMultiplier>1?'#b46c9b':'#298d73');
      });
      for(const hit of event.budsHit || []) {
        const key=hit.r+':'+hit.c,node=this.budNodes.get(key);
        if(!node) continue;
        if(!hit.after) {
          this.budNodes.delete(key); this._retiring.add(node);
          this._motion(node,from=>({
            duration:230,gate:155,final:{...from,sx:1.18,sy:1.18,o:0},
            sample:t=>({...from,sx:1+.18*smooth(t/230),sy:1+.18*smooth(t/230),o:1-smooth((t-55)/175)}),
            finish:()=>this._forget(node)
          }));
        } else {
          this._cue(85,()=> {node.classList.remove('double');node.firstElementChild.textContent='';});
          this._motion(node,from=>({
            duration:265,gate:0,final:this._home(node),
            sample:t=>({...from,sx:1+.075*Math.exp(-t/110)*Math.sin(t/35),sy:1+.075*Math.exp(-t/110)*Math.sin(t/35),o:1})
          }));
        }
      }
      for(const p of event.bloomedCells || (event.budsHit || []).filter(hit=>!hit.after)) this._cue(95,()=> {
        const point=this.center(p.r,p.c),source=scored.find(cell=>cell.r===p.r&&cell.c===p.c);
        this.fx?.bloom?.(point.x,point.y,root.LumiArt.colors[source?.tile.type ?? 0]);
      });
      if((activated.length || event.combo>2) && !this.reducedMotion) this._cue(80,()=> {
        this._motion(this.wrap,from=>({duration:250,gate:0,final:pose(),sample:t=>({
          ...from,x:1.8*Math.exp(-t/65)*Math.sin(t/14),y:1.1*Math.exp(-t/60)*Math.sin(t/17),sx:1,sy:1,a:0,o:1
        })}));
      });
      await Promise.all(pending);
      if(epoch!==this._epoch || this._disposed) return;
      await this.render(event,'static');
      // Pop ghosts and new-special rebounds finish while gravity begins.
    }

    select(position) {
      this.selected=this._inside(position)?{r:position.r,c:position.c}:null;
      for(const node of this.nodes.values()) {
        const active=same(this.selected,{r:Number(node.dataset.r),c:Number(node.dataset.c)});
        const was=node.classList.contains('selected'); node.classList.toggle('selected',active); node.setAttribute('aria-selected',String(active));
        if(active!==was) {
          this._mood(node,active?'wink':'idle');
          this._springNode(node,this._home(node),{duration:TIMING.selectionTail,gate:190,omega:.029,zeta:.7});
        }
      }
    }
    clearHints() { for(const node of this.nodes.values()) node.classList.remove('is-hint'); }
    highlightSpecial(position) {
      this.clearSpecialHighlight();
      const node=this._nodeAt(position);
      if(!node || !node.dataset.special) return false;
      node.classList.add('special-spotlight');
      return true;
    }
    clearSpecialHighlight() {
      for(const node of [...this.nodes.values(),...this._retiring]) node.classList.remove('special-spotlight');
    }
    _previewBlast(position) {
      for(const node of this.nodes.values()) {
        const active=!!(this.blastMode && position && Math.abs(Number(node.dataset.r)-position.r)<=1 && Math.abs(Number(node.dataset.c)-position.c)<=1);
        node.classList.toggle('blast-preview',active);
      }
    }
    showHint(move) { this.clearHints(); if(!move || this.disabled) return; this.select(null); for(const p of [move.from,move.to]) this._nodeAt(p)?.classList.add('is-hint'); }
    setBlastMode(enabled) { this.blastMode=!!enabled; this.wrap.classList.toggle('blast-mode',this.blastMode); this._previewBlast(null); if(enabled) { this.select(null); this.clearHints(); } }
    setDisabled(disabled) {
      this.disabled=!!disabled; this.board.setAttribute('aria-busy',String(this.disabled));
      for(const node of this.nodes.values()) node.setAttribute('aria-disabled',String(this.disabled));
      if(this.disabled) { this._releasePointer('cancel'); this.clearHints(); }
    }
    focusedPosition() { return this.board.contains(document.activeElement)?this._targetPosition(document.activeElement):null; }
    focusAt(position) {
      const node=this._nodeAt(position); if(!node) return;
      this._focus={r:position.r,c:position.c};
      for(const item of this.nodes.values()) item.tabIndex=item===node?0:-1;
      node.focus({preventScroll:true});
    }

    _interact(position,kind) { this.clearHints(); this.clearSpecialHighlight(); this.onInteract?.(position,kind); }
    _swipeTarget(press,dx,dy) {
      const p={...press.start},axis=press.axis || (Math.abs(dx)>Math.abs(dy)?'x':'y');
      if(axis==='x') p.c+=Math.sign(dx); else p.r+=Math.sign(dy);
      return this._inside(p) && !same(p,press.start) ? p : null;
    }
    _clearSwapTarget() {
      for(const node of this.nodes.values()) node.classList.remove('swap-target');
    }
    _drag(press,dx,dy) {
      if(this.blastMode) return;
      const distance=Math.max(Math.abs(dx),Math.abs(dy));
      if(distance<3) return;
      const axis=Math.abs(dx)>Math.abs(dy)?'x':'y';
      if(!press.axis || distance<this.step*.18) press.axis=axis;
      const now=clock(),dt=Math.max(1,now-press.lastTime);
      if(Math.abs(dx-press.lastX)+Math.abs(dy-press.lastY)>.1) {
        press.vx=lerp(press.vx,(dx-press.lastX)/dt,.65);
        press.vy=lerp(press.vy,(dy-press.lastY)/dt,.65);
        press.lastTime=now;
      }
      press.lastX=dx;press.lastY=dy;
      const target=this._swipeTarget(press,dx,dy),neighbor=this._nodeAt(target);
      if(press.neighbor && press.neighbor!==neighbor) {
        press.neighbor.classList.remove('swap-target');
        this._springNode(press.neighbor,this._home(press.neighbor),{duration:290,omega:.032,zeta:.78});
      }
      press.neighbor=neighbor; press.target=target;
      const along=press.axis==='x'?dx:dy,sign=Math.sign(along),amount=Math.abs(along),limit=this.step;
      const travel=neighbor
        ? sign*(amount<=limit?amount:limit+limit*.14*(1-Math.exp(-(amount-limit)/(limit*.28))))
        : sign*limit*.22*(1-Math.exp(-amount/(limit*.22)));
      const cross=clamp((press.axis==='x'?dy:dx)*.12,-this.step*.1,this.step*.1);
      const base=this._position(press.start.r,press.start.c);
      const desired=pose(base.x+(press.axis==='x'?travel:cross),base.y+(press.axis==='y'?travel:cross)-3.5,1.055,1.055,
        press.axis==='x'?clamp(travel/this.step*2.2,-2.2,2.2):0);
      press.node.classList.add('dragging');
      this._springNode(press.node,desired,{duration:TIMING.dragTail,gate:110,omega:.105,zeta:1});
      if(neighbor) {
        neighbor.classList.add('swap-target');
        const p=clamp(Math.abs(travel)/this.step,0,1),home=this._position(target.r,target.c),shift=sign*this.step*p;
        const preview=pose(home.x-(press.axis==='x'?shift:0),home.y-(press.axis==='y'?shift:0)-(press.axis==='x'?Math.sin(Math.PI*p)*2.5:0),
          1-.035*Math.sin(Math.PI*p),1-.035*Math.sin(Math.PI*p),-sign*1.5*Math.sin(Math.PI*p));
        this._springNode(neighbor,preview,{duration:TIMING.dragTail,gate:110,omega:.095,zeta:1});
      }
    }
    _releasePointer(mode='cancel') {
      const press=this.pointer;this.pointer=null;
      if(!press) return null;
      this._previewBlast(null);
      press.node.classList.remove('dragging');press.neighbor?.classList.remove('swap-target');
      // Hold the exact live pose on commit. render('swap') retargets both
      // pieces, including their current velocity, without a home snap.
      if(mode==='cancel') for(const node of [press.node,press.neighbor].filter(Boolean))
        this._springNode(node,this._home(node),{duration:320,gate:170,omega:.028,zeta:.74});
      try {if(this.board.hasPointerCapture?.(press.id))this.board.releasePointerCapture(press.id);}catch{}
      return press;
    }
    _bindInput() {
      this._handlers={
        pointerdown:event=> {
          if(this.disabled || this.pointer || event.isPrimary===false || event.button!==0) return;
          const p=this._targetPosition(event.target);if(!p)return;
          event.preventDefault();this._interact(p,'pointer');if(this.disabled)return;
          if(this.blastMode)this._previewBlast(p);
          const node=this._nodeAt(p),now=clock(),rect=this.board.getBoundingClientRect();
          this.pointer={id:event.pointerId,start:p,x:event.clientX,y:event.clientY,node,axis:null,neighbor:null,
            scale:this.board.clientWidth?rect.width/this.board.clientWidth:1,lastX:0,lastY:0,lastTime:now,vx:0,vy:0};
          const home=this._position(p.r,p.c);
          if(!this.blastMode)this._springNode(node,pose(home.x,home.y-3.5,1.055,1.055),{duration:230,omega:.037,zeta:.78});
          if(event.pointerType==='mouse')this.focusAt(p);
          try{this.board.setPointerCapture(event.pointerId);}catch{}
        },
        pointermove:event=> {
          const press=this.pointer;if(!press || press.id!==event.pointerId)return;
          if(this.disabled){this._releasePointer('cancel');return;}
          this._drag(press,(event.clientX-press.x)/press.scale,(event.clientY-press.y)/press.scale);
        },
        pointerup:event=> {
          const press=this.pointer;if(!press || press.id!==event.pointerId)return;
          const dx=(event.clientX-press.x)/press.scale,dy=(event.clientY-press.y)/press.scale;
          this._drag(press,dx,dy);
          const distance=Math.max(Math.abs(dx),Math.abs(dy));
          const flick=Math.max(Math.abs(press.vx),Math.abs(press.vy))>.55 && clock()-press.lastTime<80;
          const swipe=!this.blastMode && (distance>Math.max(12,this.cellSize*.24) || (distance>9 && flick));
          const target=swipe?this._swipeTarget(press,dx,dy):null;
          this._releasePointer(swipe && target?'hold':swipe?'cancel':'hold');
          this._suppressClickUntil=Date.now()+350;if(this.disabled)return;
          const version=this._renderVersion,epoch=this._epoch;
          if(swipe){if(target)this.onSwap?.(press.start,target);else this.select(null);}
          else this.onChoose?.(press.start);
          // A controller can decline a gesture. Return any preview smoothly,
          // but never compete with a swap already accepted by the controller.
          Promise.resolve().then(()=>{
            if(version!==this._renderVersion || epoch!==this._epoch || this._disposed)return;
            for(const node of [press.node,press.neighbor].filter(Boolean))if(this.nodes.get(node.dataset.id)===node)
              this._springNode(node,this._home(node),{duration:310,gate:165,omega:.029,zeta:.76});
          });
        },
        pointercancel:event=>{if(this.pointer?.id===event.pointerId)this._releasePointer('cancel');},
        lostpointercapture:event=>{if(this.pointer?.id===event.pointerId)this._releasePointer('cancel');},
        click:event=>{
          if(this.disabled || event.detail!==0 || Date.now()<this._suppressClickUntil)return;
          const p=this._targetPosition(event.target);if(!p)return;
          event.preventDefault();this._interact(p,'assistive');if(!this.disabled)this.onChoose?.(p);
        },
        keydown:event=>{
          const p=this._targetPosition(event.target);if(!p)return;
          const directions={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]};
          const activation=event.key==='Enter'||event.key===' '||event.key==='Spacebar';
          if(!directions[event.key]&&!activation&&event.key!=='Escape')return;
          event.preventDefault();if(this.disabled)return;
          if(activation){
            this._suppressClickUntil=Date.now()+500;if(event.repeat)return;
            this._interact(p,'keyboard');if(!this.disabled)this.onChoose?.(p);return;
          }
          this._interact(p,'keyboard');if(this.disabled)return;
          if(event.key==='Escape'){this.select(null);this.setBlastMode(false);this.onEscape?.();return;}
          const [dr,dc]=directions[event.key],target={r:clamp(p.r+dr,0,this.rows-1),c:clamp(p.c+dc,0,this.cols-1)};
          if(event.shiftKey&&!this.blastMode){if(!same(p,target)&&!event.repeat)this.onSwap?.(p,target);}
          else this.focusAt(target);
        },
        keyup:event=>{
          if(event.key==='Enter'||event.key===' '||event.key==='Spacebar'){event.preventDefault();this._suppressClickUntil=Date.now()+150;}
        },
        focusin:event=>{
          const p=this._targetPosition(event.target);if(!p)return;this._focus=p;
          for(const node of this.nodes.values())node.tabIndex=node===event.target?0:-1;
        }
      };
      for(const [name,handler]of Object.entries(this._handlers))this.board.addEventListener(name,handler);
    }

    reset() {
      this._epoch++; this._releasePointer('hold');
      if(this._raf)root.cancelAnimationFrame(this._raf);this._raf=0;
      for(const node of [...this._tracks.keys()])this._stopTrack(node);
      for(const node of this.nodes.values())node.remove();this.nodes.clear();
      for(const node of this.budNodes.values())node.remove();this.budNodes.clear();
      for(const node of this._retiring)node.remove();this._retiring.clear();
      this._states.clear();this._cues.clear();
      for(const row of this.rowNodes)row.setAttribute('aria-owns','');
      this.wrap.style.transform='';this.wrap.style.opacity='';
      this.selected=null; this.snapshot=null; this._focus={r:0,c:0}; this._suppressClickUntil=0;
      this.setBlastMode(false);
    }
    destroy() {
      this.reset(); this._disposed=true; this.resizeObserver?.disconnect();
      root.removeEventListener('resize',this._onResize); this.media.removeEventListener?.('change',this._onMotion);
      for(const [name,handler] of Object.entries(this._handlers)) this.board.removeEventListener(name,handler);
    }
  }
  LumiBoard.motion=Object.freeze({spring,springTrajectory,fallTrajectory,popTrajectory,pose,TIMING});
  root.LumiBoard=LumiBoard;
  if(typeof module!=='undefined' && module.exports) module.exports=LumiBoard;
})(typeof window!=='undefined'?window:globalThis);
