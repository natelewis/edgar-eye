const ET_TIMEZONE = "America/New_York";

export function isMarketHoursET(date = new Date()): boolean {
  const parts = getETParts(date);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return false;
  }

  const minutes = parts.hour * 60 + parts.minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return minutes >= open && minutes < close;
}

export function isTimeStopMoment(date = new Date()): boolean {
  const parts = getETParts(date);
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return false;
  }
  return parts.hour === 15 && parts.minute === 55 && parts.second === 0;
}

/// Maps a filing timestamp to the next liquid options session (9:30 AM ET).
/// Filings outside market hours execute at the next session open.
export function normalizeToNextMarketSession(timestamp: Date): Date {
  let cursor = new Date(timestamp.getTime());
  const parts = getETParts(cursor);

  if (parts.weekday === "Sat") {
    cursor = addDays(cursor, 2);
  } else if (parts.weekday === "Sun") {
    cursor = addDays(cursor, 1);
  }

  const sessionParts = getETParts(cursor);
  const minutes = sessionParts.hour * 60 + sessionParts.minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;

  if (minutes < open) {
    return buildEtDateTime(
      sessionParts.year,
      sessionParts.month,
      sessionParts.day,
      9,
      30,
      0,
    );
  }

  if (minutes >= close) {
    let next = addDays(cursor, 1);
    while (true) {
      const nextParts = getETParts(next);
      if (nextParts.weekday !== "Sat" && nextParts.weekday !== "Sun") {
        return buildEtDateTime(
          nextParts.year,
          nextParts.month,
          nextParts.day,
          9,
          30,
          0,
        );
      }
      next = addDays(next, 1);
    }
  }

  return cursor;
}

export function getMarketOpenOnDay(date: Date): Date {
  const parts = getETParts(date);
  return buildEtDateTime(parts.year, parts.month, parts.day, 9, 30, 0);
}

export function getTimeStopOnDay(entryDate: Date): Date {
  const parts = getETParts(entryDate);
  return buildEtDateTime(parts.year, parts.month, parts.day, 15, 55, 0);
}

function buildEtDateTime(
  year: string,
  month: string,
  day: string,
  hour: number,
  minute: number,
  second: number,
): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    timeZoneName: "shortOffset",
  });
  const guess = new Date(
    `${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`,
  );
  const offsetPart = formatter
    .formatToParts(guess)
    .find((p) => p.type === "timeZoneName")?.value;
  const offsetHours = offsetPart?.includes("GMT-")
    ? Number(offsetPart.replace("GMT-", "").replace(":00", ""))
    : 4;

  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      hour + offsetHours,
      minute,
      second,
    ),
  );
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getETParts(date: Date): {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}
