import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Asosiy Navo Market SVG logotipi
const svgLogo = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Fon gradienti -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#ffffff" />
      <stop offset="100%" stopColor="#f0fdf4" />
    </linearGradient>

    <!-- Yuqori yashil barg gradienti -->
    <linearGradient id="leafGrad" x1="120" y1="70" x2="270" y2="210" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#76c843" />
      <stop offset="100%" stopColor="#489d2c" />
    </linearGradient>

    <!-- Yashil o'ng yuqori qanot gradienti -->
    <linearGradient id="greenArc" x1="220" y1="120" x2="430" y2="320" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#00b355" />
      <stop offset="100%" stopColor="#008f45" />
    </linearGradient>

    <!-- Sariq chap qanot gradienti -->
    <linearGradient id="yellowArc" x1="70" y1="180" x2="220" y2="400" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#fdb813" />
      <stop offset="100%" stopColor="#f59e0b" />
    </linearGradient>

    <!-- Qizil pastki qanot gradienti -->
    <linearGradient id="redArc" x1="120" y1="380" x2="400" y2="400" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#e52d27" />
      <stop offset="100%" stopColor="#b31217" />
    </linearGradient>

    <!-- Savat gradienti -->
    <linearGradient id="cartGrad" x1="160" y1="210" x2="350" y2="350" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stopColor="#ff6f1e" />
      <stop offset="100%" stopColor="#e04e05" />
    </linearGradient>

    <filter id="shadow" x="0" y="0" width="512" height="512" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#00a651" flood-opacity="0.15" />
    </filter>
  </defs>

  <!-- Dumaloq ramka orqa foni -->
  <rect width="512" height="512" rx="112" fill="url(#bgGrad)" />
  <rect x="8" y="8" width="496" height="496" rx="104" stroke="#00a651" stroke-width="12" stroke-opacity="0.25" />

  <!-- Logotip Emblemasi -->
  <g transform="translate(46, 36) scale(1.9)">
    <!-- 1. Yuqori barg / Qabul belgisi -->
    <path
      d="M38 42 C45 36, 68 56, 75 74 C82 52, 102 18, 126 8 C128 18, 114 42, 94 62 C85 71, 78 78, 72 78 C65 78, 54 62, 38 42 Z"
      fill="url(#leafGrad)"
    />

    <!-- 2. O'ng yuqori yashil qanot / aylanma -->
    <path
      d="M128 16 C165 42, 192 84, 192 132 C192 144, 189 156, 185 166 C176 154, 168 138, 160 120 C154 105, 142 85, 128 72 C134 52, 133 32, 128 16 Z"
      fill="url(#greenArc)"
    />

    <!-- 3. Chap sariq qanot / aylanma -->
    <path
      d="M36 68 C24 88, 16 112, 16 138 C16 172, 30 202, 52 224 C56 208, 62 188, 72 170 C80 155, 92 138, 104 126 C88 108, 62 86, 36 68 Z"
      fill="url(#yellowArc)"
    />

    <!-- 4. Pastki qizil qanot / aylanma -->
    <path
      d="M58 226 C82 242, 112 252, 144 250 C176 248, 204 234, 224 212 C206 214, 184 210, 162 200 C144 192, 126 178, 114 166 C94 188, 76 210, 58 226 Z"
      fill="url(#redArc)"
    />

    <!-- 5. Markaziy Savat (Shopping Cart) -->
    <path
      d="M74 88 L92 88 L104 140 L156 140 L166 98 L86 98"
      stroke="url(#cartGrad)"
      stroke-width="9"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <!-- Savat panjarasi -->
    <path
      d="M100 118 L160 118 M116 98 L112 140 M134 98 L132 140 M150 98 L146 140"
      stroke="url(#cartGrad)"
      stroke-width="5"
      stroke-linecap="round"
    />
    <!-- Savat g'ildiraklari -->
    <circle cx="112" cy="154" r="7" fill="#ff6f1e" />
    <circle cx="148" cy="154" r="7" fill="#ff6f1e" />
  </g>

  <!-- Yozuv: NAVO MARKET -->
  <text x="256" y="456" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-weight="900" font-size="44" fill="#00a651" text-anchor="middle" letter-spacing="4">NAVO MARKET</text>
