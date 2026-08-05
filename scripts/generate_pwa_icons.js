const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// 1. SVG for standard icon (512x512)
const standardSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1e1b4b" />
      <stop offset="50%" stop-color="#312e81" />
      <stop offset="100%" stop-color="#4338ca" />
    </linearGradient>
    <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fef08a" />
      <stop offset="50%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <linearGradient id="bookGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#e0e7ff" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0f172a" flood-opacity="0.5" />
    </filter>
  </defs>

  <!-- Background Shield/Card -->
  <rect x="16" y="16" width="480" height="480" rx="96" fill="url(#bgGrad)" />
  <rect x="24" y="24" width="464" height="464" rx="88" stroke="url(#goldGrad)" stroke-width="4" stroke-opacity="0.6" fill="none" />

  <!-- Shining Star (효명 - Bright Light) -->
  <g filter="url(#glow)">
    <!-- Star rays -->
    <path d="M256 70 L266 125 L321 135 L266 145 L256 200 L246 145 L191 135 L246 125 Z" fill="url(#goldGrad)" />
    <path d="M256 95 L262 129 L296 135 L262 141 L256 175 L250 141 L216 135 L250 129 Z" fill="#ffffff" />
  </g>

  <!-- Open Book of Knowledge -->
  <g filter="url(#shadow)">
    <!-- Book Spine & Shadow -->
    <path d="M256 260 L140 220 C110 210 80 220 80 235 L80 375 C80 390 110 380 140 390 L256 425 L372 390 C402 380 432 390 432 375 L432 235 C432 220 402 210 372 220 Z" fill="#1e1b4b" opacity="0.3" />
    
    <!-- Left Page -->
    <path d="M256 250 C210 225 140 220 90 235 L90 375 C140 360 210 365 256 390 Z" fill="url(#bookGrad)" />
    <!-- Right Page -->
    <path d="M256 250 C302 225 372 220 422 235 L422 375 C372 360 302 365 256 390 Z" fill="url(#bookGrad)" opacity="0.95" />

    <!-- Page Center Spine -->
    <path d="M256 250 L256 390" stroke="#818cf8" stroke-width="4" stroke-linecap="round" />

    <!-- Book Lines (Left Page) -->
    <path d="M125 270 Q175 258 225 275" stroke="#94a3b8" stroke-width="5" stroke-linecap="round" opacity="0.7" />
    <path d="M125 298 Q175 286 225 303" stroke="#94a3b8" stroke-width="5" stroke-linecap="round" opacity="0.7" />
    <path d="M125 326 Q175 314 225 331" stroke="#94a3b8" stroke-width="5" stroke-linecap="round" opacity="0.7" />

    <!-- Book Lines (Right Page) -->
    <path d="M287 275 Q337 258 387 270" stroke="#94a3b8" stroke-width="5" stroke-linecap="round" opacity="0.7" />
    <path d="M287 303 Q337 286 387 298" stroke="#94a3b8" stroke-width="5" stroke-linecap="round" opacity="0.7" />
    <path d="M287 331 Q337 314 387 326" stroke="#94a3b8" stroke-width="5" stroke-linecap="round" opacity="0.7" />
  </g>

  <!-- School Emblem Text "효명" -->
  <g filter="url(#shadow)">
    <rect x="176" y="185" width="160" height="42" rx="12" fill="url(#goldGrad)" stroke="#ffffff" stroke-width="2" />
    <text x="256" y="214" font-family="'Pretendard', 'Noto Sans KR', 'Malgun Gothic', sans-serif" font-weight="900" font-size="24" fill="#1e1b4b" text-anchor="middle" letter-spacing="4">효 명</text>
  </g>
