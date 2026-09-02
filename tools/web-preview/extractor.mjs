import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SOURCE = path.resolve(
  HERE,
  "..",
  "..",
  "esp32",
  ".firmware",
  "web_dashboard.cpp",
);

const BOARD_DEFINES = {
  "lilygo-t2can": new Set(["BOARD_LILYGO_T2CAN"]),
  "esp32-lilygo": new Set(["BOARD_LILYGO"]),
  "ttgo-tdisplay": new Set(["BOARD_TTGO_DISPLAY"]),
  "m5stack-atom": new Set(["BOARD_M5STACK_ATOM"]),
  "m5stack-atom-matrix": new Set([
    "BOARD_M5STACK_ATOM",
    "BOARD_M5STACK_ATOM_MATRIX",
  ]),
  "waveshare-s3-can": new Set(["BOARD_WAVESHARE_S3"]),
};

function active(stack) {
  return stack.every((entry) => entry.active);
}

function preprocessWebLiteral(source, defines) {
  const start = source.indexOf("static const char WEB_HTML[]");
  const endMarker = "// ── JSON helpers";
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error("Could not locate WEB_HTML declaration boundaries");
  }

  const stack = [];
  const selected = [];
  for (const line of source.slice(start, end).split(/\r?\n/)) {
    const ifMatch = line.match(/^\s*#if\s+defined\(([^)]+)\)\s*$/);
    if (ifMatch) {
      const parentActive = active(stack);
      stack.push({
        parentActive,
        condition: defines.has(ifMatch[1]),
        active: parentActive && defines.has(ifMatch[1]),
        elseSeen: false,
      });
      continue;
    }

    if (/^\s*#else\s*$/.test(line)) {
      const entry = stack.at(-1);
      if (!entry || entry.elseSeen) {
        throw new Error("Unexpected #else while extracting WEB_HTML");
      }
      entry.elseSeen = true;
      entry.active = entry.parentActive && !entry.condition;
      continue;
    }

    if (/^\s*#endif\s*$/.test(line)) {
      if (!stack.pop()) {
        throw new Error("Unexpected #endif while extracting WEB_HTML");
      }
      continue;
    }

    if (active(stack)) selected.push(line);
  }

  if (stack.length !== 0) {
    throw new Error("Unclosed preprocessor condition in WEB_HTML");
  }

  return selected.join("\n");
}

export function extractDashboardHtml({
  board = "lilygo-t2can",
  sourcePath = DEFAULT_SOURCE,
} = {}) {
  const defines = BOARD_DEFINES[board];
  if (!defines) {
    throw new Error(
      `Unknown board "${board}". Expected one of: ${Object.keys(BOARD_DEFINES).join(", ")}`,
    );
  }

  const source = fs.readFileSync(sourcePath, "utf8");
  const selected = preprocessWebLiteral(source, defines);
  const chunks = [];
  const literal = /R"rawliteral\(([\s\S]*?)\)rawliteral"/g;
  for (const match of selected.matchAll(literal)) chunks.push(match[1]);
  const html = chunks.join("");

  if (chunks.length < 2 || !html.includes("<!DOCTYPE html>") || !html.includes("</html>")) {
    throw new Error(`Extracted dashboard is incomplete (${chunks.length} raw literal chunks)`);
  }
  return html;
}

function parseBoard(argv) {
  const value = argv.find((arg) => arg.startsWith("--board="));
  return value ? value.slice("--board=".length) : "lilygo-t2can";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const board = parseBoard(process.argv.slice(2));
    const html = extractDashboardHtml({ board });
    if (process.argv.includes("--check")) {
      console.log(`WEB_HTML extraction OK: ${board}, ${Buffer.byteLength(html)} bytes`);
    } else {
      process.stdout.write(html);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
