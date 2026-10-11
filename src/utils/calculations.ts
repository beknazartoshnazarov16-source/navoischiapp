import type { Attendance, MarketSettings, User, WorkerMonthlyHours } from '../types.ts';

export const UZBEK_MONTHS: Record<number, string> = {
  1: 'Yanvar',
  2: 'Fevral',
  3: 'Mart',
  4: 'Aprel',
  5: 'May',
  6: 'Iyun',
  7: 'Iyul',
  8: 'Avgust',
  9: 'Sentyabr',
  10: 'Oktyabr',
  11: 'Noyabr',
  12: 'Dekabr',
};

export const UZBEK_WEEKDAYS: Record<number, string> = {
  0: 'Yakshanba',
  1: 'Dushanba',
  2: 'Seshanba',
  3: 'Chorshanba',
  4: 'Payshanba',
  5: 'Juma',
  6: 'Shanba',
};

export function formatUzDate(dateStr: string): string {
  try {
    const { year, month, day } = parseDateParts(dateStr);
    const dateObj = new Date(Date.UTC(year, month - 1, day));
    const monthName = UZBEK_MONTHS[month] || '';
    const weekdayName = UZBEK_WEEKDAYS[dateObj.getUTCDay()] || '';
    return `${day}-${monthName}, ${year} (${weekdayName})`;
  } catch {
    return dateStr;
  }
}

export function formatUzMonth(yearMonthStr: string): string {
  try {
    const [y, m] = yearMonthStr.split('-').map(Number);
    return `${UZBEK_MONTHS[m] || ''} ${y}`;
  } catch {
    return yearMonthStr;
  }
}

/**
 * Har qanday vaqt satridan (08:30, 08:30:00, 2026-09-27 08:30:00, ISO format, AM/PM)
 * soat, daqiqa va soniyalarni 100% aniqlikda ajratib oladi.
 */
export function parseTimeParts(timeStr: string): { hours: number; minutes: number; seconds: number } {
  if (!timeStr) return { hours: 0, minutes: 0, seconds: 0 };
  let str = String(timeStr).trim();

  // Agar ISO formatda bo'lsa: "2026-09-27T08:30:00.000Z"
  if (str.includes('T')) {
    str = str.split('T')[1].replace(/Z$/, '');
  }

  // Agar sana bilan birga bo'lsa: "2026-09-27 08:30:00"
  if (str.includes(' ')) {
    const segments = str.split(/\s+/);
    // Masalan: ["08:30:00", "PM"] yoki ["2026-09-27", "08:30:00"]
    if (segments.length >= 2 && segments[0].includes('-')) {
      str = segments.slice(1).join(' ');
    }
  }

  const isPM = /pm/i.test(str);
  const isAM = /am/i.test(str);
  // Faqat raqamlar va : belgisini qoldirish
  const cleanTime = str.replace(/[^\d:]/g, '');
  const parts = cleanTime.split(':').map((p) => parseInt(p, 10));

  let hours = isNaN(parts[0]) ? 0 : parts[0];
  const minutes = isNaN(parts[1]) ? 0 : parts[1];
  const seconds = isNaN(parts[2]) ? 0 : parts[2];

  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  return { hours, minutes, seconds };
}

/**
 * Har qanday sana satridan (YYYY-MM-DD, DD.MM.YYYY, 2026-09-27 08:30:00)
 * yil, oy, kunni 100% aniqlikda ajratib oladi.
 */
export function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const fallback = new Date();
  if (!dateStr) {
    return {
      year: fallback.getFullYear(),
      month: fallback.getMonth() + 1,
      day: fallback.getDate(),
    };
  }

  const str = String(dateStr).trim().split(' ')[0].split('T')[0];

  // DD.MM.YYYY formati
  if (str.includes('.')) {
    const [d, m, y] = str.split('.').map((p) => parseInt(p, 10));
    return {
      year: isNaN(y) ? fallback.getFullYear() : y,
      month: isNaN(m) ? fallback.getMonth() + 1 : m,
      day: isNaN(d) ? fallback.getDate() : d,
    };
  }

  // YYYY-MM-DD formati
  const [y, m, d] = str.split('-').map((p) => parseInt(p, 10));
  return {
    year: isNaN(y) ? fallback.getFullYear() : y,
    month: isNaN(m) ? fallback.getMonth() + 1 : m,
    day: isNaN(d) ? fallback.getDate() : d,
  };
}

/**
 * Toshkent vaqti bo'yicha YYYY-MM-DD formatidagi sanani qaytaradi
 */
