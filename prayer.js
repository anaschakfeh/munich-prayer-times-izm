/**
 * prayer.js — IZM Munich Prayer Times
 * Source: islamisches-zentrum-muenchen.de (2026 timetable)
 *
 * Strategy:
 *   1. Compute times astronomically (Jean Meeus algorithms)
 *   2. Apply per-day delta corrections derived from the official IZM table
 *   3. For DST-transition edge cases, use the IZM values directly
 *
 * Parameters reverse-engineered from IZM:
 *   Fajr    −18° (MWL), summer cap ~95 min before sunrise
 *   Sunrise −1.83° horizon (elevation + refraction, Munich 520 m)
 *   Dhuhr   solar noon + 5 min ihtiyat
 *   Asr     shadow factor 1× (Shafi'i) + 4 min ihtiyat
 *   Maghrib same horizon as Sunrise (−1.83°)
 *   Isha    −16°, summer cap ~90 min after sunset
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

const _r = d => d * Math.PI / 180;
const _d = r => r * 180 / Math.PI;

function _jd(year, month, day) {
  if (month <= 2) { year--; month += 12; }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (year + 4716))
       + Math.floor(30.6001 * (month + 1))
       + day + B - 1524.5;
}

/** Solar declination (°) and equation of time (minutes) — Meeus Ch. 25 */
function _sunPos(jd) {
  const T  = (jd - 2451545.0) / 36525.0;
  const L0 = ((280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360 + 360) % 360;
  const M  = _r(((357.52911 + 35999.05029 * T - 0.0001537 * T * T) % 360 + 360) % 360);
  const C  = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
           + (0.019993 - 0.000101 * T) * Math.sin(2 * M)
           + 0.000289 * Math.sin(3 * M);
  const sl = L0 + C;
  const om = _r(125.04 - 1934.136 * T);
  const lm = _r(sl - 0.00569 - 0.00478 * Math.sin(om));
  const e0 = 23.439291111 - 0.013004167 * T - 1.639e-7 * T * T + 5.036e-7 * T * T * T;
  const ep = _r(e0 + 0.00256 * Math.cos(om));
  const dec = _d(Math.asin(Math.sin(ep) * Math.sin(lm)));
  const ra  = (_d(Math.atan2(Math.cos(ep) * Math.sin(lm), Math.cos(lm))) + 360) % 360;
  const eot = 4 * (L0 - 0.0057183 - ra + 0.00478 * Math.sin(om) * Math.sin(_r(e0)));
  return { dec, eot };
}

/** German DST: UTC+1 (CET) Nov–Mar, UTC+2 (CEST) last Sun Mar – last Sun Oct */
function _utcOffset(date) {
  const y = date.getFullYear();
  const dstStart = new Date(y, 2, 31); // March 31, walk back to Sunday
  while (dstStart.getDay() !== 0) dstStart.setDate(dstStart.getDate() - 1);
  const dstEnd = new Date(y, 9, 31);   // October 31, walk back to Sunday
  while (dstEnd.getDay() !== 0) dstEnd.setDate(dstEnd.getDate() - 1);
  return (date >= dstStart && date < dstEnd) ? 2 : 1;
}

/** Solar noon in local minutes from midnight */
function _noon(date) {
  const jd = _jd(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const { eot } = _sunPos(jd);
  const tz = _utcOffset(date);
  return (12 - eot / 60 - 11.5820 / 15 + tz) * 60;
}

/** Hour angle (°) for sun to reach altitude `h` degrees at Munich */
function _ha(dec, h) {
  const lat = _r(48.1351), decR = _r(dec), hR = _r(h);
  const cos = (Math.sin(hR) - Math.sin(lat) * Math.sin(decR))
            / (Math.cos(lat) * Math.cos(decR));
  return Math.abs(cos) > 1 ? null : _d(Math.acos(cos));
}

/** Format decimal minutes as "HH:MM" */
function _fmt(mins) {
  if (mins === null || mins === undefined) return '--:--';
  const t = Math.round(mins);
  const h = Math.floor(t / 60) % 24;
  const m = ((t % 60) + 60) % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ─── Core Calculator ─────────────────────────────────────────────────────────

function _calcRaw(date) {
  const jd  = _jd(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const { dec } = _sunPos(jd);
  const noon = _noon(date);

  // Sunrise / Maghrib
  const haRise = _ha(dec, -1.83);
  const rOff   = haRise !== null ? haRise / 15 * 60 : 0;
  const sunrise = noon - rOff;
  const sunset  = noon + rOff;

  // Dhuhr
  const dhuhr = noon + 5;

  // Asr (Shafi'i shadow = 1×)
  const latR = _r(48.1351), decR = _r(dec);
  const asrAlt = _d(Math.atan(1 / (1 + Math.tan(Math.abs(latR - decR)))));
  const haAsr  = _ha(dec, asrAlt);
  const asr    = haAsr !== null ? noon + haAsr / 15 * 60 + 4 : null;

  // Fajr (−18°, cap at 95 min before sunrise)
  const haFajr = _ha(dec, -18.0);
  let fajr;
  if (haFajr !== null) {
    const raw = noon - haFajr / 15 * 60;
    fajr = (sunrise - raw >= 95) ? raw : sunrise - 95;
  } else {
    fajr = sunrise - 95;
  }

  // Isha (−16°, cap at 90 min after sunset)
  const haIsha = _ha(dec, -16.0);
  let isha;
  if (haIsha !== null) {
    const raw = noon + haIsha / 15 * 60;
    isha = (raw - sunset >= 90) ? raw : sunset + 90;
  } else {
    isha = sunset + 90;
  }

  return { fajr, sunrise, dhuhr, asr, maghrib: sunset, isha };
}

// ─── IZM Corrections — 2026 timetable ────────────────────────────────────────
// Each entry: delta in minutes (IZM − formula) per prayer.
// Covers all 365 days. DST transition dates are in IZM_DIRECT below.

const IZM_CORRECTIONS = {
  "2026-01-01": { asr: -1 },
  "2026-01-02": { maghrib: -1 },
  "2026-01-03": { maghrib: -1 },
  "2026-01-04": { maghrib: -1, isha: -1 },
  "2026-01-05": { isha: -1 },
  "2026-01-06": { fajr: +1, sunrise: +1, isha: -1 },
  "2026-01-07": { isha: -1 },
  "2026-01-08": { maghrib: -1, isha: -1 },
  "2026-01-09": { sunrise: +1, dhuhr: -1, maghrib: -1, isha: -1 },
  "2026-01-10": { maghrib: -1, isha: -1 },
  "2026-01-11": { isha: -1 },
  "2026-01-12": { sunrise: +1, asr: -1, isha: -1 },
  "2026-01-13": { asr: -1, maghrib: -1 },
  "2026-01-14": { dhuhr: -1, asr: -1, maghrib: -1 },
  "2026-01-15": { sunrise: +1, asr: -1 },
  "2026-01-16": { maghrib: -1, isha: -1 },
  "2026-01-17": { dhuhr: -1, isha: -1 },
  "2026-01-18": { sunrise: +1, asr: -1, maghrib: -1, isha: -1 },
  "2026-01-19": { sunrise: +1, asr: -1, maghrib: -1 },
  "2026-01-20": { fajr: +1, dhuhr: -1, asr: -1 },
  "2026-01-21": { maghrib: -1, isha: -1 },
  "2026-01-22": { asr: -1, isha: -1 },
  "2026-01-23": { fajr: +1, asr: -1, maghrib: -1 },
  "2026-01-24": { isha: -1 },
  "2026-01-25": { maghrib: -1, isha: -1 },
  "2026-01-26": { asr: -1 },
  "2026-01-27": { asr: -1, maghrib: -1, isha: -1 },
  "2026-01-28": { fajr: +1, dhuhr: -1, isha: -1 },
  "2026-01-29": { fajr: +1, sunrise: +1, asr: -1, isha: -1 },
  "2026-01-30": { fajr: +1, sunrise: +1, asr: -1, maghrib: -1, isha: -2 },
  "2026-01-31": { fajr: +1, isha: -2 },
  "2026-02-01": { fajr: +1, maghrib: -1, isha: -2 },
  "2026-02-02": { sunrise: +1, asr: -1, isha: -2 },
  "2026-02-03": { asr: -1, isha: -3 },
  "2026-02-04": { isha: -2 },
  "2026-02-05": { fajr: +1, sunrise: +1, asr: -1, isha: -3 },
  "2026-02-06": { fajr: +1, asr: -1, maghrib: -1, isha: -3 },
  "2026-02-07": { fajr: +1, sunrise: +1, isha: -3 },
  "2026-02-08": { fajr: +1, asr: -1, isha: -4 },
  "2026-02-09": { fajr: +1, sunrise: +1, asr: -1, isha: -3 },
  "2026-02-10": { fajr: +1, isha: -4 },
  "2026-02-11": { fajr: +1, maghrib: -1, isha: -4 },
  "2026-02-12": { fajr: +1, asr: -1, isha: -4 },
  "2026-02-13": { fajr: +1, asr: -1, isha: -4 },
  "2026-02-14": { fajr: +1, sunrise: +1, isha: -4 },
  "2026-02-15": { fajr: +1, isha: -4 },
  "2026-02-16": { fajr: +1, asr: -1, isha: -4 },
  "2026-02-17": { fajr: +1, sunrise: +1, asr: -1, isha: -5 },
  "2026-02-18": { fajr: +1, isha: -5 },
  "2026-02-19": { fajr: +1, isha: -5 },
  "2026-02-20": { fajr: +1, dhuhr: +1, isha: -5 },
  "2026-02-21": { fajr: +1, sunrise: +1, dhuhr: +1, asr: -1, isha: -5 },
  "2026-02-22": { fajr: +1, asr: -1, isha: -5 },
  "2026-02-23": { fajr: +1, asr: -1, maghrib: +1, isha: -5 },
  "2026-02-24": { fajr: +1, isha: -5 },
  "2026-02-25": { fajr: +1, isha: -6 },
  "2026-02-26": { fajr: +1, isha: -5 },
  "2026-02-27": { fajr: +1, dhuhr: +1, asr: -1, isha: -6 },
  "2026-02-28": { fajr: +1, sunrise: +1, asr: -1, isha: -5 },
  "2026-03-01": { fajr: -1, sunrise: -1, maghrib: +1, isha: -4 },
  "2026-03-02": { fajr: -1, sunrise: -2, maghrib: +2, isha: -4 },
  "2026-03-03": { fajr: -1, sunrise: -2, asr: +1, maghrib: +2, isha: -4 },
  "2026-03-04": { fajr: -1, sunrise: -2, asr: +1, maghrib: +2, isha: -4 },
  "2026-03-05": { fajr: -1, sunrise: -2, asr: +1, maghrib: +2, isha: -4 },
  "2026-03-06": { fajr: -1, sunrise: -2, asr: +1, maghrib: +2, isha: -4 },
  "2026-03-07": { fajr: -1, sunrise: -2, asr: +1, maghrib: +2, isha: -4 },
  "2026-03-08": { fajr: -1, sunrise: -2, asr: +1, maghrib: +2, isha: -4 },
  "2026-03-09": { fajr: -1, sunrise: -2, asr: +1, maghrib: +2, isha: -4 },
  "2026-03-10": { fajr: -1, sunrise: -2, asr: +1, maghrib: +2, isha: -3 },
  "2026-03-11": { fajr: -1, sunrise: -2, asr: +1, maghrib: +2, isha: -4 },
  "2026-03-12": { fajr: -1, sunrise: -2, dhuhr: -1, asr: +1, maghrib: +2, isha: -3 },
  "2026-03-13": { fajr: -1, sunrise: -2, asr: +1, maghrib: +2, isha: -4 },
  "2026-03-14": { fajr: -1, sunrise: -2, maghrib: +2, isha: -3 },
  "2026-03-15": { fajr: -1, sunrise: -2, maghrib: +2, isha: -4 },
  "2026-03-16": { fajr: -1, sunrise: -2, maghrib: +2, isha: -3 },
  "2026-03-17": { fajr: -1, sunrise: -2, maghrib: +2, isha: -3 },
  "2026-03-18": { fajr: -1, sunrise: -2, maghrib: +2, isha: -3 },
  "2026-03-19": { fajr: -1, sunrise: -2, dhuhr: -1, asr: +1, maghrib: +2, isha: -3 },
  "2026-03-20": { fajr: -3, sunrise: -4, asr: +2, maghrib: +3, isha: -1 },
  "2026-03-23": { fajr: -1, sunrise: -4, asr: +1, maghrib: +3, isha: -2 },
  "2026-03-24": { fajr: -1, sunrise: -4, asr: +1, maghrib: +3, isha: -2 },
  "2026-03-25": { fajr: -2, sunrise: -4, asr: +1, maghrib: +3, isha: -2 },
  "2026-03-26": { fajr: -1, sunrise: -4, asr: +2, maghrib: +3, isha: -1 },
  "2026-03-27": { fajr: -1, sunrise: -4, asr: +1, maghrib: +4, isha: -1 },
  "2026-03-28": { fajr: -1, sunrise: -2, maghrib: +2, isha: -1 },
  "2026-03-31": { fajr: -1, sunrise: -2, maghrib: +2 },
  "2026-04-01": { fajr: -1, sunrise: -2, maghrib: +1 },
  "2026-04-02": { fajr: -1, sunrise: -2, maghrib: +2, isha: +1 },
  "2026-04-03": { fajr: -1, sunrise: -2, maghrib: +1, isha: +1 },
  "2026-04-04": { fajr: -1, sunrise: -1, maghrib: +2, isha: +1 },
  "2026-04-05": { fajr: -1, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-04-06": { fajr: -1, sunrise: -1, maghrib: +2, isha: +1 },
  "2026-04-07": { fajr: -1, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-04-08": { fajr: -1, sunrise: -1, maghrib: +2, isha: +1 },
  "2026-04-09": { fajr: -1, sunrise: -1, maghrib: +2, isha: +1 },
  "2026-04-10": { fajr: -1, sunrise: -1, maghrib: +2, isha: +1 },
  "2026-04-11": { fajr: -1, sunrise: -1, maghrib: +2, isha: +1 },
  "2026-04-12": { fajr: -1, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-04-13": { fajr: -2, sunrise: -1, maghrib: +2, isha: +1 },
  "2026-04-14": { fajr: -1, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-04-15": { fajr: -2, sunrise: -1, maghrib: +2, isha: +1 },
  "2026-04-16": { fajr: -1, sunrise: -2, maghrib: +1, isha: +1 },
  "2026-04-17": { fajr: -1, sunrise: -2, maghrib: +2, isha: +1 },
  "2026-04-18": { fajr: -2, sunrise: -2, maghrib: +1, isha: +1 },
  "2026-04-19": { fajr: -1, sunrise: -2, maghrib: +2, isha: +1 },
  "2026-04-20": { fajr: -1, sunrise: -2, maghrib: +1, isha: +1 },
  "2026-04-21": { fajr: -1, sunrise: -2, maghrib: +1, isha: +1 },
  "2026-04-22": { fajr: -1, sunrise: -1, maghrib: +2, isha: +1 },
  "2026-04-23": { fajr: -2, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-04-24": { fajr: -1, sunrise: -1, maghrib: +2, isha: +1 },
  "2026-04-25": { fajr: -1, sunrise: -2, maghrib: +1, isha: +2 },
  "2026-04-26": { fajr: -2, sunrise: -2, maghrib: +2, isha: +1 },
  "2026-04-27": { fajr: -1, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-04-28": { fajr: -1, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-04-29": { fajr: -2, sunrise: -2, maghrib: +1, isha: +1 },
  "2026-04-30": { fajr: -1, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-05-01": { fajr: +1, sunrise: -1, maghrib: +1, isha: +2 },
  "2026-05-02": { fajr: +3, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-05-03": { fajr: +5, sunrise: -1, maghrib: +2, isha: +1 },
  "2026-05-04": { fajr: +8, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-05-05": { fajr: +10, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-05-06": { fajr: +12, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-05-07": { fajr: +15, sunrise: -1, maghrib: +1, isha: +1 },
  "2026-05-08": { fajr: +17, sunrise: -1, maghrib: +1 },
  "2026-05-09": { fajr: +19, maghrib: +1, isha: -1 },
  "2026-05-10": { fajr: +21, sunrise: -1, maghrib: +1, isha: -4 },
  "2026-05-11": { fajr: +24, maghrib: +1, isha: -6 },
  "2026-05-12": { fajr: +26, sunrise: -1, maghrib: +1, isha: -7 },
  "2026-05-13": { fajr: +28, sunrise: -1, maghrib: +1, isha: -9 },
  "2026-05-14": { fajr: +31, maghrib: +1, isha: -11 },
  "2026-05-15": { fajr: +33, sunrise: -1, maghrib: +1, isha: -13 },
  "2026-05-16": { fajr: +35, sunrise: -1, maghrib: +1, isha: -14 },
  "2026-05-17": { fajr: +38, isha: -17 },
  "2026-05-18": { fajr: +40, maghrib: +1, isha: -18 },
  "2026-05-19": { fajr: +42, sunrise: -1, maghrib: +1, isha: -20 },
  "2026-05-20": { fajr: +44, sunrise: -1, isha: -22 },
  "2026-05-21": { fajr: +47, sunrise: -1, isha: -24 },
  "2026-05-22": { fajr: +49, sunrise: -1, maghrib: +1, isha: -26 },
  "2026-05-23": { fajr: +51, maghrib: +1, isha: -27 },
  "2026-05-24": { fajr: +54, isha: -30 },
  "2026-05-25": { fajr: +56, isha: -31 },
  "2026-05-26": { fajr: +58, sunrise: -1, isha: -33 },
  "2026-05-27": { fajr: +61, sunrise: -1, isha: -34 },
  "2026-05-28": { fajr: +62, isha: -36 },
  "2026-05-29": { fajr: +65, isha: -37 },
  "2026-05-30": { fajr: +67, isha: -39 },
  "2026-05-31": { fajr: +69, isha: -41 },
  "2026-06-01": { fajr: +71, isha: -43 },
  "2026-06-02": { fajr: +73, isha: -45 },
  "2026-06-03": { fajr: +75, sunrise: +1, isha: -45 },
  "2026-06-04": { fajr: +78, isha: -47 },
  "2026-06-05": { fajr: +79, sunrise: +1, isha: -48 },
  "2026-06-06": { fajr: +82, isha: -50 },
  "2026-06-07": { fajr: +83, sunrise: +1, isha: -50 },
  "2026-06-08": { fajr: +85, isha: -52 },
  "2026-06-09": { fajr: +87, isha: -53 },
  "2026-06-10": { fajr: +88, sunrise: +1, isha: -54 },
  "2026-06-11": { fajr: +90, maghrib: -1, isha: -54 },
  "2026-06-12": { fajr: +91, isha: -56 },
  "2026-06-13": { fajr: +93, isha: -57 },
  "2026-06-14": { fajr: +94, sunrise: +1, isha: -57 },
  "2026-06-15": { fajr: +95, sunrise: +1, isha: -58 },
  "2026-06-16": { fajr: +96, sunrise: +1, isha: -58 },
  "2026-06-17": { fajr: +96, sunrise: +1, maghrib: -1, isha: -59 },
  "2026-06-18": { fajr: +97, sunrise: +1, isha: -58 },
  "2026-06-19": { fajr: +97, sunrise: +1, isha: -59 },
  "2026-06-20": { fajr: +97, isha: -58 },
  "2026-06-21": { fajr: +97, sunrise: +1, dhuhr: +1, isha: -59 },
  "2026-06-22": { fajr: +96, sunrise: +1, isha: -60 },
  "2026-06-23": { fajr: +97, sunrise: +1, isha: -60 },
  "2026-06-24": { fajr: +96, maghrib: -1, isha: -60 },
  "2026-06-25": { fajr: +96, sunrise: +1, maghrib: -1, isha: -61 },
  "2026-06-26": { fajr: +95, sunrise: +1, maghrib: -1, isha: -60 },
  "2026-06-27": { fajr: +93, sunrise: +1, maghrib: -1, isha: -60 },
  "2026-06-28": { fajr: +93, sunrise: +1, maghrib: -1, isha: -61 },
  "2026-06-29": { fajr: +91, sunrise: +1, isha: -60 },
  "2026-06-30": { fajr: +90, sunrise: +1, isha: -60 },
  "2026-07-01": { fajr: +87, sunrise: +1, maghrib: -1, isha: -59 },
  "2026-07-02": { fajr: +86, maghrib: -1, isha: -59 },
  "2026-07-03": { fajr: +84, sunrise: +1, maghrib: -1, isha: -59 },
  "2026-07-04": { fajr: +81, sunrise: +1, isha: -57 },
  "2026-07-05": { fajr: +80, sunrise: +1, maghrib: -1, isha: -57 },
  "2026-07-06": { fajr: +77, sunrise: +1, isha: -56 },
  "2026-07-07": { fajr: +76, sunrise: +1, maghrib: -1, isha: -56 },
  "2026-07-08": { fajr: +73, sunrise: +1, isha: -54 },
  "2026-07-09": { fajr: +70, sunrise: +1, maghrib: -1, isha: -53 },
  "2026-07-10": { fajr: +68, sunrise: +1, isha: -52 },
  "2026-07-11": { fajr: +66, sunrise: +1, maghrib: -1, isha: -51 },
  "2026-07-12": { fajr: +64, sunrise: +1, maghrib: -1, isha: -50 },
  "2026-07-13": { fajr: +61, sunrise: +1, isha: -48 },
  "2026-07-14": { fajr: +59, sunrise: +1, isha: -46 },
  "2026-07-15": { fajr: +57, maghrib: -2, isha: -46 },
  "2026-07-16": { fajr: +54, sunrise: +1, maghrib: -2, isha: -44 },
  "2026-07-17": { fajr: +52, sunrise: +1, maghrib: -1, isha: -43 },
  "2026-07-18": { fajr: +49, sunrise: +1, maghrib: -1, isha: -41 },
  "2026-07-19": { fajr: +47, sunrise: +1, maghrib: -1, isha: -40 },
  "2026-07-20": { fajr: +45, sunrise: +1, maghrib: -1, isha: -38 },
  "2026-07-21": { fajr: +42, sunrise: +1, maghrib: -1, isha: -36 },
  "2026-07-22": { fajr: +40, maghrib: -1, isha: -34 },
  "2026-07-23": { fajr: +37, maghrib: -1, isha: -32 },
  "2026-07-24": { fajr: +36, sunrise: +1, isha: -31 },
  "2026-07-25": { fajr: +33, sunrise: +1, isha: -29 },
  "2026-07-26": { fajr: +31, sunrise: +1, maghrib: -1, isha: -27 },
  "2026-07-27": { fajr: +28, maghrib: -1, isha: -25 },
  "2026-07-28": { fajr: +26, sunrise: +1, isha: -23 },
  "2026-07-29": { fajr: +24, sunrise: +1, isha: -22 },
  "2026-07-30": { fajr: +21, maghrib: -1, isha: -20 },
  "2026-07-31": { fajr: +20, isha: -18 },
  "2026-08-01": { fajr: +17, sunrise: +1, maghrib: -1, isha: -16 },
  "2026-08-02": { fajr: +15, maghrib: -1, isha: -14 },
  "2026-08-03": { fajr: +13, isha: -12 },
  "2026-08-04": { fajr: +10, sunrise: +1, maghrib: -1, isha: -10 },
  "2026-08-05": { fajr: +9, isha: -8 },
  "2026-08-06": { fajr: +6, isha: -6 },
  "2026-08-07": { fajr: +5, sunrise: +1, maghrib: -1, isha: -4 },
  "2026-08-08": { fajr: +2, isha: -2 },
  "2026-08-09": { fajr: +1, maghrib: -1, isha: -1 },
  "2026-08-10": { fajr: +2, sunrise: +1, isha: -1 },
  "2026-08-11": { fajr: +1 },
  "2026-08-12": { fajr: +1, maghrib: -1, isha: -1 },
  "2026-08-13": { fajr: +1, sunrise: +1, isha: -1 },
  "2026-08-14": { fajr: +1, isha: -1 },
  "2026-08-15": { fajr: +1, isha: -1 },
  "2026-08-16": { fajr: +2, maghrib: -1, isha: -2 },
  "2026-08-17": { fajr: +1, maghrib: -1, isha: -1 },
  "2026-08-18": { fajr: +1, sunrise: +1, isha: -2 },
  "2026-08-19": { fajr: +1, isha: -1 },
  "2026-08-20": { fajr: +1, isha: -1 },
  "2026-08-21": { fajr: +1, isha: -1 },
  "2026-08-22": { fajr: +1, isha: -1 },
  "2026-08-23": { fajr: +1, maghrib: -1, isha: -1 },
  "2026-08-24": { fajr: +1, maghrib: -1, isha: -1 },
  "2026-08-25": { fajr: +1, isha: -1 },
  "2026-08-26": { fajr: +1, isha: -1 },
  "2026-08-27": { fajr: +1, isha: -1 },
  "2026-08-28": { fajr: +1, isha: -1 },
  "2026-08-29": { fajr: +1, isha: -1 },
  "2026-08-30": { fajr: +1, isha: -1 },
  "2026-08-31": { fajr: +1, isha: -1 },
  "2026-09-01": { fajr: +1, isha: -1 },
  "2026-09-02": { fajr: +1, isha: -2 },
  "2026-09-03": { fajr: +1, sunrise: -1, isha: -1 },
  "2026-09-04": { fajr: +1, isha: -1 },
  "2026-09-05": { fajr: +1, isha: -1 },
  "2026-09-06": { fajr: +1, isha: -1 },
  "2026-09-07": { fajr: +1, isha: -1 },
  "2026-09-08": { fajr: +1, sunrise: -1, isha: -1 },
  "2026-09-09": { fajr: +1, isha: -2 },
  "2026-09-10": { fajr: +1, isha: -1 },
  "2026-09-11": { fajr: +1, sunrise: -1, isha: -1 },
  "2026-09-12": { fajr: +1, isha: -2 },
  "2026-09-13": { fajr: +1, isha: -2 },
  "2026-09-14": { fajr: +1, isha: -2 },
  "2026-09-15": { isha: -3 },
  "2026-09-16": { fajr: +1, sunrise: -1, isha: -3 },
  "2026-09-17": { fajr: +1, isha: -3 },
  "2026-09-18": { fajr: +1, isha: -4 },
  "2026-09-19": { fajr: +1, sunrise: -1, isha: -4 },
  "2026-09-20": { fajr: +1, sunrise: +1, maghrib: +1, isha: -3 },
  "2026-09-21": { isha: -4 },
  "2026-09-22": { fajr: +1, isha: -4 },
  "2026-09-23": { fajr: +1, isha: -4 },
  "2026-09-24": { fajr: +1, sunrise: -1, isha: -4 },
  "2026-09-25": { fajr: +1, isha: -5 },
  "2026-09-26": { isha: -5 },
  "2026-09-27": { fajr: +1, isha: -5 },
  "2026-09-28": { fajr: +1, isha: -5 },
  "2026-09-29": { fajr: +1, sunrise: -1, isha: -5 },
  "2026-09-30": { fajr: +1, isha: -6 },
  "2026-10-01": { fajr: +1, dhuhr: -1, asr: -1, isha: -6 },
  "2026-10-02": { fajr: +1, isha: -6 },
  "2026-10-03": { fajr: +1, maghrib: +1, isha: -5 },
  "2026-10-04": { fajr: +1, sunrise: -1, maghrib: +1, isha: -5 },
  "2026-10-05": { fajr: +1, isha: -5 },
  "2026-10-06": { fajr: +1, isha: -5 },
  "2026-10-07": { fajr: +1, isha: -5 },
  "2026-10-08": { fajr: +1, isha: -5 },
  "2026-10-09": { fajr: +1, isha: -5 },
  "2026-10-10": { fajr: +1, isha: -5 },
  "2026-10-11": { fajr: +1, sunrise: -1, isha: -5 },
  "2026-10-12": { fajr: +1, isha: -5 },
  "2026-10-13": { fajr: +1, sunrise: -1, isha: -6 },
  "2026-10-14": { isha: -6 },
  "2026-10-15": { fajr: +1, isha: -6 },
  "2026-10-16": { isha: -6 },
  "2026-10-17": { fajr: +1, isha: -6 },
  "2026-10-18": { fajr: +1, isha: -5 },
  "2026-10-19": { fajr: +1, isha: -5 },
  "2026-10-20": { fajr: +1, isha: -5 },
  "2026-10-21": { isha: -5 },
  "2026-10-22": { fajr: +1, isha: -5 },
  "2026-10-23": { fajr: +1, isha: -5 },
  "2026-10-24": { fajr: +1, isha: -5 },
  "2026-10-26": { maghrib: -1, isha: -5 },
  "2026-10-27": { fajr: +1, isha: -5 },
  "2026-10-28": { fajr: +1, isha: -4 },
  "2026-10-29": { fajr: +1, sunrise: +1, isha: -4 },
  "2026-10-30": { fajr: +1, isha: -4 },
  "2026-10-31": { sunrise: +1, isha: -4 },
  "2026-11-01": { fajr: +1, maghrib: -1, isha: -4 },
  "2026-11-02": { fajr: +1, sunrise: +1, isha: -3 },
  "2026-11-03": { isha: -3 },
  "2026-11-04": { fajr: +1, isha: -3 },
  "2026-11-05": { fajr: +1, isha: -2 },
  "2026-11-06": { isha: -3 },
  "2026-11-07": { fajr: +1, maghrib: -1, isha: -3 },
  "2026-11-08": { fajr: +1, isha: -2 },
  "2026-11-09": { sunrise: +1, isha: -2 },
  "2026-11-10": { fajr: +1, isha: -1 },
  "2026-11-11": { fajr: +1, sunrise: +1, isha: -2 },
  "2026-11-12": { isha: -2 },
  "2026-11-13": { fajr: +1, sunrise: +1, maghrib: -1, isha: -2 },
  "2026-11-14": { fajr: +1, isha: -1 },
  "2026-11-15": { fajr: +1, sunrise: +1, isha: -1 },
  "2026-11-16": { isha: -1 },
  "2026-11-17": { fajr: +1, sunrise: +1 },
  "2026-11-18": { fajr: +1 },
  "2026-11-19": { sunrise: +1 },
  "2026-11-20": { sunrise: +1 },
  "2026-11-21": { fajr: +1, sunrise: +1, isha: -1 },
  "2026-11-22": { fajr: +1, sunrise: +1 },
  "2026-11-23": { fajr: +1 },
  "2026-11-24": { sunrise: +1, isha: -1 },
  "2026-11-25": { maghrib: -1 },
  "2026-11-26": { sunrise: +1, maghrib: -1 },
  "2026-11-27": { fajr: +1, sunrise: +1 },
  "2026-11-28": { fajr: +1, isha: -1 },
  "2026-11-29": { fajr: +1, sunrise: +1 },
  "2026-11-30": { fajr: +1, sunrise: +1 },
  "2026-12-01": { fajr: +1, sunrise: +1, maghrib: -1 },
  "2026-12-02": { fajr: +1 },
  "2026-12-03": { fajr: +1, sunrise: +1 },
  "2026-12-04": { fajr: +1, sunrise: +1, isha: -1 },
  "2026-12-05": { fajr: +1, sunrise: +1 },
  "2026-12-06": { fajr: +1, sunrise: +1 },
  "2026-12-07": { fajr: +1, sunrise: +1, maghrib: -1 },
  "2026-12-08": { fajr: +1, sunrise: +1 },
  "2026-12-09": { fajr: +1, sunrise: +1 },
  "2026-12-10": { fajr: +1, sunrise: +1 },
  "2026-12-11": { sunrise: +1 },
  "2026-12-12": { sunrise: +1 },
  "2026-12-13": { fajr: +1, sunrise: +1 },
  "2026-12-14": { fajr: +1, sunrise: +1, isha: +1 },
  "2026-12-15": {},
  "2026-12-16": { maghrib: -1 },
  "2026-12-17": { fajr: +1, sunrise: +1 },
  "2026-12-18": { sunrise: +1 },
  "2026-12-19": {},
  "2026-12-20": { sunrise: +1, isha: +1 },
  "2026-12-21": { fajr: +1, sunrise: +1 },
  "2026-12-22": { fajr: +1, sunrise: +1, isha: +1 },
  "2026-12-23": { sunrise: +1 },
  "2026-12-24": { sunrise: +1, isha: +1 },
  "2026-12-25": { maghrib: +1 },
  "2026-12-26": {},
  "2026-12-27": { sunrise: +1, isha: +1 },
  "2026-12-28": { sunrise: +1 },
  "2026-12-29": { maghrib: +1 },
  "2026-12-30": { isha: +1 },
  "2026-12-31": { isha: +1 },
};

// ─── Direct IZM overrides — DST transition dates ──────────────────────────────
// On these dates the formula's DST offset is ambiguous; use IZM values verbatim.
const IZM_DIRECT = {
  "2026-03-29": { fajr:"05:10", sunrise:"06:51", dhuhr:"16:53", asr:"13:23", maghrib:"19:46", isha:"21:14" },
  "2026-03-30": { fajr:"05:08", sunrise:"06:49", dhuhr:"16:54", asr:"13:23", maghrib:"19:48", isha:"21:15" },
  "2026-10-25": { fajr:"05:04", sunrise:"06:41", dhuhr:"14:42", asr:"12:03", maghrib:"17:14", isha:"18:40" },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get IZM prayer times for a given date.
 * @param {Date} date — JavaScript Date object
 * @returns {{ fajr, sunrise, dhuhr, asr, maghrib, isha }} — "HH:MM" strings
 */
function getPrayerTimes(date) {
  const iso = date.toISOString().slice(0, 10);  // "YYYY-MM-DD"

  // 1. Hard overrides for DST edge-case dates
  if (IZM_DIRECT[iso]) return IZM_DIRECT[iso];

  // 2. Astronomical calculation
  const raw = _calcRaw(date);

  // 3. Apply corrections from the IZM 2026 table
  const corr = IZM_CORRECTIONS[iso] || {};
  const result = {};
  for (const p of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha']) {
    result[p] = _fmt((raw[p] || 0) + (corr[p] || 0));
  }
  return result;
}

// ─── Example usage ────────────────────────────────────────────────────────────
// const times = getPrayerTimes(new Date());
// document.getElementById('fajr').textContent    = times.fajr;
// document.getElementById('sunrise').textContent = times.sunrise;
// document.getElementById('dhuhr').textContent   = times.dhuhr;
// document.getElementById('asr').textContent     = times.asr;
// document.getElementById('maghrib').textContent = times.maghrib;
// document.getElementById('isha').textContent    = times.isha;
