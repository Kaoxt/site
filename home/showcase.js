(() => {
  const root = document.querySelector('.collection-tour');
  if (!root) return;
  const track = root.querySelector('.tour-track');
  const slides = [...root.querySelectorAll('.tour-slide')];
  const thumbnails = [...root.querySelectorAll('.tour-thumbnail')];
  const rail = root.querySelector('.tour-thumbnails');
  const toggle = root.querySelector('[data-tour-toggle]');
  const count = root.querySelector('.tour-count');
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
    toggle.textContent = playing ? 'Pause slideshow' : 'Play slideshow';
    toggle.setAttribute('aria-label', playing ? 'Pause slideshow' : 'Play slideshow');
    track.setAttribute('aria-live', playing ? 'off' : 'polite');
    schedule();
  }
  function update(next) {
    index = next;
    thumbnails.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
    const thumb = thumbnails[index];
    const left = rail.scrollLeft + thumb.getBoundingClientRect().left - rail.getBoundingClientRect().left - (rail.clientWidth - thumb.offsetWidth) / 2;
    rail.scrollTo({left, behavior: motion.matches ? 'auto' : 'smooth'});
  }
  function go(next) {
    const target = (next + slides.length) % slides.length;
    track.scrollTo({left: target * track.clientWidth, behavior: motion.matches ? 'auto' : 'smooth'});
    update(target);
    schedule();
  }
  root.querySelector('.tour-controls').hidden = false;
  rail.hidden = false;
  root.querySelector('[data-tour-prev]').addEventListener('click', () => {setPlaying(false); go(index - 1);});
  root.querySelector('[data-tour-next]').addEventListener('click', () => {setPlaying(false); go(index + 1);});
  thumbnails.forEach((button, i) => button.addEventListener('click', () => {setPlaying(false); go(i);}));
  toggle.addEventListener('click', () => setPlaying(!playing));
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
