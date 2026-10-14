(() => {
  const root = document.querySelector('.collection-tour');
  if (!root) return;
  const track = root.querySelector('.tour-track');
  const slides = [...root.querySelectorAll('.tour-slide')];
  const dots = [...root.querySelectorAll('.tour-dot')];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;
  let playing = !motion.matches;
  let visible = false;
  let hovered = false;
  let focused = false;
  let timer;
  let scrollFrame;
  const schedule = () => {
    clearTimeout(timer);
    if (playing && visible && !hovered && !focused && !document.hidden) {
      timer = setTimeout(() => go(index + 1), 5000);
    }
  };
  function setPlaying(value) {
    playing = value;
    track.setAttribute('aria-live', playing ? 'off' : 'polite');
    schedule();
  }
  function update(next) {
    index = next;
    dots.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  }
  function go(next) {
    const target = (next + slides.length) % slides.length;
    track.scrollTo({left: target * track.clientWidth, behavior: motion.matches ? 'auto' : 'smooth'});
    update(target);
    schedule();
  }
  root.querySelector('.tour-controls').hidden = false;
  root.querySelector('.tour-arrows').hidden = false;
  root.querySelector('[data-tour-prev]').addEventListener('click', () => {setPlaying(false); go(index - 1);});
  root.querySelector('[data-tour-next]').addEventListener('click', () => {setPlaying(false); go(index + 1);});
  dots.forEach((button, i) => button.addEventListener('click', () => {setPlaying(false); go(i);}));
  track.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setPlaying(false);
    go(event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1 : index + (event.key === 'ArrowRight' ? 1 : -1));
  });
  track.addEventListener('pointerdown', () => setPlaying(false), {passive:true});
  track.addEventListener('wheel', () => setPlaying(false), {passive:true});
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      const next = Math.max(0, Math.min(slides.length - 1, Math.round(track.scrollLeft / track.clientWidth)));
      if (next !== index) update(next);
    });
  }, {passive:true});
  root.addEventListener('mouseenter', () => {hovered = true; schedule();});
  root.addEventListener('mouseleave', () => {hovered = false; schedule();});
  root.addEventListener('focusin', () => {focused = true; schedule();});
  root.addEventListener('focusout', event => {focused = root.contains(event.relatedTarget); schedule();});
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', () => {if (motion.matches) setPlaying(false);});
  new IntersectionObserver(entries => {visible = entries[0].isIntersecting; schedule();}, {threshold:0.25}).observe(track);
  new ResizeObserver(() => track.scrollTo({left:index * track.clientWidth, behavior:'instant'})).observe(track);
  update(0);
  setPlaying(playing);
})();
