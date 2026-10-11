import React, { useState, useEffect, useMemo } from 'react';
import { User, MarketSettings } from '../types';
import { NavoLogo } from './NavoLogo';
import {
  Users,
  KeyRound,
  Crown,
  UserPlus,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Delete,
  Search,
  ArrowLeft,
  Sparkles,
  ShoppingCart,
  ShoppingBag,
  Store,
  Package,
  Smartphone,
  DollarSign,
  Shield,
  Lock,
  Sun,
  Moon,
} from 'lucide-react';
import { triggerHaptic } from '../utils/telegram';
import { verifyWorkerPin, findUserByPhone } from '../utils/userAuth';
import { isUserAdminByTelegramId } from '../utils/adminAuth';
import supermarketBg from '../assets/images/supermarket_bg_1790789695444.jpg';

interface LoginScreenProps {
  users: User[];
  settings: MarketSettings;
  onWorkerLogin: (user: User, linkTelegram?: boolean) => void;
  onAdminLogin: (directTgId?: string) => void;
  onOpenRegister: () => void;
  inTelegram?: boolean;
  telegramUser?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  } | null;
  onOpenInstallModal?: () => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export function LoginScreen({
  users,
  settings,
  onWorkerLogin,
  onAdminLogin,
  onOpenRegister,
  inTelegram = false,
  telegramUser,
  onOpenInstallModal,
  theme = 'light',
  onToggleTheme,
}: LoginScreenProps) {
  const [activeTab, setActiveTab] = useState<'worker' | 'admin'>('worker');
  const [selectedWorker, setSelectedWorker] = useState<User | null>(null);
  const [pinCode, setPinCode] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [adminAuthType, setAdminAuthType] = useState<'pin' | 'tg_id'>('tg_id');
  const [adminTgIdInput, setAdminTgIdInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [linkTelegram, setLinkTelegram] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const workers = useMemo(
    () => users.filter((u) => u.role === 'worker' && u.is_active !== false),
    [users]
  );

  const filteredWorkers = useMemo(() => {
    if (!searchQuery.trim()) return workers;
    const q = searchQuery.toLowerCase().trim();
    return workers.filter(
      (w) =>
        w.full_name.toLowerCase().includes(q) ||
        (w.phone && w.phone.replace(/\D/g, '').includes(q)) ||
        (w.position && w.position.toLowerCase().includes(q))
    );
  }, [workers, searchQuery]);

  // Desktop klaviatura orqali kiritish
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTab === 'admin' && adminAuthType === 'tg_id') {
        // ID yozish vaqtida klaviatura to'sqinlik qilmasin
        return;
      }
      if (e.key >= '0' && e.key <= '9') {
        handleKeypadPress(e.key);
      } else if (e.key === 'Backspace') {
        handleKeypadDelete();
      } else if (e.key === 'Escape') {
        handleKeypadClear();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, adminAuthType, selectedWorker, pinCode, adminPin]);

  const [adminTgSecretPin, setAdminTgSecretPin] = useState('');

  // Telegram ID orqali admin va oylikka kirish (Xavfsiz: begona shaxslar faqat ID yozib kira olmaydi)
  const handleAdminTgIdLogin = (idToUse?: string) => {
    const cleanId = (idToUse || adminTgIdInput).trim();
    if (!cleanId) {
      setError("Iltimos, Telegram ID raqamingizni kiriting!");
      triggerHaptic('error');
      return;
    }

    // Agar Telegram WebApp ichida bo'lmasa, do'kon Admin PIN-kodi bilan qo'shimcha tasdiqlanadi
    if (!inTelegram) {
      const enteredPin = adminTgSecretPin.trim();
      const validAdminPin = (settings.admin_pin || '7207').trim();
      const validPayrollPin = (settings.payroll_master_pin || '9009').trim();

      if (!enteredPin) {
        setError("Xavfsizlik: Iltimos, Telegram ID bilan birga Admin PIN-kodini ham kiriting!");
        triggerHaptic('error');
        return;
      }

      if (enteredPin !== validAdminPin && enteredPin !== validPayrollPin) {
        setError("❌ Noto'g'ri Admin PIN kod! Telegram ID egasi ekanligingiz tasdiqlanmadi.");
        triggerHaptic('error');
        return;
      }
    }

    // Maxfiy Oylik bo'limi uchun sozlangan Telegram ID tekshiruvi (Faqat yagona mas'ul admin)
    const explicitPayrollId = (settings.payroll_admin_id || '').trim();
    const isTargetPayroll = explicitPayrollId ? cleanId === explicitPayrollId : cleanId === '45701569';
    if (isTargetPayroll) {
      triggerHaptic('success');
      setError(null);
      onAdminLogin(cleanId);
      return;
    }

    const isValid = isUserAdminByTelegramId(cleanId, settings, users);
    if (isValid) {
      triggerHaptic('success');
      setError(null);
      onAdminLogin(cleanId);
    } else {
      triggerHaptic('error');
      setError("❌ Ruxsat berilmadi! Ushbu Telegram ID adminlar ro'yxatida topilmadi.");
    }
  };

  // Worker PIN tekshirish
  const verifyWorker = (worker: User, pinToTest: string) => {
    setIsVerifying(true);
    const isValid = verifyWorkerPin(worker, pinToTest);
    if (!isValid) {
      triggerHaptic('error');
      setError("PIN-kod noto'g'ri! Iltimos, qaytadan urinib ko'ring.");
      setPinCode('');
      setIsVerifying(false);
      return;
    }

    triggerHaptic('success');
    setIsVerifying(false);
    onWorkerLogin(worker, linkTelegram);
  };

  // Admin PIN tekshirish (Oddiy Admin kirishi — Oylik ko'rinmaydi)
  const verifyAdmin = (pinToTest: string) => {
    setIsVerifying(true);
    const cleanEntered = pinToTest.trim();
    const adminPin = (settings.admin_pin || '7207').trim();

    if (cleanEntered === adminPin) {
      triggerHaptic('success');
      setIsVerifying(false);
      onAdminLogin(); // PIN bilan kirganda oddiy admin paneli ochiladi, oylik emas
      return;
    }

    triggerHaptic('error');
    setError("Noto'g'ri Admin PIN kod! Qaytadan urinib ko'ring.");
    setAdminPin('');
    setIsVerifying(false);
  };

  // Raqam tugmachalari orqali PIN kiritish
  const handleKeypadPress = (digit: string) => {
    triggerHaptic('light');
    setError(null);

    if (activeTab === 'worker') {
      if (!selectedWorker) return;
      if (pinCode.length < 4) {
        const nextPin = pinCode + digit;
        setPinCode(nextPin);
        if (nextPin.length === 4) {
          verifyWorker(selectedWorker, nextPin);
        }
      }
    } else {
      if (adminPin.length < 4) {
        const nextPin = adminPin + digit;
        setAdminPin(nextPin);
        if (nextPin.length === 4) {
          verifyAdmin(nextPin);
        }
      }
    }
  };

  const handleKeypadDelete = () => {
    triggerHaptic('light');
    setError(null);
    if (activeTab === 'worker') {
      setPinCode((prev) => prev.slice(0, -1));
    } else {
      setAdminPin((prev) => prev.slice(0, -1));
    }
  };

  const handleKeypadClear = () => {
    triggerHaptic('light');
    setError(null);
    if (activeTab === 'worker') {
      setPinCode('');
    } else {
      setAdminPin('');
    }
  };

  // Lavozim belgisini aniqlash (Supermarket rollari)
  const getRoleBadge = (positionStr?: string) => {
    const pos = (positionStr || '').toLowerCase();
    if (pos.includes('sotuv') || pos.includes('kass')) {
      return {
        label: positionStr || 'Sotuvchi',
        icon: <ShoppingCart className="w-3 h-3 text-emerald-600" />,
        className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      };
    }
    if (pos.includes('prixod') || pos.includes('ombor')) {
      return {
        label: positionStr || 'Prixod',
        icon: <Package className="w-3 h-3 text-indigo-600" />,
        className: 'bg-indigo-50 text-indigo-800 border-indigo-200',
      };
    }
    if (pos.includes('admin') || pos.includes('boshqar')) {
      return {
        label: positionStr || 'Boshqaruvchi',
        icon: <Crown className="w-3 h-3 text-amber-600" />,
        className: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    }
    return {
      label: positionStr || 'Xodim',
      icon: <Users className="w-3 h-3 text-slate-500" />,
      className: 'bg-slate-100 text-slate-700 border-slate-200',
    };
  };

  // Raqamlar klaviaturasi tugmachalari (POS uslubida harflar bilan)
  const keypadButtons = [
    { num: '1', sub: ' ' },
    { num: '2', sub: 'ABC' },
    { num: '3', sub: 'DEF' },
    { num: '4', sub: 'GHI' },
    { num: '5', sub: 'JKL' },
    { num: '6', sub: 'MNO' },
    { num: '7', sub: 'PQRS' },
    { num: '8', sub: 'TUV' },
    { num: '9', sub: 'WXYZ' },
  ];

  return (
    <div
      className="min-h-screen relative text-slate-100 flex flex-col justify-between p-3.5 sm:p-6 overflow-x-hidden selection:bg-[#00a651] selection:text-white"
      style={{
        backgroundImage: `url(${supermarketBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Supermarket orqa foni ustidagi boyitilgan qora-yashil shaffof qatlam */}
      <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-[2px] bg-gradient-to-b from-slate-950/92 via-emerald-950/80 to-slate-950/95 pointer-events-none" />

      {/* Orqa fon nur effekti (Ambient lighting) */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-[#00a651]/20 rounded-full blur-3xl pointer-events-none -z-0"></div>
      <div className="fixed bottom-0 right-0 w-80 h-80 bg-amber-500/15 rounded-full blur-3xl pointer-events-none -z-0"></div>

      {/* Dekorativ do'kon suvi belgilari (Watermark) */}
      <div className="absolute top-12 left-10 text-emerald-400/[0.04] pointer-events-none hidden lg:block">
        <ShoppingCart className="w-48 h-48 -rotate-12" />
      </div>
      <div className="absolute bottom-16 right-12 text-emerald-400/[0.04] pointer-events-none hidden lg:block">
        <Store className="w-56 h-56 rotate-6" />
      </div>

      {/* Yuqori brend maydoni: Navo Market Rasmiy Oq Lavhasi */}
      <header className="relative z-10 pt-2 pb-3 sm:pt-4 text-center max-w-md mx-auto w-full">
        {/* 🌙 / ☀️ Qorong'u va Kunduzgi rejim tugmasi */}
        {onToggleTheme && (
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={onToggleTheme}
              title={theme === 'dark' ? "Kunduzgi rejimga o'tish" : "Qorong'u rejimga o'tish"}
              className="px-3 py-1.5 rounded-2xl bg-white/15 hover:bg-white/25 active:scale-95 backdrop-blur-md border border-white/20 text-white transition cursor-pointer shadow-md flex items-center gap-1.5 text-xs font-bold"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-300 fill-amber-300" />
                  <span className="text-amber-200">Kunduzgi rejim</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-emerald-200" />
                  <span className="text-emerald-100">Qorong'u rejim</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Rasmiy Navo Market oq lavha (Signboard badge) */}
        <div className="inline-flex items-center justify-center mb-3">
          <NavoLogo
            size="lg"
            layout="horizontal"
            badge={true}
            className="hover:scale-102 transition-transform shadow-2xl"
          />
        </div>

        <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center justify-center gap-2">
          <span>Navo Market Tizimi</span>
        </h1>

        <div className="flex items-center justify-center gap-2 text-xs text-emerald-200/90 font-medium mt-1">
          <span className="inline-flex items-center gap-1 text-emerald-300">
            <Store className="w-3.5 h-3.5" />
            <span>Do'kon xodimlari va kassa davomati</span>
          </span>
          <span>·</span>
          <span className="text-emerald-400 font-semibold">08:00 — 20:00</span>
        </div>

        {inTelegram && telegramUser && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-[11px] text-white mt-2.5 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>
              Telegram: <b>{telegramUser.first_name}</b>
            </span>
          </div>
        )}
      </header>

      {/* Asosiy Markaziy Kirish Kartasi */}
      <main className="relative z-10 max-w-md w-full mx-auto my-auto py-2">
        {onOpenInstallModal && (
          <div className="mb-2 text-center">
            <button
              type="button"
              onClick={onOpenInstallModal}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/90 hover:bg-white text-emerald-950 border border-white/60 shadow-lg text-xs font-black backdrop-blur-md transition active:scale-95 cursor-pointer"
            >
              <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
              <span>📲 Ilovani Telefoningizga O'rnating</span>
            </button>
          </div>
        )}

        <div className="bg-white/98 backdrop-blur-md rounded-3xl p-5 sm:p-7 shadow-2xl shadow-emerald-950/40 border border-emerald-100/90 text-slate-800 animate-in fade-in zoom-in-95 duration-200">
          {/* Rejim tanlash: Xodim yoki Admin */}
          <div className="flex items-center p-1 bg-slate-100/90 rounded-2xl mb-5 border border-slate-200/60">
            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                setActiveTab('worker');
                setError(null);
                setPinCode('');
              }}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'worker'
                  ? 'bg-gradient-to-r from-[#00a651] to-[#008f45] text-white shadow-md'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Ishchi Kirish</span>
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                setActiveTab('admin');
                setError(null);
                setAdminPin('');
              }}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'admin'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-md'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Crown className="w-4 h-4" />
              <span>Admin Kirish</span>
            </button>
          </div>

          {/* Xato xabari ko'rinishi */}
          {error && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-2xl flex items-center gap-2 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span className="font-semibold">{error}</span>
            </div>
          )}

          {/* ======================================================== */}
          {/* 1. XODIM KIRISH BO'LIMI                                   */}
          {/* ======================================================== */}
          {activeTab === 'worker' && (
            <div>
              {!selectedWorker ? (
                /* 1-QADAM: Xodim o'z ismini tanlaydi */
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <label className="text-xs font-bold text-slate-700">
                      O'z ism-familiyangizni tanlang:
                    </label>
                    <span className="text-[11px] font-semibold text-slate-400">
                      {workers.length} ta xodim
                    </span>
                  </div>

                  {/* Qidiruv qatori */}
                  {workers.length > 4 && (
                    <div className="relative mb-3">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Ism yoki telefon bo'yicha qidirish..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-[#00a651] outline-none"
                      />
                    </div>
                  )}

                  {/* Ishchilar ro'yxati */}
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1 no-scrollbar mb-4">
                    {filteredWorkers.length === 0 ? (
                      <div className="text-center py-6 px-3 bg-slate-50 rounded-2xl border border-slate-200">
                        <Users className="w-8 h-8 text-slate-300 mx-auto mb-1.5" />
                        <p className="text-xs font-bold text-slate-600">
                          Xodim topilmadi
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Agar yangi bo'lsangiz, pastdagi tugma orqali ro'yxatdan o'ting
                        </p>
                      </div>
                    ) : (
                      filteredWorkers.map((w) => {
                        const badgeInfo = getRoleBadge(w.position);
                        return (
                          <button
                            key={w.id}
                            type="button"
                            onClick={() => {
                              triggerHaptic('light');
                              setSelectedWorker(w);
                              setPinCode('');
                              setError(null);
                            }}
                            className="w-full p-2.5 bg-slate-50/80 hover:bg-emerald-50/70 border border-slate-200/80 hover:border-emerald-300 rounded-2xl flex items-center justify-between text-left transition-all group cursor-pointer active:scale-98 shadow-2xs"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#00a651] to-[#008f45] text-white font-black text-sm flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 transition-transform">
                                {w.full_name.charAt(0)}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-emerald-700 truncate">
                                  {w.full_name}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-md border ${badgeInfo.className}`}
                                  >
                                    {badgeInfo.icon}
                                    <span>{badgeInfo.label}</span>
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="w-7 h-7 rounded-full bg-white border border-slate-200 group-hover:border-emerald-500 group-hover:bg-[#00a651] group-hover:text-white flex items-center justify-center text-slate-400 transition-colors shrink-0 shadow-2xs">
                              <ArrowRight className="w-3.5 h-3.5" />
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {/* Yangi xodim ro'yxatdan o'tishi */}
                  <div className="pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        onOpenRegister();
                      }}
                      className="w-full py-2.5 px-3 bg-emerald-50 hover:bg-emerald-100/80 text-emerald-800 border border-emerald-200 rounded-2xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <UserPlus className="w-4 h-4 text-[#00a651]" />
                      <span>+ Yangi xodim ro'yxatdan o'tish</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* 2-QADAM: Tanlangan xodim 4 xonali PIN kodini teradi */
                <div className="animate-in fade-in duration-150">
                  {/* Tanlangan xodim profili bosh qismi */}
                  <div className="flex items-center justify-between p-3 bg-emerald-50/80 border border-emerald-200 rounded-2xl mb-4">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#00a651] to-[#008f45] text-white font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
                        {selectedWorker.full_name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-black text-slate-900 truncate">
                          {selectedWorker.full_name}
                        </div>
                        <div className="text-[10px] text-emerald-700 font-semibold truncate">
                          {selectedWorker.position || 'Xodim'}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        setSelectedWorker(null);
                        setPinCode('');
                        setError(null);
                      }}
                      className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-900 bg-white px-2.5 py-1.5 rounded-xl border border-slate-200 hover:border-slate-300 transition cursor-pointer"
                    >
                      <ArrowLeft className="w-3 h-3" />
                      <span>O'zgartirish</span>
                    </button>
                  </div>

                  {/* 4 xonali PIN nuqtalari */}
                  <div className="flex flex-col items-center justify-center mb-4">
                    <label className="text-xs font-bold text-slate-700 mb-2">
                      Shaxsiy 4 xonali PIN kodingizni kiriting:
                    </label>

                    <div className="flex items-center gap-3">
                      {[0, 1, 2, 3].map((index) => {
                        const isFilled = index < pinCode.length;
                        return (
                          <div
                            key={index}
                            className={`w-4 h-4 rounded-full transition-all duration-150 ${
                              isFilled
                                ? 'bg-[#00a651] scale-110 shadow-sm'
                                : 'bg-slate-200'
                            }`}
                          />
                        );
                      })}
                    </div>

                    <p className="text-[11px] text-slate-400 mt-2 font-medium">
                      🔒 Shaxsiy 4 xonali PIN kodingizni kiriting
                    </p>
                  </div>

                  {/* POS Terminal uslubidagi Virtual Raqamlar Klaviaturasi */}
                  <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto mb-3">
                    {keypadButtons.map(({ num, sub }) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => handleKeypadPress(num)}
                        className="h-12 rounded-2xl bg-slate-50 hover:bg-emerald-50 active:bg-emerald-100 text-slate-800 border border-slate-200 hover:border-emerald-300 transition-all flex flex-col items-center justify-center shadow-2xs active:scale-95 cursor-pointer"
                      >
                        <span className="text-lg font-bold leading-none">{num}</span>
                        {sub.trim() && (
                          <span className="text-[8px] font-semibold text-slate-400 leading-none mt-0.5">
                            {sub}
                          </span>
                        )}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={handleKeypadClear}
                      className="h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold border border-slate-200 transition-all flex items-center justify-center cursor-pointer active:scale-95"
                    >
                      Tozalash
                    </button>
                    <button
                      type="button"
                      onClick={() => handleKeypadPress('0')}
                      className="h-12 rounded-2xl bg-slate-50 hover:bg-emerald-50 active:bg-emerald-100 text-slate-800 border border-slate-200 hover:border-emerald-300 transition-all flex flex-col items-center justify-center shadow-2xs active:scale-95 cursor-pointer"
                    >
                      <span className="text-lg font-bold leading-none">0</span>
                      <span className="text-[8px] font-semibold text-slate-400 leading-none mt-0.5">+</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleKeypadDelete}
                      className="h-12 rounded-2xl bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-600 border border-slate-200 transition-all flex items-center justify-center cursor-pointer active:scale-95"
                      title="O'chirish"
                    >
                      <Delete className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Telegram hisobiga biriktirish opsiyasi */}
                  {inTelegram && telegramUser && (
                    <label className="flex items-center justify-center gap-2 text-xs font-medium text-slate-600 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={linkTelegram}
                        onChange={(e) => setLinkTelegram(e.target.checked)}
                        className="rounded text-[#00a651] focus:ring-[#00a651] accent-[#00a651]"
                      />
                      <span>Telegram hisobimga eslab qolinsin</span>
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* 2. ADMIN KIRISH BO'LIMI                                   */}
          {/* ======================================================== */}
          {activeTab === 'admin' && (
            <div className="animate-in fade-in duration-150">
              <div className="flex flex-col items-center text-center mb-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shadow-2xs mb-2">
                  <Crown className="w-6 h-6 fill-amber-500 text-amber-600" />
                </div>
                <h3 className="text-base font-black text-slate-900">
                  Do'kon Boshqaruvi & Oylik
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Faqat do'kon ma'muri va Bosh Admin uchun
                </p>
              </div>

              {/* Kirish usuli: PIN-kod yoki Telegram ID */}
              <div className="flex bg-slate-100 p-1 rounded-2xl mb-4 border border-slate-200/60">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    setAdminAuthType('pin');
                    setError(null);
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    adminAuthType === 'pin'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                  <span>Admin PIN</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    setAdminAuthType('tg_id');
                    setError(null);
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    adminAuthType === 'tg_id'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Telegram ID</span>
                </button>
              </div>

              {adminAuthType === 'tg_id' ? (
                /* Telegram ID orqali kirish (Xavfsiz: brauzerda PIN bilan tasdiqlanadi) */
                <div className="space-y-3.5 pt-1">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                      <span>Telegram ID raqamingiz:</span>
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">Botda /id</span>
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Telegram ID raqamingizni kiriting"
                      value={adminTgIdInput}
                      onChange={(e) => {
                        setAdminTgIdInput(e.target.value);
                        setError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAdminTgIdLogin();
                        }
                      }}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-base font-mono font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none text-center"
                      autoFocus
                    />
                  </div>

                  {!inTelegram && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                        <span>Admin PIN-kod (Tasdiqlash):</span>
                        <span className="text-[10px] text-amber-600 font-bold">🔒 Majburiy</span>
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={8}
                        placeholder="••••"
                        value={adminTgSecretPin}
                        onChange={(e) => {
                          setAdminTgSecretPin(e.target.value);
                          setError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAdminTgIdLogin();
                          }
                        }}
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-base font-mono font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none text-center tracking-widest"
                      />
                      <p className="text-[10px] text-slate-400 mt-1 text-center">
                        Xavfsizlik: Begona shaxslar faqat ID yozib kirishining oldi olingan.
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => handleAdminTgIdLogin()}
                    className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold text-sm rounded-2xl shadow-md transition active:scale-98 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span>Tasdiqlash va Kirish</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                /* Admin PIN-kod orqali kirish (Virtual klaviatura) */
                <div>
                  <div className="flex flex-col items-center justify-center mb-4">
                    <label className="text-xs font-bold text-slate-700 mb-2">
                      Admin PIN-kodini kiriting:
                    </label>

                    <div className="flex items-center gap-3">
                      {[0, 1, 2, 3].map((index) => {
                        const isFilled = index < adminPin.length;
                        return (
                          <div
                            key={index}
                            className={`w-4 h-4 rounded-full transition-all duration-150 ${
                              isFilled
                                ? 'bg-amber-500 scale-110 shadow-sm'
                                : 'bg-slate-200'
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto mb-2">
                    {keypadButtons.map(({ num, sub }) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => handleKeypadPress(num)}
                        className="h-12 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 active:bg-amber-100 dark:active:bg-amber-900/60 text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-600 transition-all flex flex-col items-center justify-center shadow-2xs active:scale-95 cursor-pointer"
                      >
                        <span className="text-lg font-bold leading-none">{num}</span>
                        {sub.trim() && (
                          <span className="text-[8px] font-semibold text-slate-400 dark:text-slate-400 leading-none mt-0.5">
                            {sub}
                          </span>
                        )}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={handleKeypadClear}
                      className="h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold border border-slate-200 dark:border-slate-700 transition-all flex items-center justify-center cursor-pointer active:scale-95"
                    >
                      Tozalash
                    </button>
                    <button
                      type="button"
                      onClick={() => handleKeypadPress('0')}
                      className="h-12 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 active:bg-amber-100 dark:active:bg-amber-900/60 text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-600 transition-all flex flex-col items-center justify-center shadow-2xs active:scale-95 cursor-pointer"
                    >
                      <span className="text-lg font-bold leading-none">0</span>
                      <span className="text-[8px] font-semibold text-slate-400 dark:text-slate-400 leading-none mt-0.5">+</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleKeypadDelete}
                      className="h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-400 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all flex items-center justify-center cursor-pointer active:scale-95"
                      title="O'chirish"
                    >
                      <Delete className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Pastki qism: Xavfsizlik kafolati */}
      <footer className="relative z-10 text-center py-2.5 text-xs text-slate-300/80 font-medium">
        <div className="flex items-center justify-center gap-2">
          <span className="font-bold text-white">Navo Market</span>
          <span className="text-white/40">·</span>
          <span className="text-emerald-300">Xavfsiz Davomat & Ish Vaqti Tizimi</span>
        </div>
      </footer>
    </div>
  );
}
