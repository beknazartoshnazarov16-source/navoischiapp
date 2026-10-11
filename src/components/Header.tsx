import React from 'react';
import { MarketSettings, User } from '../types';
import { NavoLogo } from './NavoLogo';
import { isUserAuthorizedForPayroll } from '../utils/adminAuth';
import {
  Users,
  Clock,
  BarChart3,
  Smartphone,
  Bot,
  Settings,
  UserCheck,
  RotateCcw,
  Repeat,
  Lock,
  Unlock,
  Cloud,
  CheckCircle2,
  Crown,
  LogOut,
  Bell,
  Trophy,
  Sun,
  Moon,
} from 'lucide-react';

interface HeaderProps {
  settings: MarketSettings;
  currentUser: User;
  isAdmin: boolean;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLockAdmin?: () => void;
  onRequestAdminLogin?: () => void;
  onLogout?: () => void;
  isCloudConnected?: boolean;
  onOpenInstallModal?: () => void;
  verifiedAdminTgId?: string | null;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export function Header({
  settings,
  currentUser,
  isAdmin,
  activeTab,
  setActiveTab,
  onLockAdmin,
  onRequestAdminLogin,
  onLogout,
  isCloudConnected = true,
  onOpenInstallModal,
  verifiedAdminTgId,
  theme = 'light',
  onToggleTheme,
}: HeaderProps) {
  // Faqatgina usha Telegram ID si bor odam kura oladi, boshqalarga (hatto adminga ham) UMUMAN KO'RINMAYDI!
  const isPayrollAuthorized = isUserAuthorizedForPayroll(
    currentUser,
    verifiedAdminTgId,
    settings
  );
  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 shadow-xs transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo va Do'kon nomi */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <NavoLogo size="sm" showText={true} />
            <div className="min-w-0 pl-1 border-l border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-1.5">
                {isAdmin ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-700 shrink-0">
                    <Crown className="w-3 h-3 text-amber-600 dark:text-amber-400 fill-amber-600 dark:fill-amber-400" />
                    <span>Admin</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Xodim</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* O'ng tomon: Rejim tugmasi, Ilovani o'rnatish va Foydalanuvchi ma'lumoti */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* 🌙 / ☀️ Kunduzgi / Qorong'u rejim o'tkazgich */}
            {onToggleTheme && (
              <button
                type="button"
                onClick={onToggleTheme}
                title={theme === 'dark' ? "Kunduzgi rejimga o'tish" : "Qorong'u rejimga o'tish"}
                className="p-2 sm:px-2.5 sm:py-1.5 flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-amber-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer text-xs font-bold"
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className="w-4 h-4 text-amber-400 fill-amber-400" />
                    <span className="hidden sm:inline text-amber-200">Kunduzgi</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-4 h-4 text-slate-600" />
                    <span className="hidden sm:inline text-slate-700">Qorong'u</span>
                  </>
                )}
              </button>
            )}

            {onOpenInstallModal && (
              <button
                type="button"
                onClick={onOpenInstallModal}
                title="Ilovani telefoningizga o'rnatish"
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-xl border border-emerald-200 dark:border-emerald-800 transition cursor-pointer shadow-2xs group"
              >
                <Smartphone className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                <span className="hidden sm:inline">Ilovani o'rnatish</span>
                <span className="sm:hidden">Ilova</span>
              </button>
            )}

