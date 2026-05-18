const FIREBASE_BASE =
  'https://oyako-shokuboard-default-rtdb.firebaseio.com/shokuboard';

export default {
  // ── カレンダー .ics 配信 ──────────────────────────
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    try {
      const res = await fetch(`${FIREBASE_BASE}/meals.json`);
      if (!res.ok) throw new Error('Firebase fetch failed');
      const meals = await res.json();
      return new Response(buildICS(meals || {}), {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Cache-Control': 'no-cache',
          ...cors(),
        },
      });
    } catch (e) {
      return new Response('Server Error', { status: 500 });
    }
  },

  // ── Cron: 定時Discord通知 ─────────────────────────
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAndNotify());
  },
};

async function checkAndNotify() {
  // 通知設定を取得
  const configRes = await fetch(`${FIREBASE_BASE}/notification_config.json`);
  if (!configRes.ok) return;
  const config = await configRes.json();
  if (!config?.times?.length || !config?.discord_webhook) return;

  // 現在のJST時刻
  const now = new Date();
  const jstHour = (now.getUTCHours() + 9) % 24;
  const jstMin = now.getUTCMinutes();
  const jstTotal = jstHour * 60 + jstMin;

  // 設定時刻の30分以内かチェック（cronは30分毎に実行）
  const shouldSend = config.times
    .filter(Boolean)
    .some(t => {
      const [h, m] = t.split(':').map(Number);
      const target = h * 60 + m;
      return jstTotal >= target && jstTotal < target + 30;
    });

  if (!shouldSend) return;

  // 通知待ちを取得
  const notifRes = await fetch(`${FIREBASE_BASE}/pending_notifications.json`);
  if (!notifRes.ok) return;
  const notifications = await notifRes.json();
  if (!notifications) return;

  const entries = Object.entries(notifications);
  if (entries.length === 0) return;

  // タイムスタンプ順に並べてフォーマット
  const lines = entries
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, n]) => `・${n.who}が ${n.detail}`);

  const appUrl = config.app_url || 'https://koninico.github.io/oyako-shokuboard/';
  const description = lines.join('\n') + `\n\n[▶ アプリを開く](${appUrl})`;

  // Discordに送信
  await fetch(config.discord_webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `🍱 定時通知（${lines.length}件の更新）`,
        description,
        color: 0x4a90d9,
        footer: { text: '親子の食ボード' },
        timestamp: now.toISOString(),
      }],
    }),
  });

  // 通知待ちをクリア
  await fetch(`${FIREBASE_BASE}/pending_notifications.json`, { method: 'DELETE' });
}

function cors() {
  return { 'Access-Control-Allow-Origin': '*' };
}

function buildICS(meals) {
  const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const events = [];

  for (const [key, cell] of Object.entries(meals)) {
    if (!cell || cell.status !== 'confirmed' || !cell.menu) continue;
    const m = key.match(/^(\d{4}-\d{2}-\d{2})_(lunch|dinner)$/);
    if (!m) continue;

    const dt = m[1].replace(/-/g, '');
    const isLunch = m[2] === 'lunch';
    const start = isLunch ? 'T030000Z' : 'T100000Z';
    const end   = isLunch ? 'T040000Z' : 'T110000Z';
    const label = isLunch ? '昼食' : '夕食';
    const emoji = isLunch ? '🌞' : '🌙';

    events.push(
      'BEGIN:VEVENT',
      `UID:${key}@oyako-shokuboard`,
      `DTSTAMP:${now}`,
      `DTSTART:${dt}${start}`,
      `DTEND:${dt}${end}`,
      fold(`SUMMARY:${emoji} ${label}：${cell.menu}`),
      'DESCRIPTION:親子の食ボードで確定したメニュー',
      'END:VEVENT',
    );
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//oyako-shokuboard//JP',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:🍱 親子の食ボード',
    'X-WR-CALDESC:親子の食ボードの確定メニュー',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  let result = '';
  let buf = '';
  for (const ch of [...line]) {
    const candidate = buf + ch;
    if (enc.encode(candidate).length > 75) {
      result += candidate.slice(0, -ch.length) + '\r\n ';
      buf = ch;
    } else {
      buf = candidate;
    }
  }
  return result + buf;
}