export function getTashkentDateString(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tashkent',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

/**
 * Toshkent vaqti bo'yicha HH:mm yoki HH:mm:ss formatidagi vaqtni qaytaradi (24 soatlik)
 */
export function getTashkentTimeString(d: Date = new Date(), withSeconds = false): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tashkent',
      hour: '2-digit',
      minute: '2-digit',
      second: withSeconds ? '2-digit' : undefined,
      hour12: false,
    }).format(d);
  } catch {
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    if (withSeconds) {
      const secs = String(d.getSeconds()).padStart(2, '0');
      return `${hours}:${mins}:${secs}`;
    }
    return `${hours}:${mins}`;
  }
}

/**
 * Mahalliy vaqt bo'yicha YYYY-MM-DD formatidagi sanani qaytaradi
 */
export function getLocalDateString(d: Date = new Date()): string {
  return getTashkentDateString(d);
}

/**
 * Mahalliy vaqt bo'yicha YYYY-MM formatidagi oyni qaytaradi
 */
export function getLocalMonthString(d: Date = new Date()): string {
  const dateStr = getTashkentDateString(d);
  return dateStr.slice(0, 7);
}

/**
 * Daqiqalarni chiroyli qilib "X soat Y daqiqa" ko'rinishiga keltiradi
 */
export function formatMinutesToHours(minutes: number): string {
  if (!minutes || minutes <= 0) return '0 daqiqa';
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours > 0 && mins > 0) {
    return `${hours} soat ${mins} daq`;
  } else if (hours > 0) {
    return `${hours} soat`;
  }
  return `${mins} daqiqa`;
}

/**
 * 00:00 dan keyin ketgan tungi smenalarni, erta ketishlarni va
 * barcha vaqt zonasi farqlarini hisobga olgan holda aniq ishlangan daqiqalarni hisoblash
 */
export function calculateShiftWorkedMinutes(
  checkInDate: string,
  checkInTime: string,
  checkOutDate: string,
  checkOutTime: string,
  breakMinutes: number = 0
): number {
  try {
    if (!checkInTime || !checkOutTime) return 0;

    const inTime = parseTimeParts(checkInTime);
    const outTime = parseTimeParts(checkOutTime);
    const inDate = parseDateParts(checkInDate);

    // Ketish sanasi HECH QACHON kelish sanasidan oldin bo'lishi mumkin emas!
    // Agar checkOutDate bo'sh yoki kelish sanasidan oldin bo'lsa, avtomatik checkInDate ga tenglashtiriladi.
    const rawOutDate = parseDateParts(checkOutDate || checkInDate);
    const inDateKey = `${String(inDate.year).padStart(4, '0')}-${String(inDate.month).padStart(2, '0')}-${String(inDate.day).padStart(2, '0')}`;
    let outDateKey = `${String(rawOutDate.year).padStart(4, '0')}-${String(rawOutDate.month).padStart(2, '0')}-${String(rawOutDate.day).padStart(2, '0')}`;
    
    if (outDateKey < inDateKey) {
      outDateKey = inDateKey;
    }
    const outDate = parseDateParts(outDateKey);

    // Vaqt zonalaridan qat'iy nazar, mutlaq UTC vaqt tamg'alarini hosil qilish
    const inMs = Date.UTC(
      inDate.year,
      inDate.month - 1,
      inDate.day,
      inTime.hours,
      inTime.minutes,
      inTime.seconds
    );

    let outMs = Date.UTC(
      outDate.year,
      outDate.month - 1,
      outDate.day,
      outTime.hours,
      outTime.minutes,
      outTime.seconds
    );

    // Tungi smena: agar sana bir xil bo'lib, ketish soati kelishdan kichik bo'lsa (masalan: 20:30 da kelib 01:30 da ketgan)
    // yoki outMs < inMs bo'lsa, bu avtomatik ravishda keyingi kunga o'tgan (+24 soat)
    if (outMs < inMs) {
      outMs += 24 * 3600000;
    }

    const diffMs = outMs - inMs;
    if (diffMs <= 0) return 0;

    const rawMinutes = Math.floor(diffMs / 60000);
    const cleanBreak = Math.max(0, Number(breakMinutes) || 0);
    const netMinutes = Math.max(0, rawMinutes - cleanBreak);

    // Agar xodim ketishni unutib 24+ soat yopilmagan bo'lsa, xatolikni oldini olish uchun
    // standart 10 soat (600 daqiqa) bilan cheklanadi
    if (netMinutes > 1200) {
      return 600;
    }

    return netMinutes > 0 ? netMinutes : (rawMinutes > 0 ? rawMinutes : 0);
  } catch (err) {
    console.error('Error in calculateShiftWorkedMinutes:', err);
    return 0;
  }
}

