const LAT = 48.2104491
const LON = 11.6343305
const FAJR = 17.95
const ISHA = 16.5
const SUN_ALT = -0.983  // −0.833° + 0.15° local/atmospheric correction

function dayOfYear(d){
    const start = new Date(d.getFullYear(),0,0)
    return Math.floor((d - start)/86400000)
}

// NOAA equation-of-time for better solar noon accuracy
function equationOfTime(n){
    const B = (360/365)*(n-81) * Math.PI/180
    return 9.87*Math.sin(2*B) - 7.53*Math.cos(B) - 1.5*Math.sin(B)  // minutes
}

function solarDeclination(n){
    return 23.45*Math.sin((360/365)*(284+n)*Math.PI/180)*Math.PI/180
}

function hourAngle(angle,lat,decl){
    lat *= Math.PI/180
    angle *= Math.PI/180
    const cosH = (Math.sin(angle)-Math.sin(lat)*Math.sin(decl))/(Math.cos(lat)*Math.cos(decl))
    return Math.acos(cosH)*180/Math.PI
}

function asrAltitude(lat,decl){
    lat *= Math.PI/180
    return Math.atan(1/(1 + Math.tan(Math.abs(lat-decl))))*180/Math.PI
}

// Germany timezone with DST
function germanyTZ(d){
    const y = d.getFullYear()
    const march = new Date(y,2,31)
    const october = new Date(y,9,31)
    const dstStart = new Date(march.setDate(31-march.getDay()))
    const dstEnd = new Date(october.setDate(31-october.getDay()))
    return (d>=dstStart && d<dstEnd)?2:1
}

function prayerTimes(date){
    const n = dayOfYear(date)
    const decl = solarDeclination(n)
    const eqt = equationOfTime(n)/60  // convert minutes → hours
    const tz = germanyTZ(date)

    // Precise solar noon (Dhuhr)
    const dhuhr = 12 + tz - LON/15 - eqt

    // Sunrise/Maghrib with refined altitude
    const sunrise = dhuhr - hourAngle(SUN_ALT,LAT,decl)/15
    const maghrib = dhuhr + hourAngle(SUN_ALT,LAT,decl)/15

    // Fajr/Isha with precise angles
    const fajr = dhuhr - hourAngle(-FAJR,LAT,decl)/15
    const isha = dhuhr + hourAngle(-ISHA,LAT,decl)/15

    // Asr
    const asrAlt = asrAltitude(LAT,decl)
    const asr = dhuhr + hourAngle(asrAlt,LAT,decl)/15

    return {fajr,sunrise,dhuhr,asr,maghrib,isha}
}

// Format decimal hours to HH:MM
function formatTime(t){
    let h = Math.floor(t)
    let m = Math.round((t-h)*60)
    if(m===60){h++; m=0}
    return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")
}

// Update table
function update(date){
    const t = prayerTimes(date)
    const rows = `
<tr><td>Fajr</td><td>${formatTime(t.fajr)}</td></tr>
<tr><td>Sunrise</td><td>${formatTime(t.sunrise)}</td></tr>
<tr><td>Dhuhr</td><td>${formatTime(t.dhuhr)}</td></tr>
<tr><td>Asr</td><td>${formatTime(t.asr)}</td></tr>
<tr><td>Maghrib</td><td>${formatTime(t.maghrib)}</td></tr>
<tr><td>Isha</td><td>${formatTime(t.isha)}</td></tr>
`
    document.getElementById("times").innerHTML = rows
}

// Initialize
const picker = document.getElementById("datePicker")
const today = new Date()
picker.value = today.toISOString().split("T")[0]
update(today)

picker.addEventListener("change", ()=>{ update(new Date(picker.value)) })
