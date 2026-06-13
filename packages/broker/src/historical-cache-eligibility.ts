const ET_TIMEZONE = "America/New_York";

export function getEtCalendarDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function getYesterdayEtCalendarDate(now = new Date()): string {
  const today = getEtCalendarDate(now);
  const [yearStr, monthStr, dayStr] = today.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  utcNoon.setUTCDate(utcNoon.getUTCDate() - 1);
  return getEtCalendarDate(utcNoon);
}

export function isHistoricalCacheEligible(date: Date, now = new Date()): boolean {
  return getEtCalendarDate(date) < getYesterdayEtCalendarDate(now);
}
