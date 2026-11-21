import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatDateTime64,
  timezoneOffset,
  wallClockToUTC,
} from "../../src/protocol/text";

describe("[Native] DateTime text", () => {
  // 2024-01-01 12:00:00 UTC
  const noon = 1704110400;

  it("writes the simple format in the time zone", () => {
    expect(formatDateTime(noon, "UTC")).toBe("2024-01-01 12:00:00");
    expect(formatDateTime(noon, "Europe/Berlin")).toBe("2024-01-01 13:00:00");
    expect(formatDateTime(noon, "Europe/Berlin", "simple")).toBe(
      "2024-01-01 13:00:00",
    );
    expect(formatDateTime64(1704110400123n, 3, "Asia/Kolkata")).toBe(
      "2024-01-01 17:30:00.123",
    );
  });

  it("writes the iso format in UTC", () => {
    expect(formatDateTime(noon, "UTC", "iso")).toBe("2024-01-01T12:00:00Z");
    expect(formatDateTime(noon, "Europe/Berlin", "iso")).toBe(
      "2024-01-01T12:00:00Z",
    );
    expect(formatDateTime64(1704110400123n, 3, "Asia/Kolkata", "iso")).toBe(
      "2024-01-01T12:00:00.123Z",
    );
    expect(formatDateTime64(1704110400n, 0, "UTC", "iso")).toBe(
      "2024-01-01T12:00:00Z",
    );
    expect(formatDateTime64(-5n, 1, "UTC", "iso")).toBe(
      "1969-12-31T23:59:59.5Z",
    );
    expect(formatDateTime64(1704110400123456789n, 9, "UTC", "iso")).toBe(
      "2024-01-01T12:00:00.123456789Z",
    );
  });

  it("writes the unix_timestamp format", () => {
    expect(formatDateTime(noon, "Europe/Berlin", "unix_timestamp")).toBe(
      "1704110400",
    );
    expect(
      formatDateTime64(1704110400123n, 3, "Asia/Kolkata", "unix_timestamp"),
    ).toBe("1704110400.123");
    expect(formatDateTime64(1704110400n, 0, "UTC", "unix_timestamp")).toBe(
      "1704110400",
    );
    expect(
      formatDateTime64(1704110400500000n, 6, "UTC", "unix_timestamp"),
    ).toBe("1704110400.500000");
    expect(formatDateTime64(-1500n, 3, "UTC", "unix_timestamp")).toBe("-1.500");
  });
});

describe("[Native] time zones", () => {
  it("finds the second of a change of the offset", () => {
    // Daylight saving time in Berlin: 2024-03-31 01:00 UTC to 2024-10-27 01:00 UTC.
    expect(timezoneOffset(1711846799, "Europe/Berlin")).toBe(3600);
    expect(timezoneOffset(1711846800, "Europe/Berlin")).toBe(7200);
    expect(timezoneOffset(1729990799, "Europe/Berlin")).toBe(7200);
    expect(timezoneOffset(1729990800, "Europe/Berlin")).toBe(3600);
    expect(formatDateTime(1711846799, "Europe/Berlin")).toBe(
      "2024-03-31 01:59:59",
    );
    expect(formatDateTime(1711846800, "Europe/Berlin")).toBe(
      "2024-03-31 03:00:00",
    );
  });

  it("gives the same offsets for times in any sequence", () => {
    // The offsets are found one day at a time and joined: the result must
    // not change with the sequence of the calls.
    const zone = "America/New_York";
    const day = 86400;
    const start = 1704067200; // 2024-01-01
    const forward: number[] = [];
    for (let d = 0; d < 366; d++) {
      forward.push(timezoneOffset(start + d * day + 43200, zone));
    }
    expect(new Set(forward)).toEqual(new Set([-18000, -14400]));
    for (let d = 365; d >= 0; d -= 7) {
      expect(timezoneOffset(start + d * day + 3, zone)).toBe(
        d * day + 3 >= 5900400 && d * day + 3 < 26460000 ? -14400 : -18000,
      );
    }
    // 2024-03-10 07:00 UTC and 2024-11-03 06:00 UTC
    expect(timezoneOffset(1710054000 - 1, zone)).toBe(-18000);
    expect(timezoneOffset(1710054000, zone)).toBe(-14400);
    expect(timezoneOffset(1730613600 - 1, zone)).toBe(-14400);
    expect(timezoneOffset(1730613600, zone)).toBe(-18000);
  });

  it("finds a change that is not on a boundary of 15 minutes", () => {
    // Newfoundland changed its clocks at 00:01 local time in 1988.
    // The server gives 1988-04-03 02:12:31 for this time.
    expect(formatDateTime(576042151, "America/St_Johns")).toBe(
      "1988-04-03 02:12:31",
    );
    expect(formatDateTime(576041400, "America/St_Johns")).toBe(
      "1988-04-03 00:00:00",
    );
  });

  it("uses zones with an offset that is not a full hour", () => {
    expect(formatDateTime(0, "Australia/Lord_Howe")).toBe(
      "1970-01-01 10:00:00",
    );
    expect(formatDateTime(1704067200, "Asia/Kathmandu")).toBe(
      "2024-01-01 05:45:00",
    );
    expect(formatDateTime(-2208988800, "UTC")).toBe("1900-01-01 00:00:00");
  });

  it("changes a wall-clock time to UTC", () => {
    expect(wallClockToUTC(1704110400, "UTC")).toBe(1704110400);
    expect(wallClockToUTC(1704110400, "Europe/Berlin")).toBe(1704106800);
    expect(wallClockToUTC(1719835200, "Europe/Berlin")).toBe(1719828000);
  });

  it("does not write UTC times for a time zone that Node.js does not know", () => {
    expect(() => formatDateTime(0, "Mars/Olympus_Mons")).toThrow(
      'The time zone "Mars/Olympus_Mons" is not known to this Node.js runtime',
    );
    expect(() => formatDateTime64(0n, 3, "Mars/Olympus_Mons")).toThrow(
      "Mars/Olympus_Mons",
    );
    expect(() => wallClockToUTC(0, "Mars/Olympus_Mons")).toThrow(
      "Mars/Olympus_Mons",
    );
    // The iso and unix_timestamp formats do not use the time zone.
    expect(formatDateTime(0, "Mars/Olympus_Mons", "iso")).toBe(
      "1970-01-01T00:00:00Z",
    );
  });
});

