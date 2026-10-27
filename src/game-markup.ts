import type {Lang, T} from './i18n';
import {BUDGET_KWH} from './engine';

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const STUDIO = 'https://kononov.dev';
export const UTM = 'utm_source=github&utm_medium=open_source&utm_campaign=greenhouse_game';

function hudRow(label: string, id: string, value: string, {wide = false, className = ''} = {}) {
  const bar = !wide || className ? `<i><em data-hb="${id}"></em></i>` : '';
  return `<div class="hud-row ${wide ? 'wide' : ''} ${className}"><span>${esc(label)}</span><b data-h="${id}">${esc(value)}</b>${bar}</div>`;
}

/** Markup the engine binds to through data attributes. Buttons marked data-wait stay disabled until the 3D scene is ready. */
export function gameMarkup(lang: Lang, t: T) {
  const kwh = t('кВт·ч', 'kWh');
  const varietyCards = [
    ['cherry', t('Черри', 'Cherry'), t('Быстро растёт, много пьёт', 'Grows fast, drinks a lot'), t('2.8 кг/куст · $5.0/кг', '2.8 kg/plant · $5.0/kg')],
    ['plum', t('Сливка', 'Plum'), t('Неприхотливая, терпит сухость', 'Hardy, tolerates dry soil'), t('4.0 кг/куст · $3.0/кг', '4.0 kg/plant · $3.0/kg')],
    ['heart', t('Бычье сердце', 'Oxheart'), t('Крупная, медленная, боится жары', 'Large, slow, dislikes heat'), t('5.5 кг/куст · $3.6/кг', '5.5 kg/plant · $3.6/kg')],
  ];
  const contact = `${STUDIO}/${lang}/contact?context=${encodeURIComponent(t('Автоматизация теплицы', 'Greenhouse automation'))}&${UTM}`;
  const icon = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const toggle = (act: string, path: string, label: string) =>
    `<button type="button" class="g-btn" data-act="${act}" aria-pressed="false" data-wait disabled>${icon(path)}${esc(label)}</button>`;

  return `<div class="game" data-game data-status="idle">
    <canvas data-game-canvas aria-hidden="true"></canvas>
    <p class="sr-only">${esc(t('Интерактивная 3D-игра: теплица с растениями. Кнопки полива, досветки и вентиляции доступны с клавиатуры, показатели обновляются в панели датчиков.', 'Interactive 3D game: a greenhouse with plants. Irrigation, grow light and ventilation buttons work from the keyboard; readings update in the sensor panel.'))}</p>
    <div class="game-hud game-sensors">
      <div class="hud-time" data-h="time">${esc(t('День 1 · 08:00', 'Day 1 · 08:00'))}</div>
      ${hudRow(t('Свет', 'Light'), 'light', '0%')}
      ${hudRow(t('Температура', 'Temperature'), 'temp', '19°')}
      ${hudRow(t('Влажность почвы', 'Soil moisture'), 'moist', '55%')}
    </div>
    <div class="game-hud game-status">
      <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="4"/><circle data-hb="growth" cx="24" cy="24" r="20" fill="none" stroke="#4ade80" stroke-width="4" stroke-linecap="round" stroke-dasharray="125.6" stroke-dashoffset="120.6" transform="rotate(-90 24 24)"/></svg>
      <div class="g-growth"><span>${esc(t('Рост урожая', 'Crop growth'))}</span><b data-h="growth">4%</b></div>
      ${hudRow(t('Здоровье', 'Health'), 'health', '100%', {className: 'health'})}
      ${hudRow(t('Сорт', 'Variety'), 'variety', t('Черри', 'Cherry'), {wide: true})}
      ${hudRow(t('Расходы', 'Costs'), 'cost', '$0.00', {wide: true})}
      ${hudRow(t('Энергия', 'Energy'), 'energy', `0 / ${BUDGET_KWH} ${kwh}`, {wide: true, className: 'energy'})}
    </div>
    <div class="game-toasts" data-toasts aria-live="polite"></div>

    <div class="game-controls" role="group" aria-label="${esc(t('Управление теплицей', 'Greenhouse controls'))}">
      ${toggle('pump', 'M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z', t('Полив', 'Irrigation'))}
      ${toggle('lamps', 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z', t('Досветка', 'Grow lights'))}
      ${toggle('vent', 'M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h18', t('Вентиляция', 'Ventilation'))}
      <span class="g-sep" aria-hidden="true"></span>
      <span class="g-auto"><span aria-hidden="true">${esc(t('Автопилот', 'Autopilot'))}</span><button type="button" class="g-switch" role="switch" aria-checked="false" aria-label="${esc(t('Автопилот', 'Autopilot'))}" data-act="auto" data-wait disabled></button></span>
      <span class="g-speed" role="group" aria-label="${esc(t('Скорость времени', 'Time speed'))}">${[1, 3, 8].map((speed) => `<button type="button" data-speed="${speed}" aria-pressed="${speed === 1}">×${speed}</button>`).join('')}</span>
      <button type="button" class="g-icon" data-restart aria-label="${esc(t('Начать заново', 'Start over'))}">↻</button>
    </div>

    <div class="game-overlay" data-overlay="start">
      <div class="game-card">
        <h2>${esc(t('Ваша теплица. Десять кустов томатов.', 'Your greenhouse. Ten tomato plants.'))}</h2>
        <p>${esc(t('Выберите сорт. Следите за влажностью, светом и температурой, держитесь в бюджете энергии. В конце посчитаем урожай, расходы и прибыль и сравним с автопилотом.', 'Choose a variety. Watch moisture, light and temperature and stay within the energy budget. At the end we count harvest, costs and profit and compare them with the autopilot.'))}</p>
        <div class="varieties" role="group" aria-label="${esc(t('Сорт томатов', 'Tomato variety'))}">
          ${varietyCards.map(([key, name, hint, price], index) => `<button type="button" data-variety="${key}" aria-pressed="${index === 0}"><b>${esc(name)}</b><span>${esc(hint)}</span><small>${esc(price)}</small></button>`).join('')}
        </div>
        <div class="game-actions">
          <button type="button" class="game-btn primary" data-begin="manual" data-wait disabled>${esc(t('Начать вручную', 'Play by hand'))} <span aria-hidden="true">→</span></button>
          <button type="button" class="game-btn" data-begin="auto" data-wait disabled>${esc(t('С автопилотом', 'With autopilot'))}</button>
        </div>
        <small data-hint data-ready-text="${esc(t('Перетащите сцену, чтобы осмотреть теплицу. Электричество $0.22/кВт·ч, вода с удобрениями $0.004/л.', 'Drag the scene to look around. Electricity $0.22/kWh, water with nutrients $0.004/L.'))}">${esc(t('Загружаем 3D-сцену…', 'Loading the 3D scene…'))}</small>
      </div>
    </div>
    <div class="game-overlay" data-overlay="end" hidden>
      <div class="game-card wide">
        <p class="game-end-title" data-end-title></p>
        <p data-end-text></p>
        <div class="econ" data-end-stats></div>
        <div class="compare-box" data-end-compare></div>
        <div class="game-actions">
          <button type="button" class="game-btn primary" data-begin="manual">${esc(t('Ещё раз вручную', 'Play by hand again'))}</button>
          <button type="button" class="game-btn" data-begin="auto">${esc(t('С автопилотом', 'With autopilot'))}</button>
          <button type="button" class="game-btn" data-choose>${esc(t('Другой сорт', 'Another variety'))}</button>
          <a class="game-btn" href="${esc(contact)}">${esc(t('Обсудить такую систему', 'Discuss a system like this'))}</a>
        </div>
      </div>
    </div>
    <div class="game-fallback"><p>${esc(t('3D-сцена не загрузилась: нужен WebGL.', 'The 3D scene did not load: it needs WebGL.'))}</p></div>
  </div>`;
}
