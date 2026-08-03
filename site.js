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

const tabLists = document.querySelectorAll('[data-tab-list]');

for (const tabList of tabLists) {
  const tabs = Array.from(tabList.querySelectorAll('[role="tab"]'));
  const panelHost = document.querySelector(tabList.dataset.panelHost);
  if (!panelHost || tabs.length === 0) continue;

  const panels = Array.from(panelHost.querySelectorAll('[role="tabpanel"]'));

  function activateTab(nextTab) {
    for (const tab of tabs) {
      const selected = tab === nextTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }

    for (const panel of panels) {
      panel.hidden = panel.id !== nextTab.getAttribute('aria-controls');
    }
  }

  tabList.addEventListener('click', (event) => {
    const nextTab = event.target.closest('[role="tab"]');
    if (nextTab && tabs.includes(nextTab)) activateTab(nextTab);
  });

  tabList.addEventListener('keydown', (event) => {
    const currentIndex = tabs.indexOf(document.activeElement);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === currentIndex) return;

    event.preventDefault();
    tabs[nextIndex].focus();
    activateTab(tabs[nextIndex]);
  });

  activateTab(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || tabs[0]);
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
