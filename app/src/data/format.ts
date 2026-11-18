const yenFormat = new Intl.NumberFormat('ja-JP');
const tokyoDateFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const weekdayFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'UTC',
  weekday: 'short',
});
const dayMilliseconds = 24 * 60 * 60 * 1_000;

export function formatYenDigits(amount: number) {
  return yenFormat.format(amount);
}

export function formatYen(amount: number) {
  return `¥${formatYenDigits(amount)}`;
}

export function formatShortDate(date: string) {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

export function businessDate(now = new Date()) {
  return tokyoDateFormat
    .formatToParts(now)
    .filter(part => part.type !== 'literal')
    .map(part => part.value)
    .join('-');
}

export function isBusinessDate(value: string) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000')) return false;

  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function formatDateHeading(date: string, now = new Date()) {
  if (date === businessDate(now)) return '今日';
  if (date === businessDate(new Date(now.getTime() - dayMilliseconds))) return '昨日';

  const [, month, day] = date.split('-');
  const weekday = weekdayFormat.format(new Date(`${date}T00:00:00Z`));
  return `${Number(month)}月${Number(day)}日（${weekday}）`;
}
