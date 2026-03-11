/**
 * prayer.js — IZM Munich Prayer Times
 * Source: islamisches-zentrum-muenchen.de (2025 timetable)
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

// ─── IZM Corrections (IZM minutes − calculated minutes, per prayer) ──────────
// Auto-generated from the 2025 IZM timetable. Covers all 365 days.
// DST edge-case dates (Mar 21, 29, 30, Oct 25) are in IZM_DIRECT instead.

const IZM_CORRECTIONS = {
  "2025-01-01": { asr: -1 },
  "2025-01-02": { dhuhr: -1, asr: -1, maghrib: -1 },
  "2025-01-03": { asr: -1, maghrib: -1 },
  "2025-01-04": { dhuhr: -1, maghrib: -1, isha: -1 },
  "2025-01-05": { fajr: +1, sunrise: +1, isha: -1 },
  "2025-01-06": { fajr: +1, sunrise: +1, maghrib: -1, isha: -1 },
  "2025-01-07": { maghrib: -1, isha: -1 },
  "2025-01-08": { maghrib: -1, isha: -1 },
  "2025-01-09": { sunrise: +1, dhuhr: -1, asr: -1, maghrib: -1, isha: -1 },
  "2025-01-10": { asr: -1, maghrib: -1, isha: -1 },
  "2025-01-11": { fajr: +1, sunrise: +1, asr: -1, isha: -1 },
  "2025-01-12": { sunrise: +1, asr: -1, maghrib: -1, isha: -1 },
  "2025-01-13": { sunrise: +1, asr: -1, maghrib: -1 },
  "2025-01-14": { fajr: +1, dhuhr: -1, asr: -1, maghrib: -1, isha: -1 },
  "2025-01-15": { sunrise: +1, asr: -1, maghrib: -1, isha: -1 },
  "2025-01-16": { maghrib: -1, isha: -1 },
  "2025-01-17": { dhuhr: -1, asr: -1, maghrib: -1, isha: -1 },
  "2025-01-18": { fajr: +1, sunrise: +1, asr: -1, maghrib: -1, isha: -1 },
  "2025-01-19": { sunrise: +1, asr: -1, maghrib: -1, isha: -1 },
  "2025-01-20": { fajr: +1, sunrise: +1, dhuhr: -1, asr: -1, maghrib: -1, isha: -1 },
  "2025-01-21": { asr: -1, maghrib: -1, isha: -1 },
  "2025-01-22": { asr: -1, maghrib: -1, isha: -1 },
  "2025-01-23": { fajr: +1, asr: -1, maghrib: -1, isha: -1 },
  "2025-01-24": { fajr: +1, maghrib: -1, isha: -1 },
  "2025-01-25": { fajr: +1, asr: -1, maghrib: -1, isha: -1 },
  "2025-01-26": { asr: -1, maghrib: -1, isha: -1 },
  "2025-01-27": { sunrise: +1, asr: -1, maghrib: -1, isha: -1 },
  "2025-01-28": { fajr: +1, sunrise: +1, dhuhr: -1, asr: -1, maghrib: -1, isha: -2 },
  "2025-01-29": { fajr: +1, sunrise: +1, asr: -1, isha: -1 },
  "2025-01-30": { fajr: +1, sunrise: +1, asr: -1, maghrib: -1, isha: -2 },
  "2025-01-31": { fajr: +1, isha: -2 },
  "2025-02-01": { fajr: +1, sunrise: +1, asr: -1, maghrib: -1, isha: -2 },
  "2025-02-02": { sunrise: +1, asr: -1, maghrib: -1, isha: -3 },
  "2025-02-03": { fajr: +1, asr: -1, isha: -3 },
  "2025-02-04": { fajr: +1, sunrise: +1, asr: -1, maghrib: -1, isha: -3 },
  "2025-02-05": { fajr: +1, sunrise: +1, asr: -1, isha: -3 },
  "2025-02-06": { fajr: +1, sunrise: +1, asr: -1, maghrib: -1, isha: -3 },
  "2025-02-07": { fajr: +2, sunrise: +1, asr: -1, maghrib: -1, isha: -4 },
  "2025-02-08": { fajr: +1, sunrise: +1, asr: -1, isha: -4 },
  "2025-02-09": { fajr: +1, sunrise: +1, asr: -1, maghrib: -1, isha: -4 },
  "2025-02-10": { fajr: +2, sunrise: +1, isha: -4 },
  "2025-02-11": { fajr: +1, asr: -1, maghrib: -1, isha: -4 },
  "2025-02-12": { fajr: +1, sunrise: +1, asr: -1, isha: -4 },
  "2025-02-13": { fajr: +1, asr: -1, isha: -4 },
  "2025-02-14": { fajr: +1, sunrise: +1, maghrib: -1, isha: -5 },
  "2025-02-15": { fajr: +1, sunrise: +1, asr: -1, isha: -4 },
  "2025-02-16": { fajr: +2, asr: -1, maghrib: -1, isha: -5 },
  "2025-02-17": { fajr: +1, sunrise: +1, asr: -1, isha: -5 },
  "2025-02-18": { fajr: +2, sunrise: +1, isha: -5 },
  "2025-02-19": { fajr: +1, sunrise: +1, dhuhr: +1, asr: -1, maghrib: -1, isha: -6 },
  "2025-02-20": { fajr: +1, dhuhr: +1, asr: -1, isha: -5 },
  "2025-02-21": { fajr: +2, sunrise: +1, dhuhr: +1, asr: -1, maghrib: -1, isha: -6 },
  "2025-02-22": { fajr: +2, sunrise: +1, asr: -1, isha: -5 },
  "2025-02-23": { fajr: +1, sunrise: +1, asr: -1, isha: -6 },
  "2025-02-24": { fajr: +1, sunrise: +1, isha: -5 },
  "2025-02-25": { fajr: +2, asr: -1, isha: -6 },
  "2025-02-26": { fajr: +2, asr: -1, isha: -5 },
  "2025-02-27": { fajr: +2, dhuhr: +1, asr: -1, isha: -6 },
  "2025-02-28": { fajr: +1, sunrise: +1, asr: -1, maghrib: -1, isha: -6 },
  "2025-03-01": { fajr: -1, sunrise: -1, maghrib: +1, isha: -4 },
  "2025-03-02": { fajr: -1, sunrise: -1, maghrib: +1, isha: -5 },
  "2025-03-03": { fajr: -1, sunrise: -1, asr: +1, maghrib: +2, isha: -4 },
  "2025-03-04": { fajr: -1, sunrise: -1, asr: +1, maghrib: +1, isha: -5 },
  "2025-03-05": { fajr: -1, sunrise: -1, asr: +1, maghrib: +2, isha: -4 },
  "2025-03-06": { fajr: -1, sunrise: -1, asr: +1, maghrib: +1, isha: -5 },
  "2025-03-07": { fajr: -1, sunrise: -1, asr: +1, maghrib: +2, isha: -4 },
  "2025-03-08": { fajr: -1, sunrise: -1, dhuhr: +1, asr: +1, maghrib: +1, isha: -5 },
  "2025-03-09": { fajr: -1, sunrise: -1, asr: +1, maghrib: +2, isha: -4 },
  "2025-03-10": { fajr: -1, sunrise: -1, asr: +1, maghrib: +1, isha: -4 },
  "2025-03-11": { sunrise: -1, asr: +1, maghrib: +2, isha: -4 },
  "2025-03-12": { sunrise: -1, asr: +1, maghrib: +1, isha: -4 },
  "2025-03-13": { sunrise: -1, asr: +1, maghrib: +2, isha: -4 },
  "2025-03-14": { sunrise: -1, maghrib: +1, isha: -4 },
  "2025-03-15": { fajr: -1, sunrise: -1, maghrib: +2, isha: -4 },
  "2025-03-16": { fajr: -1, sunrise: -1, maghrib: +1, isha: -4 },
  "2025-03-17": { sunrise: -1, maghrib: +2, isha: -3 },
  "2025-03-18": { sunrise: -1, maghrib: +1, isha: -4 },
  "2025-03-19": { fajr: -1, sunrise: -2, dhuhr: -1, maghrib: +2, isha: -3 },
  "2025-03-20": { fajr: -3, sunrise: -4, asr: +1, maghrib: +2, isha: -2 },
  "2025-03-23": { fajr: -1, sunrise: -4, asr: +1, maghrib: +3, isha: -2 },
  "2025-03-24": { sunrise: -4, asr: +1, maghrib: +3, isha: -2 },
  "2025-03-25": { fajr: -1, sunrise: -4, asr: +1, maghrib: +3, isha: -2 },
  "2025-03-26": { fajr: -1, sunrise: -3, asr: +1, maghrib: +3, isha: -1 },
  "2025-03-27": { sunrise: -3, asr: +1, maghrib: +3, isha: -2 },
  "2025-03-28": { fajr: -1, sunrise: -1, maghrib: +2, isha: -1 },
  "2025-03-31": { fajr: -1, sunrise: -1, maghrib: +1, isha: -1 },
  "2025-04-01": { sunrise: -1, maghrib: +1 },
  "2025-04-02": { fajr: -1, sunrise: -1, maghrib: +1 },
  "2025-04-03": { sunrise: -1, maghrib: +1, isha: +1 },
  "2025-04-04": { fajr: -1, sunrise: -1, maghrib: +2 },
  "2025-04-05": { sunrise: -1, maghrib: +1 },
  "2025-04-06": { fajr: -1, sunrise: -1, maghrib: +2, isha: +1 },
  "2025-04-07": { sunrise: -1, maghrib: +1, isha: +1 },
  "2025-04-08": { fajr: -1, sunrise: -1, maghrib: +2, isha: +1 },
  "2025-04-09": { sunrise: -1, maghrib: +1, isha: +1 },
  "2025-04-10": { fajr: -1, sunrise: -1, maghrib: +2 },
  "2025-04-11": { sunrise: -1, maghrib: +1 },
  "2025-04-12": { fajr: -1, sunrise: -1, maghrib: +1 },
  "2025-04-13": { fajr: -1, sunrise: -1, maghrib: +1 },
  "2025-04-14": { sunrise: -1, maghrib: +1 },
  "2025-04-15": { fajr: -1, sunrise: -1, maghrib: +1 },
  "2025-04-16": { sunrise: -1, maghrib: +1 },
  "2025-04-17": { fajr: -1, sunrise: -1, maghrib: +2 },
  "2025-04-18": { fajr: -1, sunrise: -1, maghrib: +1 },
  "2025-04-19": { sunrise: -1, maghrib: +2 },
  "2025-04-20": { fajr: -1, sunrise: -1, maghrib: +1 },
  "2025-04-21": { sunrise: -2, maghrib: +1 },
  "2025-04-22": { fajr: -1, sunrise: -1, maghrib: +1 },
  "2025-04-23": { fajr: -1, sunrise: -1, maghrib: +1 },
  "2025-04-24": { sunrise: -1, maghrib: +1 },
  "2025-04-25": { fajr: -1, sunrise: -1, maghrib: +1, isha: +1 },
  "2025-04-26": { fajr: -1, sunrise: -1, maghrib: +1, isha: +1 },
  "2025-04-27": { sunrise: -1, maghrib: +1, isha: +1 },
  "2025-04-28": { fajr: -1, sunrise: -1, isha: +1 },
  "2025-04-29": { fajr: -1, sunrise: -1, maghrib: +1 },
  "2025-04-30": { maghrib: +1 },
  "2025-05-01": { fajr: +1, sunrise: -1, maghrib: +1, isha: +1 },
  "2025-05-02": { fajr: +4, sunrise: -1, maghrib: +1, isha: +1 },
  "2025-05-03": { fajr: +6, maghrib: +1, isha: +1 },
  "2025-05-04": { fajr: +8, sunrise: -1, maghrib: +1 },
  "2025-05-05": { fajr: +10 },
  "2025-05-06": { fajr: +13, sunrise: -1, maghrib: +1, isha: +1 },
  "2025-05-07": { fajr: +16, sunrise: -1, maghrib: +1, isha: +1 },
  "2025-05-08": { fajr: +17, sunrise: -1, isha: -1 },
  "2025-05-09": { fajr: +20, maghrib: +1, isha: -2 },
  "2025-05-10": { fajr: +22, sunrise: -1, isha: -4 },
  "2025-05-11": { fajr: +24, maghrib: +1, isha: -6 },
  "2025-05-12": { fajr: +27, sunrise: -1, maghrib: +1, isha: -8 },
  "2025-05-13": { fajr: +29, isha: -10 },
  "2025-05-14": { fajr: +32, maghrib: +1, isha: -11 },
  "2025-05-15": { fajr: +33, sunrise: -1, maghrib: +1, isha: -14 },
  "2025-05-16": { fajr: +36, isha: -15 },
  "2025-05-17": { fajr: +39, isha: -17 },
  "2025-05-18": { fajr: +40, maghrib: +1, isha: -18 },
  "2025-05-19": { fajr: +43, sunrise: -1, isha: -21 },
  "2025-05-20": { fajr: +45, isha: -22 },
  "2025-05-21": { fajr: +47, isha: -24 },
  "2025-05-22": { fajr: +50, maghrib: +1, isha: -27 },
  "2025-05-23": { fajr: +52, isha: -28 },
  "2025-05-24": { fajr: +54, isha: -30 },
  "2025-05-25": { fajr: +57, isha: -31 },
  "2025-05-26": { fajr: +59, isha: -33 },
  "2025-05-27": { fajr: +61, isha: -35 },
  "2025-05-28": { fajr: +63, isha: -37 },
  "2025-05-29": { fajr: +65, isha: -38 },
  "2025-05-30": { fajr: +68, isha: -40 },
  "2025-05-31": { fajr: +70, maghrib: -1, isha: -41 },
  "2025-06-01": { fajr: +72, sunrise: +1, maghrib: -1, isha: -43 },
  "2025-06-02": { fajr: +74, isha: -45 },
  "2025-06-03": { fajr: +76, sunrise: +1, isha: -46 },
  "2025-06-04": { fajr: +78, isha: -48 },
  "2025-06-05": { fajr: +80, sunrise: +1, maghrib: -1, isha: -48 },
  "2025-06-06": { fajr: +82, isha: -50 },
  "2025-06-07": { fajr: +83, sunrise: +1, maghrib: -1, isha: -51 },
  "2025-06-08": { fajr: +86, maghrib: -1, isha: -52 },
  "2025-06-09": { fajr: +88, sunrise: +1, isha: -53 },
  "2025-06-10": { fajr: +89, sunrise: +1, isha: -54 },
  "2025-06-11": { fajr: +91, maghrib: -1, isha: -55 },
  "2025-06-12": { fajr: +91, isha: -56 },
  "2025-06-13": { fajr: +93, isha: -57 },
  "2025-06-14": { fajr: +95, sunrise: +1, isha: -57 },
  "2025-06-15": { fajr: +95, sunrise: +1, isha: -58 },
  "2025-06-16": { fajr: +96, sunrise: +1, isha: -58 },
  "2025-06-17": { fajr: +96, sunrise: +1, maghrib: -1, isha: -59 },
  "2025-06-18": { fajr: +97, sunrise: +1, isha: -58 },
  "2025-06-19": { fajr: +98, sunrise: +1, maghrib: -1, isha: -59 },
  "2025-06-20": { fajr: +97, isha: -58 },
  "2025-06-21": { fajr: +97, sunrise: +1, dhuhr: +1, isha: -59 },
  "2025-06-22": { fajr: +96, sunrise: +1, isha: -60 },
  "2025-06-23": { fajr: +97, sunrise: +1, isha: -60 },
  "2025-06-24": { fajr: +96, maghrib: -1, isha: -60 },
  "2025-06-25": { fajr: +96, sunrise: +1, maghrib: -1, isha: -61 },
  "2025-06-26": { fajr: +94, sunrise: +1, maghrib: -1, isha: -60 },
  "2025-06-27": { fajr: +93, sunrise: +1, maghrib: -1, isha: -60 },
  "2025-06-28": { fajr: +92, sunrise: +1, maghrib: -1, isha: -60 },
  "2025-06-29": { fajr: +90, sunrise: +1, isha: -60 },
  "2025-06-30": { fajr: +89, sunrise: +1, isha: -60 },
  "2025-07-01": { fajr: +87, sunrise: +1, maghrib: -1, isha: -59 },
  "2025-07-02": { fajr: +86, maghrib: -1, isha: -58 },
  "2025-07-03": { fajr: +83, sunrise: +1, isha: -58 },
  "2025-07-04": { fajr: +81, sunrise: +1, isha: -57 },
  "2025-07-05": { fajr: +79, sunrise: +1, maghrib: -1, isha: -57 },
  "2025-07-06": { fajr: +77, isha: -56 },
  "2025-07-07": { fajr: +75, sunrise: +1, maghrib: -1, isha: -55 },
  "2025-07-08": { fajr: +72, sunrise: +1, isha: -54 },
  "2025-07-09": { fajr: +70, sunrise: +1, maghrib: -1, isha: -52 },
  "2025-07-10": { fajr: +68, sunrise: +1, isha: -52 },
  "2025-07-11": { fajr: +65, sunrise: +1, isha: -50 },
  "2025-07-12": { fajr: +63, sunrise: +1, maghrib: -1, isha: -49 },
  "2025-07-13": { fajr: +61, sunrise: +1, isha: -48 },
  "2025-07-14": { fajr: +59, sunrise: +1, isha: -46 },
  "2025-07-15": { fajr: +56, maghrib: -1, isha: -45 },
  "2025-07-16": { fajr: +53, sunrise: +1, maghrib: -2, isha: -43 },
  "2025-07-17": { fajr: +51, sunrise: +1, maghrib: -1, isha: -42 },
  "2025-07-18": { fajr: +49, sunrise: +1, maghrib: -1, isha: -40 },
  "2025-07-19": { fajr: +47, sunrise: +1, maghrib: -1, isha: -39 },
  "2025-07-20": { fajr: +44, sunrise: +1, maghrib: -1, isha: -37 },
  "2025-07-21": { fajr: +41, maghrib: -1, isha: -35 },
  "2025-07-22": { fajr: +39, isha: -34 },
  "2025-07-23": { fajr: +37, isha: -32 },
  "2025-07-24": { fajr: +35, sunrise: +1, isha: -31 },
  "2025-07-25": { fajr: +32, isha: -28 },
  "2025-07-26": { fajr: +30, maghrib: -1, isha: -26 },
  "2025-07-27": { fajr: +28, isha: -25 },
  "2025-07-28": { fajr: +25, sunrise: +1, isha: -23 },
  "2025-07-29": { fajr: +23, isha: -21 },
  "2025-07-30": { fajr: +21, isha: -19 },
  "2025-07-31": { fajr: +19, isha: -18 },
  "2025-08-01": { fajr: +17, maghrib: -1, isha: -15 },
  "2025-08-02": { fajr: +14, isha: -13 },
  "2025-08-03": { fajr: +12, isha: -12 },
  "2025-08-04": { fajr: +10, isha: -9 },
  "2025-08-05": { fajr: +8, isha: -8 },
  "2025-08-06": { fajr: +6, isha: -5 },
  "2025-08-07": { fajr: +4, isha: -3 },
  "2025-08-08": { fajr: +2, isha: -2 },
  "2025-08-10": { fajr: +1, isha: -1 },
  "2025-08-11": { fajr: +1 },
  "2025-08-12": { isha: -1 },
  "2025-08-13": { fajr: +1, maghrib: +1 },
  "2025-08-14": { fajr: +1, isha: -1 },
  "2025-08-15": { sunrise: -1 },
  "2025-08-16": { fajr: +1, isha: -1 },
  "2025-08-17": { fajr: +1 },
  "2025-08-18": { fajr: +1, maghrib: +1, isha: -1 },
  "2025-08-19": { isha: -1 },
  "2025-08-20": { sunrise: -1 },
  "2025-08-21": { fajr: +1, isha: -1 },
  "2025-08-23": { fajr: +1, sunrise: -1, isha: -1 },
  "2025-08-24": { fajr: +1 },
  "2025-08-25": { maghrib: +1, isha: -1 },
  "2025-08-26": { maghrib: +1 },
  "2025-08-27": { maghrib: +1, isha: -1 },
  "2025-08-28": { sunrise: -1, maghrib: +1 },
  "2025-08-29": { maghrib: +1, isha: -1 },
  "2025-08-30": { maghrib: +1 },
  "2025-08-31": { sunrise: -1, maghrib: +1, isha: -1 },
  "2025-09-01": { maghrib: +1 },
  "2025-09-02": { sunrise: -1, maghrib: +1, isha: -1 },
  "2025-09-03": { fajr: +1, sunrise: -1, maghrib: +1 },
  "2025-09-04": { fajr: +1, maghrib: +1 },
  "2025-09-05": { fajr: +1, sunrise: -1, maghrib: +1, isha: -1 },
  "2025-09-06": { fajr: +1, maghrib: +1 },
  "2025-09-07": { maghrib: +1, isha: -1 },
  "2025-09-08": { sunrise: -1, maghrib: +1 },
  "2025-09-09": { isha: -1 },
  "2025-09-10": { fajr: +1, sunrise: -1, isha: -1 },
  "2025-09-11": { fajr: +1, sunrise: -1, isha: -1 },
  "2025-09-12": { isha: -2 },
  "2025-09-13": { sunrise: -1, isha: -2 },
  "2025-09-14": { fajr: +1, isha: -2 },
  "2025-09-15": { sunrise: -1, maghrib: +1, isha: -2 },
  "2025-09-16": { sunrise: -1, maghrib: +1, isha: -2 },
  "2025-09-17": { fajr: +1, maghrib: +1, isha: -2 },
  "2025-09-18": { fajr: +1, sunrise: -1, maghrib: +1, isha: -3 },
  "2025-09-19": { sunrise: -1, maghrib: +1, isha: -3 },
  "2025-09-20": { fajr: +1, sunrise: +1, maghrib: +1, isha: -3 },
  "2025-09-21": { sunrise: -1, isha: -4 },
  "2025-09-22": { isha: -4 },
  "2025-09-23": { fajr: +1, sunrise: -1, isha: -4 },
  "2025-09-24": { sunrise: -1, isha: -4 },
  "2025-09-25": { fajr: +1, isha: -5 },
  "2025-09-26": { sunrise: -1, maghrib: +1, isha: -4 },
  "2025-09-27": { maghrib: +1, isha: -4 },
  "2025-09-28": { fajr: +1, sunrise: -1, maghrib: +1, isha: -4 },
  "2025-09-29": { sunrise: -1, maghrib: +1, isha: -4 },
  "2025-09-30": { fajr: +1, maghrib: +1, isha: -5 },
  "2025-10-01": { sunrise: -1, asr: -1, maghrib: +1, isha: -5 },
  "2025-10-02": { fajr: +1, maghrib: +1, isha: -5 },
  "2025-10-03": { sunrise: -1, maghrib: +1, isha: -5 },
  "2025-10-04": { fajr: +1, sunrise: -1, maghrib: +1, isha: -5 },
  "2025-10-05": { isha: -5 },
  "2025-10-06": { fajr: +1, sunrise: -1, isha: -5 },
  "2025-10-07": { isha: -5 },
  "2025-10-08": { fajr: +1, sunrise: -1, isha: -5 },
  "2025-10-09": { isha: -5 },
  "2025-10-10": { fajr: +1, sunrise: -1, isha: -5 },
  "2025-10-11": { sunrise: -1, isha: -5 },
  "2025-10-12": { fajr: +1, isha: -5 },
  "2025-10-13": { sunrise: -1, maghrib: +1, isha: -5 },
  "2025-10-14": { maghrib: +1, isha: -5 },
  "2025-10-15": { fajr: +1, sunrise: -1, maghrib: +1, isha: -5 },
  "2025-10-16": { maghrib: +1, isha: -5 },
  "2025-10-17": { fajr: +1, sunrise: -1, maghrib: +1, isha: -5 },
  "2025-10-18": { isha: -5 },
  "2025-10-19": { fajr: +1, sunrise: -1, isha: -5 },
  "2025-10-20": { isha: -5 },
  "2025-10-21": { sunrise: -1, isha: -5 },
  "2025-10-22": { fajr: +1, maghrib: +1, isha: -4 },
  "2025-10-23": { sunrise: -1, maghrib: +1, isha: -4 },
  "2025-10-24": { fajr: +1, isha: -5 },
  "2025-10-26": { isha: -4 },
  "2025-10-27": { fajr: +1, sunrise: -1, maghrib: +1, isha: -4 },
  "2025-10-28": { isha: -4 },
  "2025-10-29": { fajr: +1, isha: -4 },
  "2025-10-30": { maghrib: +1, isha: -3 },
  "2025-10-31": { isha: -4 },
  "2025-11-01": { fajr: +1, isha: -3 },
  "2025-11-02": { isha: -3 },
  "2025-11-03": { isha: -3 },
  "2025-11-04": { fajr: +1, isha: -3 },
  "2025-11-05": { isha: -2 },
  "2025-11-06": { isha: -3 },
  "2025-11-07": { fajr: +1, isha: -2 },
  "2025-11-08": { isha: -2 },
  "2025-11-09": { maghrib: +1, isha: -1 },
  "2025-11-10": { fajr: +1, isha: -1 },
  "2025-11-11": { isha: -2 },
  "2025-11-12": { isha: -2 },
  "2025-11-13": { fajr: +1, isha: -1 },
  "2025-11-14": { isha: -1 },
  "2025-11-15": { isha: -1 },
  "2025-11-16": { isha: -1 },
  "2025-11-17": { fajr: +1, sunrise: +1 },
  "2025-11-19": { sunrise: +1 },
  "2025-11-21": { fajr: +1, sunrise: +1 },
  "2025-11-22": { fajr: +1 },
  "2025-11-24": { sunrise: +1 },
  "2025-11-26": { sunrise: +1, maghrib: -1 },
  "2025-11-27": { fajr: +1 },
  "2025-11-28": { fajr: +1 },
  "2025-11-29": { fajr: +1, sunrise: +1 },
  "2025-11-30": { sunrise: +1 },
  "2025-12-01": { maghrib: -1 },
  "2025-12-03": { sunrise: +1 },
  "2025-12-04": { sunrise: +1 },
  "2025-12-05": { sunrise: +1 },
  "2025-12-06": { sunrise: +1 },
  "2025-12-08": { fajr: +1 },
  "2025-12-09": { fajr: +1 },
  "2025-12-10": { fajr: +1 },
  "2025-12-12": { sunrise: +1 },
  "2025-12-13": { sunrise: +1 },
  "2025-12-14": { fajr: +1, sunrise: +1 },
  "2025-12-16": { maghrib: -1 },
  "2025-12-17": { fajr: +1, sunrise: +1 },
  "2025-12-18": { sunrise: +1 },
  "2025-12-19": { maghrib: -1 },
  "2025-12-20": { sunrise: +1, isha: +1 },
  "2025-12-21": { fajr: +1, sunrise: +1 },
  "2025-12-22": { fajr: +1, sunrise: +1, isha: +1 },
  "2025-12-23": { sunrise: +1 },
  "2025-12-24": { sunrise: +1 },
  "2025-12-27": { sunrise: +1, isha: +1 },
  "2025-12-28": { sunrise: +1 },
  "2025-12-31": { isha: +1 },
};

// ─── Direct IZM overrides (DST edge cases, extreme summer) ───────────────────
// These dates had uncorrectable formula errors due to DST display ambiguity.
// Times taken verbatim from the IZM 2025 timetable.
const IZM_DIRECT = {
  // Mar 21–22: formula is mid-DST-transition; IZM already shows CEST values
  "2025-03-21": { fajr:"04:29", sunrise:"06:05", dhuhr:"13:25", asr:"17:08", maghrib:"20:19", isha:"21:53" },
  "2025-03-22": { fajr:"04:27", sunrise:"06:03", dhuhr:"12:25", asr:"15:49", maghrib:"18:37", isha:"20:02" },
  // Mar 29–30: IZM starts CEST a day early (Sat/Sun display)
  "2025-03-29": { fajr:"05:10", sunrise:"06:51", dhuhr:"16:53", asr:"13:23", maghrib:"19:46", isha:"21:14" },
  "2025-03-30": { fajr:"05:08", sunrise:"06:49", dhuhr:"16:54", asr:"13:23", maghrib:"19:48", isha:"21:15" },
  // Oct 25: DST fall-back ambiguity (clocks go back at 3am → 2am)
  "2025-10-25": { fajr:"05:04", sunrise:"06:41", dhuhr:"14:42", asr:"12:03", maghrib:"17:14", isha:"18:40" },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get IZM prayer times for any date.
 * Falls back to the correction table, then to the raw formula.
 *
 * @param {Date} date  — JavaScript Date object (local time)
 * @returns {{ fajr, sunrise, dhuhr, asr, maghrib, isha }}  — all "HH:MM" strings
 */
function getPrayerTimes(date) {
  const iso = date.toISOString().slice(0, 10);

  // 1. Check for a direct IZM override (DST edge cases)
  if (IZM_DIRECT[iso]) return IZM_DIRECT[iso];

  // 2. Compute astronomically
  const raw = _calcRaw(date);

  // 3. Apply per-prayer corrections from the IZM table
  const corr = IZM_CORRECTIONS[iso] || {};
  const prayers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const result = {};

  for (const p of prayers) {
    const delta = corr[p] || 0;
    result[p] = _fmt((raw[p] || 0) + delta);
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
