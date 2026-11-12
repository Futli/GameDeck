// Скриншот клиента GameDeck в эмуляции телефона (как в Telegram Mini App).
// Использование: node .claude/skills/run-gamedeck/screenshot.cjs [url] [out.png]
// Playwright берётся глобальный (в облачной сессии Claude он предустановлен),
// поэтому файл CommonJS: require видит глобальные модули, а import — нет.
const { chromium, devices } = require('playwright');

(async () => {
  const url = process.argv[2] ?? 'http://localhost:5173';
  const out = process.argv[3] ?? 'screenshot.png';
  const browser = await chromium.launch();
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log(`saved ${out}`);
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
})();
