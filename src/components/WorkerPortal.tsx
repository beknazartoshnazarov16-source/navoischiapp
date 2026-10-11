import React, { useState, useEffect, useRef } from 'react';
import { Attendance, MarketSettings, User } from '../types';
import { NavoLogo } from './NavoLogo';
import {
  calculateShiftWorkedMinutes,
  calculateLateMinutes,
  formatMinutesToHours,
  formatUzDate,
  isWithinLocation,
  haversineDistanceMeters,
  getLocalDateString,
  getLocalMonthString,
  getAccurateAttendanceMinutes,
  getTashkentTimeString,
  parseTimeParts,
  parseDateParts,
} from '../utils/calculations';
import {
  Clock,
  MapPin,
  CheckCircle2,
  Coffee,
  LogOut,
  Calendar,
  AlertCircle,
  Smartphone,
  Repeat,
  Sparkles,
  UserPlus,
  UserCheck,
  Timer,
  Link,
  Bell,
  Megaphone,
  Crown,
  Navigation,
} from 'lucide-react';
import { triggerHaptic, getTelegramUser, isTelegramWebApp } from '../utils/telegram';

interface WorkerPortalProps {
  user: User;
  settings: MarketSettings;
  attendances: Attendance[];
  onCheckIn: (lat?: number, lon?: number) => void;
  onStartBreak: () => void;
  onEndBreak: () => void;
  onCheckOut: (workedMinutes: number, checkOutDate: string, checkOutTime: string, autoReason?: string) => void;
  onOpenRegister?: () => void;
  onLogout?: () => void;
  allWorkers?: User[];
  onSelectUser?: (u: User) => void;
  onLinkTelegram?: (tgId: string) => Promise<void> | void;
  isAdmin?: boolean;
  onOpenInstallModal?: () => void;
  onRequestAdminLogin?: () => void;
}

