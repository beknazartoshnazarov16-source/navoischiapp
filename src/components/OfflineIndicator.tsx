import React from 'react';
import { useOnlineStatus } from '../utils/useOnlineStatus';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-16 sm:bottom-4 left-4 right-4 sm:right-auto z-50 flex items-center justify-center gap-2 rounded-2xl bg-amber-600 px-4 py-2.5 text-xs font-bold text-white shadow-xl animate-bounce">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Oflayn rejim — Internet yo'q, saqlangan kesh ma'lumotlari ishlatilmoqda.</span>
    </div>
  );
};
