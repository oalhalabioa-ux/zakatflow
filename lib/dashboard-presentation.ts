/** Read-only presentation helpers. Never change assessment or allocation amounts. */
export function hawlProgress(start?: string, end?: string, asOf?: string) {
  const parse = (v?: string) => v ? Date.parse(`${v.slice(0, 10)}T00:00:00Z`) : NaN;
  const a = parse(start), b = parse(end), now = parse(asOf);
  if (![a, b, now].every(Number.isFinite) || b <= a) return null;
  const total = Math.round((b - a) / 86400000);
  const elapsed = Math.max(0, Math.min(total, Math.floor((now - a) / 86400000)));
  return {total, elapsed, percent: elapsed / total * 100};
}

export function allocationSegments(rows: {type: string; value: string}[]) {
  const positive = rows.filter(r => Number(r.value) > 0);
  const total = positive.reduce((sum, r) => sum + Number(r.value), 0);
  let cursor = 0;
  return positive.map(r => {
    const percent = Number(r.value) / total * 100;
    const start = cursor;
    cursor += percent;
    return {...r, percent, start, end: cursor};
  });
}
