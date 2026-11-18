/* =========================================================
   Home page interactions
   ========================================================= */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  function heroSpotlight() {
    const hero = document.querySelector('.hero');
    if (!hero || reduceMotion || !finePointer) return;
    const scene = hero.querySelector('.scene__inner');
    let frame = null;
    let point = null;

    hero.addEventListener('pointermove', (event) => {
      point = event;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (!point) return;
        const rect = hero.getBoundingClientRect();
        const x = ((point.clientX - rect.left) / rect.width) * 100;
        const y = ((point.clientY - rect.top) / rect.height) * 100;
        hero.style.setProperty('--hero-x', `${x.toFixed(1)}%`);
        hero.style.setProperty('--hero-y', `${y.toFixed(1)}%`);
        if (scene) {
          const dx = (0.5 - x / 100) * 14;
          const dy = (0.5 - y / 100) * 14;
          scene.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`;
        }
      });
    });

    hero.addEventListener('pointerleave', () => {
      if (scene) scene.style.transform = '';
    });
  }

  function boot() {
    heroSpotlight();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
