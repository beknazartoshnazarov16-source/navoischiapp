import React, { useState, useMemo } from 'react';
import { Attendance, MarketSettings, User } from '../types';
import {
  Trophy,
  Award,
  Medal,
  Clock,
  Calendar,
  Send,
  Download,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Sparkles,
  Zap,
  Users,
  Search,
  Filter,
  Check,
  ChevronDown,
  ThumbsUp,
  Flame,
  ArrowUpDown,
  FileText,
} from 'lucide-react';
import {
  formatMinutesToHours,
  formatUzMonth,
  getLocalMonthString,
  calculateLateMinutes,
  getAccurateAttendanceMinutes,
} from '../utils/calculations';
import { sendTelegramNotification, triggerHaptic } from '../utils/telegram';
import { exportKpiRatingToPdf } from '../utils/pdfExport';

interface KpiRatingManagerProps {
  users: User[];
  attendances: Attendance[];
  settings: MarketSettings;
}

export type PeriodFilter = 'this_month' | 'prev_month' | 'last_30_days' | 'all_time';
export type SortOption = 'hours' | 'kpi' | 'punctuality' | 'days';

export interface WorkerKpiMetric {
  user: User;
  rank: number;
  totalWorkedMinutes: number;
  totalWorkedHours: number;
  formattedWorkedHours: string;
  workedDaysCount: number;
  averageDailyHours: number;
  totalBreakMinutes: number;
  formattedBreakHours: string;
  onTimeCount: number;
  lateCount: number;
  punctualityRate: number; // 0-100 %
  totalLateMinutes: number;
  hoursScore: number; // 0-50
  disciplineScore: number; // 0-30
  consistencyScore: number; // 0-15
  breakScore: number; // 0-5
  totalKpiScore: number; // 0-100
  tier: 'top' | 'good' | 'average' | 'low';
  badgeTitle: string;
  rewardRecommendation: string;
}

