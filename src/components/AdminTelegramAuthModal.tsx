import React, { useState } from 'react';
import { MarketSettings, User } from '../types';
import { isUserAdminByTelegramId, getAllAdminIds } from '../utils/adminAuth';
import { ShieldCheck, Lock, AlertCircle, X, HelpCircle, ArrowRight, KeyRound, Smartphone } from 'lucide-react';
import { triggerHaptic } from '../utils/telegram';

interface AdminTelegramAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: MarketSettings;
  users: User[];
  onSuccess: (verifiedTgId: string) => void;
}

export function AdminTelegramAuthModal({
  isOpen,
  onClose,
  settings,
  users,
  onSuccess,
}: AdminTelegramAuthModalProps) {
  const [authMode, setAuthMode] = useState<'pin' | 'tg_id'>('tg_id');
  const [tgIdInput, setTgIdInput] = useState('');
  const [tgSecretPin, setTgSecretPin] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentPin = (settings.admin_pin || '7207').trim();
  const currentPayrollPin = (settings.payroll_master_pin || '9009').trim();
  const existingAdmins = getAllAdminIds(settings, users);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (authMode === 'pin') {
      const cleanPin = pinInput.trim();
      if (!cleanPin) {
        setError('Iltimos, PIN-kodni kiriting!');
        triggerHaptic('error');
        return;
      }
      if (cleanPin === currentPin) {
        triggerHaptic('success');
        onSuccess('PIN_VERIFIED_ADMIN');
        onClose();
        return;
      } else {
        triggerHaptic('error');
        setError("Noto'g'ri PIN-kod! Qaytadan urinib ko'ring.");
        return;
      }
    } else {
      const cleanId = tgIdInput.trim();
      const enteredSecretPin = tgSecretPin.trim();

      if (!cleanId) {
        setError('Iltimos, Telegram ID raqamingizni kiriting!');
        triggerHaptic('error');
        return;
      }

      if (!enteredSecretPin) {
        setError("Xavfsizlik: Iltimos, Telegram ID bilan birga Admin PIN-kodini ham kiriting!");
        triggerHaptic('error');
        return;
      }

      if (enteredSecretPin !== currentPin && enteredSecretPin !== currentPayrollPin) {
        setError("❌ Noto'g'ri PIN-kod! Telegram ID egasi ekanligingiz tasdiqlanmadi.");
        triggerHaptic('error');
        return;
      }

      // Maxfiy Oylik bo'limi uchun sozlangan Telegram ID tekshiruvi
      const targetPayrollId = String(settings.payroll_admin_id || '45701569').trim();
      if (cleanId === targetPayrollId) {
        triggerHaptic('success');
        onSuccess(cleanId);
        onClose();
        return;
      }

      // Agar bazada hali birorta ham admin bo'lmasa, birinchi kiritgan shaxs admin bo'ladi
      if (existingAdmins.length === 0) {
        triggerHaptic('success');
        onSuccess(cleanId);
        onClose();
        return;
      }

      const isValid = isUserAdminByTelegramId(cleanId, settings, users);
      if (isValid) {
        triggerHaptic('success');
        onSuccess(cleanId);
        onClose();
      } else {
        triggerHaptic('error');
        setError("❌ Ruxsat berilmadi! Ushbu Telegram ID adminlar ro'yxatida topilmadi.");
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-slate-200 relative overflow-hidden">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center pt-2">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 flex items-center justify-center mx-auto mb-3 shadow-2xs">
            <Lock className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-black text-slate-900">Admin Panelga Kirish</h2>
          <p className="text-xs text-slate-500 mt-1.5 px-4 leading-relaxed">
            Do'kon sozlamalari, barcha xodimlar va davomatni boshqarish uchun admin sifatida tasdiqlang.
          </p>
        </div>

        {/* Kirish usuli tablari */}
        <div className="flex bg-slate-100 p-1 rounded-2xl mt-5">
          <button
            type="button"
            onClick={() => {
              setAuthMode('pin');
              setError(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
              authMode === 'pin'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5 text-amber-600" />
            <span>Admin PIN-kod</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode('tg_id');
              setError(null);
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
              authMode === 'tg_id'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
            <span>Telegram ID</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {authMode === 'pin' ? (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                <span>Maxsus PIN-kod:</span>
                <span className="text-[10px] text-slate-400 font-normal">🔒 Maxfiy</span>
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="••••"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  setError(null);
                }}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xl font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 transition text-center tracking-widest"
                autoFocus
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>Telegram ID raqamingiz:</span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">Botda /id</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Telegram ID raqamingizni kiriting..."
                  value={tgIdInput}
                  onChange={(e) => {
                    setTgIdInput(e.target.value);
                    setError(null);
                  }}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-base font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 transition text-center tracking-wider"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>Admin PIN-kod (Tasdiqlash):</span>
                  <span className="text-[10px] text-amber-600 font-bold">🔒 Majburiy</span>
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="••••"
                  value={tgSecretPin}
                  onChange={(e) => {
                    setTgSecretPin(e.target.value);
                    setError(null);
                  }}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-base font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 transition text-center tracking-widest"
                />
                <p className="text-[10px] text-slate-400 mt-1 text-center">
                  Xavfsizlik: Begona shaxslar faqat ID yozib kirishining oldi olingan.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-3 bg-amber-50/70 border border-amber-200/60 rounded-xl text-[11px] text-amber-900 flex items-start gap-2">
            <HelpCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              {authMode === 'pin' ? (
                <>Admin PIN-kod orqali faqat do'kon rahbari tizim boshqaruviga kira oladi.</>
              ) : (
                <>Telegram ID raqamingizni bilish uchun Telegram botga kirib <b><code>/id</code></b> deb yozing.</>
              )}
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 active:scale-98 text-white font-bold rounded-2xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer text-sm"
          >
            <span>Tasdiqlash va Kirish</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
