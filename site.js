document.documentElement.classList.add('js');

const header = document.querySelector('[data-site-header]');
const menuButton = document.querySelector('[data-menu-button]');
const mobilePanel = document.querySelector('[data-mobile-panel]');

function setMenu(open) {
  if (!menuButton || !mobilePanel) return;
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
  mobilePanel.classList.toggle('is-open', open);
  mobilePanel.setAttribute('aria-hidden', String(!open));
  document.body.classList.toggle('menu-open', open);
}

if (header) {
  const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });
}

if (menuButton && mobilePanel) {
  setMenu(false);

  menuButton.addEventListener('click', () => {
    setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
  });

  mobilePanel.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || menuButton.getAttribute('aria-expanded') !== 'true') return;
    setMenu(false);
    menuButton.focus();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) setMenu(false);
  });
}

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const videoButtons = document.querySelectorAll('[data-video-toggle]');

for (const button of videoButtons) {
  const media = button.closest('[data-video-frame]');
  const video = media?.querySelector('video');
  if (!media || !video) continue;

  const updateButton = () => {
    const playing = !video.paused && !video.ended;
    button.textContent = playing ? '暂停演示' : '播放演示';
    button.setAttribute('aria-pressed', String(playing));
  };

  button.addEventListener('click', async () => {
    if (!video.paused) {
      video.pause();
      updateButton();
      return;
    }

    try {
      await video.play();
      updateButton();
    } catch (error) {
      console.warn('Video playback was unavailable; poster fallback remains visible.', error);
      media.classList.add('is-unavailable');
    }
  });

  video.addEventListener('play', updateButton);
  video.addEventListener('pause', updateButton);
  video.addEventListener('ended', updateButton);
  video.addEventListener('error', () => media.classList.add('is-unavailable'));

  if (prefersReducedMotion.matches) video.pause();
  updateButton();
}

prefersReducedMotion.addEventListener('change', (event) => {
  if (!event.matches) return;
  for (const video of document.querySelectorAll('video')) video.pause();
});

for (const year of document.querySelectorAll('[data-current-year]')) {
  year.textContent = String(new Date().getFullYear());
}
