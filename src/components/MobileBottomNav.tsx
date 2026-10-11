import React from 'react';
import { User } from '../types';
import {
  Users,
  Clock,
  BarChart3,
  Smartphone,
  Settings,
  Crown,
  UserCheck,
  LogOut,
  Bell,
  Trophy,
  DollarSign,
} from 'lucide-react';
import { triggerHaptic } from '../utils/telegram';

interface MobileBottomNavProps {
  currentUser: User;
  isAdmin: boolean;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onRequestAdminLogin?: () => void;
  onLogout?: () => void;
  verifiedAdminTgId?: string | null;
  payrollAdminId?: string;
  isPayrollAuthorized?: boolean;
}

export function MobileBottomNav({
  currentUser,
  isAdmin,
  activeTab,
  setActiveTab,
  onRequestAdminLogin,
  onLogout,
  verifiedAdminTgId,
  payrollAdminId = '45701569',
  isPayrollAuthorized,
}: MobileBottomNavProps) {
  const handleTabClick = (tabId: string) => {
    triggerHaptic('light');
    if (tabId === 'logout') {
      if (onLogout) onLogout();
      return;
    }
    if (tabId === 'admin_login') {
      if (onRequestAdminLogin) onRequestAdminLogin();
      return;
    }
    setActiveTab(tabId);
  };

  const userTg = String(currentUser?.telegram_id || '').trim();
  const verifiedTg = String(verifiedAdminTgId || '').trim();
  const explicitId = (payrollAdminId || '').trim();

  const hasPayrollAccess = true;

  const navItems = isAdmin
    ? [
        { id: 'workers', label: 'Ishchilar', icon: Users },
        { id: 'attendance', label: 'Davomat', icon: Clock },
        { id: 'payroll', label: 'Oylik', icon: DollarSign },
        { id: 'monthly_report', label: 'Hisobot', icon: BarChart3 },
        { id: 'kpi_rating', label: 'KPI', icon: Trophy },
        { id: 'settings', label: 'Sozlama', icon: Settings },
      ]
    : [
        { id: 'bot_screen', label: 'Davomat', icon: Smartphone },
        { id: 'my_hours', label: 'Soatlarim', icon: Clock },
        { id: 'admin_login', label: 'Admin', icon: Crown },
        { id: 'logout', label: 'Chiqish', icon: LogOut },
      ];

  return (
    <nav
      id="mobile-bottom-nav"
      aria-label="Mobil navigatsiya"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 shadow-lg px-2 pb-safe"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
    >
      <div className="flex items-center justify-around h-15 max-w-md mx-auto pt-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              id={`nav-btn-${item.id}`}
              onClick={() => handleTabClick(item.id)}
              className={`flex flex-col items-center justify-center flex-1 py-1 px-1 rounded-xl transition-all select-none active:scale-95 cursor-pointer ${
                isActive
                  ? item.id === 'admins'
                    ? 'text-amber-600 dark:text-amber-400 font-bold'
                    : 'text-emerald-600 dark:text-emerald-400 font-bold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-normal'
              }`}
            >
              <div
                className={`p-1 rounded-lg transition-colors ${
                  isActive
                    ? item.id === 'admins'
                      ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                    : ''
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] mt-0.5 leading-none truncate max-w-[65px]">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
