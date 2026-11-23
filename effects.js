/* 채소팡 — produce-colored light, never pieces of the characters. */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const random = (a, b) => a + Math.random() * (b - a);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const FALLBACK_COLORS = ['#59B875', '#F3903D', '#DF4E60', '#F46B50', '#EDC83F', '#CCA476'];
  const colors = () => root.LumiArt?.colors?.length ? root.LumiArt.colors : FALLBACK_COLORS;
  const SIGNATURES = ['leaf', 'seed', 'heart', 'star', 'crescent', 'bubble'];
  // Every ingredient keeps its own hue, silhouette and physical rhythm.
  // Shape differences survive grayscale and red/coral similarity.
  const RECIPES = Object.freeze([
    {x:1.12,y:.72,lift:27,gravity:40,spin:1.4,life:1.08,ringX:1.12,ringY:.86},
    {x:.78,y:1.12,lift:32,gravity:92,spin:2.2,life:.87,ringX:.88,ringY:1.1},
    {x:1.05,y:.92,lift:21,gravity:55,spin:.7,life:1.04,ringX:1,ringY:1},
    {x:.94,y:1.08,lift:27,gravity:70,spin:2.9,life:.98,ringX:1,ringY:1},
    {x:1.2,y:.72,lift:22,gravity:44,spin:1.9,life:1.09,ringX:1.18,ringY:.78,curl:14},
    {x:.78,y:.73,lift:18,gravity:33,spin:.4,life:1.14,ringX:.95,ringY:.95}
  ].map(Object.freeze));
  const ink = color => {
    const hex = String(color || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return color || colors()[0];
    const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = d ? max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4 : 2.8;
    h = (h * 60 + 360) % 360;
    const l = (max + min) / 2, s = d ? d / (1 - Math.abs(2 * l - 1)) * 100 : 0;
    // Keep the source hue and its saturation identity: warm potato light must
    // not turn into the same saturated orange as carrot light.
    return `hsl(${h.toFixed(1)}, ${Math.min(94, s * 1.08).toFixed(1)}%, ${h > 38 && h < 75 ? 48 : 58}%)`;
  };
  const tint = (color, lightness) => color.replace(/([\d.]+)%\)$/, lightness + '%)');

  class LumiFX {
    constructor({ canvas, ambientCanvas, boardEl }) {
      this.canvas = canvas;
      this.ambientCanvas = ambientCanvas;
      this.boardEl = boardEl;
      this.ctx = canvas && canvas.getContext('2d');
      this.ambientCtx = ambientCanvas && ambientCanvas.getContext('2d');
      this.trailCanvas = document.createElement('canvas');
      this.trailCanvas.setAttribute('aria-hidden', 'true');
      this.trailCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:70;';
      document.body.appendChild(this.trailCanvas);
      this.trailCtx = this.trailCanvas.getContext('2d');
      this.particles = [];
      this.lights = [];
      this.feverActive = false;
      this.feverEmission = 0;
      this.destroyed = false;
      this.paused = false;
      this.raf = 0;
      this.lastTime = 0;
      this.ambientTime = 0;
      this.particleLimit = (root.innerWidth || 1000) < 720 ? 320 : 480;
      this._feverBounds = null;
      this.media = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
      this.reducedMotion = !!(this.media && this.media.matches);
      this._onMotion = event => {
        this.reducedMotion = event.matches;
        this.clear();
        this._clearAmbient();
        this._start();
      };
      this._onVisibility = () => {
        if (document.hidden) {
          root.cancelAnimationFrame(this.raf);
          this.raf = 0;
          this.lastTime = 0;
        } else this._start();
      };
      this._onResize = () => this.resize();
      this._onScroll = () => this._cacheFeverBounds();
      this._tick = time => this._frame(time);
      if (this.media && this.media.addEventListener) this.media.addEventListener('change', this._onMotion);
      document.addEventListener('visibilitychange', this._onVisibility);
      root.addEventListener('resize', this._onResize, { passive: true });
      root.addEventListener('scroll', this._onScroll, { passive: true, capture: true });
      this.resize();
      this._start();
    }

    resize() {
      this.dpr = Math.min(root.devicePixelRatio || 1, 2);
      if (this.canvas && this.ctx) {
        const rect = this.canvas.getBoundingClientRect();
        this.width = Math.max(1, rect.width);
        this.height = Math.max(1, rect.height);
        this.canvas.width = Math.ceil(this.width * this.dpr);
        this.canvas.height = Math.ceil(this.height * this.dpr);
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
      if (this.ambientCanvas && this.ambientCtx) {
        const rect = this.ambientCanvas.getBoundingClientRect();
        this.ambientWidth = Math.max(1, rect.width || root.innerWidth);
        this.ambientHeight = Math.max(1, rect.height || root.innerHeight);
        this.ambientCanvas.width = Math.ceil(this.ambientWidth * this.dpr);
        this.ambientCanvas.height = Math.ceil(this.ambientHeight * this.dpr);
        this.ambientCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
      if (this.trailCtx) {
        this.trailWidth = Math.max(1, root.innerWidth);
        this.trailHeight = Math.max(1, root.innerHeight);
        this.trailCanvas.width = Math.ceil(this.trailWidth * this.dpr);
        this.trailCanvas.height = Math.ceil(this.trailHeight * this.dpr);
        this.trailCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
      if (!this.lights.length) {
        const count = (root.innerWidth || 1000) < 600 ? 16 : 30;
        for (let i = 0; i < count; i++) this.lights.push({
          u: Math.random(), v: Math.random(), phase: random(0, TAU),
          speed: random(0.14, 0.33), size: random(0.65, 1.7),
          gold: Math.random() < 0.28,
        });
      }
      this.particleLimit = (root.innerWidth || 1000) < 720 ? 320 : 480;
      this._cacheFeverBounds();
      this._start();
    }

    _cacheFeverBounds() {
      if (!this.boardEl || !this.canvas) return;
      const b = this.boardEl.getBoundingClientRect(), c = this.canvas.getBoundingClientRect();
      this._feverBounds = { x: b.left - c.left, y: b.top - c.top, width: b.width, height: b.height };
    }

    _point(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    _add(particle) {
      this.particles.push(particle);
      const limit = this.reducedMotion ? 80 : this.particleLimit;
      // Preserve the legible score and collection feedback in large cascades.
      // Decorative fragments have a strict mobile budget and leave first.
      if (this.particles.length > limit) {
        const expendable = this.particles.findIndex(p => !['text','reward','collect','beam'].includes(p.kind));
        this.particles.splice(expendable < 0 ? 0 : expendable, 1);
      }
      this._start();
    }

    burst(clientX, clientY, color = colors()[0], power = 1, type) {
      if (!this.ctx || this.destroyed) return;
      const p = this._point(clientX, clientY);
      color = ink(color);
      const light = tint(color, 76), deep = tint(color, 45);
      const signature = SIGNATURES[type] || 'leaf', recipe = RECIPES[type] || RECIPES[0];
      power = clamp(Number(power) || 1, 0.4, 3);
      const count = this.reducedMotion ? 5 : Math.round(16 + power * 7);
      this._add({ kind: 'flash', ...p, color, life: 0.24, maxLife: 0.24, size: 22 * power });
      this._add({ kind: 'ring', ...p, color, life: 0.36, maxLife: 0.36,
        size: this.reducedMotion ? 10 : 18 * Math.sqrt(power), ringX:recipe.ringX,ringY:recipe.ringY });
      for (let i = 0; i < count; i++) {
        const angle = i / count * TAU + random(-0.22, 0.22);
        const speed = this.reducedMotion ? 10 : random(35, 120) * Math.sqrt(power);
        const life = random(0.4, 0.85)*recipe.life;
        this._add({
          kind: i % 3 === 0 ? signature : i % 2 === 0 ? 'spark' : 'diamond',
          ...p, vx: Math.cos(angle) * speed*recipe.x, vy: Math.sin(angle) * speed*recipe.y - recipe.lift,
          size: random(1.6, i % 3 === 0 ? 5.2 : 3.7),
          color: i % 4 === 0 ? light : i % 7 === 0 ? deep : color,
          rotation: angle, spin: random(-1, 1)*recipe.spin, life, maxLife: life,
          curl:this.reducedMotion?0:recipe.curl||0,
          gravity: this.reducedMotion ? 0 : recipe.gravity,
        });
      }
    }

    beam(clientX, clientY, axis = 'row', color = colors()[0]) {
      if (!this.ctx || this.destroyed) return;
      const p = this._point(clientX, clientY);
      color = ink(color);
      const light = tint(color, 76);
      const b = this.boardEl ? this.boardEl.getBoundingClientRect() : this.canvas.getBoundingClientRect();
      const c = this.canvas.getBoundingClientRect();
      this._add({ kind: 'beam', ...p, axis, color,
        start: axis === 'col' ? b.top - c.top : b.left - c.left,
        end: axis === 'col' ? b.bottom - c.top : b.right - c.left,
        life: 0.44, maxLife: 0.44,
      });
      if (!this.reducedMotion) {
        for (let i = 0; i < 12; i++) {
          const t = i / 11;
          const x = axis === 'col' ? clientX : b.left + t * b.width;
          const y = axis === 'col' ? b.top + t * b.height : clientY;
          const q = this._point(x, y);
          this._add({ kind: 'diamond', ...q, vx: random(-10, 10), vy: random(-45, -12),
            size: random(2, 4), color: i % 3 === 0 ? light : color, rotation: random(0, TAU), spin: 2,
            life: 0.55, maxLife: 0.55, gravity: 20 });
        }
      }
    }

    shockwave(clientX, clientY, color = colors()[0], options) {
      if (!this.ctx || this.destroyed) return;
      const p = this._point(clientX, clientY);
      color = ink(color);
      this._add({ kind: 'ring', ...p, color, life: 0.6, maxLife: 0.6,
        size: this.reducedMotion ? 25 : 105 });
      if (!this.reducedMotion) this._add({ kind: 'ring', ...p, color: tint(color, 76),
        life: 0.44, maxLife: 0.44, size: 72 });
      this.burst(clientX, clientY, color, 1.8, options?.type);
      // A spectrum belongs to an explicitly activated rainbow special. A
      // regular carrot, apple, banana, line, or bomb never borrows its colors.
      if (options?.rainbow) {
        const palette = colors(), count = this.reducedMotion ? 6 : 24;
        for (let i = 0; i < count; i++) {
          const angle = i / count * TAU, speed = this.reducedMotion ? 8 : random(100, 180);
          const life = this.reducedMotion ? .35 : random(.55, .9);
          this._add({ kind: 'diamond', ...p, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            color: ink(palette[i % palette.length]), size: this.reducedMotion ? 2 : random(3, 5),
            rotation: angle, spin: 1.5, gravity: 10, life, maxLife: life });
        }
      }
    }

    score(clientX, clientY, text, color = '#269878') {
      if (!this.ctx || this.destroyed) return;
      const p = this._point(clientX, clientY);
      this._add({ kind: 'text', ...p, text: String(text), color,
        life: 1.05, maxLife: 1.05, size: 21 });
    }

    trail(fromX, fromY, toX, toY, color = colors()[0], kind = 'star') {
      if (!this.trailCtx || this.destroyed) return;
      color = ink(color);
      const count = this.reducedMotion ? 1 : 3;
      for (let i = 0; i < count; i++) {
        const duration = this.reducedMotion ? 0.32 : 0.62 + i * 0.065;
        this._add({ kind: 'collect', visual: kind, x: fromX, y: fromY, toX, toY, color,
          controlX: (fromX + toX) / 2 + (i - 1) * 28,
          controlY: Math.min(fromY, toY) - 35 - i * 12,
          size: i === 0 ? 6 : 3.8, delay: i * 0.045, life: duration, maxLife: duration });
      }
    }

    bonus(fromX, fromY, toX, toY, amount = 0, color = '#d5a239') {
      if (!this.trailCtx || this.destroyed || ![fromX,fromY,toX,toY].every(Number.isFinite)) return;
      const count = this.reducedMotion ? 1 : 4;
      for (let i = 0; i < count; i++) {
        const duration = this.reducedMotion ? .32 : .78 + i * .06;
        this._add({ kind:'collect', visual:'star', x:fromX+(i-1.5)*4, y:fromY, toX,toY,color,
          controlX:(fromX+toX)/2+(i-1.5)*20, controlY:Math.min(fromY,toY)-28-i*7,
          size:i===0?7:4.8, delay:i*.055, life:duration, maxLife:duration });
      }
      if (Number.isFinite(amount) && amount > 0) this._add({kind:'reward',x:toX,y:toY,
        text:'+'+Math.round(amount).toLocaleString('ko-KR'),color,life:1.22,maxLife:1.22,size:15,
        delay:this.reducedMotion?0:.4});
    }

    companion(clientX, clientY, color = '#e887a7', intensity = 1) {
      if (!this.trailCtx || this.destroyed || ![clientX,clientY].every(Number.isFinite)) return;
      const power=clamp(Number(intensity)||1,1,3),count=this.reducedMotion?2:Math.round(3+power*2);
      for(let i=0;i<count;i++) {
        const angle=-Math.PI+(i+.5)/count*Math.PI;
        const speed=this.reducedMotion?4:random(15,35)*Math.sqrt(power),life=random(.65,1.05);
        this._add({kind:i%3===0?'heart':'star',layer:'ui',x:clientX,y:clientY,
          vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-10,gravity:-7,
          size:random(2.5,4.2),rotation:random(-.25,.25),spin:random(-.5,.5),color,
          life,maxLife:life});
      }
    }

    fever(enabled) {
      this.feverActive = !!enabled;
      this.feverEmission = 0;
      this._cacheFeverBounds();
      if (!this.feverActive && !this.particles.length && this.ctx) this.ctx.clearRect(0, 0, this.width, this.height);
      if (this.feverActive && this.reducedMotion) this._drawFever(0);
      this._start();
    }

    bloom(clientX, clientY, color = colors()[0]) {
      if (!this.ctx || this.destroyed) return;
      const p = this._point(clientX, clientY);
      color = ink(color);
      const light = tint(color, 76);
      this.shockwave(clientX, clientY, color);
      const count = this.reducedMotion ? 6 : 30;
      for (let i = 0; i < count; i++) {
        const angle = i / count * TAU;
        const speed = this.reducedMotion ? 7 : random(70, 190);
        const life = random(0.65, 1.2);
        this._add({ kind: i % 4 === 0 ? 'star' : 'leaf', ...p,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 35,
          size: random(3.5, 7.5), color: i % 3 === 0 ? light : color,
          rotation: angle, spin: random(-3, 3), gravity: this.reducedMotion ? 0 : 75,
          life, maxLife: life });
      }
    }

    worldRestore(chapter=1, clientX, clientY) {
      if (!this.ctx || this.destroyed) return;
      const id=clamp(Math.floor(Number(chapter)||1),1,5);
      const b=this.boardEl?this.boardEl.getBoundingClientRect():this.canvas.getBoundingClientRect();
      const x=Number.isFinite(clientX)?clientX:b.left+b.width*.5;
      const y=Number.isFinite(clientY)?clientY:b.top+b.height*.4;
      const p=this._point(x,y),palette=['#79b56d','#6cb2bd','#b493ce','#d5af61','#e6bc58'];
      const color=ink(palette[id-1]),count=this.reducedMotion?8:42;
      this._add({kind:'ring',...p,color,life:.75,maxLife:.75,size:this.reducedMotion?17:76});
      for(let i=0;i<count;i++) {
        const angle=i/count*TAU,life=this.reducedMotion?.45:random(.8,1.5);
        const speed=this.reducedMotion?7:random(35,100);
        this._add({kind:i%3===0?'seed':id===2?'bubble':id===3?'diamond':id===4?'crescent':'leaf',...p,
          vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-35,
          gravity:this.reducedMotion?0:22,rotation:angle,spin:random(-1,1),size:random(3,6),
          color:i%3===0?tint(color,80):color,life,maxLife:life});
      }
    }

    confetti() {
      if (!this.ctx || this.destroyed) return;
      const palette = colors();
      const b = this.boardEl ? this.boardEl.getBoundingClientRect() : this.canvas.getBoundingClientRect();
      const count = this.reducedMotion ? 12 : 115;
      for (let i = 0; i < count; i++) {
        const side = i % 2;
        const p = this._point(side ? b.right - b.width * 0.15 : b.left + b.width * 0.15,
          b.top + b.height * 0.68);
        const life = random(1.4, 2.8);
        const angle = side ? random(-2.4, -1.45) : random(-1.7, -0.7);
        const speed = this.reducedMotion ? 14 : random(160, 390);
        this._add({ kind: i % 5 === 0 ? 'diamond' : 'confetti', ...p,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          color: palette[i % palette.length], size: random(2.5, 5.5),
          rotation: random(0, TAU), spin: random(-8, 8), gravity: this.reducedMotion ? 0 : 180,
          life, maxLife: life });
      }
      this.shockwave(b.left + b.width / 2, b.top + b.height / 2, '#e5f8bd');
    }

    clear() {
      this.particles.length = 0;
      if (this.ctx) this.ctx.clearRect(0, 0, this.width, this.height);
      if (this.trailCtx) this.trailCtx.clearRect(0, 0, this.trailWidth, this.trailHeight);
    }

    _clearAmbient() {
      if (this.ambientCtx) this.ambientCtx.clearRect(0, 0, this.ambientWidth, this.ambientHeight);
    }

    setPaused(paused) {
      this.paused = !!paused;
      if (this.paused) {
        root.cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.lastTime = 0;
      } else this._start();
    }

    _start() {
      if (!this.raf && !this.destroyed && !this.paused && !document.hidden &&
          (this.particles.length || (!this.reducedMotion && (this.ambientCtx || this.feverActive)))) {
        this.raf = root.requestAnimationFrame(this._tick);
      }
    }

    _frame(time) {
      this.raf = 0;
      if (this.destroyed || this.paused || document.hidden) return;
      const dt = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.04) : 0.016;
      this.lastTime = time;
      if (this.ctx) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);
        if (this.trailCtx) this.trailCtx.clearRect(0, 0, this.trailWidth, this.trailHeight);
        if (this.feverActive) {
          this._drawFever(time / 1000);
          this.feverEmission += dt;
          if (!this.reducedMotion && this._feverBounds && this.feverEmission > 0.09) {
            this.feverEmission = 0;
            const b = this._feverBounds;
            const pos = {x:Math.random()<.5?b.x-5:b.x+b.width+5,y:random(b.y,b.y+b.height)};
            const palette = colors();
            this._add({ kind: 'star', ...pos, vx: random(-12, 12), vy: random(-35, -15),
              size: random(2, 4.5), color: palette[Math.floor(Math.random() * palette.length)],
              rotation: 0, spin: random(-2, 2), gravity: -5, life: 0.85, maxLife: 0.85 });
          }
        }
        for (let i = this.particles.length - 1; i >= 0; i--) {
          const p = this.particles[i];
          p.life -= dt;
          if (p.life <= 0) { this.particles.splice(i, 1); continue; }
          if (p.vx !== undefined) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += (p.gravity || 0) * dt;
            if(p.curl)p.vx+=Math.sin((p.maxLife-p.life)*7)*p.curl*dt;
            p.vx *= Math.pow(p.kind === 'confetti' ? 0.985 : 0.96, dt * 60);
            p.rotation += (p.spin || 0) * dt;
          }
          if (p.kind === 'collect') this._drawCollection(p);
          else if (p.kind === 'reward') this._drawReward(p);
          else this._drawParticle(p.layer==='ui' && this.trailCtx ? this.trailCtx : ctx, p);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      if (!this.reducedMotion && this.ambientCtx && time - this.ambientTime > 32) {
        this.ambientTime = time;
        this._drawAmbient(time / 1000);
      }
      this._start();
    }

    _drawParticle(ctx, p) {
      const t = 1 - p.life / p.maxLife;
      const fade = Math.min(1, p.life / (p.maxLife * 0.42));
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.kind === 'beam') {
        const width = (1 - t) * 11;
        ctx.globalCompositeOperation = 'source-over';
        const vertical = p.axis === 'col';
        const coordinate = vertical ? p.x : p.y;
        const gradient = vertical ? ctx.createLinearGradient(coordinate - width * 2, 0, coordinate + width * 2, 0)
          : ctx.createLinearGradient(0, coordinate - width * 2, 0, coordinate + width * 2);
        gradient.addColorStop(0, 'transparent');
        gradient.addColorStop(0.35, p.color);
        gradient.addColorStop(0.5, '#fff');
        gradient.addColorStop(0.65, p.color);
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.globalAlpha = fade * 0.82;
        const reveal=this.reducedMotion?1:easeOut(clamp(t/.28,0,1));
        const origin=vertical?p.y:p.x;
        const start=origin+(p.start-origin)*reveal,end=origin+(p.end-origin)*reveal;
        if (vertical) ctx.fillRect(p.x - width * 2, start - 8, width * 4, end - start + 16);
        else ctx.fillRect(start - 8, p.y - width * 2, end - start + 16, width * 4);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(0.5, width * 0.22);
        ctx.beginPath();
        if (vertical) { ctx.moveTo(p.x, start); ctx.lineTo(p.x, end); }
        else { ctx.moveTo(start, p.y); ctx.lineTo(end, p.y); }
        ctx.stroke();
        if(!this.reducedMotion && reveal<1) for(const edge of [start,end]) {
          ctx.save();ctx.translate(vertical?p.x:edge,vertical?edge:p.y);
          ctx.fillStyle='#fff';ctx.globalAlpha=1;this._starPath(ctx,4+(1-reveal)*5);ctx.fill();ctx.restore();
        }
      } else if (p.kind === 'ring') {
        ctx.globalCompositeOperation = 'source-over';
        const radius = 8 + easeOut(t) * p.size;
        ctx.globalAlpha = Math.pow(1 - t, 1.7) * 0.74;
        ctx.lineWidth = Math.max(0.7, (1 - t) * 3);
        ctx.beginPath();
        if(p.ringX || p.ringY)ctx.ellipse(p.x,p.y,radius*(p.ringX||1),radius*(p.ringY||1),0,0,TAU);
        else ctx.arc(p.x, p.y, radius, 0, TAU);
        ctx.stroke();
      } else if (p.kind === 'flash') {
        ctx.globalCompositeOperation = 'source-over';
        const radius = p.size * (0.45 + easeOut(t));
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        glow.addColorStop(0, '#fff'); glow.addColorStop(0.18, p.color); glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow; ctx.globalAlpha = (1 - t) * 0.42;
        ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
      } else if (p.kind === 'text') {
        const scale = t < 0.15 ? 0.7 + easeOut(t / 0.15) * 0.3 : 1;
        const lift = this.reducedMotion ? 0 : easeOut(t) * 36;
        ctx.translate(p.x, p.y - lift); ctx.scale(scale, scale);
        ctx.font = '700 ' + p.size + 'px "Avenir Next", "Segoe UI", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.95)';
        ctx.strokeText(p.text, 0, 0); ctx.fillText(p.text, 0, 0);
      } else {
        ctx.translate(p.x, p.y); ctx.rotate(p.rotation || 0);
        const s = p.size * (p.kind === 'bubble' ? 0.6 + t * 0.6 : 1 - t * 0.36);
        if (p.kind === 'diamond') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.beginPath(); ctx.moveTo(0, -s * 1.8); ctx.quadraticCurveTo(s * 0.25, -s * 0.25, s * 1.2, 0);
          ctx.quadraticCurveTo(s * 0.25, s * 0.25, 0, s * 1.8);
          ctx.quadraticCurveTo(-s * 0.25, s * 0.25, -s * 1.2, 0);
          ctx.quadraticCurveTo(-s * 0.25, -s * 0.25, 0, -s * 1.8); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.9; ctx.stroke();
        } else if (p.kind === 'star') {
          this._starPath(ctx, s * 1.35); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
        } else if (p.kind === 'heart') {
          ctx.beginPath();ctx.moveTo(0,s*1.2);
          ctx.bezierCurveTo(-s*2,-s*.15,-s*1.1,-s*1.65,0,-s*.65);
          ctx.bezierCurveTo(s*1.1,-s*1.65,s*2,-s*.15,0,s*1.2);ctx.fill();
          ctx.lineWidth=1;ctx.strokeStyle='#fff';ctx.stroke();
        } else if (p.kind === 'leaf') {
          ctx.beginPath(); ctx.moveTo(-s * 1.25, s * .7);
          ctx.bezierCurveTo(-s * 1.2, -s * 1.2, s * .5, -s * 1.7, s * 1.35, -s * .75);
          ctx.bezierCurveTo(s * 1.25, s * 1.1, -s * .3, s * 1.45, -s * 1.25, s * .7);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = .65; ctx.globalAlpha *= .7;
          ctx.beginPath(); ctx.moveTo(-s, s * .6); ctx.quadraticCurveTo(s * .2, s * .1, s, -s * .6); ctx.stroke();
        } else if (p.kind === 'seed') {
          ctx.beginPath(); ctx.moveTo(0, -s * 1.65);
          ctx.bezierCurveTo(s * 1.2, -s * .4, s * .85, s * 1.2, 0, s * 1.25);
          ctx.bezierCurveTo(-s * .85, s * 1.2, -s * 1.2, -s * .4, 0, -s * 1.65);
          ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = .65; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.globalAlpha *= .75;
          ctx.beginPath(); ctx.ellipse(-s * .17, -s * .05, s * .16, s * .48, -.25, 0, TAU); ctx.fill();
        } else if (p.kind === 'crescent') {
          ctx.beginPath(); ctx.moveTo(0, -s * 1.4);
          ctx.bezierCurveTo(s * 1.9, -s, s * 1.9, s, 0, s * 1.4);
          ctx.bezierCurveTo(s * .8, s * .4, s * .8, -s * .4, 0, -s * 1.4);
          ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = .65; ctx.stroke();
        } else if (p.kind === 'petal') {
          ctx.beginPath(); ctx.moveTo(0, -s * 1.6);
          ctx.bezierCurveTo(s * 1.65, -s * 0.4, s * 0.9, s * 1.2, 0, s * 1.2);
          ctx.bezierCurveTo(-s * 0.9, s * 1.2, -s * 1.65, -s * 0.4, 0, -s * 1.6);
          ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
        } else if (p.kind === 'bubble') {
          ctx.lineWidth = 1.7; ctx.globalAlpha *= 0.9;
          ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-s * 0.28, -s * 0.3, s * 0.22, 0, TAU); ctx.fill();
        } else if (p.kind === 'confetti') {
          ctx.scale(Math.cos(t * 9 + p.rotation) * 0.7 + 0.3, 1);
          ctx.beginPath();
          ctx.ellipse(0, 0, s * 0.58, s * 1.2, 0, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.75; ctx.stroke();
        } else {
          ctx.globalCompositeOperation = 'source-over';
          if (p.kind === 'spark' && !this.reducedMotion) {
            ctx.globalAlpha *= .6; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(.7, s * .8);
            ctx.beginPath(); ctx.moveTo(-s * (2.2 + t * 1.4), 0); ctx.lineTo(0, 0); ctx.stroke();
          }
          ctx.globalAlpha *= 0.3;
          ctx.beginPath(); ctx.arc(0, 0, s * 2.5, 0, TAU); ctx.fill();
          ctx.globalAlpha = fade;
          ctx.beginPath(); ctx.arc(0, 0, s * 0.65, 0, TAU); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(0, 0, s * 0.28, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    }

    _starPath(ctx, radius) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const r = i % 2 ? radius * 0.47 : radius;
        if (!i) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
    }

    _drawCollection(p) {
      const ctx = this.trailCtx;
      if (!ctx || p.maxLife - p.life < p.delay) return;
      const t = clamp((p.maxLife - p.life - p.delay) / (p.maxLife - p.delay), 0, 1);
      ctx.save();
      ctx.strokeStyle = p.color;
      ctx.fillStyle = p.color;
      if (this.reducedMotion) {
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.toX, p.toY, 8 + t * 8, 0, TAU); ctx.stroke();
      } else {
        const curve = u => {
          const k = u * u * (3 - 2 * u), a = 1 - k;
          return { x: a * a * p.x + 2 * a * k * p.controlX + k * k * p.toX,
            y: a * a * p.y + 2 * a * k * p.controlY + k * k * p.toY };
        };
        const head = curve(t);
        for (let i = 7; i > 0; i--) {
          const q = curve(Math.max(0, t - i * 0.022));
          ctx.globalAlpha = (1 - i / 8) * 0.35 * Math.min(1, (1 - t) * 10);
          ctx.beginPath(); ctx.arc(q.x, q.y, p.size * (1 - i / 10), 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = Math.min(1, (1 - t) * 8);
        ctx.translate(head.x, head.y); ctx.rotate(t * 3);
        if (p.visual === 'petal') { ctx.beginPath(); ctx.ellipse(0, 0, p.size * 0.6, p.size, 0, 0, TAU); }
        else this._starPath(ctx, p.size);
        ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.stroke();
      }
      ctx.restore();
    }

    _drawReward(p) {
      const ctx=this.trailCtx,age=p.maxLife-p.life;
      if(!ctx || age<p.delay)return;
      const t=clamp((age-p.delay)/(p.maxLife-p.delay),0,1);
      ctx.save();ctx.globalAlpha=Math.min(1,t*10,(1-t)*4);
      ctx.translate(p.x,p.y-(this.reducedMotion?0:24*easeOut(t)));
      const scale=this.reducedMotion?1:1+.12*Math.sin(Math.min(1,t*2)*Math.PI);
      ctx.scale(scale,scale);ctx.font='800 '+p.size+'px "Avenir Next", "Segoe UI", sans-serif';
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
      ctx.strokeStyle='#fffdf4';ctx.lineWidth=4;ctx.strokeText(p.text,0,0);
      ctx.fillStyle=p.color;ctx.fillText(p.text,0,0);ctx.restore();
    }

    _drawFever(time) {
      if (!this.ctx || !this.boardEl) return;
      const ctx = this.ctx, b = this._feverBounds, palette = colors();
      if(!b)return;
      const p = {x:b.x,y:b.y};
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const expansion = this.reducedMotion ? 3 + i * 4 : 3 + i * 4 + Math.sin(time * 2.7 + i) * 2;
        ctx.strokeStyle = palette[(i * 2 + 1) % palette.length];
        ctx.globalAlpha = 0.34 - i * 0.07;
        ctx.lineWidth = 4.8 - i;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(p.x - expansion, p.y - expansion, b.width + expansion * 2, b.height + expansion * 2, 24 + expansion);
        else ctx.rect(p.x - expansion, p.y - expansion, b.width + expansion * 2, b.height + expansion * 2);
        ctx.stroke();
      }
      // Quiet traveling glints make fever readable at the edges, without
      // whitening the board or introducing repeated full-screen flashes.
      const perimeter=2*(b.width+b.height),phase=this.reducedMotion?0:(time*72)%perimeter;
      for(let i=0;i<4;i++) {
        let d=(phase+i*perimeter/4)%perimeter,x,y;
        if(d<b.width){x=p.x+d;y=p.y-4;}
        else if((d-=b.width)<b.height){x=p.x+b.width+4;y=p.y+d;}
        else if((d-=b.height)<b.width){x=p.x+b.width-d;y=p.y+b.height+4;}
        else{x=p.x-4;y=p.y+b.height-(d-b.width);}
        ctx.save();ctx.translate(x,y);ctx.fillStyle='#ffdf83';ctx.strokeStyle='#fffdf3';
        ctx.globalAlpha=.82;ctx.lineWidth=1.3;this._starPath(ctx,4.5);ctx.fill();ctx.stroke();ctx.restore();
      }
      ctx.restore();
    }

    _drawAmbient(time) {
      const ctx = this.ambientCtx;
      const w = this.ambientWidth, h = this.ambientHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      for (const light of this.lights) {
        const x = light.u * w + Math.sin(time * light.speed + light.phase) * 24;
        const y = ((light.v * h - time * light.speed * 8) % (h + 30) + h + 30) % (h + 30) - 15;
        const alpha = 0.12 + (Math.sin(time * 1.15 + light.phase) + 1) * 0.15;
        const radius = light.size * 6;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, light.gold ? 'rgba(242,184,90,.7)' : 'rgba(82,194,165,.6)');
        glow.addColorStop(1, 'transparent');
        ctx.globalAlpha = alpha;
        ctx.fillStyle = glow;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        ctx.globalAlpha = alpha * 1.5;
        ctx.fillStyle = light.gold ? '#e6b150' : '#68bca6';
        ctx.beginPath(); ctx.arc(x, y, light.size * 0.55, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    destroy() {
      this.destroyed = true;
      root.cancelAnimationFrame(this.raf);
      root.removeEventListener('resize', this._onResize);
      root.removeEventListener('scroll', this._onScroll, true);
      document.removeEventListener('visibilitychange', this._onVisibility);
      if (this.media && this.media.removeEventListener) this.media.removeEventListener('change', this._onMotion);
      this.clear(); this._clearAmbient();
      if (this.trailCanvas && this.trailCanvas.parentNode) this.trailCanvas.parentNode.removeChild(this.trailCanvas);
    }
  }

  // "Sunbeam Parade": an original 16-bar, 4/4 miniature at 120 BPM.
  // Each lead event is [sixteenth-note position, MIDI note, sixteenth-note length].
  // A repeated E–G–A–G–E hook receives a new answer in each four-bar phrase.
  const MUSIC_CHORDS = [
    { bass: 48, notes: [60, 64, 67, 71] }, // Cmaj9
    { bass: 45, notes: [60, 64, 67, 71] }, // Am9
    { bass: 41, notes: [57, 60, 64, 67] }, // Fmaj9
    { bass: 43, notes: [59, 62, 64, 69] }, // G6/9
    { bass: 48, notes: [60, 64, 67, 71] },
    { bass: 40, notes: [59, 62, 64, 67] }, // Em7
    { bass: 38, notes: [57, 60, 62, 65] }, // Dm7
    { bass: 43, notes: [59, 62, 64, 69] },
    { bass: 45, notes: [60, 64, 67, 71] },
    { bass: 40, notes: [59, 62, 64, 67] },
    { bass: 41, notes: [57, 60, 64, 67] },
    { bass: 43, notes: [59, 62, 64, 69] },
    { bass: 48, notes: [60, 64, 67, 71] },
    { bass: 38, notes: [57, 60, 62, 65] },
    { bass: 43, notes: [59, 62, 65, 69] }, // G9 turnaround
    { bass: 48, notes: [60, 64, 67, 71] },
  ];
  const MUSIC_LEAD = [
    [[0,76,2],[3,79,1],[4,81,2],[7,79,1],[8,76,3],[12,74,1],[14,72,2]],
    [[0,76,2],[3,84,1],[4,83,2],[7,81,1],[8,79,2],[11,76,1],[14,72,2]],
    [[0,77,2],[3,81,1],[4,84,2],[7,81,1],[8,79,2],[11,77,1],[14,76,2]],
    [[0,74,2],[3,79,1],[4,83,2],[7,81,1],[8,79,4],[13,76,1],[14,74,1]],
    [[0,76,2],[3,79,1],[4,81,2],[7,79,1],[8,76,2],[11,79,1],[14,84,2]],
    [[0,83,2],[3,79,1],[4,78,2],[7,79,1],[8,76,3],[12,74,1],[14,71,2]],
    [[0,74,2],[3,77,1],[4,81,2],[7,84,1],[8,81,2],[11,77,1],[14,76,2]],
    [[0,74,2],[3,79,1],[4,81,1],[6,83,1],[8,79,4],[14,76,1],[15,79,1]],
    [[0,81,3],[4,84,2],[7,83,1],[8,81,2],[11,79,1],[14,76,2]],
    [[0,79,3],[4,83,2],[7,86,1],[8,83,2],[11,79,1],[14,76,2]],
    [[0,81,2],[3,84,1],[4,88,2],[7,86,1],[8,84,3],[12,81,1],[14,79,2]],
    [[0,83,2],[3,81,1],[4,79,2],[7,76,1],[8,74,4],[14,72,1],[15,74,1]],
    [[0,76,2],[3,79,1],[4,81,2],[7,79,1],[8,84,3],[12,83,1],[14,79,2]],
    [[0,81,2],[3,77,1],[4,74,2],[7,77,1],[8,81,2],[11,84,1],[14,86,2]],
    [[0,83,2],[3,81,1],[4,79,2],[7,77,1],[8,74,2],[11,71,1],[14,74,2]],
    [[0,76,2],[3,79,1],[4,84,4],[10,79,1],[12,76,2],[15,74,1]],
  ];
  const midiHz = note => 440 * Math.pow(2, (note - 69) / 12);

  class LumiAudio {
    constructor() {
      this.enabled = false;
      this.musicEnabled = true;
      this.sfxEnabled = true;
      this.volume = 0.7;
      this.musicVolume = 0.45;
      this.bpm = 120;
      this.paused = false;
      this.feverActive = false;
      this.context = null;
      this.master = null;
      this.voices = new Set();
      this._timer = null;
      this._step = 0;
      this._nextNoteTime = 0;
      this._musicStartTime = 0;
      this._musicStartStep = 0;
      this._duckUntil = 0;
      this._echoNodes = [];
      this._destroyed = false;
      this._onVisibility = () => {
        if (!this.context) return;
        if (document.hidden) {
          this._stopMusic(false); this._stopGroup('sfx');
          this.context.suspend().catch(() => {});
        } else if (this.enabled && !this.paused) this.unlock();
      };
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVisibility);
    }

    _visible() { return typeof document === 'undefined' || !document.hidden; }

    setEnabled(enabled) {
      this.enabled = !!enabled;
      if (this.enabled) this.unlock();
      else {
        this._stopMusic(false); this._stopGroup('sfx');
        this._ramp(this.master && this.master.gain, 0, 0.02);
      }
      return this.enabled;
    }

    setMusicEnabled(enabled) {
      this.musicEnabled = !!enabled;
      if (this.musicEnabled) this.unlock();
      else this._stopMusic(false);
      return this.musicEnabled;
    }

    setSfxEnabled(enabled) {
      this.sfxEnabled = !!enabled;
      if (!this.sfxEnabled) this._stopGroup('sfx');
      return this.sfxEnabled;
    }

    setVolume(value) {
      const n = Number(value);
      if (Number.isFinite(n)) this.volume = clamp(n, 0, 1);
      if (this.enabled) this._ramp(this.master && this.master.gain, this.volume, 0.025);
      return this.volume;
    }

    setFever(enabled) { this.feverActive = !!enabled; }

    _ramp(param, value, time = 0.025) {
      if (!param || !this.context) return;
      const now = this.context.currentTime;
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, time);
    }

    _createContext() {
      const AudioContext = root.AudioContext || root.webkitAudioContext;
      if (!AudioContext || this.context || this._destroyed) return;
      const ctx = this.context = new AudioContext();
      this.master = ctx.createGain(); this.master.gain.value = this.volume;
      this.musicBus = ctx.createGain(); this.musicBus.gain.value = 1;
      this.musicGain = ctx.createGain(); this.musicGain.gain.value = this.musicVolume;
      this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.8;
      this.musicBus.connect(this.musicGain); this.musicGain.connect(this.master); this.sfxBus.connect(this.master);
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 8200; filter.Q.value = 0.3;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -16; compressor.knee.value = 16;
      compressor.ratio.value = 5; compressor.attack.value = 0.005; compressor.release.value = 0.16;
      this.master.connect(filter); filter.connect(compressor); compressor.connect(ctx.destination);
      // One shared deterministic noise buffer supplies quiet hats, shaker and clap.
      this._noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this._noise.getChannelData(0);
      let seed = 91827;
      for (let i = 0; i < data.length; i++) { seed = (seed * 16807) % 2147483647; data[i] = seed / 1073741824 - 1; }
      ctx.onstatechange = () => {
        if (ctx.state === 'running') this._startMusic();
        else if (ctx.state === 'suspended') this._stopMusic(false);
      };
    }

    unlock() {
      if (!this.enabled || this.paused || !this._visible() || this._destroyed) return;
      try {
        this._createContext();
        if (!this.context) return;
        this._ramp(this.master.gain, this.volume, 0.025);
        if (this.context.state === 'running') this._startMusic();
        else if (this.context.state === 'suspended') this.context.resume().then(() => this._startMusic()).catch(() => {});
      } catch (_) { /* Sound is optional; a restricted audio device never interrupts play. */ }
    }

    _makeEcho() {
      if (this._echoNodes.length || !this.context) return;
      const delay = this.context.createDelay(1), feedback = this.context.createGain(), output = this.context.createGain();
      delay.delayTime.value = 60 / this.bpm * 0.375;
      feedback.gain.value = 0.13; output.gain.value = 0.11;
      this.musicBus.connect(delay); delay.connect(feedback); feedback.connect(delay);
      delay.connect(output); output.connect(this.musicGain);
      this._echoNodes = [delay, feedback, output];
    }

    _clearEcho() {
      if (this._echoNodes.length) {
        try { this.musicBus.disconnect(this._echoNodes[0]); } catch (_) {}
        for (const node of this._echoNodes) { try { node.disconnect(); } catch (_) {} }
        this._echoNodes.length = 0;
      }
    }

    _startMusic() {
      if (this._timer !== null || !this.context || this.context.state !== 'running' ||
          !this.enabled || !this.musicEnabled || this.paused || !this._visible() || this._destroyed) return;
      try {
        this._makeEcho();
        this._ramp(this.musicGain.gain, this.musicVolume, 0.04);
        this._duckUntil = 0;
        this._nextNoteTime = this.context.currentTime + 0.045;
        this._musicStartTime = this._nextNoteTime;
        this._musicStartStep = this._step;
        // The timer only fills the queue. Web Audio's monotonic clock plays every note.
        this._timer = root.setInterval(() => this._scheduler(), 25);
        this._scheduler();
      } catch (_) { this._stopMusic(false); }
    }

    _stopMusic(reset = false) {
      const hadTimer = this._timer !== null;
      if (hadTimer) root.clearInterval(this._timer);
      this._timer = null;
      if (reset) this._step = 0;
      else if (hadTimer && this.context) {
        const ticks = Math.max(0, Math.ceil((this.context.currentTime - this._musicStartTime) / (60 / this.bpm / 4)));
        this._step = (this._musicStartStep + ticks) % 256;
      }
      this._stopGroup('music');
      this._ramp(this.musicGain && this.musicGain.gain, 0, 0.015);
      this._clearEcho();
    }

    _scheduler() {
      if (!this.context || !this.enabled || !this.musicEnabled || this.paused || !this._visible()) return;
      const now = this.context.currentTime, tick = 60 / this.bpm / 4;
      // If a tab stalls, skip the old queue; never fire several missed bars at once.
      if (this._nextNoteTime < now - 0.15) {
        this._step = (this._step + Math.ceil((now - this._nextNoteTime) / tick)) % 256;
        this._nextNoteTime = now + 0.035;
        this._musicStartTime = this._nextNoteTime; this._musicStartStep = this._step;
      }
      let guard = 0;
      while (this._nextNoteTime < now + 0.115 && guard++ < 4) {
        this._scheduleStep(this._step, this._nextNoteTime);
        this._step = (this._step + 1) % 256;
        this._nextNoteTime += tick;
      }
    }

    _scheduleStep(step, when) {
      const bar = Math.floor(step / 16), s = step % 16, chord = MUSIC_CHORDS[bar];
      const tick = 60 / this.bpm / 4;
      const swing = s % 2 ? tick * 0.07 : 0;
      for (const [at, note, length] of MUSIC_LEAD[bar]) if (at === s) {
        this._pluck(note, when + swing, Math.min(0.58, length * tick + 0.12), 0.18, 'music', 'marimba', -0.07);
      }
      // Rounded root / octave / fifth bass makes the pulse bounce without a hard saw wave.
      if (s === 0) this._pluck(chord.bass, when, tick * 2.5, 0.19, 'music', 'bass');
      if (s === 6) this._pluck(chord.bass + 12, when, tick * 1.4, 0.105, 'music', 'bass');
      if (s === 8) this._pluck(chord.bass + 7, when, tick * 2.5, 0.145, 'music', 'bass');
      if (s === 14) this._pluck(chord.bass + 12, when, tick * 1.35, 0.1, 'music', 'bass');
      // Short, airy offbeat keys; alternate voicings keep the loop light.
      if ([2, 6, 10, 14].includes(s)) chord.notes.forEach((n, i) => {
        this._pluck(n, when + i * 0.008, tick * 1.7, 0.036, 'music', 'keys', 0.16);
      });
      if (s === 0 && bar % 4 === 0) chord.notes.slice(0, 3).forEach(n => this._pluck(n + 12, when, 1.2, 0.018, 'music', 'pad', -0.2));
      // Bell replies appear in the melodic gaps, rather than doubling every lead note.
      if ((bar % 2 === 1 && (s === 10 || s === 13)) || (this.feverActive && s === 15)) {
        const n = chord.notes[(s + bar) % chord.notes.length] + 24;
        this._pluck(n, when + swing, 0.42, this.feverActive ? 0.075 : 0.045, 'music', 'bell', 0.35);
      }
      if (s === 0 || s === 8 || (bar % 4 === 3 && s === 11) || (this.feverActive && s === 6)) this._drum('kick', when, s === 0 ? 1 : 0.76);
      if (s === 4 || s === 12) this._drum('clap', when + 0.006, 0.8);
      if (s % 2 === 0) this._drum('hat', when, s % 4 === 2 ? 0.65 : 0.32);
      if (s % 2 === 1 && (bar >= 4 || this.feverActive)) this._drum('shaker', when + swing, this.feverActive ? 0.55 : 0.28);
      if (this.feverActive && (s === 3 || s === 7 || s === 11 || s === 15)) this._drum('hat', when + swing, 0.32);
    }

    _track(source, gain, group, end, extra = []) {
      const record = { source, gain, group, extra };
      if (this.voices.size >= 160) {
        const oldest = this.voices.values().next().value;
        if (oldest) this._release(oldest);
      }
      this.voices.add(record);
      source.onended = () => {
        this.voices.delete(record);
        try { source.disconnect(); gain.disconnect(); extra.forEach(n => n.disconnect()); } catch (_) {}
      };
      source.stop(end);
    }

    _release(record) {
      if (!this.context) return;
      const now = this.context.currentTime;
      try {
        record.gain.gain.cancelScheduledValues(now);
        record.gain.gain.setTargetAtTime(0, now, 0.006);
        record.source.stop(now + 0.025);
      } catch (_) {}
      this.voices.delete(record);
    }

    _stopGroup(group) {
      for (const voice of Array.from(this.voices)) if (voice.group === group) this._release(voice);
    }

    _route(gain, group, pan = 0) {
      const destination = group === 'music' ? this.musicBus : this.sfxBus;
      if (pan && this.context.createStereoPanner) {
        const panner = this.context.createStereoPanner(); panner.pan.value = pan;
        gain.connect(panner); panner.connect(destination); return [panner];
      }
      gain.connect(destination); return [];
    }

    _pluck(note, start, duration, level, group = 'sfx', timbre = 'marimba', pan = 0) {
      this._tone(midiHz(note), start, duration, level, timbre, group, pan);
    }

    _tone(frequency, start, duration = 0.4, level = 0.1, timbre = 'marimba', group = 'sfx', pan = 0) {
      const ctx = this.context;
      if (!ctx || !this.master) return;
      if (timbre === true) timbre = 'keys';
      const partials = timbre === 'wood' ? [[1,1],[3,.08]] : timbre === 'felt' ? [[1,1],[2,.045]]
        : timbre === 'glass' ? [[1,1],[2,.16],[4,.035]] : timbre === 'drop' ? [[1,1],[2,.055]]
        : timbre === 'bass' ? [[1, 1], [2, 0.14]] : timbre === 'pad' ? [[1, 1], [2, 0.08]]
        : timbre === 'bell' ? [[1, 1], [2, 0.2], [3, 0.05]] : [[1, 1], [2, 0.16], [3, 0.025]];
      for (const [ratio, amplitude] of partials) {
        const oscillator = ctx.createOscillator(), gain = ctx.createGain();
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency * ratio*(timbre==='drop'?1.38:1), start);
        if(timbre==='drop')oscillator.frequency.exponentialRampToValueAtTime(frequency*ratio,start+.055);
        const attack = timbre === 'pad' ? 0.08 : timbre === 'felt' ? .012 : timbre === 'bass' ? 0.009 : 0.004;
        const tail = Math.max(attack + 0.02, duration / Math.sqrt(ratio));
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * amplitude), start + attack);
        if (timbre === 'pad') gain.gain.setValueAtTime(level * amplitude * 0.8, start + tail * 0.3);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + tail);
        oscillator.connect(gain);
        const extra = this._route(gain, group, pan);
        oscillator.start(start);
        this._track(oscillator, gain, group, start + tail + 0.02, extra);
      }
    }

    _drum(kind, start, velocity = 1) {
      const ctx = this.context;
      if (!ctx) return;
      const gain = ctx.createGain();
      if (kind === 'kick') {
        const source = ctx.createOscillator(); source.type = 'sine';
        source.frequency.setValueAtTime(125, start); source.frequency.exponentialRampToValueAtTime(47, start + 0.12);
        gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(0.3 * velocity, start + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.23);
        source.connect(gain); gain.connect(this.musicBus); source.start(start);
        this._track(source, gain, 'music', start + 0.25);
        return;
      }
      const source = ctx.createBufferSource(); source.buffer = this._noise;
      const filter = ctx.createBiquadFilter();
      filter.type = kind === 'clap' ? 'bandpass' : 'highpass';
      filter.frequency.value = kind === 'clap' ? 1700 : kind === 'hat' ? 7200 : 5100;
      filter.Q.value = kind === 'clap' ? 0.75 : 0.4;
      const duration = kind === 'clap' ? 0.115 : kind === 'hat' ? 0.045 : 0.055;
      const level = (kind === 'clap' ? 0.065 : kind === 'hat' ? 0.038 : 0.026) * velocity;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(level, start + 0.003);
      if (kind === 'clap') {
        gain.gain.exponentialRampToValueAtTime(level * 0.15, start + 0.012);
        gain.gain.linearRampToValueAtTime(level * 0.8, start + 0.018);
        gain.gain.exponentialRampToValueAtTime(level * 0.15, start + 0.028);
        gain.gain.linearRampToValueAtTime(level * 0.55, start + 0.033);
      }
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source.connect(filter); filter.connect(gain);
      const extra = this._route(gain, 'music', kind === 'shaker' ? 0.3 : kind === 'hat' ? -0.3 : 0);
      source.start(start, kind === 'clap' ? 0.32 : 0.08);
      this._track(source, gain, 'music', start + duration + 0.01, [filter, ...extra]);
    }

    _duck(duration = 1, amount = 0.3) {
      if (!this.musicGain || this._timer === null) return;
      const t = this.context.currentTime, end = Math.max(t + duration, this._duckUntil);
      this._duckUntil = end;
      const gain = this.musicGain.gain;
      gain.cancelScheduledValues(t); gain.setValueAtTime(gain.value, t);
      gain.linearRampToValueAtTime(this.musicVolume * amount, t + 0.035);
      gain.setValueAtTime(this.musicVolume * amount, Math.max(t + 0.04, end - 0.4));
      gain.linearRampToValueAtTime(this.musicVolume, end);
    }

    playMatch(type=0,combo=1,power=1) {
      if (!this.enabled || !this.sfxEnabled || this.paused || !this._visible()) return;
      this.unlock();
      if (!this.context || this.context.state === 'closed') return;
      try {
        const id=clamp(Math.floor(Number(type)||0),0,5);
        const step=clamp(Math.floor(Number(combo)||1)-1,0,5),scale=[0,2,4,7,9];
        const index=[0,2,4,1,3,0][id]+step;
        const note=(id===5?60:72)+scale[index%5]+Math.floor(index/5)*12;
        const t=this.context.currentTime+.012,level=.095*clamp(Number(power)||1,.65,1.35);
        const voices=[
          [[0,0,.28,1,'wood'],[7,.075,.22,.32,'felt']],
          [[0,0,.14,1,'wood'],[7,.052,.16,.52,'wood']],
          [[0,0,.46,.79,'glass'],[7,.085,.3,.35,'glass']],
          [[0,0,.2,1,'drop'],[7,.088,.18,.5,'drop']],
          [[0,0,.25,.92,'marimba'],[7,.063,.24,.65,'marimba'],[12,.14,.2,.25,'keys']],
          [[0,0,.35,1,'felt'],[7,.105,.27,.4,'wood']]
        ][id];
        voices.forEach(([pitch,offset,length,gain,timbre])=>this._pluck(note+pitch,t+offset,length,level*gain,'sfx',timbre));
      } catch (_) { /* Optional sound never gates a valid move. */ }
    }

    play(kind, combo = 1) {
      if (!this.enabled || !this.sfxEnabled || this.paused || !this._visible()) return;
      this.unlock();
      if (!this.context || this.context.state === 'closed') return;
      try {
        const t = this.context.currentTime + 0.012;
        const note = (midi, offset = 0, length = 0.3, level = 0.12, timbre = 'marimba') => this._pluck(midi, t + offset, length, level, 'sfx', timbre);
        switch (kind) {
          case 'button': case 'select': note(79, 0, 0.1, 0.065, 'keys'); break;
          case 'swap': note(72, 0, 0.13, 0.07, 'keys'); note(79, 0.05, 0.16, 0.06, 'keys'); break;
          case 'invalid': note(64, 0, 0.13, 0.07, 'keys'); note(62, 0.08, 0.18, 0.065, 'keys'); break;
          case 'match': {
            const step = clamp(Math.round(Number(combo) || 1) - 1, 0, 9), pentatonic = [0, 2, 4, 7, 9];
            const n = 72 + pentatonic[step % 5] + Math.floor(step / 5) * 12;
            note(n, 0, 0.38, 0.12); note(n + 7, 0.05, 0.25, 0.05, 'bell');
            break;
          }
          case 'collect': note(88, 0, 0.22, 0.05, 'bell'); note(91, 0.05, 0.24, 0.035, 'bell'); break;
          case 'special': [72,76,79,84,88].forEach((n,i) => note(n,i*0.04,0.4,0.085)); break;
          case 'bloom': [77,81,84,89,93].forEach((n,i) => note(n,i*0.055,0.5,0.08,'bell')); break;
          case 'hint': note(79,0,0.28,0.07,'bell'); note(84,0.1,0.35,0.06,'bell'); break;
          case 'shuffle': [84,79,76,72,76,79].forEach((n,i) => note(n,i*0.05,0.22,0.065,'keys')); break;
          case 'feverStart':
            this.setFever(true); this._duck(0.85,0.45);
            [72,76,79,81,84,88,91].forEach((n,i) => note(n,i*0.045,0.4,0.085)); break;
          case 'feverEnd': this.setFever(false); [84,79,76].forEach((n,i) => note(n,i*0.07,0.3,0.055,'bell')); break;
          case 'restore':
            this._duck(1.1,.4); [72,79,81,84,91].forEach((n,i)=>note(n,i*.085,.55,.075,i%2?'bell':'marimba')); break;
          case 'levelUp': case 'win':
            this._duck(1.85,0.22);
            [72,76,79,84,88,91].forEach((n,i) => note(n,i*0.095,0.65,0.11));
            [60,64,67].forEach(n => note(n,0.42,1.15,0.04,'pad'));
            note(96,0.74,0.8,0.035,'bell'); break;
          case 'lose': this._duck(1.2,0.5); [76,74,72].forEach((n,i) => note(n,i*0.15,0.5,0.075,'keys')); break;
        }
      } catch (_) { /* Gameplay does not depend on a working audio device. */ }
    }

    suspend(paused = true) {
      this.paused = !!paused;
      if (!this.context) return;
      if (this.paused) {
        this._stopMusic(false); this._stopGroup('sfx');
        this.context.suspend().catch(() => {});
      } else if (this.enabled) this.unlock();
    }

    destroy() {
      this._destroyed = true;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibility);
      this._stopMusic(true); this._stopGroup('sfx');
      if (this.context) { this.context.onstatechange = null; this.context.close().catch(() => {}); }
      this.context = null;
    }
  }

  root.LumiFX = LumiFX;
  root.LumiAudio = LumiAudio;
  if (typeof module !== 'undefined' && module.exports) module.exports = { LumiFX, LumiAudio };
})(typeof window !== 'undefined' ? window : globalThis);