describe("[Native] DateTime64 text without zeros at the end", () => {
  // 2024-01-01 00:00:00 UTC
  const second = 1704067200n;
  const text = (fraction: string, format?: "simple" | "iso") =>
    formatDateTime64(
      second * 10n ** BigInt(fraction.length) + BigInt(fraction),
      fraction.length,
      "UTC",
      format ?? "simple",
      true,
    );

  it("keeps 3, 6 or 9 digits", () => {
    expect(text("1")).toBe("2024-01-01 00:00:00.100");
    expect(text("12")).toBe("2024-01-01 00:00:00.120");
    expect(text("5000")).toBe("2024-01-01 00:00:00.500");
    expect(text("120000")).toBe("2024-01-01 00:00:00.120");
    expect(text("123400")).toBe("2024-01-01 00:00:00.123400");
    expect(text("1000000")).toBe("2024-01-01 00:00:00.100");
    expect(text("000001000")).toBe("2024-01-01 00:00:00.000001");
    expect(text("123456789")).toBe("2024-01-01 00:00:00.123456789");
  });

  it("writes no fraction for a full second", () => {
    expect(text("000000")).toBe("2024-01-01 00:00:00");
    expect(formatDateTime64(second, 0, "UTC", "simple", true)).toBe(
      "2024-01-01 00:00:00",
    );
  });

  it("does not change the other formats", () => {
    expect(text("120000", "iso")).toBe("2024-01-01T00:00:00.120000Z");
    expect(
      formatDateTime64(second * 1000n + 500n, 3, "UTC", "unix_timestamp", true),
    ).toBe("1704067200.500");
  });

  it("keeps all digits without the setting", () => {
    expect(formatDateTime64(second * 1000000n, 6, "UTC")).toBe(
      "2024-01-01 00:00:00.000000",
    );
  });

  it("stays accurate after exceeding the timezone range cache bound", () => {
    // Visit > 4096 non-contiguous days (every 2nd day) in a DST timezone.
    const startDay = 0; // 1970-01-01
    for (let i = 0; i < 4200; i++) {
      const ts = (startDay + i * 2) * 86_400;
      const offset = timezoneOffset(ts, "Europe/Berlin");
      expect(offset === 3600 || offset === 7200).toBe(true);
    }
    // Verify DST boundary after cache reset: 2024-03-31 01:00 UTC in Berlin.
    expect(formatDateTime(1711846799, "Europe/Berlin")).toBe(
      "2024-03-31 01:59:59",
    );
    expect(formatDateTime(1711846800, "Europe/Berlin")).toBe(
      "2024-03-31 03:00:00",
    );
  });
});
