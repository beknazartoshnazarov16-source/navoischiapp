import React from 'react';

interface NavoLogoProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  showText?: boolean;
  layout?: 'horizontal' | 'vertical';
  variant?: 'light' | 'dark' | 'white';
  badge?: boolean;
}

export function NavoLogo({
  className = '',
  size = 'md',
  showText = true,
  layout = 'horizontal',
  variant = 'light',
  badge = false,
}: NavoLogoProps) {
  const iconSizes = {
    xs: 'w-7 h-7',
    sm: 'w-9 h-9',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24',
    '2xl': 'w-32 h-32',
  };

  const navoTextSizes = {
    xs: 'text-sm font-black',
    sm: 'text-base font-black',
    md: 'text-xl font-black',
    lg: 'text-2xl font-black',
    xl: 'text-4xl font-black',
    '2xl': 'text-5xl font-black',
  };

  const marketTextSizes = {
    xs: 'text-xs font-bold',
    sm: 'text-sm font-bold',
    md: 'text-base font-bold',
    lg: 'text-xl font-bold',
    xl: 'text-2xl font-bold',
    '2xl': 'text-3xl font-bold',
  };

  const logoContent = (
    <div
      className={`inline-flex ${
        layout === 'vertical' ? 'flex-col items-center text-center' : 'items-center'
      } gap-2.5 sm:gap-3.5 select-none transition-transform ${badge ? '' : className}`}
    >
      {/* Logotip Emblemasi (Barg, Sariq, Yashil, Qizil aylanma va To'q sariq savat) */}
      <div className={`relative shrink-0 ${iconSizes[size]}`}>
        <svg
          viewBox="0 0 220 220"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-sm"
        >
          <defs>
            {/* Yuqori yashil barg gradienti */}
            <linearGradient id="navoLeafGrad" x1="40" y1="20" x2="110" y2="85" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#76c843" />
              <stop offset="100%" stopColor="#489d2c" />
            </linearGradient>

            {/* Yashil o'ng yuqori qanot gradienti */}
            <linearGradient id="navoGreenArc" x1="90" y1="50" x2="185" y2="135" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#00b355" />
              <stop offset="100%" stopColor="#008f45" />
            </linearGradient>

            {/* Sariq chap qanot gradienti */}
            <linearGradient id="navoYellowArc" x1="30" y1="80" x2="95" y2="175" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#fdb813" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>

            {/* Qizil pastki qanot gradienti */}
            <linearGradient id="navoRedArc" x1="55" y1="165" x2="175" y2="175" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#e52d27" />
              <stop offset="100%" stopColor="#b31217" />
            </linearGradient>

            {/* Savat gradienti */}
            <linearGradient id="navoCartGrad" x1="70" y1="90" x2="150" y2="150" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#ff6f1e" />
              <stop offset="100%" stopColor="#e04e05" />
            </linearGradient>
          </defs>

          {/* 1. Yuqori barg / Qabul belgisi (Checkmark Leaf) */}
          <path
            d="M38 42 C45 36, 68 56, 75 74 C82 52, 102 18, 126 8 C128 18, 114 42, 94 62 C85 71, 78 78, 72 78 C65 78, 54 62, 38 42 Z"
            fill="url(#navoLeafGrad)"
          />
          {/* Barg ichki oq nurlanishi (checkmark slit) */}
          <path
            d="M50 46 C64 58, 74 72, 74 74 C82 58, 96 32, 115 16"
            stroke="#ffffff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeOpacity="0.7"
          />

          {/* 2. Chap tomon Sariq/Oltin yarim doira (Yellow crescent) */}
          <path
            d="M54 78 C32 98, 26 134, 46 162 C57 177, 72 185, 90 184 C64 168, 52 140, 62 112 C69 92, 85 82, 102 75 C82 71, 65 72, 54 78 Z"
            fill="url(#navoYellowArc)"
          />

          {/* 3. O'ng yuqori Yashil yarim doira (Green crescent) */}
          <path
            d="M86 54 C122 52, 166 74, 174 112 C178 128, 172 146, 160 160 C166 140, 160 115, 144 96 C127 79, 106 72, 86 54 Z"
            fill="url(#navoGreenArc)"
          />

          {/* 4. Pastki Qizil yarim doira (Red crescent) */}
          <path
            d="M58 170 C78 198, 122 205, 154 186 C168 178, 178 162, 183 146 C165 170, 138 181, 112 177 C90 173, 72 163, 58 170 Z"
            fill="url(#navoRedArc)"
          />

          {/* 5. Markazdagi To'q sariq harakatdagi xarid savatchasi (Fast Shopping Cart with Speed Lines) */}
          <g transform="translate(64, 90) scale(0.82)">
            {/* Tezlik chiziqlari (Speed lines trailing behind the cart - from official logo) */}
            <path d="M-8 26 L8 26" stroke="url(#navoCartGrad)" strokeWidth="4.5" strokeLinecap="round" />
            <path d="M-15 38 L11 38" stroke="url(#navoCartGrad)" strokeWidth="4.5" strokeLinecap="round" />
            <path d="M-6 50 L14 50" stroke="url(#navoCartGrad)" strokeWidth="4.5" strokeLinecap="round" />

            {/* Savat g'ildiraklari */}
            <circle cx="28" cy="80" r="7.5" fill="url(#navoCartGrad)" />
            <circle cx="28" cy="80" r="3" fill="#ffffff" />
            <circle cx="74" cy="80" r="7.5" fill="url(#navoCartGrad)" />
            <circle cx="74" cy="80" r="3" fill="#ffffff" />

            {/* Savat tutqichi va korpusi */}
            <path
              d="M98 12 C95 3, 84 1, 74 1 L64 1"
              stroke="url(#navoCartGrad)"
              strokeWidth="6"
              strokeLinecap="round"
            />
            <path
              d="M88 12 L77 66 L22 66 L10 22 L88 16"
              stroke="url(#navoCartGrad)"
              strokeWidth="6"
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M28 66 L18 76 L78 76"
              stroke="url(#navoCartGrad)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />

            {/* Savat ichki panjarasi (gorizontal) */}
            <path
              d="M13 35 L84 31 M18 49 L80 47"
              stroke="url(#navoCartGrad)"
              strokeWidth="4"
              strokeLinecap="round"
            />
            {/* Savat ichki panjarasi (vertikal) */}
            <path
              d="M33 22 L40 66 M53 20 L58 66 M72 18 L75 66"
              stroke="url(#navoCartGrad)"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </g>
        </svg>
      </div>

      {/* Brend matni: Navo Market (Official Logo: Title Case 'Navo' and 'Market') */}
      {showText && (
        <div className={`flex flex-col ${layout === 'vertical' ? 'items-center mt-1.5' : 'items-start -space-y-0.5'}`}>
          <div className="flex items-center gap-1.5 leading-none">
            <span
              className={`tracking-tight ${navoTextSizes[size]} ${
                badge
                  ? 'text-[#00a651]'
                  : variant === 'dark'
                  ? 'text-[#00e676]'
                  : variant === 'white'
                  ? 'text-white'
                  : 'text-[#00a651]'
              }`}
              style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
            >
              Navo
            </span>
            <span
              className={`font-black ${marketTextSizes[size]} ${
                badge
                  ? 'text-[#008f45]'
                  : variant === 'dark'
                  ? 'text-emerald-300'
                  : variant === 'white'
                  ? 'text-emerald-100'
                  : 'text-[#008f45]'
              }`}
              style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
            >
              Market
            </span>
          </div>
          {(size === 'lg' || size === 'xl' || size === '2xl') && (
            <span
              className={`text-[9px] sm:text-[10px] tracking-widest uppercase font-extrabold mt-0.5 ${
                badge
                  ? 'text-slate-400'
                  : variant === 'white'
                  ? 'text-emerald-200/80'
                  : variant === 'dark'
                  ? 'text-emerald-400/80'
                  : 'text-slate-400'
              }`}
            >
              Supermarket
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (badge) {
    return (
      <div
        className={`inline-flex items-center bg-white px-5 py-3 rounded-2xl shadow-xl border border-slate-100/90 ${className}`}
      >
        {logoContent}
      </div>
    );
  }

  return logoContent;
}