export function KpiRatingManager({ users, attendances, settings }: KpiRatingManagerProps) {
  const currentMonthStr = getLocalMonthString(new Date());

  // O'tgan oy YYYY-MM
  const prevMonthStr = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return getLocalMonthString(d);
  }, []);

  const [period, setPeriod] = useState<PeriodFilter>('this_month');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [sortBy, setSortBy] = useState<SortOption>('hours');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<string>('all');
  const [isSendingTelegram, setIsSendingTelegram] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Faol xodimlar
  const workers = useMemo(() => {
    return users.filter((u) => u.role === 'worker' && u.is_active !== false);
  }, [users]);

  // Lavozimlar ro'yxati
  const positions = useMemo(() => {
    const set = new Set<string>();
    workers.forEach((w) => {
      if (w.position) set.add(w.position);
    });
    return Array.from(set);
  }, [workers]);

  // Sana filtri bo'yicha davomatlarni ajratish
  const filteredAttendances = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    return attendances.filter((att) => {
      if (period === 'this_month') {
        return att.date.startsWith(selectedMonth);
      }
      if (period === 'prev_month') {
        return att.date.startsWith(prevMonthStr);
      }
      if (period === 'last_30_days') {
        return att.date >= thirtyDaysAgoStr;
      }
      if (period === 'all_time') {
        return true;
      }
      return true;
    });
  }, [attendances, period, selectedMonth, prevMonthStr]);

  // Har bir xodim uchun KPI va soatlarni hisoblash
  const kpiDataList = useMemo(() => {
    // 1. Dastlabki hisoblash
    const rawList = workers.map((worker) => {
      const workerAtts = filteredAttendances.filter((a) => a.user_id === worker.id);

      let totalWorkedMinutes = 0;
      let totalBreakMinutes = 0;
      const uniqueDates = new Set<string>();
      let onTimeCount = 0;
      let lateCount = 0;
      let totalLateMinutes = 0;

      // Har bir kun uchun eng birinchi kelgan smenani aniqlaymiz (faqat 1-smena kechikishga tekshiriladi)
      const dateFirstShiftMap = new Map<string, Attendance>();
      workerAtts.forEach((att) => {
        const existing = dateFirstShiftMap.get(att.date);
        if (!existing || (att.check_in_time || '').localeCompare(existing.check_in_time || '') < 0) {
          dateFirstShiftMap.set(att.date, att);
        }
      });

      workerAtts.forEach((att) => {
        uniqueDates.add(att.date);
        totalWorkedMinutes += getAccurateAttendanceMinutes(att);
        totalBreakMinutes += att.total_break_minutes || 0;

        // Kechikish FAQAT kunning birinchi smenasi uchun hisoblanadi (5 daqiqalik me'yoriy chegarasi bilan)
        const isFirstShiftOfDate = dateFirstShiftMap.get(att.date)?.id === att.id;
        if (isFirstShiftOfDate) {
          const late = calculateLateMinutes(
            att.check_in_time ? att.check_in_time.slice(0, 5) : '',
            worker.work_start_time || '08:00'
          );
          if (late > 5) {
            lateCount++;
            totalLateMinutes += late;
          } else {
            onTimeCount++;
          }
        }
      });

      const workedDaysCount = uniqueDates.size;
      const totalWorkedHours = Math.round((totalWorkedMinutes / 60) * 10) / 10;
      const averageDailyHours =
        workedDaysCount > 0 ? Math.round((totalWorkedHours / workedDaysCount) * 10) / 10 : 0;

      const punctualityRate =
        workedDaysCount > 0 ? Math.round((onTimeCount / workedDaysCount) * 100) : 100;

      return {
        user: worker,
        totalWorkedMinutes,
        totalWorkedHours,
        formattedWorkedHours: formatMinutesToHours(totalWorkedMinutes),
        workedDaysCount,
        averageDailyHours,
        totalBreakMinutes,
        formattedBreakHours: formatMinutesToHours(totalBreakMinutes),
        onTimeCount,
        lateCount,
        punctualityRate,
        totalLateMinutes,
      };
    });

    // 2. Guruhdagi maksimal ishlangan vaqt (eng ko'p ishlagan xodim)
    const maxMinutes = Math.max(...rawList.map((r) => r.totalWorkedMinutes), 1);
    const benchmarkNormMinutes = period === 'all_time' ? maxMinutes : 180 * 60; // 180 soat oylik reja
    const targetBenchmark = Math.max(maxMinutes, benchmarkNormMinutes);

    // 3. KPI ballarini hisoblash (0-100)
    const scoredList = rawList.map((item) => {
      // a) Ish soati ulushi (Maksimal 50 ball)
      const hoursScore = Math.min(
        50,
        Math.round((item.totalWorkedMinutes / targetBenchmark) * 50)
      );

      // b) Intizom va kechikmaslik (Maksimal 30 ball)
      const disciplineScore = Math.round((item.punctualityRate / 100) * 30);

      // c) Kelgan kunlar barqarorligi (Maksimal 15 ball)
      const expectedDays = period === 'all_time' ? 30 : 24;
      const consistencyScore = Math.min(
        15,
        Math.round((item.workedDaysCount / expectedDays) * 15)
      );

      // d) Tanaffus me'yori (Maksimal 5 ball)
      const breakRatio =
        item.totalWorkedMinutes > 0 ? item.totalBreakMinutes / item.totalWorkedMinutes : 0;
      const breakScore = breakRatio <= 0.15 ? 5 : breakRatio <= 0.25 ? 3 : 1;

      const totalKpiScore = Math.min(
        100,
        Math.max(0, hoursScore + disciplineScore + consistencyScore + breakScore)
      );

      // Tier & Tavsiya
      let tier: 'top' | 'good' | 'average' | 'low' = 'low';
      let badgeTitle = 'Yetarli emas';
      let rewardRecommendation = "Intizom va ish soatlarini oshirish tavsiya etiladi";

      if (totalKpiScore >= 88) {
        tier = 'top';
        badgeTitle = 'Top Xodim 🌟';
        rewardRecommendation = '🏆 Oylik eng yuqori mukofot / Bonusga tavsiya etiladi (+20%)';
      } else if (totalKpiScore >= 72) {
        tier = 'good';
        badgeTitle = 'A’lochi 👍';
        rewardRecommendation = '✨ Barqaror va faol ishladi (+10% rag‘batlantirish)';
      } else if (totalKpiScore >= 55) {
        tier = 'average';
        badgeTitle = 'O‘rtacha ⚡️';
        rewardRecommendation = 'Me’yoriy daraja saqlangan';
      } else {
        tier = 'low';
        badgeTitle = 'E’tibor kerak ⚠️';
        rewardRecommendation = 'Kechikishlar ko‘p yoki ish soati kam';
      }

      return {
        ...item,
        rank: 0,
        hoursScore,
        disciplineScore,
        consistencyScore,
        breakScore,
        totalKpiScore,
        tier,
        badgeTitle,
        rewardRecommendation,
      };
    });

    // 4. Saralash (Sort)
    scoredList.sort((a, b) => {
      if (sortBy === 'hours') {
        if (b.totalWorkedMinutes !== a.totalWorkedMinutes) {
          return b.totalWorkedMinutes - a.totalWorkedMinutes;
        }
        return b.totalKpiScore - a.totalKpiScore;
      }
      if (sortBy === 'kpi') {
        if (b.totalKpiScore !== a.totalKpiScore) {
          return b.totalKpiScore - a.totalKpiScore;
        }
        return b.totalWorkedMinutes - a.totalWorkedMinutes;
      }
      if (sortBy === 'punctuality') {
        if (b.punctualityRate !== a.punctualityRate) {
          return b.punctualityRate - a.punctualityRate;
        }
        return b.totalWorkedMinutes - a.totalWorkedMinutes;
      }
      if (sortBy === 'days') {
        return b.workedDaysCount - a.workedDaysCount;
      }
      return b.totalWorkedMinutes - a.totalWorkedMinutes;
    });

    // O'rinlarni belgilash (1, 2, 3...)
    return scoredList.map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
  }, [workers, filteredAttendances, period, sortBy]);

  // Qidiruv va lavozim filtri
  const displayList = useMemo(() => {
    return kpiDataList.filter((item) => {
      const matchSearch =
        item.user.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.user.phone.includes(searchTerm) ||
        (item.user.position && item.user.position.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchPos =
        selectedPosition === 'all' || item.user.position === selectedPosition;

      return matchSearch && matchPos;
    });
  }, [kpiDataList, searchTerm, selectedPosition]);

  // Umumiy jamoa ko'rsatkichlari
  const totalTeamHours = useMemo(() => {
    const mins = kpiDataList.reduce((sum, item) => sum + item.totalWorkedMinutes, 0);
    return Math.round((mins / 60) * 10) / 10;
  }, [kpiDataList]);

  const averageKpiScore = useMemo(() => {
    if (kpiDataList.length === 0) return 0;
    const sum = kpiDataList.reduce((s, i) => s + i.totalKpiScore, 0);
    return Math.round(sum / kpiDataList.length);
  }, [kpiDataList]);

  const teamPunctuality = useMemo(() => {
    if (kpiDataList.length === 0) return 100;
    const sum = kpiDataList.reduce((s, i) => s + i.punctualityRate, 0);
    return Math.round(sum / kpiDataList.length);
  }, [kpiDataList]);

  // Top 3 yetakchi
  const top1 = kpiDataList[0];
  const top2 = kpiDataList[1];
  const top3 = kpiDataList[2];

  // =========================================================================
  // TELEGRAM GURUHGA REYTINGNI E'LON QILISH
  // =========================================================================
  const handleAnnounceToTelegram = async () => {
    if (!settings.bot_token) {
      setNotification({
        type: 'error',
        message: "Sozlamalarda Telegram Bot Token kiritilmagan!",
      });
      return;
    }

    const targetChat = settings.group_telegram_id || settings.admin_telegram_id;
    if (!targetChat) {
      setNotification({
        type: 'error',
        message: "Do'kon guruhi ID yoki Admin Telegram ID kiritilmagan!",
      });
      return;
    }

    setIsSendingTelegram(true);
    triggerHaptic('medium');

    const periodName =
      period === 'this_month'
        ? formatUzMonth(selectedMonth)
        : period === 'prev_month'
        ? formatUzMonth(prevMonthStr)
        : period === 'last_30_days'
        ? 'Oxirgi 30 kunlik'
        : 'Barcha davr';

    let text = `🏆 <b>${settings.shop_name || 'Navo Market'} — ISHCHILARNING SAMARADORLIK VA ISH SOATI REYTINGI</b>\n`;
    text += `📅 Davr: <b>${periodName}</b>\n\n`;

    text += `👥 Jamoaning jami mehnati: <b>${totalTeamHours} soat</b>\n`;
    text += `📈 O‘rtacha KPI intizomi: <b>${averageKpiScore} ball</b> | Vaqtida kelish: <b>${teamPunctuality}%</b>\n\n`;

    text += `🥇 <b>YETAKCHI TOP XODIMLAR:</b>\n`;
    const topList = kpiDataList.slice(0, 5);
    topList.forEach((item) => {
      const medal =
        item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `🔹 #${item.rank}`;
      const pos = item.user.position ? ` (${item.user.position})` : '';
      text += `${medal} <b>${item.user.full_name}</b>${pos}\n`;
      text += `   ⏱ Ishlangan vaqt: <b>${item.totalWorkedHours} soat</b> (${item.workedDaysCount} kun)\n`;
      text += `   ⭐ KPI Bali: <b>${item.totalKpiScore}/100</b> · Intizom: <b>${item.punctualityRate}%</b>\n\n`;
    });

    text += `👏 <i>Barcha faol xodimlarimizga halol mehnati va do‘kondagi mas’uliyatli xizmati uchun minnatdorchilik bildiramiz!</i>\n`;
    text += `🚀 <i>Eng ko‘p ishlagan xodimlarimiz oylik taqdirlash va rag‘batlantirish ro‘yxatiga kiritildi!</i>`;

    const res = await sendTelegramNotification(settings.bot_token, targetChat, text);
    setIsSendingTelegram(false);

    if (res.success) {
      setNotification({
        type: 'success',
        message: "Samaradorlik reytingi Telegram guruhga muvaffaqiyatli e'lon qilindi!",
      });
      triggerHaptic('success');
    } else {
      setNotification({
        type: 'error',
        message: res.error || "Xabar yuborilmadi.",
      });
      triggerHaptic('error');
    }

    setTimeout(() => setNotification(null), 5000);
  };

  // Rasmiy PDF hisobotni yuklab olish
  const handleExportPDF = () => {
    if (kpiDataList.length === 0) {
      setNotification({
        type: 'error',
        message: "Hisobotda xodimlar ma'lumotlari mavjud emas!",
      });
      return;
    }

    setIsExportingPdf(true);
    triggerHaptic('medium');

    try {
      const periodName =
        period === 'this_month'
          ? formatUzMonth(selectedMonth)
          : period === 'prev_month'
          ? formatUzMonth(prevMonthStr)
          : period === 'last_30_days'
          ? 'Oxirgi 30 kun'
          : 'Barcha davr';

      exportKpiRatingToPdf(kpiDataList, periodName, settings.shop_name, {
        totalHours: totalTeamHours,
        averageKpi: averageKpiScore,
        punctualityRate: teamPunctuality,
        totalWorkers: workers.length,
      });

      setNotification({
        type: 'success',
        message: "Rasmiy PDF hisoboti muvaffaqiyatli shakllantirildi va yuklab olindi!",
      });
      triggerHaptic('success');
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: `PDF yaratishda xatolik: ${err?.message || err}`,
      });
      triggerHaptic('error');
    } finally {
      setIsExportingPdf(false);
      setTimeout(() => setNotification(null), 4000);
    }
  };

  // CSV ga yuklab olish
  const handleExportCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    csvContent += 'Reyting;Xodim;Lavozimi;Telefon;Jami soat;Jami daqiqa;Ishlagan kunlari;Kunlik ortacha;Vaqtida kelish foizi;Kechikishlar;KPI Bali;Daraja;Tavsiya\n';

    kpiDataList.forEach((item) => {
      csvContent += `${item.rank};"${item.user.full_name}";"${item.user.position || 'Xodim'}";"${item.user.phone}";${item.totalWorkedHours};${item.totalWorkedMinutes};${item.workedDaysCount};${item.averageDailyHours};${item.punctualityRate}%;${item.lateCount};${item.totalKpiScore};"${item.badgeTitle}";"${item.rewardRecommendation}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Navo_Market_KPI_Reytingi_${period}_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-5 sm:space-y-6 max-w-6xl mx-auto pb-10">
      {/* 1. Sarlavha va Asosiy Boshqaruv */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 text-white flex items-center justify-center shrink-0 shadow-md">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Samaradorlik Reytingi (KPI)
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black uppercase tracking-wide">
                Top Ishchilar
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Ishlangan soatlar, intizom va davomat asosida eng ko'p ishlayotgan xodimlarning haqqoniy reytingi
            </p>
          </div>
        </div>

        {/* Tezkor Tugmalar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Rasmiy PDF Hisobot yuklab olish */}
          <button
            type="button"
            disabled={isExportingPdf || kpiDataList.length === 0}
            onClick={handleExportPDF}
            className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-800 hover:opacity-95 disabled:opacity-50 text-white rounded-2xl text-xs font-black transition flex items-center gap-2 shadow-xs cursor-pointer active:scale-95 whitespace-nowrap"
            title="Rasmiy PDF hisobotini yuklab olish"
          >
            <FileText className="w-4 h-4 text-emerald-200" />
            <span>{isExportingPdf ? "Tayyorlanmoqda..." : "📄 Rasmiy PDF Hisobot"}</span>
          </button>

          <button
            type="button"
            disabled={isSendingTelegram}
            onClick={handleAnnounceToTelegram}
            className="px-4 py-2.5 bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:opacity-95 disabled:opacity-50 text-white rounded-2xl text-xs font-black transition flex items-center gap-2 shadow-xs cursor-pointer active:scale-95 whitespace-nowrap"
          >
            <Send className="w-4 h-4" />
            <span>{isSendingTelegram ? "Yuborilmoqda..." : "📢 Guruhga Reytingni E'lon Qilish"}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer active:scale-95"
            title="Excel/CSV yuklab olish"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Excelga Yuklash</span>
          </button>
        </div>
      </div>

      {/* Bildirishnoma */}
      {notification && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center gap-2.5 animate-in fade-in ${
            notification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* 2. Vaqt Oralig'i va Filtrlash Paneli */}
      <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Davr Tablari */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => {
                setPeriod('this_month');
                setSelectedMonth(currentMonthStr);
              }}
              className={`py-2 px-3 sm:px-4 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                period === 'this_month'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📅 Shu oy ({formatUzMonth(currentMonthStr)})
            </button>

            <button
              type="button"
              onClick={() => {
                setPeriod('prev_month');
                setSelectedMonth(prevMonthStr);
              }}
              className={`py-2 px-3 sm:px-4 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                period === 'prev_month'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ⏮ O'tgan oy ({formatUzMonth(prevMonthStr)})
            </button>

            <button
              type="button"
              onClick={() => setPeriod('last_30_days')}
              className={`py-2 px-3 sm:px-4 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                period === 'last_30_days'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ⏳ Oxirgi 30 kun
            </button>

            <button
              type="button"
              onClick={() => setPeriod('all_time')}
              className={`py-2 px-3 sm:px-4 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                period === 'all_time'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ♾ Butun davr
            </button>
          </div>

          {/* Saralash tartibi */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>Saralash:</span>
            </span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
            >
              <option value="hours">⏱ Eng ko'p ishlaganlar (Soat bo'yicha)</option>
              <option value="kpi">⭐ Eng yuqori KPI (Umumiy ball)</option>
              <option value="punctuality">🎯 Eng intizomli (Vaqtida kelish)</option>
              <option value="days">📅 Eng ko'p kun kelganlar</option>
            </select>
          </div>
        </div>

        {/* Qidiruv va Lavozim filteri */}
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Xodim ismi, lavozimi yoki telefon raqami..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedPosition}
              onChange={(e) => setSelectedPosition(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="all">Barcha lavozimlar ({workers.length})</option>
              {positions.map((pos) => (
                <option key={pos} value={pos}>
                  {pos}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 3. Asosiy Jamoa Statistikasi (Summary Cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md">
            <Clock className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
              Jami Ish Soatlari
            </div>
            <div className="text-lg sm:text-xl font-black text-slate-900 truncate">
              {totalTeamHours} <span className="text-xs font-bold text-slate-500">soat</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-md">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
              O'rtacha Jamoa KPI
            </div>
            <div className="text-lg sm:text-xl font-black text-emerald-600 truncate">
              {averageKpiScore} <span className="text-xs font-bold text-slate-500">/ 100 ball</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-blue-500 text-white flex items-center justify-center shrink-0 shadow-md">
            <TargetIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
              Vaqtida Kelish
            </div>
            <div className="text-lg sm:text-xl font-black text-blue-600 truncate">
              {teamPunctuality}%
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-purple-500 text-white flex items-center justify-center shrink-0 shadow-md">
            <Users className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
              Faol Xodimlar
            </div>
            <div className="text-lg sm:text-xl font-black text-purple-600 truncate">
              {workers.length} <span className="text-xs font-bold text-slate-500">kishi</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Top-3 Shoxsupasi (Pedestal Podium) */}
      {top1 && (
        <div className="bg-gradient-to-b from-amber-50/70 via-white to-white rounded-3xl p-5 sm:p-6 border border-amber-200/80 shadow-xs space-y-4">
          <div className="text-center max-w-md mx-auto mb-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-700 bg-amber-100/80 px-3 py-1 rounded-full">
              👑 Shoxsufa — Yetakchilar Uchligi
            </span>
            <h3 className="text-base sm:text-lg font-black text-slate-900 mt-1">
              Eng Ko'p Mehnat Qilgan Xodimlar
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 items-end pt-2">
            {/* 2-O'rin (Kumush) */}
            {top2 ? (
              <div className="order-2 md:order-1 bg-slate-50 rounded-3xl p-4 sm:p-5 border border-slate-200 text-center relative flex flex-col items-center shadow-2xs hover:border-slate-300 transition">
                <div className="w-8 h-8 rounded-full bg-slate-300 text-slate-800 font-black text-xs flex items-center justify-center mb-2 shadow-xs">
                  🥈 #2
                </div>
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800 font-black text-lg flex items-center justify-center shadow-inner mb-2">
                  {top2.user.full_name.charAt(0)}
                </div>
                <div className="font-extrabold text-sm text-slate-900 truncate w-full">
                  {top2.user.full_name}
                </div>
                <div className="text-[11px] text-slate-500 truncate w-full">{top2.user.position || 'Xodim'}</div>
                <div className="mt-3 py-1.5 px-3 rounded-xl bg-white border border-slate-200 w-full">
                  <div className="text-base font-black text-slate-900">{top2.totalWorkedHours} soat</div>
                  <div className="text-[10px] text-slate-500 font-semibold">{top2.workedDaysCount} kun · KPI: {top2.totalKpiScore} ball</div>
                </div>
              </div>
            ) : <div className="hidden md:block order-1" />}

            {/* 1-O'rin (Oltin Yetakchi - Markazda Katta) */}
            <div className="order-1 md:order-2 bg-gradient-to-b from-amber-50 to-amber-100/50 rounded-3xl p-5 sm:p-6 border-2 border-amber-400 text-center relative flex flex-col items-center shadow-md scale-102 hover:border-amber-500 transition">
              <div className="absolute -top-3.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-black text-[11px] px-3.5 py-0.5 rounded-full shadow-md flex items-center gap-1">
                <span>🥇</span>
                <span>OYNING ENG SAMARALI XODIMI</span>
              </div>

              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-white font-black text-2xl flex items-center justify-center shadow-lg mb-2 mt-2">
                {top1.user.full_name.charAt(0)}
              </div>
              <div className="font-black text-base text-slate-900 truncate w-full">
                {top1.user.full_name}
              </div>
              <div className="text-xs text-amber-900 font-bold truncate w-full">{top1.user.position || 'Xodim'}</div>

              <div className="mt-3.5 py-2 px-4 rounded-2xl bg-white/90 border border-amber-300 w-full shadow-xs space-y-0.5">
                <div className="text-xl font-black text-amber-900 flex items-center justify-center gap-1">
                  <Flame className="w-5 h-5 text-amber-500 fill-amber-500" />
                  <span>{top1.totalWorkedHours} soat</span>
                </div>
                <div className="text-xs text-emerald-700 font-bold">
                  KPI Bali: {top1.totalKpiScore}/100 · Intizom: {top1.punctualityRate}%
                </div>
                <div className="text-[10px] text-slate-500 font-medium pt-0.5 border-t border-slate-100">
                  {top1.workedDaysCount} kun davomat · kuniga o'rtacha {top1.averageDailyHours} soat
                </div>
              </div>
            </div>

            {/* 3-O'rin (Bronza) */}
            {top3 ? (
              <div className="order-3 bg-amber-50/40 rounded-3xl p-4 sm:p-5 border border-amber-200/60 text-center relative flex flex-col items-center shadow-2xs hover:border-amber-300 transition">
                <div className="w-8 h-8 rounded-full bg-amber-700 text-white font-black text-xs flex items-center justify-center mb-2 shadow-xs">
                  🥉 #3
                </div>
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-600 to-amber-800 text-white font-black text-lg flex items-center justify-center shadow-inner mb-2">
                  {top3.user.full_name.charAt(0)}
                </div>
                <div className="font-extrabold text-sm text-slate-900 truncate w-full">
                  {top3.user.full_name}
                </div>
                <div className="text-[11px] text-slate-500 truncate w-full">{top3.user.position || 'Xodim'}</div>
                <div className="mt-3 py-1.5 px-3 rounded-xl bg-white border border-amber-200 w-full">
                  <div className="text-base font-black text-slate-900">{top3.totalWorkedHours} soat</div>
                  <div className="text-[10px] text-slate-500 font-semibold">{top3.workedDaysCount} kun · KPI: {top3.totalKpiScore} ball</div>
                </div>
              </div>
            ) : <div className="hidden md:block order-3" />}
          </div>
        </div>
      )}

      {/* 5. To'liq Reyting Jadvali (Interactive Leaderboard Table) */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-500" />
              <span>Barcha Xodimlarning Samaradorlik Jadvali ({displayList.length})</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Ishlangan soat ulushi (50%), vaqtida kelish intizomi (30%), barqarorlik (15%) va tanaffus (5%) asosida
            </p>
          </div>
        </div>

        {displayList.length === 0 ? (
          <div className="p-10 text-center text-slate-500 space-y-2">
            <Users className="w-10 h-10 text-slate-300 mx-auto" />
            <div className="text-sm font-bold text-slate-700">Xodimlar topilmadi</div>
            <div className="text-xs text-slate-400">
              Qidiruv shartlarini o'zgartiring yoki ushbu davrda davomat yozuvlari mavjud emas.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 text-slate-500 font-black border-b border-slate-100 uppercase tracking-wider text-[10px]">
                  <th className="py-3.5 px-4 w-14 text-center">O'rin</th>
                  <th className="py-3.5 px-4">Xodim</th>
                  <th className="py-3.5 px-4">Jami Ish Soatlari</th>
                  <th className="py-3.5 px-4">Kunlar / O'rtacha</th>
                  <th className="py-3.5 px-4">Vaqtida Kelish</th>
                  <th className="py-3.5 px-4">KPI Bali</th>
                  <th className="py-3.5 px-4">Holati & Tavsiya</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {displayList.map((item) => {
                  const maxHours = top1?.totalWorkedHours || 1;
                  const hoursPercent = Math.min(100, Math.round((item.totalWorkedHours / maxHours) * 100));

                  const rankBadgeClass =
                    item.rank === 1
                      ? 'bg-amber-500 text-white font-black shadow-xs'
                      : item.rank === 2
                      ? 'bg-slate-400 text-white font-black'
                      : item.rank === 3
                      ? 'bg-amber-700 text-white font-black'
                      : 'bg-slate-100 text-slate-600 font-bold';

                  return (
                    <tr
                      key={item.user.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        item.rank <= 3 ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      {/* O'rin */}
                      <td className="py-3.5 px-4 text-center">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-xl text-xs ${rankBadgeClass}`}>
                          {item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : item.rank}
                        </span>
                      </td>

                      {/* Xodim */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 font-black text-xs flex items-center justify-center shrink-0">
                            {item.user.full_name.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-extrabold text-slate-900 truncate">
                              {item.user.full_name}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {item.user.position || 'Xodim'} · {item.user.phone}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Ishlangan Soatlar (Visual Progress bar) */}
                      <td className="py-3.5 px-4">
                        <div>
                          <div className="flex items-center gap-1.5 font-black text-slate-900 text-sm">
                            <span>{item.totalWorkedHours}</span>
                            <span className="text-[11px] font-semibold text-slate-400">soat</span>
                          </div>
                          {/* Mini Progress bar */}
                          <div className="w-28 sm:w-36 h-2 bg-slate-100 rounded-full mt-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                item.rank === 1
                                  ? 'bg-amber-500'
                                  : item.rank === 2
                                  ? 'bg-slate-400'
                                  : item.rank === 3
                                  ? 'bg-amber-700'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${hoursPercent}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {item.formattedWorkedHours}
                          </div>
                        </div>
                      </td>

                      {/* Kelgan kunlari va o'rtacha kunlik soat */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-800">
                          {item.workedDaysCount} kun kelgan
                        </div>
                        <div className="text-[11px] text-slate-500">
                          O'rtacha: <b>{item.averageDailyHours} soat/kun</b>
                        </div>
                      </td>

                      {/* Intizom / Vaqtida kelish */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-black text-xs ${
                              item.punctualityRate >= 90
                                ? 'text-emerald-700'
                                : item.punctualityRate >= 75
                                ? 'text-blue-700'
                                : 'text-rose-700'
                            }`}
                          >
                            {item.punctualityRate}%
                          </span>
                          <span className="text-[10px] text-slate-400">vaqtida</span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {item.lateCount === 0 ? (
                            <span className="text-emerald-600 font-semibold">Kechikish yo'q</span>
                          ) : (
                            <span className="text-rose-600 font-semibold">{item.lateCount} marta kechikkan</span>
                          )}
                        </div>
                      </td>

                      {/* KPI Bali */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-sm font-black px-2.5 py-1 rounded-xl shadow-2xs ${
                              item.tier === 'top'
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : item.tier === 'good'
                                ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                : item.tier === 'average'
                                ? 'bg-blue-100 text-blue-900 border border-blue-200'
                                : 'bg-rose-100 text-rose-900 border border-rose-200'
                            }`}
                          >
                            {item.totalKpiScore}
                          </span>
                          <span className="text-[10px] text-slate-400 font-semibold">/100</span>
                        </div>
                      </td>

                      {/* Holati va Tavsiya */}
                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-slate-900 flex items-center gap-1">
                          <span>{item.badgeTitle}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 max-w-xs leading-tight">
                          {item.rewardRecommendation}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6. Samaradorlik / KPI Hisoblash Qoidalari Ko'rsatmasi */}
      <div className="bg-slate-50 rounded-3xl p-5 border border-slate-200 text-xs text-slate-600 space-y-2.5">
        <div className="flex items-center gap-2 font-black text-slate-900 text-xs sm:text-sm">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span>Navo Market KPI Reytingi Qanday Hisoblanadi?</span>
        </div>
        <p className="leading-relaxed">
          Ushbu reyting do'konda eng ko'p mehnat qilayotgan va mas'uliyatli xodimlarni haqqoniy aniqlash uchun quyidagi 4 ta asosiy mezonga tayanadi:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 pt-1">
          <div className="p-3 bg-white rounded-2xl border border-slate-200/80">
            <div className="font-black text-slate-900 text-xs text-amber-700">⏱ Ish Hajmi (50 ball)</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Oy davomida ishlangan jami soatlar miqdori</div>
          </div>
          <div className="p-3 bg-white rounded-2xl border border-slate-200/80">
            <div className="font-black text-slate-900 text-xs text-emerald-700">🎯 Intizom (30 ball)</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Belgilangan vaqtda kechikmasdan kelish ko'rsatkichi</div>
          </div>
          <div className="p-3 bg-white rounded-2xl border border-slate-200/80">
            <div className="font-black text-slate-900 text-xs text-blue-700">📅 Barqarorlik (15 ball)</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Oydagi smenalarga qoldirmasdan qatnashish darajasi</div>
          </div>
          <div className="p-3 bg-white rounded-2xl border border-slate-200/80">
            <div className="font-black text-slate-900 text-xs text-purple-700">☕️ Tanaffus (5 ball)</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Tanaffus vaqtidan me'yorda va unumli foydalanish</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TargetIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
