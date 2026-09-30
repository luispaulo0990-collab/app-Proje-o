/** Current competence month (`YYYY-MM-01`) in the business time zone. */
export function currentMonth(timeZone = 'America/Sao_Paulo', now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}-01`;
}

export function toMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}
