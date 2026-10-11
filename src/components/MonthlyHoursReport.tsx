import React, { useState, useMemo } from 'react';
import { Attendance, User } from '../types';
import {
  calculateMonthlyHours,
  calculateHoursByDateRange,
  getAccurateAttendanceMinutes,
  formatMinutesToHours,
  formatUzDate,
  formatUzMonth,
  getLocalMonthString,
  getLocalDateString,
} from '../utils/calculations';
import {
  BarChart3,
  Calendar,
  CalendarRange,
  Clock,
  UserCheck,
  ChevronDown,
  ChevronRight,
  Printer,
  Copy,
  Check,
  Download,
  CreditCard,
  Lock,
} from 'lucide-react';

interface MonthlyHoursReportProps {
  users: User[];
  attendances: Attendance[];
  forWorkerId?: number;
  onNavigateToPayroll?: () => void;
}

export function MonthlyHoursReport({
  users,
  attendances,
  forWorkerId,
  onNavigateToPayroll,
}: MonthlyHoursReportProps) {
  const currentMonthStr = getLocalMonthString(new Date());
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);

  // Sana oralig'i rejimi ('month' - bir oylik, 'range' - oraliq: masalan 01.10 dan 15.10 gacha)
  const [periodMode, setPeriodMode] = useState<'month' | 'range'>('month');

  // Oraliq uchun boshlanish va tugash sanalari
  const todayDateStr = getLocalDateString(new Date());
  const [rangeStartDate, setRangeStartDate] = useState<string>(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  });
  const [rangeEndDate, setRangeEndDate] = useState<string>(todayDateStr);

  const [expandedWorkerId, setExpandedWorkerId] = useState<number | null>(forWorkerId || null);
  const [copied, setCopied] = useState(false);

  const isPersonalView = typeof forWorkerId === 'number';
  const targetUsers = isPersonalView ? users.filter((u) => u.id === forWorkerId) : users;
  const workers = targetUsers.filter((u) => isPersonalView || u.role === 'worker');

  // Faol davr tafsilotlari
  const activePeriod = useMemo(() => {
    if (periodMode === 'range') {
      const s = rangeStartDate <= rangeEndDate ? rangeStartDate : rangeEndDate;
      const e = rangeStartDate <= rangeEndDate ? rangeEndDate : rangeStartDate;
      return {
        isRange: true,
        startDate: s,
        endDate: e,
        label: `${s} — ${e}`,
      };
    }
    const [y, m] = selectedMonth.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const s = `${selectedMonth}-01`;
    const e = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
    return {
      isRange: false,
      startDate: s,
      endDate: e,
      label: formatUzMonth(selectedMonth),
    };
  }, [periodMode, selectedMonth, rangeStartDate, rangeEndDate]);

  // Tanlangan davr (oy yoki oraliq) bo'yicha hisoblangan ma'lumotlar
  const monthlyData = useMemo(() => {
    if (periodMode === 'range') {
      return calculateHoursByDateRange(
        targetUsers,
        attendances,
        activePeriod.startDate,
        activePeriod.endDate,
        isPersonalView
      );
    }
    return calculateMonthlyHours(targetUsers, attendances, selectedMonth, isPersonalView);
  }, [periodMode, targetUsers, attendances, activePeriod, selectedMonth, isPersonalView]);

  // Umumiy do'kon boyicha jami soatlar
  const totalStoreMinutes = monthlyData.reduce(
    (sum, item) => sum + item.total_worked_minutes,
    0
  );

  const handleCopyReport = () => {
    let text = `📊 DO'KON ISHCHILARINING ISH VAQTI HISOBOTI (${activePeriod.label})\n\n`;
    monthlyData.forEach((w, idx) => {
      text += `${idx + 1}. ${w.full_name} (${w.position})\n`;
      text += `   • Kelgan kunlari: ${w.worked_days} kun\n`;
      text += `   • Jami ishlagan vaqti: ${w.formatted_total_hours} (${w.total_worked_hours} soat)\n\n`;
    });
    text += `Umumiy do'kon soatlari: ${formatMinutesToHours(totalStoreMinutes)}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    csvContent += 'T/r;Xodim;Lavozimi;Telefon;Kelgan kunlari;Jami ishlagan vaqti;Jami soat\n';
    monthlyData.forEach((w, idx) => {
      csvContent += `${idx + 1};"${w.full_name}";"${w.position}";"${w.phone}";${w.worked_days};"${w.formatted_total_hours}";${w.total_worked_hours}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Ishchilar_Ish_Vaqti_${activePeriod.label.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Banner: Agar admin bo'lsa, Oylik to'lash bo'limiga o'tish tugmasi */}
      {onNavigateToPayroll && !isPersonalView && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-700 to-emerald-800 text-white shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <CreditCard className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <div className="text-sm font-black flex items-center gap-2">
                <span>Oylik Maoshlar & Har Bir Xodimga To'lov Qilish</span>
                <span className="text-[10px] bg-amber-400 text-slate-900 font-extrabold px-2 py-0.5 rounded-full">
                  Maxfiy Buxgalteriya
                </span>
              </div>
              <p className="text-xs text-emerald-100 mt-0.5">
                Ishlangan vaqt, avanslar, jarimalar va mukofotlarni hisoblab har bir xodimga alohida to'lov cheki chiqarish
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onNavigateToPayroll}
            className="px-4 py-2 rounded-xl bg-white text-emerald-800 hover:bg-emerald-50 font-black text-xs shadow transition cursor-pointer self-start sm:self-auto shrink-0 flex items-center gap-1.5"
          >
            <Lock className="w-3.5 h-3.5 text-emerald-700" />
            <span>Oylik Paneli & To'lov Qilish ➡️</span>
          </button>
        </div>
      )}

      {/* Sarlavha, Rejim almashtirish va Vaqt Tanlagich */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <span>{isPersonalView ? 'Mening Ish Soatlarim' : 'Ish Soatlari Hisoboti'}</span>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg">
              {activePeriod.label}
            </span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isPersonalView
              ? 'Belgilangan davrda ishlagan umumiy soatlaringiz va kunlik davomat tafsilotlari'
              : 'Har bir ishchining ishlagan soatlari, kunlari va davomati'}
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Rejim Almashtirgich: Oylik yoki Sana Oralig'i */}
          <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200">
            <button
              type="button"
              onClick={() => setPeriodMode('month')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                periodMode === 'month'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-amber-600" />
              <span>Oylik</span>
            </button>

            <button
              type="button"
              onClick={() => setPeriodMode('range')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                periodMode === 'range'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarRange className="w-3.5 h-3.5 text-emerald-600" />
              <span>Sana Oralig'i</span>
            </button>
          </div>

          {/* 1. Oylik tanlagich */}
          {periodMode === 'month' ? (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-xs text-slate-500">Oy:</span>
              <input
                type="month"
                aria-label="Hisobot oyi"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
              />
            </div>
          ) : (
            /* 2. Sana Oralig'i Tanlagich */
            <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
              <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400">Dan:</span>
                <input
                  type="date"
                  value={rangeStartDate}
                  onChange={(e) => setRangeStartDate(e.target.value)}
                  className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
                />
              </div>
              <span className="text-xs text-slate-400 font-bold">—</span>
              <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400">Gacha:</span>
                <input
                  type="date"
                  value={rangeEndDate}
                  onChange={(e) => setRangeEndDate(e.target.value)}
                  className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
                />
              </div>
            </div>
          )}

          {!isPersonalView && (
            <>
              <button
                onClick={handleCopyReport}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
                title="Hisobot matnidan nusxa olish"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Nusxalandi!' : 'Nusxalash'}</span>
              </button>

              <button
                onClick={handleDownloadCSV}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-semibold transition"
                title="Excel formatida yuklab olish"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Excel / CSV</span>
              </button>
            </>
          )}

          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
            title="Chop etish"
          >
            <Printer className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sana oralig'i rejimi faol bo'lganda tezkor oraliq tanlash tugmalari */}
      {periodMode === 'range' && (
        <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-emerald-900 flex items-center gap-1">
              <CalendarRange className="w-4 h-4 text-emerald-600" />
              <span>Tezkor oraliqlar:</span>
            </span>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const y = now.getFullYear();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
                setRangeStartDate(`${y}-${m}-01`);
                setRangeEndDate(`${y}-${m}-${String(lastDay).padStart(2, '0')}`);
              }}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 text-[11px] transition cursor-pointer"
            >
              Bu oy to'liq
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const y = now.getFullYear();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                setRangeStartDate(`${y}-${m}-01`);
                setRangeEndDate(`${y}-${m}-15`);
              }}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 text-[11px] transition cursor-pointer"
            >
              1-15 kunlar (1-yarmi)
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const y = now.getFullYear();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
                setRangeStartDate(`${y}-${m}-16`);
                setRangeEndDate(`${y}-${m}-${String(lastDay).padStart(2, '0')}`);
              }}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 text-[11px] transition cursor-pointer"
            >
              16-oxiri (2-yarmi)
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const py = prev.getFullYear();
                const pm = String(prev.getMonth() + 1).padStart(2, '0');
                const plast = new Date(py, prev.getMonth() + 1, 0).getDate();
                setRangeStartDate(`${py}-${pm}-01`);
                setRangeEndDate(`${py}-${pm}-${String(plast).padStart(2, '0')}`);
              }}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 text-[11px] transition cursor-pointer"
            >
              O'tgan oy
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
                setRangeStartDate(getLocalDateString(past));
                setRangeEndDate(getLocalDateString(now));
              }}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-100 text-emerald-800 font-bold border border-emerald-200 text-[11px] transition cursor-pointer"
            >
              Oxirgi 7 kun
            </button>
          </div>

          <div className="text-[11px] text-emerald-800 font-semibold bg-emerald-100/70 px-2.5 py-1 rounded-lg">
            Tanlangan: <b>{activePeriod.label}</b>
          </div>
        </div>
      )}

      {/* Tezkor statistika kartalari */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 font-medium">
                Jami ishlangan soat ({formatUzMonth(selectedMonth)})
              </div>
              <div className="text-xl font-bold text-slate-900 mt-0.5">
                {formatMinutesToHours(totalStoreMinutes)}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 font-medium">
                Faol ishchilar soni
              </div>
              <div className="text-xl font-bold text-slate-900 mt-0.5">
                {workers.length} nafar
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 font-medium">
                O'rtacha bir ishchiga
              </div>
              <div className="text-xl font-bold text-slate-900 mt-0.5">
                {workers.length > 0
                  ? formatMinutesToHours(Math.round(totalStoreMinutes / workers.length))
                  : '0 soat'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ishchilar jadvali */}
      {workers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-xs">
          <p className="text-sm text-slate-500">
            Hozircha ishchilar qo'shilmagan. "Ishchilar" bo'limidan ishchi qo'shishingiz mumkin.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {monthlyData.map((workerData) => {
            const isExpanded = expandedWorkerId === workerData.user_id;
            
            // Ushbu ishchining faol davrdagi (oy yoki oraliq) barcha kunlari
            const workerShifts = attendances
              .filter((a) => {
                if (a.user_id !== workerData.user_id) return false;
                const d = a.date || '';
                const od = a.check_out_date || a.date || '';
                return (
                  ((d >= activePeriod.startDate && d <= activePeriod.endDate) ||
                    (od >= activePeriod.startDate && od <= activePeriod.endDate)) &&
                  a.status === 'completed'
                );
              })
              .sort(
                (a, b) =>
                  b.date.localeCompare(a.date) ||
                  (b.check_in_time || '').localeCompare(a.check_in_time || '') ||
                  b.id - a.id
              );

            return (
              <div
                key={workerData.user_id}
                className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden transition"
              >
                {/* Ishchi qatori */}
                <div
                  onClick={() =>
                    setExpandedWorkerId(isExpanded ? null : workerData.user_id)
                  }
                  className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 cursor-pointer hover:bg-slate-50/70 select-none"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00a651] to-[#008f45] text-white font-black flex items-center justify-center text-sm shadow-2xs shrink-0">
                      {workerData.full_name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-slate-900 text-sm sm:text-base truncate">
                        {workerData.full_name}
                      </h3>
                      <div className="text-[11px] sm:text-xs text-slate-500 truncate">
                        {workerData.position} • {workerData.phone}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-5 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 flex-wrap">
                    {/* Kelgan kunlari */}
                    <div className="text-left sm:text-right">
                      <div className="text-[10px] sm:text-xs text-slate-400 font-medium">Ishlagan kunlari</div>
                      <div className="text-xs sm:text-sm font-bold text-slate-800">
                        {workerData.worked_days} kun
                      </div>
                      {workerShifts.length > workerData.worked_days && (
                        <div className="text-[10px] text-indigo-600 font-medium">
                          ({workerShifts.length} marta kirgan)
                        </div>
                      )}
                    </div>

                    {/* JAMI ISHLAGAN SOATI */}
                    <div className="text-right min-w-[110px] sm:min-w-[130px]">
                      <div className="text-[10px] sm:text-xs text-slate-400 font-medium">JAMI ISH VAQTI</div>
                      <div className="text-sm sm:text-base font-black text-[#008f45]">
                        {workerData.formatted_total_hours}
                      </div>
                      <div className="text-[10px] sm:text-[11px] text-slate-400">
                        ({workerData.total_worked_hours} soat)
                      </div>
                    </div>

                    {/* To'lov qilish tugmasi (Agar Admin bo'lsa) */}
                    {onNavigateToPayroll && !isPersonalView && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigateToPayroll();
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition flex items-center gap-1 cursor-pointer"
                        title="Ushbu ishchiga oylik to'lash"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">To'lov</span>
                      </button>
                    )}

                    <div className="text-slate-400 pl-1">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5 text-[#00a651]" />
                      ) : (
                        <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Kunma-kun tafsilotlar (ochilganda) */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/60 p-3 sm:p-5 animate-in fade-in duration-150">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5">
                      Kunlik davomat va ishlangan soatlar:
                    </h4>

                    {workerShifts.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">
                        Ushbu oyda hech qanday tugallangan smena mavjud emas.
                      </p>
                    ) : (
                      <>
                        {/* Mobil ko'rinish (sm:hidden) */}
                        <div className="sm:hidden space-y-2">
                          {workerShifts.map((shift) => {
                            const sameDateShifts = workerShifts
                              .filter((s) => s.date === shift.date)
                              .sort((a, b) => a.check_in_time.localeCompare(b.check_in_time));
                            const shiftIdx = sameDateShifts.findIndex((s) => s.id === shift.id) + 1;
                            const isMulti = sameDateShifts.length > 1;

                            return (
                              <div
                                key={`mob-shift-${shift.id}`}
                                className="bg-white p-3 rounded-xl border border-slate-200 text-xs shadow-2xs space-y-1.5"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-slate-900">
                                    {formatUzDate(shift.date)}
                                  </span>
                                  {isMulti && (
                                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                                      {shiftIdx}-smena
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg">
                                  <div>
                                    <span className="text-emerald-700 font-medium">🟢 {shift.check_in_time}</span>
                                    {' — '}
                                    <span className="text-rose-700 font-medium">🔴 {shift.check_out_time || '---'}</span>
                                  </div>
                                  <div className="font-extrabold text-[#008f45]">
                                    {formatMinutesToHours(getAccurateAttendanceMinutes(shift))}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Planshet va Desktop jadvali (hidden sm:block) */}
                        <div className="hidden sm:block overflow-x-auto">
                          <table className="w-full text-xs text-left bg-white rounded-xl border border-slate-200 overflow-hidden">
                            <thead>
                              <tr className="bg-slate-100/80 text-slate-600 font-bold border-b border-slate-200">
                                <th className="py-2.5 px-3">Sana</th>
                                <th className="py-2.5 px-3">Kelgan vaqti</th>
                                <th className="py-2.5 px-3">Ketgan vaqti</th>
                                <th className="py-2.5 px-3 text-right">Kunlik ishlangan vaqt</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {workerShifts.map((shift) => {
                                const sameDateShifts = workerShifts
                                  .filter((s) => s.date === shift.date)
                                  .sort((a, b) => a.check_in_time.localeCompare(b.check_in_time));
                                const shiftIdx = sameDateShifts.findIndex((s) => s.id === shift.id) + 1;
                                const isMulti = sameDateShifts.length > 1;

                                return (
                                  <tr key={shift.id} className="hover:bg-slate-50">
                                    <td className="py-2.5 px-3 font-medium text-slate-900">
                                      <div className="flex items-center gap-1.5">
                                        <span>{formatUzDate(shift.date)}</span>
                                        {isMulti && (
                                          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">
                                            {shiftIdx}-smena
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-2.5 px-3 text-emerald-700 font-medium">
                                      🟢 {shift.check_in_time}
                                    </td>
                                    <td className="py-2.5 px-3 text-rose-700 font-medium">
                                      🔴 {shift.check_out_time || '---'}
                                      {shift.check_out_date && shift.check_out_date !== shift.date && (
                                        <span className="ml-1 text-[10px] text-indigo-600 font-normal">
                                          (+1 kun tunda)
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                                      {formatMinutesToHours(getAccurateAttendanceMinutes(shift))}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