</svg>
`;

// 2. SVG for maskable icon (has extra padding around center content so launcher crop works perfectly)
const maskableSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradM" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#1e1b4b" />
      <stop offset="50%" stop-color="#312e81" />
      <stop offset="100%" stop-color="#4338ca" />
    </linearGradient>
    <linearGradient id="goldGradM" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fef08a" />
      <stop offset="50%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <linearGradient id="bookGradM" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#e0e7ff" />
    </linearGradient>
  </defs>

  <!-- Full bleed square background for maskable -->
  <rect width="512" height="512" fill="url(#bgGradM)" />

  <!-- Scaled down content inside 80% safe zone (center at 256, 256, scale 0.8) -->
  <g transform="translate(51.2, 51.2) scale(0.8)">
    <rect x="24" y="24" width="464" height="464" rx="88" stroke="url(#goldGradM)" stroke-width="4" stroke-opacity="0.6" fill="none" />

    <!-- Star -->
    <g>
      <path d="M256 70 L266 125 L321 135 L266 145 L256 200 L246 145 L191 135 L246 125 Z" fill="url(#goldGradM)" />
      <path d="M256 95 L262 129 L296 135 L262 141 L256 175 L250 141 L216 135 L250 129 Z" fill="#ffffff" />
    </g>

    <!-- Book -->
    <g>
      <path d="M256 250 C210 225 140 220 90 235 L90 375 C140 360 210 365 256 390 Z" fill="url(#bookGradM)" />
      <path d="M256 250 C302 225 372 220 422 235 L422 375 C372 360 302 365 256 390 Z" fill="url(#bookGradM)" opacity="0.95" />
      <path d="M256 250 L256 390" stroke="#818cf8" stroke-width="4" stroke-linecap="round" />
      <path d="M125 270 Q175 258 225 275" stroke="#94a3b8" stroke-width="5" stroke-linecap="round" opacity="0.7" />
      <path d="M125 298 Q175 286 225 303" stroke="#94a3b8" stroke-width="5" stroke-linecap="round" opacity="0.7" />
      <path d="M125 326 Q175 314 225 331" stroke="#94a3b8" stroke-width="5" stroke-linecap="round" opacity="0.7" />
      <path d="M287 275 Q337 258 387 270" stroke="#94a3b8" stroke-width="5" stroke-linecap="round" opacity="0.7" />
      <path d="M287 303 Q337 286 387 298" stroke="#94a3b8" stroke-width="5" stroke-linecap="round" opacity="0.7" />
      <path d="M287 331 Q337 314 387 326" stroke="#94a3b8" stroke-width="5" stroke-linecap="round" opacity="0.7" />
    </g>

    <!-- Text -->
    <g>
      <rect x="176" y="185" width="160" height="42" rx="12" fill="url(#goldGradM)" stroke="#ffffff" stroke-width="2" />
      <text x="256" y="214" font-family="'Pretendard', 'Noto Sans KR', sans-serif" font-weight="900" font-size="24" fill="#1e1b4b" text-anchor="middle" letter-spacing="4">효 명</text>
    </g>
  </g>
</svg>
`;

async function generateIcons() {
  const publicDir = path.join(__dirname, '..', 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const stdBuffer = Buffer.from(standardSvg);
  const maskBuffer = Buffer.from(maskableSvg);

  // 1. icon-512.png
  await sharp(stdBuffer).resize(512, 512).png().toFile(path.join(publicDir, 'icon-512.png'));
  console.log('Created icon-512.png');

  // 2. icon-192.png
  await sharp(stdBuffer).resize(192, 192).png().toFile(path.join(publicDir, 'icon-192.png'));
  console.log('Created icon-192.png');

  // 3. apple-touch-icon.png (180x180)
  await sharp(stdBuffer).resize(180, 180).png().toFile(path.join(publicDir, 'apple-touch-icon.png'));
  console.log('Created apple-touch-icon.png');

  // 4. icon-maskable-512.png
  await sharp(maskBuffer).resize(512, 512).png().toFile(path.join(publicDir, 'icon-maskable-512.png'));
  console.log('Created icon-maskable-512.png');

  // 5. favicon.ico / favicon.png (32x32)
  await sharp(stdBuffer).resize(32, 32).png().toFile(path.join(publicDir, 'favicon.png'));
  console.log('Created favicon.png');

  console.log('All PWA icons generated successfully!');
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