export function WorkerPortal({
  user,
  settings,
  attendances,
  onCheckIn,
  onStartBreak,
  onEndBreak,
  onCheckOut,
  onOpenRegister,
  onLogout,
  allWorkers = [],
  onSelectUser,
  onLinkTelegram,
  isAdmin = false,
  onOpenInstallModal,
  onRequestAdminLogin,
}: WorkerPortalProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [justCheckedOutNotice, setJustCheckedOutNotice] = useState<string | null>(null);
  const [isLinkingTg, setIsLinkingTg] = useState(false);
  const [tgLinkedSuccess, setTgLinkedSuccess] = useState(false);

  // 100 metr Geozona va real-vaqt masofa monitoringi
  const [currentDistanceToShop, setCurrentDistanceToShop] = useState<number | null>(null);
  const [autoCheckoutNotice, setAutoCheckoutNotice] = useState<string | null>(null);
  const autoCheckoutTriggeredRef = useRef<boolean>(false);

  const autoCheckoutDistanceLimit = settings.auto_checkout_distance_meters || 100;
  const isAutoCheckoutEnabled = settings.auto_checkout_on_distance_enabled !== false;

  // Har soniyada vaqtni yangilash
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const todayStr = getLocalDateString(currentTime);
  const currentMonthStr = getLocalMonthString(currentTime);

  // Foydalanuvchining hozirgi ochiq smenasi bormi? (status === 'working' yoki 'on_break')
  const activeAttendance = attendances.find(
    (a) => a.user_id === user.id && (a.status === 'working' || a.status === 'on_break')
  );

  // Bugungi tugallangan smenalar (1 kunda bir necha marta kirib-chiqqan bo'lsa)
  const todayCompletedShifts = attendances.filter(
    (a) =>
      a.user_id === user.id &&
      (a.date === todayStr || a.check_out_date === todayStr) &&
      a.status === 'completed'
  );
  const todayCompletedMinutes = todayCompletedShifts.reduce(
    (sum, a) => sum + getAccurateAttendanceMinutes(a),
    0
  );

  // Ushbu ishchining shu oydagi jami ishlagan daqiqalari
  const userMonthAttendances = attendances.filter(
    (a) =>
      a.user_id === user.id &&
      (a.date.slice(0, 7) === currentMonthStr ||
        (a.check_out_date || '').slice(0, 7) === currentMonthStr) &&
      a.status === 'completed'
  );
  const totalMonthMinutes = userMonthAttendances.reduce(
    (sum, a) => sum + getAccurateAttendanceMinutes(a),
    0
  );

  // Telegram native MainButton integratsiyasi
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg || !tg.MainButton) return;

    if (!activeAttendance) {
      tg.MainButton.setText('🟢 ISHGA KELISHNI QAYD ETISH');
      tg.MainButton.setParams({
        color: '#00a651',
        text_color: '#ffffff',
        is_visible: true,
        is_active: !isLocating,
      });
      const onClick = () => handleCheckInClick();
      tg.MainButton.onClick(onClick);
      return () => {
        tg.MainButton?.offClick(onClick);
        tg.MainButton?.hide();
      };
    } else if (activeAttendance.status === 'working') {
      tg.MainButton.setText('🔴 ISHDAN KETDIM');
      tg.MainButton.setParams({
        color: '#f37021',
        text_color: '#ffffff',
        is_visible: true,
        is_active: true,
      });
      const onClick = () => handleCheckOutClick();
      tg.MainButton.onClick(onClick);
      return () => {
        tg.MainButton?.offClick(onClick);
        tg.MainButton?.hide();
      };
    } else if (activeAttendance.status === 'on_break') {
      tg.MainButton.setText('✅ TANAFFUSNI YAKUNLASH');
      tg.MainButton.setParams({
        color: '#00a651',
        text_color: '#ffffff',
        is_visible: true,
        is_active: true,
      });
      const onClick = () => onEndBreak();
      tg.MainButton.onClick(onClick);
      return () => {
        tg.MainButton?.offClick(onClick);
        tg.MainButton?.hide();
      };
    }
  }, [activeAttendance, isLocating]);

  // Ishga kelish tugmasi
  const [adminOverrideCoords, setAdminOverrideCoords] = useState<{ lat: number; lon: number } | null>(null);

  const handleCheckInClick = () => {
    setLocationError(null);
    setAdminOverrideCoords(null);
    setJustCheckedOutNotice(null);
    triggerHaptic('medium');

    const isGpsEnforced = settings.gps_required !== false;

    // Agar GPS majburiy bo'lsa (barcha xodimlar va admin uchun real GPS so'raladi!)
    if (isGpsEnforced && typeof navigator !== 'undefined' && navigator.geolocation) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setIsLocating(false);
          const { latitude, longitude } = pos.coords;
          const check = isWithinLocation(
            latitude,
            longitude,
            settings.market_latitude,
            settings.market_longitude,
            settings.gps_radius_meters
          );

          if (!check.isWithin) {
            triggerHaptic('error');
            const dist = Math.round(check.distanceMeters);
            setLocationError(
              `Siz do'kondan ${dist} metr uzoqdasiz. Ruxsat etilgan radius: ${settings.gps_radius_meters} metr. (Do'konga yaqinlashib qayta urinib ko'ring)`
            );
            if (isAdmin) {
              setAdminOverrideCoords({ lat: latitude, lon: longitude });
            }
            return;
          }

          triggerHaptic('success');
          onCheckIn(latitude, longitude);
        },
        (err) => {
          setIsLocating(false);
          triggerHaptic('error');
          let errorMsg = "Geolokatsiya (GPS) aniqlanmadi. Iltimos, brauzerda lokatsiyaga ruxsat bering.";
          if (err.code === 1) {
            errorMsg = "GPS (Geolokatsiya)ga ruxsat berilmadi! Ishga kelishni qayd etish uchun brauzerda lokatsiyaga ruxsat bering.";
          } else if (err.code === 2) {
            errorMsg = "GPS koordinatalarini aniqlab bo'lmadi. Qurilmangizda geolokatsiyani yoqing.";
          } else if (err.code === 3) {
            errorMsg = "GPS qidirish vaqti tugadi. Qaytadan urinib ko'ring.";
          }
          setLocationError(errorMsg);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    } else if (isGpsEnforced && (!navigator || !navigator.geolocation)) {
      setLocationError("Qurilmangizda GPS (geolokatsiya) qo'llab-quvvatlanmaydi.");
    } else {
      // GPS talab qilinmasa darhol yozadi
      triggerHaptic('success');
      onCheckIn();
    }
  };

  // Ishdan ketishni amalga oshirish
  const executeCheckOut = () => {
    if (!activeAttendance) return;
    triggerHaptic('success');

    const now = new Date();
    const outDateStr = getLocalDateString(now);
    const outTimeStr = getTashkentTimeString(now, true);

    const workedMinutes = calculateShiftWorkedMinutes(
      activeAttendance.date,
      activeAttendance.check_in_time,
      outDateStr,
      outTimeStr,
      activeAttendance.total_break_minutes
    );

    onCheckOut(workedMinutes, outDateStr, outTimeStr);
    setJustCheckedOutNotice(
      `Smena yakunlandi (${formatMinutesToHours(workedMinutes)}). Agar bugun yana qaytib kelsangiz, bemalol qaytadan «📍 Ishga keldim» tugmasini bosishingiz mumkin!`
    );
  };

  // Ishdan ketish tugmasi (GPS yoqilgan bo'lsa tekshiradi, o'chiq bo'lsa darhol yopadi)
  const handleCheckOutClick = () => {
    if (!activeAttendance) return;
    setLocationError(null);

    const isGpsCheckoutEnforced = settings.gps_checkout_required === true;
    if (isGpsCheckoutEnforced && typeof navigator !== 'undefined' && navigator.geolocation) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setIsLocating(false);
          const { latitude, longitude } = pos.coords;
          const check = isWithinLocation(
            latitude,
            longitude,
            settings.market_latitude,
            settings.market_longitude,
            settings.gps_radius_meters
          );

          if (!check.isWithin) {
            triggerHaptic('error');
            const dist = Math.round(check.distanceMeters);
            setLocationError(
              `Ishdan ketishni qayd etish uchun do'konda ekanligingizni tasdiqlashingiz kerak. Siz do'kondan ${dist} metr uzoqdasiz (Ruxsat: ${settings.gps_radius_meters}m).`
            );
            return;
          }

          executeCheckOut();
        },
        (err) => {
          setIsLocating(false);
          triggerHaptic('error');
          let errorMsg = "Ishdan ketishni tasdiqlash uchun GPS koordinata aniqlanmadi. Iltimos, brauzerda geolokatsiyaga ruxsat bering.";
          if (err.code === 1) {
            errorMsg = "GPS (Geolokatsiya)ga ruxsat berilmadi! Ishdan ketishni qayd etish uchun lokatsiyani yoqing.";
          }
          setLocationError(errorMsg);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    } else {
      executeCheckOut();
    }
  };

  // Smena o'zgarganda avtomatik ketish trigger holatini yangilash
  useEffect(() => {
    if (!activeAttendance) {
      autoCheckoutTriggeredRef.current = false;
      setCurrentDistanceToShop(null);
    }
  }, [activeAttendance]);

  // 100 metr Geozona monitoringi: ishchi do'kondan uzoqlashganda avtomatik ketishni qayd etish
  useEffect(() => {
    if (!activeAttendance || activeAttendance.status !== 'working' || !isAutoCheckoutEnabled) {
      setCurrentDistanceToShop(null);
      return;
    }

    if (!navigator.geolocation) return;

    let watchId: number | null = null;

    const handlePos = (pos: GeolocationPosition) => {
      const { latitude, longitude } = pos.coords;
      const dist = haversineDistanceMeters(
        latitude,
        longitude,
        settings.market_latitude,
        settings.market_longitude
      );
      const roundedDist = Math.round(dist);
      setCurrentDistanceToShop(roundedDist);

      // Agar xodim do'kondan 100m+ uzoqlashgan bo'lsa (real vaqtda)
      if (roundedDist > autoCheckoutDistanceLimit && !autoCheckoutTriggeredRef.current) {
        autoCheckoutTriggeredRef.current = true;
        triggerHaptic('warning');

        const now = new Date();
        const outDateStr = getLocalDateString(now);
        const outTimeStr = getTashkentTimeString(now, true);

        const workedMinutes = calculateShiftWorkedMinutes(
          activeAttendance.date,
          activeAttendance.check_in_time,
          outDateStr,
          outTimeStr,
          activeAttendance.total_break_minutes
        );

        const reason = `Do'kondan ${roundedDist} metr uzoqlashgani sababli tizim avtomatik ketishni qayd etdi`;
        onCheckOut(workedMinutes, outDateStr, outTimeStr, reason);

        setAutoCheckoutNotice(
          `📍 Diqqat: Do'kondan ${roundedDist} metr uzoqlashdingiz. Tizim soat ${outTimeStr.slice(0, 5)} da smenani avtomatik yakunladi va Telegram guruhiga xabar yubordi.`
        );
      }
    };

    const handleErr = (err: GeolocationPositionError) => {
      console.warn("Geolokatsiya monitoringi:", err.message);
    };

    try {
      watchId = navigator.geolocation.watchPosition(handlePos, handleErr, {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 15000,
      });
    } catch (e) {
      console.warn("watchPosition xatosi:", e);
    }

    // Har 25 soniyada davriy zaxira tekshiruv (interval fallback)
    const fallbackTimer = setInterval(() => {
      if (autoCheckoutTriggeredRef.current) return;
      navigator.geolocation.getCurrentPosition(handlePos, handleErr, {
        enableHighAccuracy: true,
        timeout: 10000,
      });
    }, 25000);

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearInterval(fallbackTimer);
    };
  }, [
    activeAttendance,
    isAutoCheckoutEnabled,
    autoCheckoutDistanceLimit,
    settings.market_latitude,
    settings.market_longitude,
  ]);

  // 100m uzoqlashishni sinash uchun test funksiyasi (Admin / Test uchun)
  const handleSimulateDistanceCheckout = () => {
    if (!activeAttendance) return;
    triggerHaptic('warning');
    autoCheckoutTriggeredRef.current = true;

    const simulatedDist = Math.max(120, autoCheckoutDistanceLimit + 25);
    setCurrentDistanceToShop(simulatedDist);

    const now = new Date();
    const outDateStr = getLocalDateString(now);
    const outTimeStr = getTashkentTimeString(now, true);

    const workedMinutes = calculateShiftWorkedMinutes(
      activeAttendance.date,
      activeAttendance.check_in_time,
      outDateStr,
      outTimeStr,
      activeAttendance.total_break_minutes
    );

    const reason = `Do'kondan ${simulatedDist} metr uzoqlashgani sababli tizim avtomatik ketishni qayd etdi (Sinov testi)`;
    onCheckOut(workedMinutes, outDateStr, outTimeStr, reason);

    setAutoCheckoutNotice(
      `📍 Sinov muvaffaqiyatli: 100m+ uzoqlashish simulyatsiya qilindi! Tizim soat ${outTimeStr.slice(0, 5)} da smenani avtomatik yakunladi va guruhga tezkor xabar berdi.`
    );
  };

  // Hozirgi davom etayotgan smenaning o'tgan vaqtini hisoblash
  const currentSessionMinutes = activeAttendance
    ? getAccurateAttendanceMinutes(activeAttendance, currentTime)
    : 0;

  const totalTodayWorkedMinutes = todayCompletedMinutes + currentSessionMinutes;

  // Jonli sekundomer (HH:MM:SS) - vaqt zonalaridan qat'iy nazar aniq hisoblaydi
  let liveStopwatch = '00:00:00';
  if (activeAttendance) {
    try {
      const inTime = parseTimeParts(activeAttendance.check_in_time);
      const inDate = parseDateParts(activeAttendance.date);
      const inMs = Date.UTC(inDate.year, inDate.month - 1, inDate.day, inTime.hours, inTime.minutes, inTime.seconds);

      const nowTime = parseTimeParts(getTashkentTimeString(currentTime, true));
      const nowDate = parseDateParts(getLocalDateString(currentTime));
      let nowMs = Date.UTC(nowDate.year, nowDate.month - 1, nowDate.day, nowTime.hours, nowTime.minutes, nowTime.seconds);

      if (nowMs < inMs) {
        nowMs += 24 * 3600000;
      }

      const diffMs = nowMs - inMs;
      if (diffMs > 0) {
        const totalSec = Math.floor(diffMs / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        liveStopwatch = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }
    } catch {
      liveStopwatch = '00:00:00';
    }
  }

  const isFirstShiftToday = todayCompletedShifts.length === 0;
  const currentShiftNumber = todayCompletedShifts.length + 1;

  // Kechikish FAQAT kunning 1-smenasi uchun hisoblanadi! 2-smena va qayta kirishlarda kechikish 0 bo'ladi
  const lateMinutes =
    activeAttendance && isFirstShiftToday
      ? calculateLateMinutes(activeAttendance.check_in_time, user.work_start_time || '08:00')
      : 0;

  // Ish vaqti tugaganligini aniqlash (Aqlli Eslatma uchun)
  let isShiftPastEndTime = false;
  if (activeAttendance) {
    try {
      const [endH, endM] = (user.work_end_time || '20:00').split(':').map(Number);
      const nowH = currentTime.getHours();
      const nowM = currentTime.getMinutes();
      const endTotalMins = (endH || 20) * 60 + (endM || 0);
      const nowTotalMins = nowH * 60 + nowM;
      if (activeAttendance.date === todayStr && nowTotalMins >= endTotalMins) {
        isShiftPastEndTime = true;
      } else if (activeAttendance.date < todayStr || currentSessionMinutes > 660) {
        isShiftPastEndTime = true;
      }
    } catch {
      isShiftPastEndTime = false;
    }
  }

  const tgUser = getTelegramUser();
  const isTg = isTelegramWebApp();
  const myTgIdStr = tgUser ? String(tgUser.id) : null;
  const isProfileMatched = Boolean(
    isTg && myTgIdStr && user.telegram_id && String(user.telegram_id).trim() === myTgIdStr
  );
  const isForeignProfile = Boolean(
    isTg && myTgIdStr && user.telegram_id && String(user.telegram_id).trim() !== myTgIdStr
  );
  const canLinkThisProfile = Boolean(
    isTg && myTgIdStr && !user.telegram_id
  );

  return (
    <div className="max-w-xl mx-auto space-y-4 sm:space-y-6 w-full px-1 sm:px-0">
      {/* Profil va Joriy Vaqt */}
      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm text-center relative overflow-hidden">
        {/* Yuqori brend chizig'i (Yashil va to'q sariq) */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#fdb813] via-[#00a651] to-[#f37021]" />

        {/* Navo Market Logotipi va Supermarket Terminali */}
        <div className="flex flex-col items-center justify-center gap-1 pt-2 pb-1">
          <NavoLogo size="lg" showText={true} badge={true} className="shadow-xs mb-1" />
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold flex-wrap justify-center">
            <span className="text-[#008f45] font-black">{settings.shop_name || 'Navo Market'}</span>
            <span>·</span>
            <span className="text-slate-400">Xodimlar va Smena Terminali</span>
            <span>·</span>
            <span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded text-[10px]">08:00 — 23:00</span>
          </div>
        </div>

        {/* 0. Do'kon rahbariyati E'loni / Eslatmasi */}
        {settings.active_announcement && (
          <div
            className={`mt-2 mb-3 p-3.5 rounded-2xl border text-left max-w-sm mx-auto shadow-2xs ${
              settings.active_announcement.urgency === 'high'
                ? 'bg-rose-50 border-rose-200 text-rose-950'
                : 'bg-emerald-50 border-emerald-200 text-emerald-950'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider mb-1">
              <Megaphone
                className={`w-4 h-4 ${
                  settings.active_announcement.urgency === 'high'
                    ? 'text-rose-600 animate-bounce'
                    : 'text-emerald-600'
                }`}
              />
              <span>Rahbariyat Eslatmasi</span>
            </div>
            <div className="text-xs font-bold text-slate-900">
              {settings.active_announcement.title}
            </div>
            <p className="text-[11px] text-slate-700 mt-0.5 leading-relaxed">
              {settings.active_announcement.message}
            </p>
          </div>
        )}

        {/* 1. Boshqa odam profiliga kirib qolganlik haqida ogohlantirish */}
        {isForeignProfile && (
          <div className="mt-2 mb-3 p-3 bg-amber-50 rounded-2xl border border-amber-200 max-w-sm mx-auto flex items-center justify-between gap-2 text-left">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0">
                <AlertCircle className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-amber-950 truncate">
                  Siz hozir «{user.full_name}» profilidasiz
                </div>
                <p className="text-[10px] text-amber-800">
                  Bu sizning profilingiz emasmisiz?
                </p>
              </div>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-[11px] font-bold transition shrink-0 cursor-pointer shadow-xs"
              >
                Chiqish
              </button>
            )}
          </div>
        )}

        {/* 2. O'z Telegram hisobiga bog'lash taklifi (faqat bo'sh bo'lsa) */}
        {canLinkThisProfile && (
          <div className="mt-2 mb-3 p-3 bg-gradient-to-r from-sky-50 to-indigo-50 rounded-2xl border border-sky-200 max-w-sm mx-auto flex items-center justify-between gap-2 text-left">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0">
                <Link className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-sky-950 truncate">
                  «{user.full_name}» ni Telegramga bog'lash
                </div>
                <p className="text-[10px] text-sky-700 truncate">
                  Keyingi safar avtomatik ochilishi uchun
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={isLinkingTg || tgLinkedSuccess}
                onClick={async () => {
                  if (!onLinkTelegram || !tgUser) return;
                  setIsLinkingTg(true);
                  try {
                    await onLinkTelegram(String(tgUser.id));
                    setTgLinkedSuccess(true);
                    triggerHaptic('success');
                  } finally {
                    setIsLinkingTg(false);
                  }
                }}
                className="px-2.5 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-xl text-[11px] font-bold transition cursor-pointer shadow-xs"
              >
                {tgLinkedSuccess ? '✓ Bog\'landi' : isLinkingTg ? '...' : 'Bog\'lash'}
              </button>
            </div>
          </div>
        )}

        {/* 3. Mobil Ilovani Telefonga O'rnatish banner-tugmasi */}
        {onOpenInstallModal && (
          <button
            type="button"
            onClick={onOpenInstallModal}
            className="mt-2 mb-3 w-full p-2.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-2xl max-w-sm mx-auto flex items-center justify-between gap-2 shadow-sm transition active:scale-[0.98] cursor-pointer"
          >
            <div className="flex items-center gap-2.5 text-left">
              <div className="w-8 h-8 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center shrink-0">
                <Smartphone className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-xs font-black leading-tight flex items-center gap-1.5">
                  <span>Ilovani Telefonga O'rnatish</span>
                  <span className="text-[9px] bg-amber-400 text-slate-900 font-extrabold px-1.5 py-0.2 rounded-md">PWA</span>
                </div>
                <div className="text-[10px] text-emerald-100 leading-tight mt-0.5">
                  1-bosishda brauzersiz ilova bo'lib tushadi
                </div>
              </div>
            </div>
            <span className="px-2.5 py-1 bg-white text-emerald-800 text-[11px] font-black rounded-xl shrink-0 shadow-xs">
              O'rnatish
            </span>
          </button>
        )}

        {/* Xodim kartasi */}
        <div className="mt-3 p-3.5 bg-slate-50/80 rounded-2xl border border-slate-200/80 max-w-sm mx-auto space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#00a651] to-[#008f45] text-white font-black text-base flex items-center justify-center shadow-xs shrink-0">
                {user.full_name ? user.full_name.charAt(0) : 'X'}
              </div>
              <div className="text-left min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h2 className="text-sm sm:text-base font-black text-slate-900 truncate">
                    {user.full_name}
                  </h2>
                  {isProfileMatched && (
                    <span className="text-[9px] bg-emerald-100 text-emerald-800 font-extrabold px-1.5 py-0.2 rounded-md">
                      ✓ Tasdiqlangan
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-slate-500 text-xs">
                  <span className="font-semibold text-slate-700">{user.position || 'Xodim'}</span>
                  <span>·</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 font-semibold">
                    {(() => {
                      const p = (user.position || '').toLowerCase();
                      if (p.includes('kass')) return '🛒 Kassa bo\'limi';
                      if (p.includes('ombor') || p.includes('yuk')) return '📦 Qabul va omborxona';
                      if (p.includes('meva') || p.includes('sabzavot')) return '🍏 Sarhil mahsulotlar';
                      if (p.includes('sotuv') || p.includes('konsultant')) return '🏷 Savdo zali';
                      if (p.includes('admin') || p.includes('menejer')) return '👔 Ma\'muriyat';
                      return '🏪 Supermarket xodimi';
                    })()}
                  </span>
                  <span>·</span>
                  <span className="text-[11px] text-slate-400">{user.phone || 'Telefon yo\'q'}</span>
                </div>
              </div>
            </div>

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 hover:text-rose-800 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 border border-slate-200 hover:border-rose-300 shadow-2xs cursor-pointer active:scale-95"
                title="Tizimdan chiqish"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-600" />
                <span>Chiqish</span>
              </button>
            )}
          </div>

          {/* Smena rejasi */}
          <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-600">
            <span>
              Standart reja: <b className="text-slate-900 font-semibold">{user.work_start_time || '08:00'} — {user.work_end_time || '20:00'}</b>
            </span>
            <span className="text-[11px] text-emerald-700 font-medium">
              12 soatlik smena
            </span>
          </div>
        </div>

        {/* Katta soat */}
        <div className="my-5">
          <div className="text-3xl sm:text-5xl font-black tracking-tight text-slate-900 font-mono select-none">
            {currentTime.toLocaleTimeString('uz-UZ', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </div>
          <div className="text-xs text-slate-500 mt-1.5 font-medium">
            {formatUzDate(todayStr)}
          </div>
        </div>

        {/* Holat indikatori */}
        <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-2xl text-xs font-bold border transition max-w-full">
          {activeAttendance ? (
            activeAttendance.status === 'on_break' ? (
              <span className="flex items-center gap-1.5 text-amber-700 bg-amber-50 px-2.5 py-1 rounded-xl border border-amber-200">
                <Coffee className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Hozir tanaffusdasiz</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-200 text-left">
                <span className="w-2.5 h-2.5 rounded-full bg-[#00a651] animate-ping shrink-0"></span>
                <span className="truncate">Hozir ishdasiz ({todayCompletedShifts.length + 1}-smena, kelgan vaqtingiz: {activeAttendance.check_in_time})</span>
              </span>
            )
          ) : (
            <span className="flex items-center gap-1.5 text-slate-600 bg-slate-100 px-3 py-1 rounded-xl border border-slate-200">
              <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0"></span>
              <span>
                {todayCompletedShifts.length > 0
                  ? `Hozir ishda emassiz (${todayCompletedShifts.length} smena tugagan)`
                  : "Ishga kelmagansiz"}
              </span>
            </span>
          )}
        </div>

        {/* Jonli smena vaqti va kechikish ko'rsatkichi */}
        {activeAttendance && (
          <div className="mt-3 p-3 bg-gradient-to-r from-emerald-50 via-teal-50/50 to-emerald-50 rounded-2xl border border-emerald-200 max-w-sm mx-auto shadow-xs text-left">
            <div className="flex items-center justify-between text-xs text-emerald-900 mb-1.5">
              <span className="flex items-center gap-1.5 font-bold">
                <Timer className="w-4 h-4 text-emerald-600 animate-pulse" />
                <span>Hozirgi smena davomiyligi:</span>
              </span>
              <span className="font-mono font-bold text-emerald-950 bg-emerald-100/90 px-2 py-0.5 rounded-lg text-xs shadow-2xs">
                {liveStopwatch}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-600 pt-1.5 border-t border-emerald-100">
              <span>Kelgan vaqt: <b>{activeAttendance.check_in_time}</b></span>
              {isFirstShiftToday ? (
                lateMinutes > 0 ? (
                  <span className="text-amber-800 font-bold bg-amber-100/80 px-1.5 py-0.5 rounded-md">
                    ⚠️ {lateMinutes} daq kechikkan
                  </span>
                ) : (
                  <span className="text-emerald-800 font-bold bg-emerald-100/80 px-1.5 py-0.5 rounded-md">
                    ✓ Rejada kelingan
                  </span>
                )
              ) : (
                <span className="text-indigo-800 font-bold bg-indigo-100/80 px-1.5 py-0.5 rounded-md">
                  🔄 {currentShiftNumber}-smena (Qayta kirish)
                </span>
              )}
            </div>
          </div>
        )}

        {/* Bugungi jami ishlangan vaqt ko'rsatkichi */}
        {totalTodayWorkedMinutes > 0 && (
          <div className="mt-4 p-3 sm:p-3.5 bg-emerald-50/70 rounded-2xl border border-emerald-100 max-w-sm mx-auto">
            <div className="text-xs text-emerald-800 font-medium">
              Bugun jami ishlagan vaqtingiz:
            </div>
            <div className="text-xl sm:text-2xl font-black text-[#008f45] mt-0.5 font-mono">
              {formatMinutesToHours(totalTodayWorkedMinutes)}
            </div>
            {todayCompletedShifts.length > 0 && (
              <div className="text-[11px] text-slate-500 mt-1">
                Bugungi kirishlar: {todayCompletedShifts.length + (activeAttendance ? 1 : 0)} marta
              </div>
            )}
          </div>
        )}

        {/* Yaqindagina chiqib ketganda eslatma */}
        {justCheckedOutNotice && !activeAttendance && (
          <div className="mt-4 p-3 bg-sky-50 border border-sky-200 text-sky-800 rounded-2xl text-xs flex items-center gap-2 text-left">
            <Repeat className="w-4 h-4 shrink-0 text-sky-600" />
            <span>{justCheckedOutNotice}</span>
          </div>
        )}

        {/* Avtomatik ketish bildirishnomasi */}
        {autoCheckoutNotice && (
          <div className="mt-4 p-3.5 bg-gradient-to-r from-rose-50 to-orange-50 border border-rose-300 rounded-2xl text-xs text-rose-950 flex items-start gap-2.5 text-left shadow-md max-w-sm mx-auto animate-in fade-in">
            <MapPin className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-rose-900">
                📍 Masofa bo'yicha Avtomatik Ketish Qayd Etildi
              </div>
              <p className="text-[11px] text-rose-800 mt-0.5 leading-relaxed">
                {autoCheckoutNotice}
              </p>
            </div>
          </div>
        )}

        {/* 100 metr Geozona jonli monitoring indikatori */}
        {activeAttendance && activeAttendance.status === 'working' && isAutoCheckoutEnabled && (
          <div className="mt-3 p-3 bg-gradient-to-r from-sky-50 via-indigo-50/40 to-sky-50 border border-sky-200 rounded-2xl text-xs flex items-center justify-between gap-2 max-w-sm mx-auto shadow-2xs">
            <div className="flex items-center gap-2 text-sky-950 font-semibold">
              <Navigation className="w-4 h-4 text-sky-600 shrink-0 animate-pulse" />
              <span>Geozona masofasi:</span>
            </div>
            <div className="flex items-center gap-1.5 font-bold">
              <span
                className={`font-mono text-xs ${
                  currentDistanceToShop !== null && currentDistanceToShop > autoCheckoutDistanceLimit
                    ? 'text-rose-600 font-black'
                    : 'text-emerald-700 font-bold'
                }`}
              >
                {currentDistanceToShop !== null ? `${currentDistanceToShop} metr` : "Aniqlanmoqda..."}
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                (Cheklov: {autoCheckoutDistanceLimit}m)
              </span>
            </div>
          </div>
        )}

        {/* Xatolik xabari */}
        {locationError && (
          <div className="mt-4 p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 rounded-2xl text-xs space-y-2.5 text-left">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <span className="leading-relaxed">{locationError}</span>
            </div>
            {isAdmin && adminOverrideCoords && (
              <div className="pt-2 border-t border-rose-200/60 dark:border-rose-800/60 flex items-center justify-between gap-2">
                <span className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">🛡 Boshqaruvchi test rejimi:</span>
                <button
                  type="button"
                  onClick={() => {
                    setLocationError(null);
                    onCheckIn(adminOverrideCoords.lat, adminOverrideCoords.lon);
                  }}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-semibold transition-colors shadow-xs"
                >
                  Masofani chetlab o'tish (Admin Test)
                </button>
              </div>
            )}
          </div>
        )}

        {/* Aqlli Eslatma: Smena vaqti tugagan bo'lsa ketishni eslatish */}
        {isShiftPastEndTime && activeAttendance && (
          <div className="mt-4 p-3.5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-300 rounded-2xl text-xs text-amber-950 flex items-start gap-2.5 text-left shadow-2xs animate-pulse max-w-sm mx-auto">
            <Bell className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-amber-900">
                ⏰ Rejadagi ish vaqtingiz tugadi ({user.work_end_time || '20:00'})
              </div>
              <p className="text-[11px] text-amber-800 mt-0.5">
                Do'kondan chiqib ketayotganda pastdagi «🏃‍♂️ ISHDAN KETDIM» tugmasini bosishni unutmang!
              </p>
            </div>
          </div>
        )}

        {/* ASOSIY HARAKAT TUGMALARI */}
        <div className="mt-6 sm:mt-8 space-y-3">
          {!activeAttendance ? (
            /* Ishga keldim tugmasi - Navo Market brend yashil rangi */
            <div>
              <button
                onClick={handleCheckInClick}
                disabled={isLocating}
                className="w-full py-4 px-5 bg-gradient-to-r from-[#00a651] to-[#008f45] hover:from-[#008f45] hover:to-[#00783a] active:scale-98 text-white rounded-2xl font-black text-base shadow-md transition flex items-center justify-center gap-2.5 cursor-pointer select-none"
              >
                <MapPin className="w-5 h-5 shrink-0" />
                <span className="truncate">
                  {isLocating
                    ? "Lokatsiya aniqlanmoqda..."
                    : todayCompletedShifts.length > 0
                    ? `📍 QAYTADAN ISHGA KELDIM (${todayCompletedShifts.length + 1}-smena)`
                    : "📍 ISHGA KELDIM"}
                </span>
              </button>
              {todayCompletedShifts.length > 0 && (
                <p className="text-[11px] text-emerald-700 mt-2 font-medium">
                  ✓ Bugun {todayCompletedShifts.length} marta kelib ketgansiz. Qaytadan ish boshlash uchun tugmani bosing.
                </p>
              )}
            </div>
          ) : (
            /* Ishda bo'lgandagi tugmalar */
            <div className="space-y-3">
              {/* Agar 16+ soatdan beri yopilmagan smena bo'lsa (unutib qoldirilgan holat) */}
              {currentSessionMinutes > 960 && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs text-left">
                  <div className="font-bold flex items-center gap-1.5 mb-1 text-amber-800">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Avvalgi smenada ketishni belgilash unutilgan</span>
                  </div>
                  <p className="text-amber-800/90 text-[11px]">
                    Ushbu smena {formatUzDate(activeAttendance.date)} soat {activeAttendance.check_in_time} da boshlangan.
                    «🏃‍♂️ ISHDAN KETDIM»ni bossangiz, avvalgi smena yopiladi va yangisini boshlay olasiz.
                  </p>
                </div>
              )}

              {/* Tanaffus tugmasi */}
              {activeAttendance.status === 'working' ? (
                <button
                  onClick={onStartBreak}
                  className="w-full py-3.5 px-4 bg-amber-500 hover:bg-amber-600 active:scale-98 text-white rounded-2xl font-bold text-sm transition flex items-center justify-center gap-2 select-none shadow-xs"
                >
                  <Coffee className="w-4 h-4 shrink-0" />
                  <span>☕️ Tanaffusga chiqish</span>
                </button>
              ) : (
                <button
                  onClick={onEndBreak}
                  className="w-full py-3.5 px-4 bg-[#00a651] hover:bg-[#008f45] active:scale-98 text-white rounded-2xl font-bold text-sm transition flex items-center justify-center gap-2 select-none shadow-xs"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>✅ Tanaffusni yakunlash</span>
                </button>
              )}

              {/* Ishdan ketdim tugmasi - Navo Market to'q sariq/qizil rangi */}
              <button
                onClick={handleCheckOutClick}
                className="w-full py-4 px-5 bg-gradient-to-r from-[#f37021] to-[#d9252a] hover:opacity-95 active:scale-98 text-white rounded-2xl font-black text-base shadow-md transition flex items-center justify-center gap-2.5 cursor-pointer select-none"
              >
                <LogOut className="w-5 h-5 shrink-0" />
                <span>🏃‍♂️ ISHDAN KETDIM</span>
              </button>
              <p className="text-[11px] text-slate-400">
                Agar ketib, keyinroq yana kelsangiz, istalgan payt yana «📍 Ishga keldim»ni bosishingiz mumkin.
              </p>

              {/* 100 metr uzoqlashishni sinash uchun test tugmasi */}
              {isAutoCheckoutEnabled && (
                <div className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={handleSimulateDistanceCheckout}
                    className="text-[11px] text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 font-semibold underline transition cursor-pointer"
                    title="Do'kondan 100m uzoqlashganda avtomatik ketish funksiyasini sinash"
                  >
                    🧪 100m uzoqlashishni sinash (Avto-ketish testi)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 🧾 SUPERMARKET SMENA KVITANSIYASI (Bugungi tugallangan smenalar cheki) */}
      {todayCompletedShifts.length > 0 && (
        <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm relative overflow-hidden text-left">
          {/* Chek tepa qirqimi bezagi */}
          <div className="border-b-2 border-dashed border-slate-200 pb-3 mb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">🧾</span>
                <span className="text-xs font-black uppercase tracking-wider text-slate-900">
                  {settings.shop_name || 'Navo Market'} — Smena Kvitansiyasi
                </span>
              </div>
              <span className="text-[10px] font-mono font-bold text-slate-400">
                №{user.id}-{todayStr.replace(/-/g, '').slice(4)}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Sana: <b>{formatUzDate(todayStr)}</b> · Xodim: <b>{user.full_name}</b>
            </div>
          </div>

          {/* Smenalar ro'yxati (1-smena, 2-smena va hokazo) */}
          <div className="space-y-2">
            {todayCompletedShifts.map((shift, idx) => {
              const shiftMins = getAccurateAttendanceMinutes(shift);
              return (
                <div
                  key={shift.id}
                  className="flex items-center justify-between p-3 bg-slate-50/90 rounded-xl border border-slate-100 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-900 text-xs font-black flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div>
                      <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                        <span>{idx + 1}-smena:</span>
                        <span className="text-emerald-700">🟢 {shift.check_in_time.slice(0, 5)}</span>
                        <span>➡️</span>
                        <span className="text-rose-700">🔴 {shift.check_out_time ? shift.check_out_time.slice(0, 5) : '---'}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {shift.check_out_date && shift.check_out_date !== shift.date
                          ? 'Tungi smena (00:00 dan keyin yakunlangan)'
                          : 'Kunning o\'zida yakunlangan smena'}
                        {shift.total_break_minutes ? ` · Tanaffus: ${shift.total_break_minutes} daq` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-black text-[#008f45] text-sm font-mono">
                      {formatMinutesToHours(shiftMins)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-medium">
                      ({(shiftMins / 60).toFixed(1)} soat)
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Chek yakuniy jami (Grand Total) */}
          <div className="mt-3 pt-3 border-t-2 border-dashed border-slate-200 flex items-center justify-between">
            <div>
              <div className="text-xs font-black text-slate-900 uppercase">
                Bugun Jami Ishlangan:
              </div>
              <div className="text-[10px] text-slate-500">
                {todayCompletedShifts.length} ta smena bo'yicha to'liq hisoblandi
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-black text-[#008f45] font-mono">
                {formatMinutesToHours(todayCompletedMinutes)}
              </div>
              <div className="text-[10px] text-slate-400 font-semibold">
                ({(todayCompletedMinutes / 60).toFixed(1)} soat)
              </div>
            </div>
          </div>

          {/* Chek pastki shtrix-kodi (Barcode motif) */}
          <div className="mt-3 pt-2 text-center text-slate-400 select-none">
            <div className="font-mono text-sm tracking-widest text-slate-500 font-extrabold opacity-70">
              ||| | |||| | ||| |||| | | |||| ||
            </div>
            <div className="text-[9px] text-slate-400 font-mono mt-0.5">
              NAVO-MARKET-VERIFIED-{user.id}
            </div>
          </div>
        </div>
      )}

      {/* Oylik ishlangan soatlar bloki */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-emerald-600" />
            <h3 className="font-bold text-slate-900 text-base">
              Mening bu oydagi soatlarim
            </h3>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 rounded-lg text-slate-700">
            {currentMonthStr}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <div className="text-xs text-slate-500">Kelgan kunlarim</div>
            <div className="text-xl font-extrabold text-slate-900 mt-1">
              {new Set(userMonthAttendances.map((a) => a.date)).size} kun
            </div>
          </div>
          <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
            <div className="text-xs text-emerald-800">Jami ishlagan vaqtim</div>
            <div className="text-xl font-extrabold text-emerald-700 mt-1">
              {formatMinutesToHours(totalMonthMinutes)}
            </div>
          </div>
        </div>

        {/* So'nggi davomatlar tarixi */}
        <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
          So'nggi kelib-ketgan kunlarim:
        </h4>
        {userMonthAttendances.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-2">
            Ushbu oyda hali tugallangan ish yozuvlari yo'q.
          </p>
        ) : (
          <div className="space-y-2">
            {userMonthAttendances.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-xl text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-900">
                    {formatUzDate(item.date)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    🟢 {item.check_in_time} — 🔴 {item.check_out_time || '---'}
                  </div>
                </div>
                <div className="font-bold text-emerald-700 text-sm">
                  {formatMinutesToHours(getAccurateAttendanceMinutes(item))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