/**
 * Har qanday davomat yozuvi (tugallangan yoki hozir ochiq ishlayotgan) uchun
 * 100% haqqoniy va aniq ishlangan daqiqalarni qaytaradi.
 */
export function getAccurateAttendanceMinutes(att: Attendance, referenceDate: Date = new Date()): number {
  if (!att) return 0;

  // 1. Tugallangan smena
  if (att.status === 'completed') {
    if (typeof att.worked_minutes === 'number' && att.worked_minutes > 0) {
      return att.worked_minutes;
    }
    // Agar bazadagi worked_minutes 0 saqlanib qolgan bo'lsa, qayta to'g'ri hisoblash
    if (att.check_in_time && att.check_out_time) {
      const recalculated = calculateShiftWorkedMinutes(
        att.date,
        att.check_in_time,
        att.check_out_date || att.date,
        att.check_out_time,
        att.total_break_minutes || 0
      );
      if (recalculated > 0) return recalculated;
    }
    return att.worked_minutes || 0;
  }

  // 2. Hozir faol ishlayotgan yoki tanaffusda bo'lgan smena (real vaqtda o'tib borayotgan vaqt)
  if (att.status === 'working' || att.status === 'on_break') {
    try {
      const inTime = parseTimeParts(att.check_in_time);
      const inDate = parseDateParts(att.date);
      const inMs = Date.UTC(inDate.year, inDate.month - 1, inDate.day, inTime.hours, inTime.minutes, inTime.seconds);

      const nowTimeStr = getTashkentTimeString(referenceDate, true);
      const nowDateStr = getTashkentDateString(referenceDate);
      const nowTime = parseTimeParts(nowTimeStr);
      const nowDate = parseDateParts(nowDateStr);
      const nowMs = Date.UTC(nowDate.year, nowDate.month - 1, nowDate.day, nowTime.hours, nowTime.minutes, nowTime.seconds);

      const diffMs = nowMs - inMs;
      if (diffMs <= 0) return 0;

      const rawMinutes = Math.floor(diffMs / 60000);
      const netMinutes = Math.max(0, rawMinutes - (att.total_break_minutes || 0));
      return Math.min(netMinutes, 1080); // Maksimal 18 soat
    } catch {
      return 0;
    }
  }

  return 0;
}

/**
 * Ishchining bugungi kunda nechta smena ishlaganini va jami qancha vaqt ishlaganini hisoblash
 */
export function calculateTodayWorkerSummary(
  attendances: Attendance[],
  userId: number,
  todayDate: string
): { completedCount: number; completedMinutes: number; activeShift: Attendance | undefined; activeMinutes: number } {
  const userTodayShifts = attendances.filter(
    (a) => a.user_id === userId && (a.date === todayDate || a.check_out_date === todayDate)
  );

  const completedShifts = userTodayShifts.filter((a) => a.status === 'completed');
  const completedMinutes = completedShifts.reduce(
    (acc, curr) => acc + getAccurateAttendanceMinutes(curr),
    0
  );

  const activeShift = userTodayShifts.find(
    (a) => a.status === 'working' || a.status === 'on_break'
  );
  const activeMinutes = activeShift ? getAccurateAttendanceMinutes(activeShift) : 0;

  return {
    completedCount: completedShifts.length,
    completedMinutes,
    activeShift,
    activeMinutes,
  };
}

/**
 * Har bir ishchining bir oylik jami ishlagan soatlarini hisoblash
 */
export function calculateMonthlyHours(
  users: User[],
  attendances: Attendance[],
  monthStr: string, // YYYY-MM
  includeAllRoles: boolean = false
): WorkerMonthlyHours[] {
  return users
    .filter((u) => includeAllRoles || u.role === 'worker')
    .map((user) => {
      // Ushbu oyga tegishli barcha davomat yozuvlari
      const userAttendances = attendances.filter((a) => {
        const itemMonth = (a.date || '').slice(0, 7);
        const outMonth = (a.check_out_date || '').slice(0, 7);
        const isThisMonth = itemMonth === monthStr || outMonth === monthStr;
        return a.user_id === user.id && isThisMonth;
      });

      const uniqueDays = new Set(userAttendances.map((a) => a.date)).size;
      const totalMinutes = userAttendances.reduce((acc, curr) => {
        return acc + getAccurateAttendanceMinutes(curr);
      }, 0);

      const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
      const avgMinutes = uniqueDays > 0 ? Math.round(totalMinutes / uniqueDays) : 0;

      return {
        user_id: user.id,
        full_name: user.full_name,
        position: user.position,
        phone: user.phone,
        worked_days: uniqueDays,
        total_worked_minutes: totalMinutes,
        total_worked_hours: totalHours,
        formatted_total_hours: formatMinutesToHours(totalMinutes),
        average_daily_minutes: avgMinutes,
      };
    });
}