</svg>
`;

// 2. Android Maskable ikonkasi (15% ichki xavfsiz zona bilan)
const svgMaskable = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- To'liq bo'yalgan fon -->
  <rect width="512" height="512" fill="#00a651" />
  <circle cx="256" cy="256" r="230" fill="#ffffff" />

  <!-- Markaziy emblem 75% masshtabda -->
  <g transform="translate(98, 90) scale(1.4)">
    <defs>
      <linearGradient id="mLeafGrad" x1="40" y1="20" x2="110" y2="85" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#76c843" />
        <stop offset="100%" stopColor="#489d2c" />
      </linearGradient>
      <linearGradient id="mGreenArc" x1="90" y1="50" x2="185" y2="135" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#00b355" />
        <stop offset="100%" stopColor="#008f45" />
      </linearGradient>
      <linearGradient id="mYellowArc" x1="30" y1="80" x2="95" y2="175" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#fdb813" />
        <stop offset="100%" stopColor="#f59e0b" />
      </linearGradient>
      <linearGradient id="mRedArc" x1="55" y1="165" x2="175" y2="175" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#e52d27" />
        <stop offset="100%" stopColor="#b31217" />
      </linearGradient>
      <linearGradient id="mCartGrad" x1="70" y1="90" x2="150" y2="150" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#ff6f1e" />
        <stop offset="100%" stopColor="#e04e05" />
      </linearGradient>
    </defs>

    <path
      d="M38 42 C45 36, 68 56, 75 74 C82 52, 102 18, 126 8 C128 18, 114 42, 94 62 C85 71, 78 78, 72 78 C65 78, 54 62, 38 42 Z"
      fill="url(#mLeafGrad)"
    />
    <path
      d="M128 16 C165 42, 192 84, 192 132 C192 144, 189 156, 185 166 C176 154, 168 138, 160 120 C154 105, 142 85, 128 72 C134 52, 133 32, 128 16 Z"
      fill="url(#mGreenArc)"
    />
    <path
      d="M36 68 C24 88, 16 112, 16 138 C16 172, 30 202, 52 224 C56 208, 62 188, 72 170 C80 155, 92 138, 104 126 C88 108, 62 86, 36 68 Z"
      fill="url(#mYellowArc)"
    />
    <path
      d="M58 226 C82 242, 112 252, 144 250 C176 248, 204 234, 224 212 C206 214, 184 210, 162 200 C144 192, 126 178, 114 166 C94 188, 76 210, 58 226 Z"
      fill="url(#mRedArc)"
    />
    <path
      d="M74 88 L92 88 L104 140 L156 140 L166 98 L86 98"
      stroke="url(#mCartGrad)"
      stroke-width="9"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle cx="112" cy="154" r="7" fill="#ff6f1e" />
    <circle cx="148" cy="154" r="7" fill="#ff6f1e" />
  </g>
</svg>
`;

async function generate() {
  console.log('Generating PWA icons...');

  // SVG fayllarni saqlash
  fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgLogo.trim());
  fs.writeFileSync(path.join(publicDir, 'pwa-maskable.svg'), svgMaskable.trim());

  // PNG iconlarni Sharp orqali yaratish
  const svgBuffer = Buffer.from(svgLogo);
  const maskableBuffer = Buffer.from(svgMaskable);

  // 1. 192x192 PNG
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'pwa-192x192.png'));

  // 2. 512x512 PNG
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'pwa-512x512.png'));

  // 3. Maskable 512x512 PNG
  await sharp(maskableBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'pwa-maskable-512x512.png'));

  // 4. Apple Touch Icon 180x180 PNG
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(path.join(publicDir, 'apple-touch-icon.png'));

  // 5. Favicon 64x64 PNG
  await sharp(svgBuffer)
    .resize(64, 64)
    .png()
    .toFile(path.join(publicDir, 'favicon.ico'));

  console.log('All PWA icons generated successfully in /public!');
}

generate().catch(console.error);
