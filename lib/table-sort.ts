export type TableSortValue = string | number | null | undefined;
/** Sort the complete filtered set before paging; absent values always come last. */
export function sortTableRows<T>(rows: readonly T[], value: (row: T) => TableSortValue, direction: 'ascending' | 'descending', locale: string): T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  return rows.map((row, index) => ({ row, index, value: value(row) })).sort((a, b) => {
    if (a.value == null && b.value == null) return a.index - b.index;
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    const compared = typeof a.value === 'number' && typeof b.value === 'number'
      ? a.value - b.value : collator.compare(String(a.value), String(b.value));
    return (direction === 'ascending' ? compared : -compared) || a.index - b.index;
  }).map(item => item.row);
}