/**
 * Ixtiyoriy sana oralig'i (startDate va endDate) bo'yicha ishchilarning ishlagan soatlarini aniq hisoblash
 */
export function calculateHoursByDateRange(
  users: User[],
  attendances: Attendance[],
  startDate: string, // YYYY-MM-DD
  endDate: string,   // YYYY-MM-DD
  includeAllRoles: boolean = false
): WorkerMonthlyHours[] {
  return users
    .filter((u) => includeAllRoles || u.role === 'worker')
    .map((user) => {
      // Belgilangan sana oralig'iga to'g'ri keluvchi davomatlar
      const userAttendances = attendances.filter((a) => {
        if (a.user_id !== user.id) return false;
        const itemDate = a.date || '';
        const outDate = a.check_out_date || a.date || '';
        return (itemDate >= startDate && itemDate <= endDate) || (outDate >= startDate && outDate <= endDate);
      });

      const uniqueDays = new Set(userAttendances.map((a) => a.date)).size;
      const totalMinutes = userAttendances.reduce((acc, curr) => {
        return acc + getAccurateAttendanceMinutes(curr);
      }, 0);

      const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
      const avgMinutes = uniqueDays > 0 ? Math.round(totalMinutes / uniqueDays) : 0;

      return {
        user_id: user.id,
        full_name: user.full_name,
        position: user.position,
        phone: user.phone,
        worked_days: uniqueDays,
        total_worked_minutes: totalMinutes,
        total_worked_hours: totalHours,
        formatted_total_hours: formatMinutesToHours(totalMinutes),
        average_daily_minutes: avgMinutes,
      };
    });
}

// GPS masofasini tekshirish
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dphi = toRad(lat2 - lat1);
  const dlambda = toRad(lon2 - lon1);

  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const earthRadiusMeters = 6371000;
  return earthRadiusMeters * c;
}

export function isWithinLocation(
  workerLat: number,
  workerLon: number,
  marketLat: number,
  marketLon: number,
  radiusMeters: number
): { isWithin: boolean; distanceMeters: number } {
  try {
    const dist = haversineDistanceMeters(workerLat, workerLon, marketLat, marketLon);
    return {
      isWithin: dist <= radiusMeters,
      distanceMeters: Math.round(dist * 10) / 10,
    };
  } catch {
    return { isWithin: true, distanceMeters: 0 };
  }
}

/**
 * Xodim ishga rejadagi vaqtga nisbatan necha daqiqa kechikib kelganini hisoblaydi.
 * Har qanday formatdagi vaqtlarni to'g'ri taqqoslaydi.
 */
export function calculateLateMinutes(checkInTime: string, workStartTime: string): number {
  try {
    if (!checkInTime || !workStartTime) return 0;
    const inParts = parseTimeParts(checkInTime);
    const startParts = parseTimeParts(workStartTime);

    const inTotal = inParts.hours * 60 + inParts.minutes;
    const startTotal = startParts.hours * 60 + startParts.minutes;
    const diff = inTotal - startTotal;
    return diff > 0 ? diff : 0;
  } catch {
    return 0;
  }
}

/**
 * Faqat kunning birinchi smenasi (1-smena) uchun kechikishni hisoblaydi.
 * 2-smena va undan keyingi qayta kirishlarda kechikish har doim 0 bo'ladi (kechikish hisoblanmaydi).
 */
export function calculateShiftLateMinutes(
  checkInTime: string,
  workStartTime: string,
  shiftIndex: number = 1
): number {
  if (shiftIndex > 1) return 0;
  return calculateLateMinutes(checkInTime, workStartTime);
}

/**
 * Pul summasini o'zbek so'mida chiroyli ajratilgan formatda ko'rsatish:
 * Masalan: 1500000 -> "1 500 000 so'm"
 */
export function formatUzSum(amount: number): string {
  if (!amount || isNaN(amount)) return "0 so'm";
  const rounded = Math.round(amount);
  return `${rounded.toLocaleString('uz-UZ').replace(/,/g, ' ')} so'm`;
}

