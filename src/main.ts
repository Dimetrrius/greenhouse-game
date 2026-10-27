import './page.css';
import './game.css';
import {LANGS, detectLang, translator} from './i18n';
import {gameMarkup, UTM} from './game-markup';
import {mountGreenhouseGame, type GreenhouseGame} from './engine';

const REPO = 'https://github.com/Dimetrrius/greenhouse-game';
const STUDIO = 'https://kononov.dev';

const lang = detectLang();
const t = translator(lang);
const esc = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const title = t('Игра про теплицу: вырастите томаты и сравните с автопилотом', 'Greenhouse game: grow tomatoes, compare with autopilot');
document.documentElement.lang = lang;
document.title = title;
document.querySelector('meta[name="description"]')?.setAttribute('content', t('3D-игра в браузере: ухаживайте за десятью кустами томатов, держите воду, свет и температуру в норме, уложитесь в бюджет энергии и сравните с автопилотом.', 'A 3D browser game: tend ten tomato plants, keep water, light and temperature in range, stay in the energy budget and compare your profit with the autopilot.'));

const languages = LANGS.map(({code, label}) => code === lang
  ? `<a href="?lang=${code}" aria-current="true" lang="${code}">${label}</a>`
  : `<a href="?lang=${code}" lang="${code}">${label}</a>`).join('');

document.querySelector<HTMLElement>('#app')!.innerHTML = `
  <header class="top">
    <a class="brand" href="${STUDIO}/${lang}/lab?${UTM}">kononov.dev <span>/ ${esc(t('Лаборатория', 'Lab'))}</span></a>
    <nav class="langs" aria-label="${esc(t('Язык', 'Language'))}">${languages}</nav>
  </header>
  <main class="page">
    <h1>${esc(title)}</h1>
    <p class="lead">${esc(t('Вырастите десять кустов томатов и сравните прибыль с автопилотом.', 'Grow ten tomato plants and compare your profit with the autopilot.'))}</p>
    <section class="greenhouse-stage">${gameMarkup(lang, t)}</section>
  </main>
  <footer class="foot">
    <a href="${STUDIO}/${lang}?${UTM}">${esc(t('Дмитрий Кононов', 'Dmitriy Kononov'))} · kononov.dev</a>
    <a href="${REPO}">${esc(t('Исходный код', 'Source code'))}</a>
    <a href="${REPO}/blob/main/LICENSE">${esc(t('Лицензия MIT', 'MIT license'))}</a>
  </footer>`;

const root = document.querySelector<HTMLElement>('[data-game]')!;
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let game: GreenhouseGame | null = null;

// The scene renders only while the stage is on screen and the tab is visible.
let inView = false, frame = 0, last = 0;
const tick = (time: number) => {
  const dt = last ? Math.min(64, time - last) : 16;
  last = time;
  game?.frame(dt);
  frame = requestAnimationFrame(tick);
};
const sync = () => {
  const run = !!game && inView && document.visibilityState === 'visible';
  if (run && !frame) { last = 0; frame = requestAnimationFrame(tick); }
  else if (!run && frame) { cancelAnimationFrame(frame); frame = 0; }
};
new IntersectionObserver((entries) => { inView = entries.some((entry) => entry.isIntersecting); sync(); }).observe(root);
document.addEventListener('visibilitychange', sync);

root.dataset.status = 'loading';
mountGreenhouseGame(root, t, () => reducedQuery.matches)
  .then((mounted) => {
    game = mounted;
    root.dataset.status = 'ready';
    root.querySelectorAll<HTMLButtonElement>('[data-wait]').forEach((button) => { button.disabled = false; });
    const hint = root.querySelector<HTMLElement>('[data-hint]')!;
    hint.textContent = hint.dataset.readyText ?? '';
    sync();
  })
  .catch((error) => {
    console.warn('Greenhouse game unavailable', error);
    root.dataset.status = 'fallback';
    root.classList.add('is-fallback');
  });
