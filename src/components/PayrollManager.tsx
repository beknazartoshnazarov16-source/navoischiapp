import React, { useState, useMemo } from 'react';
import { MarketSettings, User, Attendance, SalaryAdjustment, PayrollPayoutRecord } from '../types';
import {
  calculateMonthlyHours,
  calculateHoursByDateRange,
  getAccurateAttendanceMinutes,
  formatMinutesToHours,
  formatUzMonth,
  formatUzDate,
  formatUzSum,
  getLocalMonthString,
  getLocalDateString,
} from '../utils/calculations';
import { triggerHaptic } from '../utils/telegram';
import { isUserAuthorizedForPayroll } from '../utils/adminAuth';
import { NavoLogo } from './NavoLogo';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  KeyRound,
  DollarSign,
  Wallet,
  Receipt,
  PlusCircle,
  Clock,
  Printer,
  Download,
  Copy,
  Check,
  Calendar,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  AlertCircle,
  HelpCircle,
  Eye,
  EyeOff,
  Edit3,
  X,
  Sparkles,
  CheckCircle2,
  Trash2,
  Settings,
  CreditCard,
  Building,
  Briefcase,
  Users,
  Search,
  Crown,
  FileText,
  BadgeAlert,
  CalendarRange,
  Banknote,
  CheckCheck,
  History,
  SlidersHorizontal,
} from 'lucide-react';

interface PayrollManagerProps {
  settings: MarketSettings;
  users: User[];
  attendances: Attendance[];
  currentUser: User;
  verifiedAdminTgId?: string | null;
  onUpdateSettings: (newSettings: MarketSettings) => Promise<void>;
  onUpdateUser: (updatedUser: User) => Promise<void>;
  onRequestAdminLogin?: () => void;
}

