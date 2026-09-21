import { execSync } from 'node:child_process';
import { assertProductionBundle } from './assert-prod-bundle.mjs';

const PROD_CONVEX_URL = 'https://laudable-fly-396.convex.cloud';
const PROD_SITE_URL = 'https://laudable-fly-396.convex.site';

console.log('🚀 Starting guarded production build...');
console.log(`📌 Enforcing VITE_CONVEX_URL=${PROD_CONVEX_URL}`);
console.log(`📌 Enforcing VITE_CONVEX_SITE_URL=${PROD_SITE_URL}`);

process.env.VITE_CONVEX_URL = PROD_CONVEX_URL;
process.env.VITE_CONVEX_SITE_URL = PROD_SITE_URL;

console.log('1️⃣ Running typecheck (tsc -b)...');
execSync('npm run typecheck', { stdio: 'inherit' });

console.log('2️⃣ Running Vite production build with forced production environment...');
execSync('npx vite build --mode production', {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_CONVEX_URL: PROD_CONVEX_URL,
    VITE_CONVEX_SITE_URL: PROD_SITE_URL,
  },
});

console.log('3️⃣ Running bundle assertion on generated dist/...');
assertProductionBundle();

console.log('🎉 Production build completed and certified successfully!');
