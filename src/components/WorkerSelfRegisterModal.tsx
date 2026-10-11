import React, { useState } from 'react';
import { User } from '../types';
import { NavoLogo } from './NavoLogo';
import { Smartphone, UserCheck, ArrowRight, ShieldCheck, Phone, CheckCircle2 } from 'lucide-react';
import { triggerHaptic } from '../utils/telegram';

interface WorkerSelfRegisterModalProps {
  onRegister: (newUser: Omit<User, 'id'>) => void;
  onCancel?: () => void;
  telegramUser?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  } | null;
}

export function WorkerSelfRegisterModal({
  onRegister,
  onCancel,
  telegramUser,
}: WorkerSelfRegisterModalProps) {
  const initialName = telegramUser
    ? `${telegramUser.first_name || ''} ${telegramUser.last_name || ''}`.trim()
    : '';

  const [fullName, setFullName] = useState(initialName);
  const [phoneNumber, setPhoneNumber] = useState('+998 ');
  const [position, setPosition] = useState('Sotuvchi-kassir');
  const [pinCode, setPinCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const formatUzPhone = (input: string): string => {
    const digits = input.replace(/\D/g, '');
    let clean = digits;
    if (clean.startsWith('998')) {
      clean = clean.slice(3);
    }
    clean = clean.slice(0, 9); // 9 ta raqam (operator kodi + raqam)

    let formatted = '+998';
    if (clean.length > 0) {
      formatted += ' (' + clean.slice(0, 2);
    }
    if (clean.length >= 2) {
      formatted += ') ' + clean.slice(2, 5);
    }
    if (clean.length >= 5) {
      formatted += '-' + clean.slice(5, 7);
    }
    if (clean.length >= 7) {
      formatted += '-' + clean.slice(7, 9);
    }
    return formatted;
  };

  const handlePhoneChange = (val: string) => {
    setPhoneNumber(formatUzPhone(val));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = fullName.trim();
    if (!cleanName || cleanName.length < 3) {
      setError("Iltimos, to'liq ism-familiyangizni kiriting (kamida 3 ta harf)!");
      triggerHaptic('error');
      return;
    }

    const digitsOnly = phoneNumber.replace(/\D/g, '');
    if (digitsOnly.length < 12) {
      setError("Iltimos, telefon raqamingizni to'liq kiriting (masalan, +998 (90) 123-45-67)!");
      triggerHaptic('error');
      return;
    }

    const assignedPin = pinCode.trim().length >= 4 ? pinCode.trim() : digitsOnly.slice(-4);

    triggerHaptic('success');

    onRegister({
      full_name: cleanName,
      phone: phoneNumber.trim(),
      position: position || 'Xodim',
      role: 'worker',
      work_start_time: '08:00',
      work_end_time: '20:00',
      is_active: true,
      pin: assignedPin,
      telegram_id: telegramUser ? String(telegramUser.id) : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in overflow-y-auto">
      <div className="bg-white rounded-3xl p-5 sm:p-7 w-full max-w-sm border border-slate-200 shadow-2xl relative text-left my-auto">
        <div className="flex flex-col items-center text-center mb-4">
          <NavoLogo size="md" />
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 text-[11px] font-bold mt-2 border border-emerald-200">
            <UserCheck className="w-3.5 h-3.5 text-[#00a651]" />
            <span>Tezkor ro'yxatdan o'tish</span>
          </div>
          <h3 className="text-base sm:text-lg font-black text-slate-900 mt-2">
            Yangi ishchi ro'yxati
          </h3>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
            Hech qanday Google akkaunt yoki parol shart emas! Faqat ism va telefon raqamingizni kiriting:
          </p>
        </div>

        {error && (
          <div className="mb-4 p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Ism va familiyangiz:
            </label>
            <input
              type="text"
              required
              placeholder="Masalan: Ali Valiyev"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs sm:text-sm font-medium focus:ring-2 focus:ring-[#00a651] focus:border-transparent outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Telefon raqamingiz:
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="tel"
                required
                placeholder="+998 90 123 45 67"
                value={phoneNumber}
                onChange={(e) => handlePhoneChange(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2.5 border border-slate-300 rounded-xl text-xs sm:text-sm font-bold font-mono focus:ring-2 focus:ring-[#00a651] focus:border-transparent outline-none"
              />
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              SMS yoki tasdiqlash kodi kelmaydi, faqat hisobingizni bog'lash uchun.
            </span>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Lavozimingiz / Bo'lim:
            </label>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-xs sm:text-sm font-medium focus:ring-2 focus:ring-[#00a651] outline-none bg-white"
            >
              <option value="Sotuvchi-kassir">Sotuvchi-kassir</option>
              <option value="Katta sotuvchi">Katta sotuvchi</option>
              <option value="Omborchi">Omborchi</option>
              <option value="Yuk tashuvchi">Yuk tashuvchi</option>
              <option value="Operator">Operator</option>
              <option value="Tozalik xodimi">Tozalik xodimi</option>
              <option value="Xodim">Boshqa xodim</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Shaxsiy 4 xonali PIN kod (ixtiyoriy):
            </label>
            <input
              type="password"
              maxLength={6}
              placeholder="4 xonali maxfiy kod"
              value={pinCode}
              onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ''))}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs sm:text-sm font-medium focus:ring-2 focus:ring-[#00a651] outline-none"
            />
            <span className="text-[10px] text-slate-400 mt-1 block">
              Profilingizga faqat o'zingiz kirishingiz uchun xizmat qiladi.
            </span>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-3 px-4 bg-gradient-to-r from-[#00a651] to-[#008f45] hover:opacity-95 active:scale-98 text-white font-bold rounded-2xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer text-xs sm:text-sm"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Ro'yxatdan o'tish va Ishni boshlash</span>
            </button>
          </div>
        </form>

        {onCancel && (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-slate-400 hover:text-slate-600 font-medium cursor-pointer"
            >
              Bekor qilish
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