            {isAdmin ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200/80 rounded-2xl px-3 py-1.5">
                  <div className="w-7 h-7 rounded-xl bg-amber-500 text-white font-black text-xs flex items-center justify-center shrink-0 shadow-2xs">
                    <Crown className="w-4 h-4 fill-white" />
                  </div>
                  <div className="text-left hidden sm:block">
                    <div className="text-xs font-black text-slate-900 leading-none">
                      {currentUser.full_name}
                    </div>
                    <div className="text-[10px] text-amber-800 font-semibold mt-0.5">Admin</div>
                  </div>
                </div>

                {onLockAdmin && (
                  <button
                    onClick={onLockAdmin}
                    title="Admin paneldan chiqish"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 hover:text-rose-700 bg-slate-100 hover:bg-rose-50 rounded-xl border border-slate-200 hover:border-rose-200 transition cursor-pointer"
                  >
                    <span>Chiqish</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-2.5 sm:px-3 py-1.5 shadow-2xs"
                >
                  <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-[#00a651] to-[#008f45] text-white font-black text-xs flex items-center justify-center shrink-0 shadow-2xs">
                    {currentUser.full_name ? currentUser.full_name.charAt(0) : 'X'}
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-black text-slate-900 leading-none truncate max-w-[100px] sm:max-w-[160px]">
                      {currentUser.full_name || 'Xodim'}
                    </div>
                    <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                      {currentUser.position || 'Xodim'}
                    </div>
                  </div>
                </div>

                {onLogout && (
                  <button
                    onClick={onLogout}
                    title="Tizimdan chiqish"
                    className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-slate-700 hover:text-rose-700 bg-slate-100 hover:bg-rose-50 rounded-xl border border-slate-200 hover:border-rose-200 transition cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-600" />
                    <span className="hidden sm:inline">Chiqish</span>
                  </button>
                )}

                {onRequestAdminLogin && (
                  <button
                    onClick={onRequestAdminLogin}
                    title="Do'kon boshqaruviga (Admin) kirish"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100 rounded-xl border border-amber-200 transition cursor-pointer shadow-2xs"
                  >
                    <Crown className="w-3.5 h-3.5 text-amber-600 fill-amber-600" />
                    <span className="hidden sm:inline">Admin</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Asosiy Navigatsiya Menyusi (Kompyuter va planshet uchun) */}
        <div className="hidden md:flex items-center gap-1 overflow-x-auto py-2 border-t border-slate-100 no-scrollbar">
          {isAdmin ? (
            /* ADMIN TABS: Faqat haqiqiy adminga ko'rinadi */
            <>
              <button
                onClick={() => setActiveTab('workers')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === 'workers'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>👥 Ishchilar</span>
              </button>

              <button
                onClick={() => setActiveTab('attendance')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === 'attendance'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Clock className="w-4 h-4" />
                <span>⏱ Davomat Jurnali</span>
              </button>

              <button
                onClick={() => setActiveTab('monthly_report')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === 'monthly_report'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>📊 Oylik Hisobot</span>
              </button>

              {(isPayrollAuthorized || isAdmin) && (
                <button
                  onClick={() => setActiveTab('payroll')}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${
                    activeTab === 'payroll'
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-xs'
                      : 'text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'
                  }`}
                  title="Maxfiy buxgalteriya va oylik hisob-kitobi"
                >
                  <Lock className="w-3.5 h-3.5 text-emerald-600" />
                  <span>💰 Oylik (Maxfiy)</span>
                </button>
              )}

              <button
                onClick={() => setActiveTab('kpi_rating')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === 'kpi_rating'
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-xs'
                    : 'text-amber-800 bg-amber-50/70 hover:bg-amber-100/80'
                }`}
              >
                <Trophy className="w-4 h-4 text-amber-500" />
                <span>🏆 KPI Reyting</span>
              </button>

              <button
                onClick={() => setActiveTab('reminders')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === 'reminders'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-amber-800 bg-amber-50 hover:bg-amber-100'
                }`}
              >
                <Bell className="w-4 h-4" />
                <span>🔔 Eslatmalar</span>
              </button>

              <button
                onClick={() => setActiveTab('admins')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === 'admins'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-amber-800 bg-amber-50/70 hover:bg-amber-100/70'
                }`}
              >
                <Crown className="w-4 h-4 fill-current" />
                <span>👑 Adminlar Boshqaruvi</span>
              </button>

              <button
                onClick={() => setActiveTab('settings')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === 'settings'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span>⚙️ Sozlamalar</span>
              </button>

              <button
                onClick={() => setActiveTab('telegram_guide')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === 'telegram_guide'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-sky-700 bg-sky-50 hover:bg-sky-100'
                }`}
              >
                <Bot className="w-4 h-4" />
                <span>🤖 Bot Kodu</span>
              </button>

              <button
                onClick={() => setActiveTab('bot_screen')}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ml-auto cursor-pointer ${
                  activeTab === 'bot_screen'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
                title="Admin sifatida ishchi ekranini sinab ko'rish"
              >
                <Smartphone className="w-4 h-4" />
                <span>📱 Ishchi ekrani (Test)</span>
              </button>
            </>
          ) : (
            /* ISHCHI TABS: Faqat ishchiga kerakli 2 ta bo'lim, hech qanday admin paneli ko'rinmaydi */
            <>
              <button
                onClick={() => setActiveTab('bot_screen')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === 'bot_screen'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                <span>📍 Ishga Keldim / Ketdim</span>
              </button>

              <button
                onClick={() => setActiveTab('my_hours')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === 'my_hours'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Clock className="w-4 h-4" />
                <span>⏱ Mening Oylik Soatlarim</span>
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
