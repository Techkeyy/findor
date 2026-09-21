import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TEXT_EXTENSIONS = new Set([".css", ".html", ".svg", ".ts", ".tsx"]);
const EMOJI_PATTERN = /[\u{1f300}-\u{1faff}\u{2600}-\u{27bf}]/u;
const LONG_DASH_PATTERN = /[—–]/u;
const SYMBOL_ICON_PATTERN = /[↗▼▲✓✕⚠◇✉]/u;

function collectAuthoredFrontendFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectAuthoredFrontendFiles(entryPath);
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name))) return [];
    if (/\.test\.[^.]+$/.test(entry.name)) return [];
    return [entryPath];
  });
}

describe("authored frontend presentation guard", () => {
  it("contains no user-facing emoji, long dashes, or symbol icon hacks", () => {
    const roots = [path.resolve(process.cwd(), "src"), path.resolve(process.cwd(), "public")];
    const offenders: string[] = [];

    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const filePath of collectAuthoredFrontendFiles(root)) {
        const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
        lines.forEach((line, index) => {
          if (EMOJI_PATTERN.test(line) || LONG_DASH_PATTERN.test(line) || SYMBOL_ICON_PATTERN.test(line)) {
            offenders.push(path.relative(process.cwd(), filePath) + ":" + (index + 1) + ": " + line.trim());
          }
        });
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("keeps generic authored examples US-first without changing country support", () => {
    const roots = [path.resolve(process.cwd(), "src"), path.resolve(process.cwd(), "public")];
    const authoredText = roots
      .filter((root) => fs.existsSync(root))
      .flatMap((root) => collectAuthoredFrontendFiles(root))
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .join("\n");

    const forbiddenExamplePatterns = [
      /₦/u,
      /\bNGN\b/u,
      /\bNaira\b/iu,
      /\bOshodi\b/iu,
      /\bLagos\b/iu,
    ];

    for (const pattern of forbiddenExamplePatterns) {
      expect(authoredText).not.toMatch(pattern);
    }

    expect(authoredText).toContain("Brooklyn, New York");
    expect(authoredText).toContain("Replace bathroom light fixtures this week");
    expect(authoredText).toContain("$500 or Flexible");
  });

  it("uses the downloaded Findor mark instead of the old F placeholder", () => {
    const header = fs.readFileSync(path.resolve(process.cwd(), "src/components/Header.tsx"), "utf8");
    const authModal = fs.readFileSync(path.resolve(process.cwd(), "src/components/AuthModal.tsx"), "utf8");
    const indexHtml = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");

    expect(header).toContain('src="/findor-logo.png"');
    expect(authModal).toContain('src="/findor-logo.png"');
    expect(header).not.toContain(">F<");
    expect(authModal).not.toContain(">F<");
    expect(indexHtml).toContain('href="/findor-favicon.png"');
    expect(indexHtml).toContain('href="/apple-touch-icon.png"');
    expect(indexHtml).toContain("<title>Findor</title>");
  });
});
