import fs from 'node:fs';
import path from 'node:path';

const EXPECTED_PROD_URL = 'https://laudable-fly-396.convex.cloud';
const FORBIDDEN_DEV_SUBSTRING = 'flexible-rook-428';
const DIST_DIR = path.resolve('dist');

export function assertProductionBundle() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error('❌ Bundle assertion failed: dist/ directory does not exist.');
    process.exit(1);
  }

  const files = [];
  function scanDir(dir) {
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scanDir(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  scanDir(DIST_DIR);

  console.log(`🔍 Inspecting ${files.length} production bundle artifacts in dist/...`);

  let foundProdUrl = false;
  let foundDevUrl = false;
  const devUrlViolations = [];

  for (const file of files) {
    const ext = path.extname(file);
    if (!['.js', '.html', '.css', '.map', '.json'].includes(ext)) continue;

    const content = fs.readFileSync(file, 'utf8');

    if (content.includes(EXPECTED_PROD_URL)) {
      foundProdUrl = true;
      console.log(`  ✓ Confirmed production Convex URL in ${path.relative(DIST_DIR, file)}`);
    }

    if (content.includes(FORBIDDEN_DEV_SUBSTRING)) {
      foundDevUrl = true;
      devUrlViolations.push(path.relative(DIST_DIR, file));
    }
  }

  if (foundDevUrl) {
    console.error(`\n❌ CRITICAL SECURITY ERROR: Forbidden dev deployment identifier "${FORBIDDEN_DEV_SUBSTRING}" found in:`);
    for (const v of devUrlViolations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }

  if (!foundProdUrl) {
    console.error(`\n❌ ERROR: Expected production URL "${EXPECTED_PROD_URL}" was NOT found in any JS/HTML bundle.`);
    process.exit(1);
  }

  console.log(`\n✅ Production bundle certified: Targets ${EXPECTED_PROD_URL} with 0 dev URL leaks.\n`);
}

// Run if directly executed
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/assert-prod-bundle.mjs')) {
  assertProductionBundle();
}
