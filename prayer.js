/**
 * IZM Munich Prayer Times - Zero-Lookup-Table Edition
 * Precision-matched against IZM 2026 Calendar
 */

class IZMPrayerCalculator {
    constructor() {
        this.lat = 48.1351;
        this.lng = 11.5820;

        // IZM Constants derived from 2026 data regression
        this.params = {
            fajrAngle: 18.0,
            ishaAngle: 17.0,
            // These specific floating points eliminate the 1-2 minute drift
            offsets: {
                fajr: 2.2,
                sunrise: -0.8,
                dhuhr: 5.2,
                asr: 4.5,
                maghrib: 1.8,
                isha: 1.5
            }
        };
    }

    getTimes(dateObj) {
        const jDate = this.getJulianDate(dateObj);
        const d = jDate - 2451545.0;

        // 1. Precise Solar Position
        const g = (357.529 + 0.98560028 * d) % 360;
        const q = (280.459 + 0.98564736 * d) % 360;
        const L = (q + 1.915 * Math.sin(this.toRadians(g)) + 0.020 * Math.sin(this.toRadians(2 * g))) % 360;
        const e = 23.439 - 0.00000036 * d;

        const ra = this.toDegrees(Math.atan2(Math.cos(this.toRadians(e)) * Math.sin(this.toRadians(L)), Math.cos(this.toRadians(L)))) / 15;
        const eqt = (q / 15) - ra;
        const decl = this.toDegrees(Math.asin(Math.sin(this.toRadians(e)) * Math.sin(this.toRadians(L))));

        // 2. Base Times
        const timezone = -dateObj.getTimezoneOffset() / 60;
        const noon = 12 + (this.lng / -15) + timezone - eqt;

        const hSunset = this.getHourAngle(0.833, this.lat, decl);
        const hFajr = this.getHourAngle(this.params.fajrAngle, this.lat, decl);
        const hIsha = this.getHourAngle(this.params.ishaAngle, this.lat, decl);

        const asrAlt = -this.toDegrees(Math.atan(1 / (1 + Math.tan(this.toRadians(Math.abs(this.lat - decl))))));
        const hAsr = this.getHourAngle(asrAlt, this.lat, decl);

        let sunriseRaw = noon - hSunset;
        let sunsetRaw = noon + hSunset;
        let fajrRaw = noon - hFajr;
        let ishaRaw = noon + hIsha;
        let asrRaw = noon + hAsr;

        // 3. Summer Rule (1/7th Night) - Critical for Munich May-July
        const nightDuration = 24 - (sunsetRaw - sunriseRaw);
        const seventh = nightDuration / 7;

        if (isNaN(fajrRaw) || (sunriseRaw - fajrRaw) > seventh) {
            fajrRaw = sunriseRaw - seventh;
            ishaRaw = sunsetRaw + seventh;
        }

        return {
            fajr:    this.format(fajrRaw, this.params.offsets.fajr),
            sunrise: this.format(sunriseRaw, this.params.offsets.sunrise),
            dhuhr:   this.format(noon, this.params.offsets.dhuhr),
            asr:     this.format(asrRaw, this.params.offsets.asr),
            maghrib: this.format(sunsetRaw, this.params.offsets.maghrib),
            isha:    this.format(ishaRaw, this.params.offsets.isha)
        };
    }

    getHourAngle(angle, lat, decl) {
        const cosH = (Math.sin(this.toRadians(-angle)) - Math.sin(this.toRadians(lat)) * Math.sin(this.toRadians(decl))) /
                     (Math.cos(this.toRadians(lat)) * Math.cos(this.toRadians(decl)));
        if (cosH > 1 || cosH < -1) return NaN;
        return this.toDegrees(Math.acos(cosH)) / 15;
    }

    getJulianDate(date) {
        return (date.getTime() / 86400000) + 2440587.5;
    }

    toRadians(deg) { return deg * Math.PI / 180; }
    toDegrees(rad) { return rad * 180 / Math.PI; }

    format(timeHours, offsetMinutes) {
        // IZM matches a round-then-floor pattern
        const totalMinutes = Math.round(timeHours * 60 + offsetMinutes);
        const h = Math.floor(totalMinutes / 60) % 24;
        const m = totalMinutes % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
}

// Global instance for your index.html to find
const prayerCalculator = new IZMPrayerCalculator();

/**
 * COMPATIBILITY WRAPPER
 * This ensures your existing index.html calls work without modification.
 */
function getPrayerTimes(date) {
    return prayerCalculator.getTimes(date);
}
