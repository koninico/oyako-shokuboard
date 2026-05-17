const FIREBASE_URL =
  'https://oyako-shokuboard-default-rtdb.firebaseio.com/shokuboard/meals.json';

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() });
    }
    try {
      const res = await fetch(FIREBASE_URL);
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
};

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
    // 昼食 12:00-13:00 JST = 03:00-04:00 UTC
    // 夕食 19:00-20:00 JST = 10:00-11:00 UTC
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

// iCal仕様: 1行75バイト以内（超過時は折り返し）
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