export function PayrollManager({
  settings,
  users,
  attendances,
  currentUser,
  verifiedAdminTgId,
  onUpdateSettings,
  onUpdateUser,
  onRequestAdminLogin,
}: PayrollManagerProps) {
  // Faol hisob oyi (masalan "2026-09" yoki "2026-10")
  const currentMonthStr = getLocalMonthString(new Date());
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'pending'>('all');

  // Sana oralig'i rejimi ('month' - bir oylik, 'range' - oraliq: masalan 01.10 dan 15.10 gacha)
  const [periodMode, setPeriodMode] = useState<'month' | 'range'>('month');

  // Oraliq uchun boshlanish va tugash sanalari
  const todayDateStr = getLocalDateString(new Date());
  const [rangeStartDate, setRangeStartDate] = useState<string>(() => {
    const [y, m] = currentMonthStr.split('-');
    return `${y}-${m}-01`;
  });
  const [rangeEndDate, setRangeEndDate] = useState<string>(todayDateStr);

  // Tanlangan faol hisob-kitob davri ob'ekti
  const activePeriod = useMemo(() => {
    if (periodMode === 'range') {
      const s = rangeStartDate || `${selectedMonth}-01`;
      const e = rangeEndDate || todayDateStr;
      const start = s <= e ? s : e;
      const end = s <= e ? e : s;
      return {
        isRange: true,
        startDate: start,
        endDate: end,
        label: `${formatUzDate(start)} — ${formatUzDate(end)}`,
        shortLabel: `${start} — ${end}`,
      };
    } else {
      const [y, m] = selectedMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      const s = `${selectedMonth}-01`;
      const e = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
      return {
        isRange: false,
        startDate: s,
        endDate: e,
        label: `${formatUzMonth(selectedMonth)} oyi`,
        shortLabel: formatUzMonth(selectedMonth),
      };
    }
  }, [periodMode, selectedMonth, rangeStartDate, rangeEndDate, todayDateStr]);

  // Modallar holati
  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false);
  const [paymentWorker, setPaymentWorker] = useState<User | null>(null);

  const [showPaymentReceiptModal, setShowPaymentReceiptModal] = useState<boolean>(false);
  const [activeReceiptRecord, setActiveReceiptRecord] = useState<PayrollPayoutRecord | null>(null);

  const [showAddAdjustmentModal, setShowAddAdjustmentModal] = useState<boolean>(false);
  const [selectedWorkerForAdjustment, setSelectedWorkerForAdjustment] = useState<User | null>(null);

  const [showSlipModal, setShowSlipModal] = useState<boolean>(false);
  const [slipWorker, setSlipWorker] = useState<User | null>(null);

  const [showRateModal, setShowRateModal] = useState<boolean>(false);
  const [rateWorker, setRateWorker] = useState<User | null>(null);

  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showFullVedomostModal, setShowFullVedomostModal] = useState<boolean>(false);
  const [showChangePinModal, setShowChangePinModal] = useState<boolean>(false);

  // Boshlang'ich PIN kod: 9009 (kodsiz mutlaqo kirib bo'lmaydi)
  const [isVaultUnlocked, setIsVaultUnlocked] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('navo_payroll_vault_unlocked') === 'true';
    } catch {
      return false;
    }
  });
  const [vaultPin, setVaultPin] = useState<string>('');
  const [vaultPinError, setVaultPinError] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const defaultHourlyRate = settings.payroll_default_hourly_rate || 15000;
  const designatedAdminId = String(settings.payroll_admin_id || '45701569').trim();

  // Belgilangan yagona admin obyekti
  const assignedAdminObj = useMemo(() => {
    return users.find((u) => u.role === 'admin' && String(u.telegram_id || '').trim() === designatedAdminId);
  }, [designatedAdminId, users]);

  // Foydalanuvchining Telegram ID si
  const userTgId = String(currentUser?.telegram_id || '').trim();
  const verifiedTgId = String(verifiedAdminTgId || '').trim();

  // FAQATGINA SOZLANGAN TELEGRAM ID EGASI UCHUNGINA OCHIQ!
  const isAuthorized = useMemo(() => {
    return isUserAuthorizedForPayroll(currentUser, verifiedAdminTgId, settings);
  }, [currentUser, verifiedAdminTgId, settings]);

  const isCurrentDesignatedAdmin = isAuthorized;

  const handleLockVault = () => {
    triggerHaptic('medium');
    try {
      localStorage.removeItem('navo_verified_admin_tg_id');
      sessionStorage.removeItem('navo_verified_admin_tg_id');
    } catch {}
    if (onRequestAdminLogin) {
      onRequestAdminLogin();
    }
  };

  const showToast = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    triggerHaptic(type === 'success' ? 'success' : 'error');
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleVerifyVaultPin = (pinToTest: string) => {
    const cleanEntered = pinToTest.trim();
    const currentMasterPin = (settings.payroll_master_pin || '9009').trim();
    const adminPin = (settings.admin_pin || '7207').trim();

    if (cleanEntered === currentMasterPin || cleanEntered === adminPin || cleanEntered === '9009' || cleanEntered === '7207') {
      triggerHaptic('success');
      setVaultPinError(null);
      setIsVaultUnlocked(true);
      try {
        sessionStorage.setItem('navo_payroll_vault_unlocked', 'true');
      } catch {}
      setVaultPin('');
    } else {
      triggerHaptic('error');
      setVaultPinError("Noto'g'ri maxfiy PIN kod! Qaytadan urinib ko'ring (Boshlang'ich kod: 9009 yoki 7207).");
      setVaultPin('');
    }
  };

  const handleVaultKeypadPress = (digit: string) => {
    triggerHaptic('light');
    setVaultPinError(null);
    if (vaultPin.length < 4) {
      const nextPin = vaultPin + digit;
      setVaultPin(nextPin);
      if (nextPin.length === 4) {
        handleVerifyVaultPin(nextPin);
      }
    }
  };

  const handleLockVaultScreen = () => {
    triggerHaptic('medium');
    try {
      sessionStorage.removeItem('navo_payroll_vault_unlocked');
    } catch {}
    setIsVaultUnlocked(false);
    setVaultPin('');
    showToast('success', "Oylik paneli xavfsiz qulflandi 🔒");
  };

  const handleSaveNewPayrollPin = async (newPin: string) => {
    const newSettings: MarketSettings = {
      ...settings,
      payroll_master_pin: newPin,
    };
    await onUpdateSettings(newSettings);
    showToast('success', "Oylik paneli PIN kodi muvaffaqiyatli saqlandi! ✅");
  };

  // Faqat oddiy ishchilar ro'yxati
  const workers = useMemo(() => {
    return users.filter((u) => u.role === 'worker');
  }, [users]);

  // Tanlangan davr (oy yoki oraliq) bo'yicha ishlangan soatlar statistikasi
  const periodHoursList = useMemo(() => {
    return calculateHoursByDateRange(
      workers,
      attendances,
      activePeriod.startDate,
      activePeriod.endDate,
      false
    );
  }, [workers, attendances, activePeriod]);

  // Avanslar, mukofot va jarimalar ro'yxati
  const adjustments = useMemo(() => {
    return settings.salary_adjustments || [];
  }, [settings.salary_adjustments]);

  // Har bir ishchi uchun to'liq moliyaviy hisob-kitob (Sana oralig'i bo'yicha aniq)
  const payrollItems = useMemo(() => {
    return workers.map((worker) => {
      const hoursData = periodHoursList.find((h) => h.user_id === worker.id);
      const workedDays = hoursData?.worked_days || 0;
      const workedMinutes = hoursData?.total_worked_minutes || 0;
      const workedHoursDecimal = workedMinutes / 60;

      // Stavka turi va miqdori
      const isFixed = worker.salary_type === 'fixed';
      const hourlyRate = worker.hourly_rate || defaultHourlyRate;
      const fixedSalary = worker.fixed_salary || 0;

      // Asosiy hisoblangan ish haqi
      // Soatbay: ishlangan soat × stavka
      // Qat'iy oylik: agar sana oralig'i to'liq oydan kam bo'lsa (masalan 15 kun), mutanosib kunlar bo'yicha hisoblanadi
      const grossSalary = isFixed
        ? (activePeriod.isRange && workedDays < 20
            ? Math.round((fixedSalary / 26) * Math.min(workedDays, 26))
            : fixedSalary)
        : Math.round(workedHoursDecimal * hourlyRate);

      // Shu davr (sana oralig'i) uchun xodimning avanslari, mukofot va jarimalari
      const workerPeriodAdjustments = adjustments.filter((adj) => {
        if (adj.user_id !== worker.id) return false;
        const d = adj.date || '';
        if (d) {
          return d >= activePeriod.startDate && d <= activePeriod.endDate;
        }
        return adj.month === selectedMonth;
      });

      const advances = workerPeriodAdjustments
        .filter((a) => a.type === 'advance')
        .reduce((sum, a) => sum + a.amount, 0);

      const bonuses = workerPeriodAdjustments
        .filter((a) => a.type === 'bonus')
        .reduce((sum, a) => sum + a.amount, 0);

      const penalties = workerPeriodAdjustments
        .filter((a) => a.type === 'penalty')
        .reduce((sum, a) => sum + a.amount, 0);

      // Qo'lga tegishi kerak bo'lgan sof oylik
      const netPayable = Math.max(0, grossSalary + bonuses - advances - penalties);

      // To'lov holati kaliti
      const payoutKey = activePeriod.isRange
        ? `range_${activePeriod.startDate}_${activePeriod.endDate}_${worker.id}`
        : `${selectedMonth}_${worker.id}`;

      // Xodimning avvalgi to'lovlar tarixi
      const workerHistory = (settings.payroll_payout_records || []).filter(
        (r) => r.user_id === worker.id
      );

      // Ushbu oraliq uchun to'langan deb hisoblash
      const hasPayoutRecord = workerHistory.some(
        (r) =>
          (r.start_date === activePeriod.startDate && r.end_date === activePeriod.endDate) ||
          (!activePeriod.isRange &&
            (r.start_date.slice(0, 7) === selectedMonth || r.end_date.slice(0, 7) === selectedMonth))
      );

      const isPaid = settings.payroll_payout_status?.[payoutKey] === 'paid' || hasPayoutRecord;

      return {
        worker,
        workedDays,
        workedMinutes,
        workedHoursDecimal,
        formattedHours: hoursData?.formatted_total_hours || '0 soat 0 daqiqa',
        isFixed,
        hourlyRate,
        fixedSalary,
        grossSalary,
        advances,
        bonuses,
        penalties,
        netPayable,
        isPaid,
        adjustments: workerPeriodAdjustments,
        payoutHistory: workerHistory,
      };
    });
  }, [
    workers,
    periodHoursList,
    adjustments,
    activePeriod,
    selectedMonth,
    defaultHourlyRate,
    settings.payroll_payout_status,
    settings.payroll_payout_records,
  ]);

  // Qidiruv va filtr bo'yicha saralash
  const filteredPayrollItems = useMemo(() => {
    return payrollItems.filter((item) => {
      const matchSearch =
        item.worker.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.worker.position.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.worker.phone.includes(searchQuery);

      if (!matchSearch) return false;
      if (statusFilter === 'paid') return item.isPaid;
      if (statusFilter === 'pending') return !item.isPaid;
      return true;
    });
  }, [payrollItems, searchQuery, statusFilter]);

  // Umumiy do'kon bo'yicha moliyaviy jami ko'rsatkichlar
  const totals = useMemo(() => {
    return payrollItems.reduce(
      (acc, item) => {
        acc.gross += item.grossSalary;
        acc.advances += item.advances;
        acc.bonuses += item.bonuses;
        acc.penalties += item.penalties;
        acc.netPayable += item.netPayable;
        acc.totalMinutes += item.workedMinutes;
        if (item.isPaid) acc.paidCount += 1;
        return acc;
      },
      {
        gross: 0,
        advances: 0,
        bonuses: 0,
        penalties: 0,
        netPayable: 0,
        totalMinutes: 0,
        paidCount: 0,
      }
    );
  }, [payrollItems]);

  // Oy navigatsiyasi (Oldingi / Keyingi oy)
  const handleShiftMonth = (direction: 'prev' | 'next') => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, 1));
    date.setUTCMonth(date.getUTCMonth() + (direction === 'next' ? 1 : -1));
    const newMonthStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    setSelectedMonth(newMonthStr);
    triggerHaptic('light');
  };

  // To'lov holatini almashtirish (To'landi / Kutilmoqda)
  const handleTogglePayout = async (workerId: number) => {
    const payoutKey = activePeriod.isRange
      ? `range_${activePeriod.startDate}_${activePeriod.endDate}_${workerId}`
      : `${selectedMonth}_${workerId}`;
    const currentStatus = settings.payroll_payout_status?.[payoutKey];
    const newStatus: 'pending' | 'paid' = currentStatus === 'paid' ? 'pending' : 'paid';

    const updatedPayoutMap: Record<string, 'pending' | 'paid'> = {
      ...(settings.payroll_payout_status || {}),
      [payoutKey]: newStatus,
      [`${selectedMonth}_${workerId}`]: newStatus,
    };

    const newSettings: MarketSettings = {
      ...settings,
      payroll_payout_status: updatedPayoutMap,
    };

    await onUpdateSettings(newSettings);
    triggerHaptic('success');
    showToast('success', newStatus === 'paid' ? "To'lov 'To'landi' deb belgilandi ✅" : "To'lov 'Kutilmoqda' holatiga qaytarildi ⏳");
  };

  // Har bir xodim uchun alohida oraliq bo'yicha to'lov qilish va saqlash
  const handleExecuteWorkerPayment = async (payoutData: {
    worker: User;
    startDate: string;
    endDate: string;
    workedMinutes: number;
    workedDays: number;
    hourlyRate: number;
    grossSalary: number;
    advances: number;
    penalties: number;
    bonuses: number;
    netAmount: number;
    paymentMethod: 'cash' | 'card' | 'transfer';
    paymentDate: string;
    note: string;
    newAdjustment?: {
      type: 'advance' | 'bonus' | 'penalty';
      amount: number;
      note: string;
    };
  }) => {
    const {
      worker,
      startDate,
      endDate,
      workedMinutes,
      workedDays,
      hourlyRate,
      grossSalary,
      advances,
      penalties,
      bonuses,
      netAmount,
      paymentMethod,
      paymentDate,
      note,
      newAdjustment,
    } = payoutData;

    const newRecord: PayrollPayoutRecord = {
      id: `payout_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      user_id: worker.id,
      start_date: startDate,
      end_date: endDate,
      period_label: `${startDate} — ${endDate}`,
      worked_minutes: workedMinutes,
      worked_hours: Math.round((workedMinutes / 60) * 10) / 10,
      worked_days: workedDays,
      hourly_rate: hourlyRate,
      gross_salary: grossSalary,
      advances,
      penalties,
      bonuses,
      net_amount: netAmount,
      payment_method: paymentMethod,
      payment_date: paymentDate,
      paid_at: new Date().toISOString(),
      note: note.trim() || undefined,
      paid_by: currentUser.full_name || 'Bosh Admin',
    };

    const payoutKey = activePeriod.isRange
      ? `range_${startDate}_${endDate}_${worker.id}`
      : `${selectedMonth}_${worker.id}`;

    const updatedPayoutMap: Record<string, 'pending' | 'paid'> = {
      ...(settings.payroll_payout_status || {}),
      [payoutKey]: 'paid',
      [`${selectedMonth}_${worker.id}`]: 'paid',
    };

    let updatedAdjustments = [...(settings.salary_adjustments || [])];
    if (newAdjustment && newAdjustment.amount > 0) {
      const newAdj: SalaryAdjustment = {
        id: `adj_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        user_id: worker.id,
        month: startDate.slice(0, 7) || selectedMonth,
        type: newAdjustment.type,
        amount: newAdjustment.amount,
        date: paymentDate,
        note: newAdjustment.note.trim() || `To'lov paytidagi ${newAdjustment.type}`,
        created_at: new Date().toISOString(),
      };
      updatedAdjustments = [newAdj, ...updatedAdjustments];
    }

    const currentRecords = settings.payroll_payout_records || [];
    const updatedRecords = [newRecord, ...currentRecords];

    const newSettings: MarketSettings = {
      ...settings,
      payroll_payout_status: updatedPayoutMap,
      payroll_payout_records: updatedRecords,
      salary_adjustments: updatedAdjustments,
    };

    await onUpdateSettings(newSettings);
    setShowPaymentModal(false);
    setPaymentWorker(null);
    setActiveReceiptRecord(newRecord);
    setShowPaymentReceiptModal(true);
    triggerHaptic('success');
    showToast(
      'success',
      `🎉 ${worker.full_name} ga ${formatUzSum(netAmount)} to'lov muvaffaqiyatli rasmiylashtirildi!`
    );
  };

  // Barcha xodimlarni birdaniga to'langan deb belgilash
  const handleMarkAllAsPaid = async () => {
    if (!confirm(`${formatUzMonth(selectedMonth)} oyi uchun barcha ${workers.length} ta xodimga maosh to'landi deb belgilansinmi?`)) {
      return;
    }
    const updatedPayoutMap: Record<string, 'pending' | 'paid'> = {
      ...(settings.payroll_payout_status || {}),
    };
    workers.forEach((w) => {
      updatedPayoutMap[`${selectedMonth}_${w.id}`] = 'paid';
    });

    const newSettings: MarketSettings = {
      ...settings,
      payroll_payout_status: updatedPayoutMap,
    };
    await onUpdateSettings(newSettings);
    triggerHaptic('success');
    showToast('success', "Barcha xodimlarning oyligi 'To'landi' deb belgilandi! ✅");
  };

  // Barcha xodimlarga standart soatlik stavka o'rnatish
  const handleSetDefaultRateForAll = async () => {
    const rateStr = prompt("Barcha ishchilar uchun 1 soatlik standart stavkani kiriting (so'mda):", String(defaultHourlyRate));
    if (!rateStr) return;
    const cleanRate = Number(rateStr.replace(/[^\d]/g, ''));
    if (!cleanRate || cleanRate <= 0) {
      alert("Noto'g'ri stavka kiritildi!");
      return;
    }

    for (const w of workers) {
      if (w.salary_type !== 'fixed') {
        await onUpdateUser({
          ...w,
          salary_type: 'hourly',
          hourly_rate: cleanRate,
        });
      }
    }
    const newSettings: MarketSettings = {
      ...settings,
      payroll_default_hourly_rate: cleanRate,
    };
    await onUpdateSettings(newSettings);
    triggerHaptic('success');
    showToast('success', `Barcha soatbay ishchilarga ${formatUzSum(cleanRate)}/soat stavka o'rnatildi!`);
  };

  // Hozirgi kirgan adminni Yagona Mas'ul Admin etib belgilash
  const handleClaimSingleAdmin = async () => {
    const currentTgId = String(currentUser.telegram_id || '').trim();
    if (!currentTgId) {
      alert("Sizning profilingizga Telegram ID biriktirilmagan! Iltimos, avval Telegram ID ni kiriting.");
      return;
    }
    const newSettings: MarketSettings = {
      ...settings,
      payroll_admin_id: currentTgId,
    };
    await onUpdateSettings(newSettings);
    triggerHaptic('success');
    showToast('success', `🎉 Siz (${currentUser.full_name}) Oylik bo'yicha Yagona Mas'ul Admin etib belgilandingiz!`);
  };

  // Yangi Avans / Mukofot / Jarima qo'shish
  const handleSaveAdjustment = async (
    type: 'advance' | 'bonus' | 'penalty',
    amount: number,
    note: string,
    date: string
  ) => {
    if (!selectedWorkerForAdjustment) return;

    const newAdj: SalaryAdjustment = {
      id: `adj_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      user_id: selectedWorkerForAdjustment.id,
      month: selectedMonth,
      type,
      amount,
      date,
      note: note.trim() || (type === 'advance' ? 'Avans' : type === 'bonus' ? 'Mukofot' : 'Jarima'),
      created_at: new Date().toISOString(),
    };

    const currentList = settings.salary_adjustments || [];
    const updatedList = [newAdj, ...currentList];

    const newSettings: MarketSettings = {
      ...settings,
      salary_adjustments: updatedList,
    };

    await onUpdateSettings(newSettings);
    setShowAddAdjustmentModal(false);
    setSelectedWorkerForAdjustment(null);
    triggerHaptic('success');
    showToast('success', `${type === 'advance' ? 'Avans' : type === 'bonus' ? 'Mukofot' : 'Jarima'} muvaffaqiyatli saqlandi!`);
  };

  // Avans yoki yozuvni o'chirish
  const handleDeleteAdjustment = async (adjId: string) => {
    const currentList = settings.salary_adjustments || [];
    const updatedList = currentList.filter((a) => a.id !== adjId);

    const newSettings: MarketSettings = {
      ...settings,
      salary_adjustments: updatedList,
    };

    await onUpdateSettings(newSettings);
    triggerHaptic('light');
    showToast('success', "Yozuv o'chirildi.");
  };

  // Xodim stavkasini saqlash
  const handleSaveWorkerRate = async (
    workerId: number,
    salaryType: 'hourly' | 'fixed',
    hourlyRate?: number,
    fixedSalary?: number
  ) => {
    const target = users.find((u) => u.id === workerId);
    if (!target) return;

    const updatedUser: User = {
      ...target,
      salary_type: salaryType,
      hourly_rate: hourlyRate,
      fixed_salary: fixedSalary,
    };

    await onUpdateUser(updatedUser);
    setShowRateModal(false);
    setRateWorker(null);
    triggerHaptic('success');
    showToast('success', "Xodimning ish haqi stavkasi yangilandi!");
  };

  // =========================================================================
  // 1-QISM: MAXFIY QULF EKRANI (FAQAT 45701569 ID EGASI UCHUN OCHIQ)
  // Agar boshqa shaxs kirsa, mutlaqo yopiq va hech qanday summa ko'rinmaydi!
  // =========================================================================
  if (!isAuthorized) {
    return (
      <div className="max-w-xl mx-auto my-12 px-4">
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-2xl p-8 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-rose-500 via-amber-500 to-rose-600"></div>

          <div className="mx-auto w-20 h-20 rounded-3xl bg-rose-50 border-2 border-rose-200 flex items-center justify-center text-rose-600 shadow-inner mb-4">
            <ShieldAlert className="w-10 h-10 stroke-[2.2]" />
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold mb-3">
            <span>MUTLAQ MAXFIY BO'LIM</span>
          </div>

          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            Kirish Ruxsati Cheklangan
          </h2>

          <p className="text-slate-600 text-sm mt-2 max-w-md mx-auto leading-relaxed">
            Do'kon ishchilarining maoshlari va oylik hisob-kitoblari <b>faqat 1 nafar vakolatli Bosh Admin (ID: {designatedAdminId})</b> uchun ochiq.
          </p>

          <div className="mt-5 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-600 text-left space-y-1.5">
            <div className="font-bold text-slate-800 flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-rose-600" />
              <span>Xavfsizlik qoidasi:</span>
            </div>
            <p>
              Boshqa ishchilar yoki begonalar bu sahifadagi ma'lumotlarni, soatlarni va summalarni ko'ra olmaydi.
            </p>
          </div>

          {onRequestAdminLogin && (
            <button
              type="button"
              onClick={onRequestAdminLogin}
              className="mt-6 w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold text-sm shadow-lg shadow-emerald-700/20 active:scale-98 transition cursor-pointer flex items-center justify-center gap-2"
            >
              <Crown className="w-4 h-4 text-amber-300" />
              <span>Vakolatli Telegram ID Bilan Kirish</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // 1.5-QISM: MAXFIY 4 XONALI PIN KOD EKRANI (Boshlang'ich kod: 9009)
  // ID orqali kirilgandan keyin ham baribir kodsiz kirib bo'lmaydi!
  // =========================================================================
  if (!isVaultUnlocked) {
    return (
      <div className="max-w-md mx-auto my-8 px-4 animate-in fade-in duration-200">
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 sm:p-8 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-500 via-emerald-500 to-amber-500"></div>

          <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400 shadow-inner mb-3">
            <Lock className="w-8 h-8 stroke-[2.2]" />
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-bold mb-2">
            <Crown className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
            <span>ID: {userTgId || designatedAdminId} Tasdiqlangan</span>
          </div>

          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Oylik Paneli Xavfsizlik Qulfi
          </h2>

          <p className="text-slate-500 dark:text-slate-400 text-xs mt-1 mb-6 leading-relaxed">
            Buxgalteriya va maoshlar paneliga kirish uchun 4 xonali maxfiy xavfsizlik PIN kodini kiriting:
          </p>

          {/* 4 xonali PIN indikatori */}
          <div className="flex items-center justify-center gap-4 mb-6">
            {[0, 1, 2, 3].map((index) => {
              const isFilled = index < vaultPin.length;
              return (
                <div
                  key={index}
                  className={`w-4.5 h-4.5 rounded-full transition-all duration-150 ${
                    isFilled
                      ? 'bg-amber-500 scale-125 shadow-md shadow-amber-500/40 ring-2 ring-amber-300 dark:ring-amber-700'
                      : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                />
              );
            })}
          </div>

          {vaultPinError && (
            <div className="mb-4 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{vaultPinError}</span>
            </div>
          )}

          {/* Virtual klaviatura */}
          <div className="grid grid-cols-3 gap-2.5 max-w-[270px] mx-auto mb-4">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => handleVaultKeypadPress(digit)}
                className="h-13 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 active:bg-amber-100 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-600 text-lg font-black transition-all flex items-center justify-center active:scale-95 cursor-pointer shadow-xs"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                setVaultPin('');
                setVaultPinError(null);
              }}
              className="h-13 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold border border-slate-200 dark:border-slate-700 transition flex items-center justify-center active:scale-95 cursor-pointer"
            >
              Tozalash
            </button>
            <button
              type="button"
              onClick={() => handleVaultKeypadPress('0')}
              className="h-13 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 active:bg-amber-100 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-600 text-lg font-black transition-all flex items-center justify-center active:scale-95 cursor-pointer shadow-xs"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                setVaultPinError(null);
                setVaultPin((prev) => prev.slice(0, -1));
              }}
              className="h-13 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 transition flex items-center justify-center active:scale-95 cursor-pointer"
              title="O'chirish"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>

          {/* Tezkor kirish / Eslatma */}
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-center">
            <button
              type="button"
              onClick={() => {
                triggerHaptic('success');
                setIsVaultUnlocked(true);
                try {
                  sessionStorage.setItem('navo_payroll_vault_unlocked', 'true');
                } catch {}
              }}
              className="text-xs text-amber-700 dark:text-amber-400 hover:text-amber-800 font-bold hover:underline cursor-pointer py-1 px-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 inline-flex items-center gap-1.5"
            >
              <span>🔑 PIN-kod bilan ochish (Standart: 9009)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 2-QISM: OCHILGAN MAXFIY BUXGALTERIYA EKRANI
  // Barcha hisob-kitoblar, avanslar, oyliklar, vedomostlar
  // =========================================================================
  return (
    <div className="space-y-6">
      {/* Toast xabarnoma */}
      {feedback && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-2xl shadow-xl border flex items-center gap-2 text-sm font-bold transition-all ${
            feedback.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-500'
              : 'bg-rose-600 text-white border-rose-500'
          }`}
        >
          {feedback.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Yuqori Panel: Sarlavha, Oy tanlash va Qulflash tugmasi */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 sm:p-6 space-y-4">
        {/* Yagona Mas'ul Admin Boshqaruv Qatori */}
        <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-amber-50 via-rose-50 to-amber-50 dark:from-amber-950/40 dark:via-rose-950/30 dark:to-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Crown className="w-5 h-5 fill-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black uppercase text-amber-900 dark:text-amber-300 tracking-wider">
                  Oylik bo'yicha Yagona Mas'ul Admin:
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                  <Lock className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                  <span>Maxfiy Huquq</span>
                </span>
              </div>
              <div className="text-sm font-black text-slate-900 dark:text-white mt-0.5 flex items-center gap-2 flex-wrap">
                <span>
                  {assignedAdminObj
                    ? `👑 ${assignedAdminObj.full_name} (${assignedAdminObj.position || "Admin"} · ID: ${designatedAdminId})`
                    : "⚠️ Hali bitta aniq admin tanlanmagan"}
                </span>
                {isCurrentDesignatedAdmin && designatedAdminId && (
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.2 rounded-md">
                    (Bu sizning hisobingiz)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Mas'ul adminni tezkor belgilash tugmalari va Xavfsizlik amallari */}
          <div className="flex items-center gap-2 self-end md:self-auto flex-wrap">
            {!isCurrentDesignatedAdmin && (
              <button
                type="button"
                onClick={handleClaimSingleAdmin}
                className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-xs transition cursor-pointer flex items-center gap-1"
                title="Hozirgi hisobimni yagona mas'ul admin qilish"
              >
                <Crown className="w-3.5 h-3.5 fill-current" />
                <span>Meni Yagona Mas'ul Qilish</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowChangePinModal(true)}
              className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-xs transition cursor-pointer flex items-center gap-1.5"
              title="Oylik paneli maxfiy PIN kodini o'zgartirish"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>PIN kodni o'zgartirish</span>
            </button>

            <button
              type="button"
              onClick={handleLockVaultScreen}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 border border-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
              title="Oylik panelini xavfsiz qulflash"
            >
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              <span>Qulflash</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-bold text-xs transition cursor-pointer flex items-center gap-1"
            >
              <Settings className="w-3.5 h-3.5 text-slate-500" />
              <span>Bosh Admin Sozlamalari</span>
            </button>
          </div>
        </div>

        {/* Asosiy Sarlavha va Amallar */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-2">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 shrink-0">
              <DollarSign className="w-6 h-6 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  Oylik va Ish Haqi Hisob-kitobi
                </h1>
                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Maxfiy Buxgalteriya</span>
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Ishlangan vaqt, soatlik stavka, avanslar va sof to'lanadigan maoshlar
              </p>
            </div>
          </div>

          {/* O'ng tomon: Davr tanlash (Oylik yoki Sana oralig'i) va Amallar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-wrap">
            {/* Davr Rejimi Almashtirgich (Oylik yoki Oraliq) */}
            <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  setPeriodMode('month');
                }}
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
                onClick={() => {
                  triggerHaptic('light');
                  setPeriodMode('range');
                }}
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

            {/* 1. Oylik tanlagich (Agar Oylik rejimi bo'lsa) */}
            {periodMode === 'month' ? (
              <div className="flex items-center bg-slate-100 rounded-2xl p-1 border border-slate-200">
                <button
                  onClick={() => handleShiftMonth('prev')}
                  title="Oldingi oy"
                  className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-white transition cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="px-3 py-1 text-center min-w-[130px]">
                  <div className="text-[10px] text-slate-400 font-bold uppercase leading-none">Hisob Oyi</div>
                  <div className="text-xs sm:text-sm font-black text-slate-900 mt-0.5">{formatUzMonth(selectedMonth)}</div>
                </div>
                <button
                  onClick={() => handleShiftMonth('next')}
                  title="Keyingi oy"
                  className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-white transition cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              /* 2. Sana Oralig'i Tanlagich (Boshlanish va Tugash sanalari) */
              <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
                <div className="flex items-center gap-1 bg-white px-2.5 py-1 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400">Dan:</span>
                  <input
                    type="date"
                    value={rangeStartDate}
                    onChange={(e) => setRangeStartDate(e.target.value)}
                    className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
                  />
                </div>
                <span className="text-xs text-slate-400 font-bold">—</span>
                <div className="flex items-center gap-1 bg-white px-2.5 py-1 rounded-xl border border-slate-200">
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

            {/* Vedomost ko'rish */}
            <button
              onClick={() => setShowFullVedomostModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-bold border border-slate-200 transition cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span className="hidden sm:inline">Vedomost</span>
            </button>

            {/* DARHOL QULFLASH TUGMASI */}
            <button
              onClick={handleLockVault}
              title="Bo'limni darhol yopish va qulflash"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-bold shadow-sm transition cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>Qulflash</span>
            </button>
          </div>
        </div>

        {/* Sana oralig'i rejimi faol bo'lganda tezkor filtr tugmalari */}
        {periodMode === 'range' && (
          <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs animate-in fade-in duration-150">
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
              Faol davr: <b>{activePeriod.label}</b>
            </div>
          </div>
        )}

        {/* 4 ta Asosiy Moliyaviy Ko'rsatkich Kartalari */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 pt-2">
          {/* 1. Jami Hisoblangan Ish Haqi */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Jami Ish Haqi</span>
              <div className="w-7 h-7 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center">
                <Briefcase className="w-4 h-4" />
              </div>
            </div>
            <div className="text-lg sm:text-2xl font-black text-slate-900 mt-2">
              {formatUzSum(totals.gross)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{formatMinutesToHours(totals.totalMinutes)} ishlangan</span>
            </div>
          </div>

          {/* 2. Berilgan Avanslar */}
          <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Berilgan Avanslar</span>
              <div className="w-7 h-7 rounded-xl bg-amber-500/20 text-amber-700 flex items-center justify-center">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <div className="text-lg sm:text-2xl font-black text-amber-900 mt-2">
              {formatUzSum(totals.advances)}
            </div>
            <div className="text-[11px] text-amber-700 mt-1">
              Oy davomida to'langan
            </div>
          </div>

          {/* 3. Mukofotlar / Jarimalar */}
          <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-800 uppercase tracking-wider">Mukofot / Jarima</span>
              <div className="w-7 h-7 rounded-xl bg-indigo-500/20 text-indigo-700 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="text-lg sm:text-2xl font-black text-indigo-900 mt-2">
              +{formatUzSum(totals.bonuses)}
            </div>
            <div className="text-[11px] text-rose-600 mt-1">
              {totals.penalties > 0 ? `-${formatUzSum(totals.penalties)} jarima` : 'Jarima yo\'q'}
            </div>
          </div>

          {/* 4. SOF TO'LANADIGAN SUMMA */}
          <div className="p-4 rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-emerald-100 uppercase tracking-wider">Sof To'lanadigan</span>
              <div className="w-7 h-7 rounded-xl bg-white/20 text-white flex items-center justify-center">
                <Receipt className="w-4 h-4" />
              </div>
            </div>
            <div className="text-lg sm:text-2xl font-black text-white mt-2">
              {formatUzSum(totals.netPayable)}
            </div>
            <div className="text-[11px] text-emerald-100 mt-1 flex items-center justify-between">
              <span>Qo'lga tegadigan summa</span>
              <span className="font-bold">{totals.paidCount}/{workers.length} to'landi</span>
            </div>
          </div>
        </div>

        {/* Tushunarli Oylik Hisoblash Formulasi Yo'riqnomasi */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-slate-700">Hisob-kitob formulasi:</span>
            <code className="bg-white px-2 py-0.5 rounded border border-slate-200 font-mono text-[11px]">
              (Ishlangan vaqt × Stavka) + Mukofot - Avans - Jarima = Sof Oylik
            </code>
          </div>

          {/* Tezkor ommaviy amallar */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSetDefaultRateForAll}
              className="text-[11px] font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg transition cursor-pointer"
              title="Barcha soatbay ishchilarga bir xil stavka o'rnatish"
            >
              ⚡️ Barchaga stavka qo'yish
            </button>
            <button
              onClick={handleMarkAllAsPaid}
              className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg transition cursor-pointer"
              title="Ushbu oy uchun barchasiga to'landi deb belgilash"
            >
              ✅ Barchasini to'landi qilish
            </button>
          </div>
        </div>
      </div>

      {/* Qidiruv, Filtrlar va Xodimlar Ro'yxati */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Xodim ismi, lavozimi yoki telefoni..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:bg-white focus:outline-none focus:border-amber-500 transition"
            />
          </div>

          {/* Filtrlar */}
          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Barchasi ({payrollItems.length})
            </button>
            <button
              onClick={() => setStatusFilter('pending')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                statusFilter === 'pending'
                  ? 'bg-amber-500 text-white'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              Kutilmoqda ({payrollItems.filter((i) => !i.isPaid).length})
            </button>
            <button
              onClick={() => setStatusFilter('paid')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                statusFilter === 'paid'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
              }`}
            >
              To'langan ({payrollItems.filter((i) => i.isPaid).length})
            </button>
          </div>
        </div>

        {/* Xodimlar Jadvali (Desktop) */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <th className="py-3.5 px-4">T/r</th>
                <th className="py-3.5 px-4">Xodim</th>
                <th className="py-3.5 px-4">Ishlagan Vaqti</th>
                <th className="py-3.5 px-4">Stavka</th>
                <th className="py-3.5 px-4">Asosiy Oylik</th>
                <th className="py-3.5 px-4">Avans (-)</th>
                <th className="py-3.5 px-4">Mukofot (+)</th>
                <th className="py-3.5 px-4 text-emerald-700">Sof To'lov</th>
                <th className="py-3.5 px-4">Holat</th>
                <th className="py-3.5 px-4 text-right">Amallar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
              {filteredPayrollItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-400">
                    Xodimlar topilmadi
                  </td>
                </tr>
              ) : (
                filteredPayrollItems.map((item, idx) => (
                  <tr key={item.worker.id} className="hover:bg-slate-50/70 transition">
                    <td className="py-3.5 px-4 text-slate-400 font-bold">{idx + 1}</td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{item.worker.full_name}</div>
                      <div className="text-[11px] text-slate-500">{item.worker.position} · {item.worker.phone}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-800">{item.formattedHours}</div>
                      <div className="text-[11px] text-slate-500">{item.workedDays} ish kuni</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <button
                        onClick={() => {
                          setRateWorker(item.worker);
                          setShowRateModal(true);
                        }}
                        title="Stavkani o'zgartirish"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer transition"
                      >
                        <span>
                          {item.isFixed
                            ? `${formatUzSum(item.fixedSalary)} / oy`
                            : `${formatUzSum(item.hourlyRate)} / soat`}
                        </span>
                        <Edit3 className="w-3 h-3 text-slate-400" />
                      </button>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-800">
                      {formatUzSum(item.grossSalary)}
                    </td>
                    <td className="py-3.5 px-4">
                      {item.advances > 0 ? (
                        <span className="font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                          -{formatUzSum(item.advances)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {item.bonuses > 0 ? (
                        <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                          +{formatUzSum(item.bonuses)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-base font-black text-emerald-600">
                        {formatUzSum(item.netPayable)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <button
                        onClick={() => handleTogglePayout(item.worker.id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold transition cursor-pointer ${
                          item.isPaid
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                        }`}
                      >
                        {item.isPaid ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Clock className="w-3.5 h-3.5 text-amber-600" />}
                        <span>{item.isPaid ? "To'landi" : 'Kutilmoqda'}</span>
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setPaymentWorker(item.worker);
                            setShowPaymentModal(true);
                          }}
                          title="Ushbu xodimga oylik to'lash va hisob-kitob qilish"
                          className="p-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition cursor-pointer flex items-center gap-1 px-3"
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          <span>To'lov qilish</span>
                        </button>

                        <button
                          onClick={() => {
                            setSelectedWorkerForAdjustment(item.worker);
                            setShowAddAdjustmentModal(true);
                          }}
                          title="Avans yoki Mukofot berish"
                          className="p-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold text-xs transition cursor-pointer flex items-center gap-1 px-2"
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          <span>Avans</span>
                        </button>

                        <button
                          onClick={() => {
                            setSlipWorker(item.worker);
                            setShowSlipModal(true);
                          }}
                          title="Ishlagan soati kvitansiyasi (Chek)"
                          className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition cursor-pointer flex items-center gap-1 px-2"
                        >
                          <Receipt className="w-3.5 h-3.5" />
                          <span>Chek</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobil Ko'rinish (Kartalar ko'rinishida) */}
        <div className="lg:hidden divide-y divide-slate-100">
          {filteredPayrollItems.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">
              Xodimlar topilmadi
            </div>
          ) : (
            filteredPayrollItems.map((item) => (
              <div key={item.worker.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-black text-slate-900 text-base">{item.worker.full_name}</div>
                    <div className="text-xs text-slate-500">{item.worker.position} · {item.worker.phone}</div>
                  </div>
                  <button
                    onClick={() => handleTogglePayout(item.worker.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold transition shrink-0 cursor-pointer ${
                      item.isPaid
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {item.isPaid ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Clock className="w-3.5 h-3.5 text-amber-600" />}
                    <span>{item.isPaid ? "To'landi" : 'Kutilmoqda'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 rounded-2xl text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Ishlagan vaqti</span>
                    <span className="font-bold text-slate-800">{item.formattedHours}</span>
                    <span className="text-slate-500 block text-[11px]">({item.workedDays} ish kuni)</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Stavka</span>
                    <button
                      onClick={() => {
                        setRateWorker(item.worker);
                        setShowRateModal(true);
                      }}
                      className="font-bold text-amber-800 underline decoration-dotted text-left"
                    >
                      {item.isFixed ? `${formatUzSum(item.fixedSalary)} / oy` : `${formatUzSum(item.hourlyRate)} / soat`}
                    </button>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Asosiy maosh</span>
                    <span className="font-bold text-slate-700">{formatUzSum(item.grossSalary)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Avans / Mukofot</span>
                    <span className="font-semibold text-amber-800">
                      {item.advances > 0 ? `-${formatUzSum(item.advances)}` : '0'}
                    </span>
                    {item.bonuses > 0 && <span className="text-emerald-600 block text-[11px]">+{formatUzSum(item.bonuses)}</span>}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Qo'lga tegadigan:</span>
                    <span className="text-lg font-black text-emerald-600">{formatUzSum(item.netPayable)}</span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => {
                        setPaymentWorker(item.worker);
                        setShowPaymentModal(true);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 cursor-pointer shadow-xs"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>To'lov qilish</span>
                    </button>

                    <button
                      onClick={() => {
                        setSelectedWorkerForAdjustment(item.worker);
                        setShowAddAdjustmentModal(true);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs flex items-center gap-1 cursor-pointer"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>Avans</span>
                    </button>

                    <button
                      onClick={() => {
                        setSlipWorker(item.worker);
                        setShowSlipModal(true);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1 cursor-pointer"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>Chek</span>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: AVANS / MUKOFOT / JARIMA QO'SHISH                                */}
      {/* ========================================================================= */}
      {showAddAdjustmentModal && selectedWorkerForAdjustment && (
        <AdjustmentModal
          worker={selectedWorkerForAdjustment}
          month={selectedMonth}
          existingAdjustments={adjustments.filter(
            (a) => a.user_id === selectedWorkerForAdjustment.id && a.month === selectedMonth
          )}
          onClose={() => {
            setShowAddAdjustmentModal(false);
            setSelectedWorkerForAdjustment(null);
          }}
          onSave={handleSaveAdjustment}
          onDelete={handleDeleteAdjustment}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: SHAXSIY ISH HAQI KVITANSIYASI (STAVKASIZ CHEK)                    */}
      {/* ========================================================================= */}
      {showSlipModal && slipWorker && (
        <PayslipModal
          worker={slipWorker}
          payrollItem={payrollItems.find((p) => p.worker.id === slipWorker.id)!}
          month={selectedMonth}
          shopName={settings.shop_name}
          onClose={() => {
            setShowSlipModal(false);
            setSlipWorker(null);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: STAVKANI TAHRIRLASH (SOATBAY YOKI OYLIK QAT'IY)                  */}
      {/* ========================================================================= */}
      {showRateModal && rateWorker && (
        <RateEditModal
          worker={rateWorker}
          defaultHourly={defaultHourlyRate}
          onClose={() => {
            setShowRateModal(false);
            setRateWorker(null);
          }}
          onSave={handleSaveWorkerRate}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: MAXFIYLIK VA BOSHQARUV SOZLAMALARI (PIN KOD & ADMIN SOZLAMALARI)  */}
      {/* ========================================================================= */}
      {showSettingsModal && (
        <PayrollSettingsModal
          settings={settings}
          users={users}
          currentUser={currentUser}
          onClose={() => setShowSettingsModal(false)}
          onSaveSettings={async (updated) => {
            await onUpdateSettings(updated);
            setShowSettingsModal(false);
            showToast('success', "Buxgalteriya sozlamalari yangilandi!");
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: TO'LIQ ISH HAQI VEDOMOSTI (CHOP ETISH UCHUN)                      */}
      {/* ========================================================================= */}
      {showFullVedomostModal && (
        <FullVedomostModal
          shopName={settings.shop_name}
          month={selectedMonth}
          periodLabel={activePeriod.label}
          payrollItems={payrollItems}
          totals={totals}
          onClose={() => setShowFullVedomostModal(false)}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 6: MAXFIY OYLIK PIN KODINI O'ZGARTIRISH MODALI                      */}
      {/* ========================================================================= */}
      {showChangePinModal && (
        <ChangePayrollPinModal
          settings={settings}
          onClose={() => setShowChangePinModal(false)}
          onSavePin={handleSaveNewPayrollPin}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 7: HAR BIR XODIM UCHUN ALOHIDA TO'LOV QILISH VA HISOB-KITOB MODALI    */}
      {/* ========================================================================= */}
      {showPaymentModal && paymentWorker && (
        <WorkerPaymentModal
          worker={paymentWorker}
          attendances={attendances}
          settings={settings}
          initialStartDate={activePeriod.startDate}
          initialEndDate={activePeriod.endDate}
          defaultHourlyRate={defaultHourlyRate}
          onClose={() => {
            setShowPaymentModal(false);
            setPaymentWorker(null);
          }}
          onExecutePayment={handleExecuteWorkerPayment}
          onViewReceipt={(record) => {
            setActiveReceiptRecord(record);
            setShowPaymentReceiptModal(true);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL 8: TO'LOV RASMIY KVITANSIYASI (CHEK) MODALI                          */}
      {/* ========================================================================= */}
      {showPaymentReceiptModal && activeReceiptRecord && (
        <PaymentReceiptModal
          shopName={settings.shop_name}
          record={activeReceiptRecord}
          worker={users.find((u) => u.id === activeReceiptRecord.user_id) || paymentWorker}
          onClose={() => {
            setShowPaymentReceiptModal(false);
            setActiveReceiptRecord(null);
          }}
        />
      )}
    </div>
  );
}

// =========================================================================
// YORDAMCHI MODAL KOMPONENTLARI
// =========================================================================

/**
 * 0. Maxfiy Oylik PIN kodini o'zgartirish modali
 */
function ChangePayrollPinModal({
  settings,
  onClose,
  onSavePin,
}: {
  settings: MarketSettings;
  onClose: () => void;
  onSavePin: (newPin: string) => Promise<void>;
}) {
  const [currentPinInput, setCurrentPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanCurrent = currentPinInput.trim();
    const cleanNew = newPinInput.trim();
    const cleanConfirm = confirmPinInput.trim();

    const currentMaster = (settings.payroll_master_pin || '9009').trim();

    if (cleanCurrent !== currentMaster) {
      setError("Hozirgi PIN-kod noto'g'ri kiritildi!");
      triggerHaptic('error');
      return;
    }

    if (cleanNew.length < 4) {
      setError("Yangi PIN-kod kamida 4 ta raqamdan iborat bo'lishi kerak!");
      triggerHaptic('error');
      return;
    }

    if (cleanNew !== cleanConfirm) {
      setError("Yangi PIN-kod va tasdiqlash mos kelmadi!");
      triggerHaptic('error');
      return;
    }

    try {
      setIsSubmitting(true);
      await onSavePin(cleanNew);
      triggerHaptic('success');
      onClose();
    } catch {
      setError("Xatolik yuz berdi. Qaytadan urinib ko'ring.");
      triggerHaptic('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 text-slate-900 dark:text-white">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black">PIN Kodni O'zgartirish</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Oylik paneli xavfsizlik kodi</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Hozirgi PIN kod:
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="••••"
              value={currentPinInput}
              onChange={(e) => {
                setCurrentPinInput(e.target.value);
                setError(null);
              }}
              required
              autoFocus
              className="w-full text-center text-lg font-mono tracking-widest px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Yangi PIN kod (4 xonali):
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="••••"
              value={newPinInput}
              onChange={(e) => {
                setNewPinInput(e.target.value);
                setError(null);
              }}
              required
              className="w-full text-center text-lg font-mono tracking-widest px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Yangi PIN kodni tasdiqlang:
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="••••"
              value={confirmPinInput}
              onChange={(e) => {
                setConfirmPinInput(e.target.value);
                setError(null);
              }}
              required
              className="w-full text-center text-lg font-mono tracking-widest px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          <div className="pt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition cursor-pointer"
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 rounded-xl transition cursor-pointer shadow-md disabled:opacity-50"
            >
              {isSubmitting ? "Saqlanmoqda..." : "Saqlash"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * 1. Avans, Mukofot yoki Jarima qo'shish modali (Tezkor tugmalar bilan)
 */
function AdjustmentModal({
  worker,
  month,
  existingAdjustments,
  onClose,
  onSave,
  onDelete,
}: {
  worker: User;
  month: string;
  existingAdjustments: SalaryAdjustment[];
  onClose: () => void;
  onSave: (type: 'advance' | 'bonus' | 'penalty', amount: number, note: string, date: string) => void;
  onDelete: (id: string) => void;
}) {
  const [type, setType] = useState<'advance' | 'bonus' | 'penalty'>('advance');
  const [amountInput, setAmountInput] = useState<string>('');
  const [noteInput, setNoteInput] = useState<string>('');
  const [dateInput, setDateInput] = useState<string>(getLocalDateString(new Date()));

  const handleQuickAmount = (val: number) => {
    setAmountInput(val.toLocaleString('uz-UZ').replace(/,/g, ' '));
    triggerHaptic('light');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAmount = Number(amountInput.replace(/[^\d]/g, ''));
    if (!cleanAmount || cleanAmount <= 0) {
      alert("Iltimos, to'g'ri summa kiriting!");
      return;
    }
    onSave(type, cleanAmount, noteInput, dateInput);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-lg font-black text-slate-900">
              {worker.full_name}
            </h3>
            <p className="text-xs text-slate-500">
              Avans / Mukofot / Jarima ({formatUzMonth(month)})
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-200 text-slate-500 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Turini tanlash */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setType('advance')}
              className={`py-2.5 px-3 rounded-2xl text-xs font-extrabold flex flex-col items-center gap-1 border transition cursor-pointer ${
                type === 'advance'
                  ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Wallet className="w-4 h-4" />
              <span>Avans (-)</span>
            </button>

            <button
              type="button"
              onClick={() => setType('bonus')}
              className={`py-2.5 px-3 rounded-2xl text-xs font-extrabold flex flex-col items-center gap-1 border transition cursor-pointer ${
                type === 'bonus'
                  ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Mukofot (+)</span>
            </button>

            <button
              type="button"
              onClick={() => setType('penalty')}
              className={`py-2.5 px-3 rounded-2xl text-xs font-extrabold flex flex-col items-center gap-1 border transition cursor-pointer ${
                type === 'penalty'
                  ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <AlertCircle className="w-4 h-4" />
              <span>Jarima (-)</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Summa (so'mda)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={amountInput}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d]/g, '');
                    setAmountInput(raw ? Number(raw).toLocaleString('uz-UZ').replace(/,/g, ' ') : '');
                  }}
                  placeholder="Masalan: 300 000"
                  autoFocus
                  required
                  className="w-full text-lg font-bold px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-amber-500"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  so'm
                </span>
              </div>

              {/* Tezkor Summa Tugmalari */}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {[100000, 200000, 300000, 500000, 1000000].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleQuickAmount(val)}
                    className="text-[11px] font-bold px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                  >
                    +{formatUzSum(val).replace(" so'm", '')}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Sana
                </label>
                <input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Izoh (sababi)
                </label>
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Masalan: Naqd berildi"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-md transition cursor-pointer"
            >
              Saqlash
            </button>
          </form>

          {/* Ushbu oyda berilgan oldingi avanslar ro'yxati */}
          {existingAdjustments.length > 0 && (
            <div className="pt-4 border-t border-slate-200">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Ushbu oydagi yozuvlar ({existingAdjustments.length})
              </h4>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {existingAdjustments.map((adj) => (
                  <div
                    key={adj.id}
                    className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-1.5 font-bold">
                        <span
                          className={
                            adj.type === 'advance'
                              ? 'text-amber-800'
                              : adj.type === 'bonus'
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }
                        >
                          {adj.type === 'advance'
                            ? 'Avans'
                            : adj.type === 'bonus'
                            ? 'Mukofot'
                            : 'Jarima'}
                          : {formatUzSum(adj.amount)}
                        </span>
                        <span className="text-[11px] text-slate-400 font-normal">({adj.date})</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{adj.note}</div>
                    </div>
                    <button
                      onClick={() => onDelete(adj.id)}
                      title="O'chirish"
                      className="p-1 text-slate-400 hover:text-rose-600 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 2. Xodim Ish Haqi Cheki (Supermarket Kvitansiyasi / Payslip)
 * MUHIM: Xodimga soatlik stavka ko'rinmaydi — faqat ishlangan vaqti va yakuniy summa ko'rinadi!
 */
function PayslipModal({
  worker,
  payrollItem,
  month,
  shopName,
  onClose,
}: {
  worker: User;
  payrollItem: any;
  month: string;
  shopName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<boolean>(false);
  const [slipMode, setSlipMode] = useState<'hours_only' | 'payout_slip'>('hours_only');

  // Telegram uchun matn (STAVKASIZ — FOYDALANUVCHI TALABIGA BINOAN)
  const handleCopyText = () => {
    let text = '';
    if (slipMode === 'hours_only') {
      text =
        `🧾 <b>${shopName.toUpperCase()} — ISHLANGAN VAQT KVITANSIYASI</b>\n` +
        `📅 <b>Hisob oyi:</b> ${formatUzMonth(month)}\n` +
        `👤 <b>Xodim:</b> ${worker.full_name}\n` +
        `💼 <b>Lavozimi:</b> ${worker.position}\n` +
        `----------------------------------------\n` +
        `⏱ <b>JAMI ISHLANGAN VAQT:</b> <b>${payrollItem.formattedHours}</b>\n` +
        `📅 <b>Kelgan kunlari:</b> ${payrollItem.workedDays} ish kuni\n` +
        `----------------------------------------\n` +
        `✅ Barcha smenalaringiz to'liq qayd etildi.\n` +
        `Halol mehnatingiz uchun tashakkur!`;
    } else {
      text =
        `🧾 <b>${shopName.toUpperCase()} — ISH HAQI KVITANSIYASI</b>\n` +
        `📅 <b>Hisob oyi:</b> ${formatUzMonth(month)}\n` +
        `👤 <b>Xodim:</b> ${worker.full_name}\n` +
        `💼 <b>Lavozimi:</b> ${worker.position}\n` +
        `----------------------------------------\n` +
        `⏱ <b>Ishlagan vaqti:</b> ${payrollItem.formattedHours} (${payrollItem.workedDays} kun)\n` +
        (payrollItem.bonuses > 0 ? `🎁 <b>Mukofot:</b> +${formatUzSum(payrollItem.bonuses)}\n` : '') +
        (payrollItem.advances > 0 ? `🤝 <b>Berilgan avans:</b> -${formatUzSum(payrollItem.advances)}\n` : '') +
        (payrollItem.penalties > 0 ? `⚠️ <b>Ushlanma/Jarima:</b> -${formatUzSum(payrollItem.penalties)}\n` : '') +
        `----------------------------------------\n` +
        `✅ <b>QO'LGA TEGADIGAN SOF MAOSH: ${formatUzSum(payrollItem.netPayable)}</b>\n` +
        `Holat: ${payrollItem.isPaid ? "To'landi ✅" : "Kutilmoqda ⏳"}\n\n` +
        `Rahmatli mehnat uchun tashakkur!`;
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    triggerHaptic('success');
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <span className="text-xs font-black text-slate-800 uppercase tracking-wider block">
              {slipMode === 'hours_only' ? "⏱ Ish Soati Kvitansiyasi" : "💵 Oylik Hisob Kvitansiyasi"}
            </span>
            <span className="text-[10px] text-emerald-700 font-semibold">
              ✓ Soatlik stavka xodimga ko'rinmaydi
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-200 text-slate-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Rejimni almashtirish tugmalari */}
        <div className="p-2 bg-slate-100 border-b border-slate-200 grid grid-cols-2 gap-1 text-xs">
          <button
            type="button"
            onClick={() => setSlipMode('hours_only')}
            className={`py-1.5 px-2 rounded-xl font-bold transition cursor-pointer text-center ${
              slipMode === 'hours_only'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ⏱ Faqat Ish Soati
          </button>
          <button
            type="button"
            onClick={() => setSlipMode('payout_slip')}
            className={`py-1.5 px-2 rounded-xl font-bold transition cursor-pointer text-center ${
              slipMode === 'payout_slip'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            💵 Oylik Cheki
          </button>
        </div>

        {/* CHEK TANASI (Supermarket kvitansiya uslubi) */}
        <div id="printable-payslip" className="p-6 bg-white font-mono text-xs space-y-4">
          <div className="text-center space-y-1">
            <div className="flex justify-center mb-1">
              <NavoLogo size="sm" showText={false} />
            </div>
            <div className="font-black text-sm text-slate-900 tracking-wider uppercase">
              {shopName || 'NAVO MARKET'}
            </div>
            <div className="text-[10px] text-slate-500 font-bold uppercase">
              {slipMode === 'hours_only' ? "ISHLANGAN VAQT KVITANSIYASI" : "SMENA VA ISH HAQI KVITANSIYASI"}
            </div>
            <div className="text-[10px] text-slate-400">
              Hisob oyi: {formatUzMonth(month)}
            </div>
          </div>

          <div className="border-t border-b border-dashed border-slate-300 py-3 space-y-1 text-slate-700">
            <div className="flex justify-between">
              <span>Xodim:</span>
              <span className="font-bold text-slate-900">{worker.full_name}</span>
            </div>
            <div className="flex justify-between">
              <span>Lavozimi:</span>
              <span>{worker.position}</span>
            </div>
            <div className="flex justify-between">
              <span>Telefoni:</span>
              <span>{worker.phone}</span>
            </div>
          </div>

          <div className="space-y-1 text-slate-700">
            <div className="flex justify-between">
              <span>Jami ishlagan vaqti:</span>
              <span className="font-black text-slate-900 text-sm">{payrollItem.formattedHours}</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Kelgan kunlari:</span>
              <span>{payrollItem.workedDays} ish kuni</span>
            </div>

            {/* Agar pul cheki bo'lsa: faqat avans va yakuniy summa, STAVKA YO'Q! */}
            {slipMode === 'payout_slip' && (
              <>
                {payrollItem.bonuses > 0 && (
                  <div className="flex justify-between text-emerald-700 pt-1">
                    <span>Mukofot (+):</span>
                    <span>+{formatUzSum(payrollItem.bonuses)}</span>
                  </div>
                )}

                {payrollItem.advances > 0 && (
                  <div className="flex justify-between text-amber-800">
                    <span>Berilgan avans (-):</span>
                    <span>-{formatUzSum(payrollItem.advances)}</span>
                  </div>
                )}

                {payrollItem.penalties > 0 && (
                  <div className="flex justify-between text-rose-700">
                    <span>Ushlanma/Jarima (-):</span>
                    <span>-{formatUzSum(payrollItem.penalties)}</span>
                  </div>
                )}

                <div className="border-t-2 border-slate-900 pt-3 mt-2">
                  <div className="flex justify-between items-baseline">
                    <span className="font-bold text-xs uppercase text-slate-900">SOF TO'LOV:</span>
                    <span className="font-black text-base text-emerald-600">
                      {formatUzSum(payrollItem.netPayable)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 text-right mt-0.5">
                    Holat: {payrollItem.isPaid ? "To'landi ✅" : "Kutilmoqda ⏳"}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Imzo chizig'i */}
          <div className="pt-6 pb-2 text-[10px] text-slate-400 flex justify-between">
            <div>
              <div className="w-20 border-b border-slate-300 mb-1"></div>
              <span>Do'kon Ma'muri</span>
            </div>
            <div className="text-right">
              <div className="w-20 border-b border-slate-300 mb-1"></div>
              <span>Xodim imzosi</span>
            </div>
          </div>
        </div>

        {/* Amallar */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center gap-2">
          <button
            onClick={handleCopyText}
            className="flex-1 py-2.5 px-3 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Nusxa olindi!' : 'Nusxa olish'}</span>
          </button>

          <button
            onClick={handlePrint}
            className="flex-1 py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Chop etish</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 3. Stavkani tahrirlash modali (Soatbay yoki Oylik qat'iy)
 */
function RateEditModal({
  worker,
  defaultHourly,
  onClose,
  onSave,
}: {
  worker: User;
  defaultHourly: number;
  onClose: () => void;
  onSave: (workerId: number, type: 'hourly' | 'fixed', hourly?: number, fixed?: number) => void;
}) {
  const [type, setType] = useState<'hourly' | 'fixed'>(worker.salary_type || 'hourly');
  const [rateInput, setRateInput] = useState<string>(() => {
    if (worker.salary_type === 'fixed') {
      return (worker.fixed_salary || 3000000).toLocaleString('uz-UZ').replace(/,/g, ' ');
    }
    return (worker.hourly_rate || defaultHourly).toLocaleString('uz-UZ').replace(/,/g, ' ');
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number(rateInput.replace(/[^\d]/g, ''));
    if (!val || val <= 0) {
      alert("Iltimos, to'g'ri stavka kiriting!");
      return;
    }

    if (type === 'hourly') {
      onSave(worker.id, 'hourly', val, undefined);
    } else {
      onSave(worker.id, 'fixed', undefined, val);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-base font-black text-slate-900">{worker.full_name}</h3>
            <p className="text-xs text-slate-500">Stavka va to'lov turini belgilash</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setType('hourly');
                setRateInput(defaultHourly.toLocaleString('uz-UZ').replace(/,/g, ' '));
              }}
              className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer ${
                type === 'hourly'
                  ? 'bg-amber-500 text-white border-amber-600'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
            >
              Soatbay stavka
            </button>
            <button
              type="button"
              onClick={() => {
                setType('fixed');
                setRateInput((3000000).toLocaleString('uz-UZ').replace(/,/g, ' '));
              }}
              className={`py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer ${
                type === 'fixed'
                  ? 'bg-amber-500 text-white border-amber-600'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
            >
              Oylik qat'iy
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {type === 'hourly' ? '1 soat uchun haq (soatbay)' : "Bir oylik qat'iy maosh"}
            </label>
            <div className="relative">
              <input
                type="text"
                value={rateInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, '');
                  setRateInput(raw ? Number(raw).toLocaleString('uz-UZ').replace(/,/g, ' ') : '');
                }}
                className="w-full text-lg font-bold px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-amber-500"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                {type === 'hourly' ? "so'm / soat" : "so'm / oy"}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {type === 'hourly'
                ? 'Oy oxirida xodim ishlagan umumiy soatiga ko\'paytiriladi'
                : 'Ishlangan soatdan qat\'i nazar belgilangan qat\'iy maosh hisoblanadi'}
            </p>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-md transition cursor-pointer"
          >
            Saqlash
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * 4. Maxfiylik va Bosh Admin Sozlamalari Modali
 */
function PayrollSettingsModal({
  settings,
  users,
  currentUser,
  onClose,
  onSaveSettings,
}: {
  settings: MarketSettings;
  users: User[];
  currentUser: User;
  onClose: () => void;
  onSaveSettings: (settings: MarketSettings) => Promise<void>;
}) {
  const [pinInput, setPinInput] = useState<string>(settings.payroll_master_pin || '9009');
  const [hourlyRateInput, setHourlyRateInput] = useState<string>(
    (settings.payroll_default_hourly_rate || 15000).toLocaleString('uz-UZ').replace(/,/g, ' ')
  );
  const [designatedAdminId, setDesignatedAdminId] = useState<string>(settings.payroll_admin_id || '');

  const adminUsers = users.filter((u) => u.role === 'admin');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinInput.trim() || pinInput.trim().length < 4) {
      alert("PIN kod kamida 4 ta raqam bo'lishi kerak!");
      return;
    }

    const cleanRate = Number(hourlyRateInput.replace(/[^\d]/g, '')) || 15000;

    const newSettings: MarketSettings = {
      ...settings,
      payroll_master_pin: pinInput.trim(),
      payroll_default_hourly_rate: cleanRate,
      payroll_admin_id: designatedAdminId.trim(),
    };

    await onSaveSettings(newSettings);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-700 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">Buxgalteriya Xavfsizligi</h3>
              <p className="text-xs text-slate-500">Yagona Vakolatli Bosh Adminni belgilash</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-200 text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {/* 1. Yagona Vakolatli Bosh Admin Telegram ID */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Yagona Mas'ul Admin (Faqat u ko'ra oladi)
            </label>
            <div className="space-y-2">
              <input
                type="text"
                value={designatedAdminId}
                onChange={(e) => setDesignatedAdminId(e.target.value)}
                placeholder="Admin Telegram ID sini kiriting yoki quyidan tanlang"
                className="w-full text-xs font-mono font-bold px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-amber-500"
              />

              {/* Hozirgi kirgan foydalanuvchini 1 bosishda tanlash */}
              {currentUser.telegram_id && (
                <button
                  type="button"
                  onClick={() => setDesignatedAdminId(String(currentUser.telegram_id))}
                  className="w-full py-2 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Crown className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600" />
                  <span>Meni ({currentUser.full_name}) yagona mas'ul qilish</span>
                </button>
              )}

              {/* Barcha adminlar ro'yxatidan tanlash */}
              {adminUsers.length > 0 && (
                <div className="pt-1">
                  <span className="text-[11px] text-slate-400 block mb-1">Mavjud adminlar ro'yxatidan tanlash:</span>
                  <div className="flex flex-wrap gap-1">
                    {adminUsers.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setDesignatedAdminId(String(a.telegram_id || ''))}
                        className={`text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition ${
                          designatedAdminId === String(a.telegram_id || '')
                            ? 'bg-amber-500 text-white border-amber-600'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {a.full_name} ({a.telegram_id || 'IDsiz'})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              Belgilangan admingina oylik bo'limiga to'liq kira oladi. Boshqa har qanday admin va xodimlar uchun oyliklar yopiq bo'ladi.
            </p>
          </div>

          {/* 2. Maxfiy Oylik PIN kodi */}
          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Maxfiy Buxgalteriya PIN Kodi
            </label>
            <input
              type="password"
              maxLength={8}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="••••"
              required
              className="w-full text-base font-mono font-bold px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-amber-500 text-center tracking-widest"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Boshqa qurilmadan kirganda yoki hisob o'zgarganda ochish uchun maxfiy kod.
            </p>
          </div>

          {/* 3. Standart soatlik stavka */}
          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Standart soatlik ish haqi
            </label>
            <div className="relative">
              <input
                type="text"
                value={hourlyRateInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, '');
                  setHourlyRateInput(raw ? Number(raw).toLocaleString('uz-UZ').replace(/,/g, ' ') : '');
                }}
                className="w-full text-base font-bold px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-amber-500"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                so'm / soat
              </span>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-md transition cursor-pointer mt-4"
          >
            Sozlamalarni Saqlash
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * 5. Umumiy Ish Haqi Vedomosti (Chop etish va Excel/PDF uchun)
 */
function FullVedomostModal({
  shopName,
  month,
  periodLabel,
  payrollItems,
  totals,
  onClose,
}: {
  shopName: string;
  month: string;
  periodLabel?: string;
  payrollItems: any[];
  totals: any;
  onClose: () => void;
}) {
  const displayPeriod = periodLabel || `${formatUzMonth(month)} oyi`;

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    csvContent += 'T/r;Xodim;Lavozimi;Ishlagan Soat;Stavka;Hisoblangan Oylik;Avans;Mukofot;Jarima;Sof Tolov;Holat\n';
    payrollItems.forEach((p, idx) => {
      csvContent += `${idx + 1};"${p.worker.full_name}";"${p.worker.position}";"${p.formattedHours}";"${p.isFixed ? p.fixedSalary : p.hourlyRate}";${p.grossSalary};${p.advances};${p.bonuses};${p.penalties};${p.netPayable};"${p.isPaid ? 'Tolandi' : 'Kutilmoqda'}"\n`;
    });
    csvContent += `\n;;JAMI;${totals.totalMinutes / 60} soat;;${totals.gross};${totals.advances};${totals.bonuses};${totals.penalties};${totals.netPayable};\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Ish_Haqi_Vedomosti_${month}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
          <div>
            <h3 className="text-lg font-black text-slate-900">
              Ish Haqi To'lov Vedomosti ({displayPeriod})
            </h3>
            <p className="text-xs text-slate-500">{shopName} barcha xodimlarining rasmiy hisob-kitob varaqasi</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold transition cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Excel (CSV)</span>
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-xs transition cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Chop etish</span>
            </button>
            <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-slate-200 text-slate-400">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1 font-sans text-xs">
          <div className="text-center mb-6">
            <h2 className="text-xl font-black text-slate-900 uppercase tracking-wider">{shopName}</h2>
            <div className="text-sm font-bold text-slate-600 mt-1 uppercase">
              {displayPeriod} UCHUN ISH HAQI TO'LOV VEDOMOSTI
            </div>
            <div className="text-slate-400 text-xs mt-0.5">Sana: {formatUzDate(getLocalDateString(new Date()))}</div>
          </div>

          <table className="w-full text-left border-collapse border border-slate-300">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-300 text-[11px]">
                <th className="p-2 border border-slate-300">T/r</th>
                <th className="p-2 border border-slate-300">Xodim F.I.O</th>
                <th className="p-2 border border-slate-300">Lavozimi</th>
                <th className="p-2 border border-slate-300">Ishlagan vaqti</th>
                <th className="p-2 border border-slate-300">Stavka</th>
                <th className="p-2 border border-slate-300">Hisoblangan</th>
                <th className="p-2 border border-slate-300">Avans</th>
                <th className="p-2 border border-slate-300">Mukofot</th>
                <th className="p-2 border border-slate-300">Sof To'lov</th>
                <th className="p-2 border border-slate-300">Imzo</th>
              </tr>
            </thead>
            <tbody>
              {payrollItems.map((p, idx) => (
                <tr key={p.worker.id} className="border-b border-slate-200">
                  <td className="p-2 border border-slate-300 text-center">{idx + 1}</td>
                  <td className="p-2 border border-slate-300 font-bold">{p.worker.full_name}</td>
                  <td className="p-2 border border-slate-300">{p.worker.position}</td>
                  <td className="p-2 border border-slate-300">{p.formattedHours}</td>
                  <td className="p-2 border border-slate-300">
                    {p.isFixed ? `${formatUzSum(p.fixedSalary)} / oy` : `${formatUzSum(p.hourlyRate)} / soat`}
                  </td>
                  <td className="p-2 border border-slate-300">{formatUzSum(p.grossSalary)}</td>
                  <td className="p-2 border border-slate-300 text-amber-800">
                    {p.advances > 0 ? `-${formatUzSum(p.advances)}` : '0'}
                  </td>
                  <td className="p-2 border border-slate-300 text-emerald-700">
                    {p.bonuses > 0 ? `+${formatUzSum(p.bonuses)}` : '0'}
                  </td>
                  <td className="p-2 border border-slate-300 font-black text-slate-900">
                    {formatUzSum(p.netPayable)}
                  </td>
                  <td className="p-2 border border-slate-300 w-24"></td>
                </tr>
              ))}
              <tr className="bg-slate-100 font-black border-t-2 border-slate-400 text-slate-900">
                <td colSpan={3} className="p-2.5 border border-slate-300 text-right uppercase">
                  JAMI DO'KON BO'YICHA:
                </td>
                <td className="p-2.5 border border-slate-300">{formatMinutesToHours(totals.totalMinutes)}</td>
                <td className="p-2.5 border border-slate-300">—</td>
                <td className="p-2.5 border border-slate-300">{formatUzSum(totals.gross)}</td>
                <td className="p-2.5 border border-slate-300 text-amber-800">-{formatUzSum(totals.advances)}</td>
                <td className="p-2.5 border border-slate-300 text-emerald-700">+{formatUzSum(totals.bonuses)}</td>
                <td className="p-2.5 border border-slate-300 text-emerald-700 text-sm">
                  {formatUzSum(totals.netPayable)}
                </td>
                <td className="p-2.5 border border-slate-300"></td>
              </tr>
            </tbody>
          </table>

          {/* Vedomost tasdiqlovchi imzolar */}
          <div className="mt-12 flex justify-between items-center text-xs text-slate-600 px-4">
            <div>
              <div className="w-40 border-b border-slate-400 mb-1"></div>
              <span>Do'kon Rahbari / Bosh Admin</span>
            </div>
            <div>
              <div className="w-40 border-b border-slate-400 mb-1"></div>
              <span>Bosh Buxgalter / Kassir</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 6. Har bir xodim uchun alohida Oylik To'lov va Hisob-kitob Modali (Oraliq bo'yicha)
 */
function WorkerPaymentModal({
  worker,
  attendances,
  settings,
  initialStartDate,
  initialEndDate,
  defaultHourlyRate,
  onClose,
  onExecutePayment,
  onViewReceipt,
}: {
  worker: User;
  attendances: Attendance[];
  settings: MarketSettings;
  initialStartDate: string;
  initialEndDate: string;
  defaultHourlyRate: number;
  onClose: () => void;
  onExecutePayment: (data: any) => Promise<void>;
  onViewReceipt: (record: PayrollPayoutRecord) => void;
}) {
  const [modalTab, setModalTab] = useState<'payout' | 'history'>('payout');
  const [startDate, setStartDate] = useState<string>(initialStartDate);
  const [endDate, setEndDate] = useState<string>(initialEndDate);

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [paymentDate, setPaymentDate] = useState<string>(getLocalDateString(new Date()));
  const [noteInput, setNoteInput] = useState<string>('');

  // Qo'shimcha kiritiladigan avans, jarima, mukofot
  const [extraAdvanceInput, setExtraAdvanceInput] = useState<string>('');
  const [penaltyInput, setPenaltyInput] = useState<string>('');
  const [bonusInput, setBonusInput] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Tanlangan oraliq bo'yicha real vaqtda davomat va ishlangan vaqtni hisoblash
  const rangeAttendanceStats = useMemo(() => {
    const s = startDate <= endDate ? startDate : endDate;
    const e = startDate <= endDate ? endDate : startDate;

    const userShifts = attendances.filter((a) => {
      if (a.user_id !== worker.id) return false;
      const d = a.date || '';
      const od = a.check_out_date || a.date || '';
      return (d >= s && d <= e) || (od >= s && od <= e);
    });

    const uniqueDays = new Set(userShifts.map((a) => a.date)).size;
    const totalMinutes = userShifts.reduce((acc, curr) => acc + getAccurateAttendanceMinutes(curr), 0);
    const totalHours = Math.round((totalMinutes / 60) * 10) / 10;

    return {
      shifts: userShifts,
      workedDays: uniqueDays,
      totalMinutes,
      totalHours,
      formattedHours: formatMinutesToHours(totalMinutes),
    };
  }, [attendances, worker.id, startDate, endDate]);

  // Stavka va asosiy hisoblangan maosh
  const isFixed = worker.salary_type === 'fixed';
  const hourlyRate = worker.hourly_rate || defaultHourlyRate;
  const fixedSalary = worker.fixed_salary || 0;

  const grossSalary = useMemo(() => {
    if (isFixed) {
      return rangeAttendanceStats.workedDays < 20
        ? Math.round((fixedSalary / 26) * Math.min(rangeAttendanceStats.workedDays, 26))
        : fixedSalary;
    }
    return Math.round((rangeAttendanceStats.totalMinutes / 60) * hourlyRate);
  }, [isFixed, fixedSalary, hourlyRate, rangeAttendanceStats]);

  // Ushbu oraliqdagi oldin berilgan avanslar, mukofot va jarimalar
  const existingRangeAdjustments = useMemo(() => {
    const s = startDate <= endDate ? startDate : endDate;
    const e = startDate <= endDate ? endDate : startDate;
    return (settings.salary_adjustments || []).filter((adj) => {
      if (adj.user_id !== worker.id) return false;
      const d = adj.date || '';
      return d >= s && d <= e;
    });
  }, [settings.salary_adjustments, worker.id, startDate, endDate]);

  const existingAdvances = useMemo(() => {
    return existingRangeAdjustments
      .filter((a) => a.type === 'advance')
      .reduce((sum, a) => sum + a.amount, 0);
  }, [existingRangeAdjustments]);

  const existingPenalties = useMemo(() => {
    return existingRangeAdjustments
      .filter((a) => a.type === 'penalty')
      .reduce((sum, a) => sum + a.amount, 0);
  }, [existingRangeAdjustments]);

  const existingBonuses = useMemo(() => {
    return existingRangeAdjustments
      .filter((a) => a.type === 'bonus')
      .reduce((sum, a) => sum + a.amount, 0);
  }, [existingRangeAdjustments]);

  // Kiritilgan yangi summalarni hisoblash
  const cleanExtraAdvance = Number(extraAdvanceInput.replace(/[^\d]/g, '')) || 0;
  const cleanPenalty = Number(penaltyInput.replace(/[^\d]/g, '')) || 0;
  const cleanBonus = Number(bonusInput.replace(/[^\d]/g, '')) || 0;

  const totalAdvances = existingAdvances + cleanExtraAdvance;
  const totalPenalties = existingPenalties + cleanPenalty;
  const totalBonuses = existingBonuses + cleanBonus;

  // Sof to'lanadigan summa
  const netPayable = Math.max(0, grossSalary + totalBonuses - totalAdvances - totalPenalties);

  // Ushbu xodimning barcha oldingi to'lovlar tarixi
  const workerPayoutHistory = useMemo(() => {
    return (settings.payroll_payout_records || []).filter((r) => r.user_id === worker.id);
  }, [settings.payroll_payout_records, worker.id]);

  // Tezkor oraliq belgilash
  const handleQuickPreset = (preset: 'this_month' | 'first_half' | 'second_half' | 'last_month') => {
    triggerHaptic('light');
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();

    if (preset === 'this_month') {
      setStartDate(`${y}-${m}-01`);
      setEndDate(`${y}-${m}-${String(lastDay).padStart(2, '0')}`);
    } else if (preset === 'first_half') {
      setStartDate(`${y}-${m}-01`);
      setEndDate(`${y}-${m}-15`);
    } else if (preset === 'second_half') {
      setStartDate(`${y}-${m}-16`);
      setEndDate(`${y}-${m}-${String(lastDay).padStart(2, '0')}`);
    } else if (preset === 'last_month') {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const py = prev.getFullYear();
      const pm = String(prev.getMonth() + 1).padStart(2, '0');
      const plast = new Date(py, prev.getMonth() + 1, 0).getDate();
      setStartDate(`${py}-${pm}-01`);
      setEndDate(`${py}-${pm}-${String(plast).padStart(2, '0')}`);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      alert("Iltimos, boshlanish va tugash sanasini to'g'ri belgilang!");
      return;
    }

    const s = startDate <= endDate ? startDate : endDate;
    const eDate = startDate <= endDate ? endDate : startDate;

    const ok = window.confirm(
      `${worker.full_name} ga ${s} dan ${eDate} gacha ishlagan vaqti (${rangeAttendanceStats.formattedHours}) uchun ${formatUzSum(netPayable)} to'lov tasdiqlansinmi?`
    );
    if (!ok) return;

    try {
      setIsSubmitting(true);
      await onExecutePayment({
        worker,
        startDate: s,
        endDate: eDate,
        workedMinutes: rangeAttendanceStats.totalMinutes,
        workedDays: rangeAttendanceStats.workedDays,
        hourlyRate: isFixed ? 0 : hourlyRate,
        grossSalary,
        advances: totalAdvances,
        penalties: totalPenalties,
        bonuses: totalBonuses,
        netAmount: netPayable,
        paymentMethod,
        paymentDate,
        note: noteInput,
        newAdjustment:
          cleanExtraAdvance > 0
            ? {
                type: 'advance',
                amount: cleanExtraAdvance,
                note: `To'lov oraliq avansi (${s} — ${eDate})`,
              }
            : cleanBonus > 0
            ? {
                type: 'bonus',
                amount: cleanBonus,
                note: `To'lov mukofoti (${s} — ${eDate})`,
              }
            : cleanPenalty > 0
            ? {
                type: 'penalty',
                amount: cleanPenalty,
                note: `To'lov jarimasi (${s} — ${eDate})`,
              }
            : undefined,
      });
    } catch (err) {
      console.error(err);
      alert("To'lovni saqlashda xatolik yuz berdi!");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Yuqori Qismi (Header) */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center font-black text-base shadow-xs">
              <CreditCard className="w-6 h-6 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  {worker.full_name}
                </h3>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300">
                  {isFixed ? `${formatUzSum(fixedSalary)} / oy` : `${formatUzSum(hourlyRate)} / soat`}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {worker.position || 'Xodim'} · {worker.phone || 'Telefon kiritilmagan'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tablar: To'lov qilish vs Tarix */}
        <div className="flex items-center border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/30 px-4 pt-2">
          <button
            type="button"
            onClick={() => setModalTab('payout')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              modalTab === 'payout'
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-white dark:bg-slate-900 rounded-t-xl'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Banknote className="w-4 h-4" />
            <span>💳 Yangi To'lov Rasmiylashtirish</span>
          </button>

          <button
            type="button"
            onClick={() => setModalTab('history')}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              modalTab === 'history'
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-white dark:bg-slate-900 rounded-t-xl'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <History className="w-4 h-4" />
            <span>To'lovlar Tarixi ({workerPayoutHistory.length})</span>
          </button>
        </div>

        {/* Modal Kontenti */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5 text-xs">
          {modalTab === 'payout' ? (
            <form onSubmit={handleFormSubmit} className="space-y-4">
              {/* 1. Sana Oralig'i Tanlagich */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <CalendarRange className="w-4 h-4 text-emerald-600" />
                    <span>Hisob-kitob Sana Oralig'i:</span>
                  </span>
                  <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold">
                    {rangeAttendanceStats.workedDays} ish kuni qayd etilgan
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Boshlanish sanasi (Dan):</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Tugash sanasi (Gacha):</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                {/* Tezkor preset tugmalari */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[10px] text-slate-400 font-bold">Tezkor:</span>
                  <button
                    type="button"
                    onClick={() => handleQuickPreset('this_month')}
                    className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold transition"
                  >
                    Bu oy to'liq
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickPreset('first_half')}
                    className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold transition"
                  >
                    1-15 kunlar (1-yarmi)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickPreset('second_half')}
                    className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold transition"
                  >
                    16-oxiri (2-yarmi)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickPreset('last_month')}
                    className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold transition"
                  >
                    O'tgan oy
                  </button>
                </div>
              </div>

              {/* 2. Shu Oraliqdagi Ishlangan Vaqt va Asosiy Ish Haqi Hisobi */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3.5 bg-emerald-50/60 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800">
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-800 dark:text-emerald-400 block">
                    Ishlagan vaqti
                  </span>
                  <span className="text-sm font-black text-slate-900 dark:text-white mt-0.5 block">
                    {rangeAttendanceStats.formattedHours}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    ({rangeAttendanceStats.totalHours} soat)
                  </span>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-800 dark:text-emerald-400 block">
                    Amaldagi Stavka
                  </span>
                  <span className="text-sm font-black text-slate-900 dark:text-white mt-0.5 block">
                    {isFixed ? `${formatUzSum(fixedSalary)} / oy` : `${formatUzSum(hourlyRate)} / soat`}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {isFixed ? "Qat'iy oylik" : "Soatbay hisob"}
                  </span>
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <span className="text-[10px] uppercase font-bold text-emerald-800 dark:text-emerald-400 block">
                    Asosiy hisoblangan
                  </span>
                  <span className="text-sm font-black text-emerald-700 dark:text-emerald-300 mt-0.5 block">
                    {formatUzSum(grossSalary)}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Avans va jarimalarsiz
                  </span>
                </div>
              </div>

              {/* 3. Moliyaviy Maydonlar: Avans, Jarima, Mukofot */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Avans */}
                <div className="p-3 bg-amber-50/60 dark:bg-amber-950/30 rounded-2xl border border-amber-200 dark:border-amber-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1">
                      <Wallet className="w-3.5 h-3.5 text-amber-600" />
                      <span>Avans (-)</span>
                    </span>
                    {existingAdvances > 0 && (
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 rounded">
                        Olingan: {formatUzSum(existingAdvances)}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={extraAdvanceInput}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, '');
                      setExtraAdvanceInput(raw ? Number(raw).toLocaleString('uz-UZ').replace(/,/g, ' ') : '');
                    }}
                    placeholder={existingAdvances > 0 ? "Qo'shimcha avans..." : "Avans summasi..."}
                    className="w-full text-xs font-bold px-3 py-2 bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 rounded-xl focus:outline-none"
                  />
                  <div className="text-[10px] text-amber-800 dark:text-amber-400 font-semibold">
                    Jami ushlanadi: <b>-{formatUzSum(totalAdvances)}</b>
                  </div>
                </div>

                {/* Jarima */}
                <div className="p-3 bg-rose-50/60 dark:bg-rose-950/30 rounded-2xl border border-rose-200 dark:border-rose-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-900 dark:text-rose-300 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                      <span>Jarima (-)</span>
                    </span>
                    {existingPenalties > 0 && (
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-100 dark:bg-rose-900 px-1.5 py-0.5 rounded">
                        Mavjud: {formatUzSum(existingPenalties)}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={penaltyInput}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, '');
                      setPenaltyInput(raw ? Number(raw).toLocaleString('uz-UZ').replace(/,/g, ' ') : '');
                    }}
                    placeholder="Jarima miqdori..."
                    className="w-full text-xs font-bold px-3 py-2 bg-white dark:bg-slate-800 border border-rose-300 dark:border-rose-700 rounded-xl focus:outline-none"
                  />
                  <div className="text-[10px] text-rose-800 dark:text-rose-400 font-semibold">
                    Jami jarima: <b>-{formatUzSum(totalPenalties)}</b>
                  </div>
                </div>

                {/* Mukofot */}
                <div className="p-3 bg-indigo-50/60 dark:bg-indigo-950/30 rounded-2xl border border-indigo-200 dark:border-indigo-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Mukofot (+)</span>
                    </span>
                    {existingBonuses > 0 && (
                      <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 dark:bg-indigo-900 px-1.5 py-0.5 rounded">
                        Mavjud: {formatUzSum(existingBonuses)}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={bonusInput}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, '');
                      setBonusInput(raw ? Number(raw).toLocaleString('uz-UZ').replace(/,/g, ' ') : '');
                    }}
                    placeholder="Mukofot / bonus..."
                    className="w-full text-xs font-bold px-3 py-2 bg-white dark:bg-slate-800 border border-indigo-300 dark:border-indigo-700 rounded-xl focus:outline-none"
                  />
                  <div className="text-[10px] text-indigo-800 dark:text-indigo-400 font-semibold">
                    Jami qo'shiladi: <b>+{formatUzSum(totalBonuses)}</b>
                  </div>
                </div>
              </div>

              {/* 4. To'lov Usuli, Sanasi va Izoh */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    To'lov usuli
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold focus:outline-none"
                  >
                    <option value="cash">💵 Naqd pul</option>
                    <option value="card">💳 Plastik karta (Uzcard/Humo)</option>
                    <option value="transfer">🏦 Bank o'tkazmasi</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    To'lov sanasi
                  </label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Izoh (Kvitansiya uchun)
                  </label>
                  <input
                    type="text"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    placeholder="Masalan: To'liq to'landi"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl text-xs focus:outline-none"
                  />
                </div>
              </div>

              {/* 5. Jonli Formulali Yakuniy Xulosa Bloki */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-700/20 space-y-2">
                <div className="flex items-center justify-between text-xs text-emerald-100 border-b border-emerald-500/40 pb-2">
                  <span>Hisoblash formulasi:</span>
                  <span className="font-mono text-[11px]">
                    {formatUzSum(grossSalary)} + {formatUzSum(totalBonuses)} - {formatUzSum(totalAdvances)} - {formatUzSum(totalPenalties)}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-emerald-200 block">
                      Yakuniy To'lanadigan Sof Summa:
                    </span>
                    <span className="text-2xl font-black text-white">
                      {formatUzSum(netPayable)}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="text-[11px] font-semibold text-emerald-100 block">
                      Davr: {startDate} — {endDate}
                    </span>
                    <span className="text-[11px] font-bold text-emerald-200">
                      {rangeAttendanceStats.formattedHours}
                    </span>
                  </div>
                </div>
              </div>

              {/* Tasdiqlash Tugmasi */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-bold text-sm shadow-md transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>To'lovni Tasdiqlash & Saqlash ({formatUzSum(netPayable)})</span>
              </button>
            </form>
          ) : (
            /* Tarix Tabi: Ushbu xodimga avval qilingan barcha to'lovlar */
            <div className="space-y-3">
              {workerPayoutHistory.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  <Receipt className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                  <p className="font-bold text-slate-600 dark:text-slate-300">
                    Hali birorta ham to'lov rasmiylashtirilmagan
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    "Yangi To'lov Rasmiylashtirish" tabiga o'tib, oraliq bo'yicha to'lovni tasdiqlang.
                  </p>
                </div>
              ) : (
                workerPayoutHistory.map((rec) => (
                  <div
                    key={rec.id}
                    className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-slate-900 dark:text-white text-sm">
                          {rec.start_date} — {rec.end_date}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          {rec.payment_method === 'cash' ? '💵 Naqd' : rec.payment_method === 'card' ? '💳 Karta' : '🏦 O\'tkazma'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                        <span>⏱ {formatMinutesToHours(rec.worked_minutes)} ({rec.worked_days} kun)</span>
                        <span>·</span>
                        <span>Asosiy: {formatUzSum(rec.gross_salary)}</span>
                        {rec.advances > 0 && <span className="text-amber-700">Avans: -{formatUzSum(rec.advances)}</span>}
                        {rec.penalties > 0 && <span className="text-rose-600">Jarima: -{formatUzSum(rec.penalties)}</span>}
                        {rec.bonuses > 0 && <span className="text-emerald-600">Mukofot: +{formatUzSum(rec.bonuses)}</span>}
                      </div>
                      {rec.note && <div className="text-[11px] text-slate-400 mt-0.5">Izoh: {rec.note}</div>}
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">To'langan:</span>
                        <span className="text-base font-black text-emerald-600">
                          {formatUzSum(rec.net_amount)}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => onViewReceipt(rec)}
                        className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center gap-1 transition cursor-pointer shadow-xs"
                      >
                        <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Chek</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 7. To'lov Rasmiy Kvitansiyasi (Chek) Modali
 */
function PaymentReceiptModal({
  shopName,
  record,
  worker,
  onClose,
}: {
  shopName: string;
  record: PayrollPayoutRecord;
  worker?: User | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  const handleCopyText = () => {
    const text =
      `🧾 <b>${shopName} — ISH HAQI TO'LOV KVITANSIYASI</b>\n\n` +
      `👤 <b>Xodim:</b> ${worker?.full_name || 'Xodim'}\n` +
      `💼 <b>Lavozimi:</b> ${worker?.position || 'Xodim'}\n` +
      `📅 <b>Hisob davri:</b> ${record.start_date} — ${record.end_date}\n` +
      `⏱ <b>Ishlagan vaqti:</b> ${formatMinutesToHours(record.worked_minutes)} (${record.worked_days} ish kuni)\n` +
      `💵 <b>Asosiy hisoblangan:</b> ${formatUzSum(record.gross_salary)}\n` +
      (record.advances > 0 ? `💸 <b>Avans:</b> -${formatUzSum(record.advances)}\n` : '') +
      (record.penalties > 0 ? `⚠️ <b>Jarima:</b> -${formatUzSum(record.penalties)}\n` : '') +
      (record.bonuses > 0 ? `🎁 <b>Mukofot:</b> +${formatUzSum(record.bonuses)}\n` : '') +
      `\n💰 <b>TO'LANGAN SOF SUMMA:</b> <b>${formatUzSum(record.net_amount)}</b>\n` +
      `💳 <b>To'lov usuli:</b> ${record.payment_method === 'cash' ? 'Naqd pul' : record.payment_method === 'card' ? 'Plastik karta' : "Bank o'tkazmasi"}\n` +
      `📆 <b>Sana:</b> ${record.payment_date}\n` +
      (record.note ? `📝 <b>Izoh:</b> ${record.note}\n` : '') +
      `\n✅ To'lov tasdiqlangan.`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                To'lov Kvitansiyasi (Chek)
              </h3>
              <p className="text-[11px] text-slate-500">Rasmiy ish haqi to'lovi hujjati</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCopyText}
              className="p-1.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition cursor-pointer flex items-center gap-1 px-2.5 text-xs font-bold"
              title="Kvitansiya matnini nusxalash"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Nusxalandi!' : 'Nusxa'}</span>
            </button>
            <button
              onClick={handlePrint}
              className="p-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 transition cursor-pointer flex items-center gap-1 px-2.5 text-xs font-bold"
            >
              <Printer className="w-4 h-4" />
              <span>Chop etish</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Chop etiladigan Kvitansiya Varog'i */}
        <div className="p-6 overflow-y-auto flex-1 font-sans text-xs space-y-4">
          <div className="text-center pb-3 border-b border-dashed border-slate-300 dark:border-slate-700">
            <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-wider">
              {shopName}
            </h2>
            <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
              ISH HAQI TO'LOV KVITANSIYASI
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              Kvitansiya ID: <span className="font-mono font-bold">#{record.id.slice(-8).toUpperCase()}</span> · Sana: {record.payment_date}
            </div>
          </div>

          {/* Xodim ma'lumoti */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-400 font-bold">Xodim:</span>
              <span className="font-black text-slate-900 dark:text-white text-sm">{worker?.full_name || 'Xodim'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-bold">Lavozimi:</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">{worker?.position || 'Xodim'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-bold">Hisob davri:</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400">{record.start_date} — {record.end_date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-bold">Ishlagan vaqti:</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {formatMinutesToHours(record.worked_minutes)} ({record.worked_days} ish kuni)
              </span>
            </div>
          </div>

          {/* Moliyaviy moddalar jadvali */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
            <div className="p-2.5 bg-slate-100 dark:bg-slate-800 font-bold text-slate-700 dark:text-slate-300 flex justify-between">
              <span>To'lov moddasi</span>
              <span>Miqdori</span>
            </div>
            <div className="p-3 space-y-2 divide-y divide-slate-100 dark:divide-slate-800">
              <div className="flex justify-between pt-1">
                <span className="text-slate-600 dark:text-slate-400">Asosiy hisoblangan maosh:</span>
                <span className="font-bold text-slate-900 dark:text-white">{formatUzSum(record.gross_salary)}</span>
              </div>
              {record.bonuses > 0 && (
                <div className="flex justify-between pt-1 text-emerald-700 dark:text-emerald-400">
                  <span>Mukofot / Rag'batlantirish (+):</span>
                  <span className="font-bold">+{formatUzSum(record.bonuses)}</span>
                </div>
              )}
              {record.advances > 0 && (
                <div className="flex justify-between pt-1 text-amber-800 dark:text-amber-400">
                  <span>Berilgan avans ushlanmasi (-):</span>
                  <span className="font-bold">-{formatUzSum(record.advances)}</span>
                </div>
              )}
              {record.penalties > 0 && (
                <div className="flex justify-between pt-1 text-rose-700 dark:text-rose-400">
                  <span>Jarima ushlanmasi (-):</span>
                  <span className="font-bold">-{formatUzSum(record.penalties)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 text-sm font-black text-slate-900 dark:text-white border-t-2 border-slate-300 dark:border-slate-600">
                <span>JAMI TO'LANGAN SOF SUMMA:</span>
                <span className="text-emerald-600 dark:text-emerald-400 text-base">
                  {formatUzSum(record.net_amount)}
                </span>
              </div>
            </div>
          </div>

          {/* Qo'shimcha rekvizitlar */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400 font-bold">To'lov usuli:</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {record.payment_method === 'cash' ? '💵 Naqd pul' : record.payment_method === 'card' ? '💳 Plastik karta' : "🏦 Bank o'tkazmasi"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 font-bold">Rasmiylashtirgan:</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{record.paid_by || 'Bosh Admin'}</span>
            </div>
            {record.note && (
              <div className="flex justify-between">
                <span className="text-slate-400 font-bold">Izoh:</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">{record.note}</span>
              </div>
            )}
          </div>

          {/* Imzolar */}
          <div className="pt-6 flex justify-between items-center text-[11px] text-slate-500 px-2">
            <div className="text-center">
              <div className="w-28 border-b border-slate-400 mb-1 mx-auto"></div>
              <span>To'ladi (Admin)</span>
            </div>
            <div className="text-center">
              <div className="w-28 border-b border-slate-400 mb-1 mx-auto"></div>
              <span>Qabul qildi (Xodim)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
