import http from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { extractDashboardHtml } from "./extractor.mjs";
import { MockDevice } from "./mock-state.mjs";

const HTTP_PORT = 8080;
const WS_PORT = 81;
const CAN_PORT = 82;
const boardArgument = process.argv.find((arg) => arg.startsWith("--board="));
const board = boardArgument ? boardArgument.slice("--board=".length) : "lilygo-t2can";
const dashboardHtml = extractDashboardHtml({ board });
const device = new MockDevice();

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function text(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function simulatorHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP32 Web Preview Controls</title>
<style>
body{font:15px system-ui;background:#0a0a1a;color:#e5e7eb;margin:0;padding:20px}main{max-width:760px;margin:auto}
.card{background:#111827;border:1px solid #293247;border-radius:10px;padding:16px;margin:12px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
button,select{background:#1a1f35;color:#e5e7eb;border:1px solid #3b4864;border-radius:6px;padding:10px;cursor:pointer}
button:hover{border-color:#39d98a}pre{white-space:pre-wrap;word-break:break-word;color:#9ca3af}
a{color:#39d98a}.on{color:#fbbf24;font-weight:700}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
.metric{background:#0d1424;border-radius:8px;padding:12px;text-align:center}.metric b{display:block;font-size:1.35em;margin-top:5px}
</style></head><body><main>
<h1>ESP32 Web Preview</h1>
<p><a href="/" target="_blank">Open embedded dashboard</a></p>
<div class="card"><h2>Summon scenarios</h2><div class="grid">
<button onclick="act('run-brake-drive-stop')">Run brake → D → stop → P</button>
<button onclick="act('brake-press')">Brake press</button>
<button onclick="act('brake-release')">Brake release</button>
<button onclick="act('shift-r')">Shift R</button>
<button onclick="act('shift-n')">Shift N</button>
<button onclick="act('shift-d')">Shift D</button>
<button onclick="act('shift-p')">Shift P</button>
<button onclick="act('clear-runtime-guard')">Clear runtime guard</button>
<button onclick="act('power-cycle')">Power cycle</button>
</div></div>
<div class="card"><h2>Vehicle scenarios</h2><div class="grid">
<select onchange="act('set-hardware',Number(this.value))"><option value="">Set hardware...</option><option value="0">Unknown</option><option value="1">Legacy</option><option value="2">HW3</option><option value="3">HW4</option></select>
<button onclick="act('toggle-can')">Toggle CAN traffic</button>
<button onclick="act('toggle-ota')">Toggle vehicle OTA</button>
<button onclick="act('toggle-bms')">Toggle BMS data</button>
</div></div>
<div class="card"><h2>Live state</h2>
<div class="metrics"><div class="metric">Speed<b id="speed">--</b></div><div class="metric">Brake<b id="brake">--</b></div><div class="metric">Gear<b id="gear">--</b></div><div class="metric">Phase<b id="phase">--</b></div></div>
<div id="summary"></div><pre id="state">Loading...</pre></div>
</main><script>
async function act(action,value){await fetch('/__sim/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,value})});await load()}
async function load(){const d=await fetch('/api/status',{cache:'no-store'}).then(r=>r.json());document.getElementById('speed').textContent=(d.vehicle_speed_kph||0).toFixed(1)+' km/h';document.getElementById('brake').textContent=d.driver_brake_applied?'PRESSED':'Released';document.getElementById('gear').textContent=({1:'P',2:'R',3:'N',4:'D'})[d.vehicle_gear]||'--';document.getElementById('phase').textContent=d.scenario_phase||'Idle';document.getElementById('summary').innerHTML='Mode: <b>'+['D gear persistent','Brake temporary','Off'][d.summon_auto_control]+'</b> · Summon: <b>'+((d.summon_unlock&&!d.summon_temp_disabled)?'ON':'OFF')+'</b> · Temporary guard: <span class="'+(d.summon_temp_disabled?'on':'')+'">'+(d.summon_temp_disabled?'ACTIVE':'clear')+'</span>';document.getElementById('state').textContent=JSON.stringify(d,null,2)}
setInterval(load,1000);load();
</script></body></html>`;
}

const sockets = new Set();
let scenarioTimers = [];
function broadcast() {
  const message = JSON.stringify(device.snapshot());
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

function clearScenario() {
  for (const timer of scenarioTimers) clearTimeout(timer);
  scenarioTimers = [];
}

function scenarioStep(delayMs, phase, speed, brake, gear) {
  scenarioTimers.push(setTimeout(() => {
    device.state.scenario_phase = phase;
    device.state.vehicle_speed_kph = speed;
    if (gear !== undefined) device.state.vehicle_gear = gear;
    device.action(brake ? "brake-press" : "brake-release");
    broadcast();
  }, delayMs));
}

function runBrakeDriveStopScenario() {
  clearScenario();
  device.command("summon_unlock", true);
  device.command("summon_auto_control", 1);
  device.state.scenario_phase = "Armed";
  device.state.vehicle_speed_kph = 0;
  device.state.vehicle_gear = 1;
  device.action("brake-release");
  broadcast();
  scenarioStep(700, "Brake pressed (P)", 0, true, 1);
  scenarioStep(1800, "Shift D", 0, false, 4);
  scenarioStep(2800, "Accelerating (D)", 10, false, 4);
  scenarioStep(3800, "Accelerating (D)", 30, false, 4);
  scenarioStep(4800, "Driving (D)", 50, false, 4);
  scenarioStep(6500, "Slowing (D)", 30, false, 4);
  scenarioStep(7500, "Slowing (D)", 10, false, 4);
  scenarioStep(8500, "Stopped (D)", 0, false, 4);
  scenarioStep(9200, "Shift P", 0, false, 1);
  scenarioStep(9800, "Park brake - Summon restored", 0, true, 1);
  scenarioStep(10500, "Complete", 0, false, 1);
}

const httpServer = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      text(response, 200, dashboardHtml, "text/html; charset=utf-8");
    } else if (request.method === "GET" && url.pathname === "/__sim") {
      text(response, 200, simulatorHtml(), "text/html; charset=utf-8");
    } else if (request.method === "GET" && url.pathname === "/api/status") {
      json(response, 200, device.snapshot());
    } else if (request.method === "GET" && url.pathname === "/api/aux") {
      json(response, 200, device.auxSnapshot());
    } else if (request.method === "GET" && url.pathname === "/blackbox/list") {
      json(response, 200, device.blackboxList());
    } else if (request.method === "GET" && url.pathname === "/blackbox/get") {
      const type = url.searchParams.get("type") === "json" ? "json" : "log";
      const file = device.blackboxFile(url.searchParams.get("name"), type);
      if (file === null) {
        text(response, 404, "Capture not found");
      } else {
        text(
          response,
          200,
          file,
          type === "json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
        );
      }
    } else if (request.method === "GET" && url.pathname === "/auth") {
      text(response, 200, "OK");
    } else if (request.method === "GET" && url.pathname === "/sdformat") {
      json(response, 200, { ok: true, msg: "Preview storage formatted", free_mb: 64 });
    } else if (request.method === "GET" && url.pathname === "/restart") {
      clearScenario();
      device.action("power-cycle");
      broadcast();
      text(response, 200, "OK");
    } else if (request.method === "POST" && url.pathname === "/__sim/action") {
      const body = await readJson(request);
      if (body.action === "run-brake-drive-stop") {
        runBrakeDriveStopScenario();
        json(response, 200, { ok: true, state: device.snapshot() });
        return;
      }
      if (body.action === "power-cycle") clearScenario();
      if (!device.action(body.action, body.value)) {
        json(response, 400, { ok: false, error: "Unknown simulator action" });
        return;
      }
      broadcast();
      json(response, 200, { ok: true, state: device.snapshot() });
    } else {
      text(response, 404, "Not found");
    }
  } catch (error) {
    json(response, 400, { ok: false, error: error.message });
  }
});

const websocketServer = new WebSocketServer({ port: WS_PORT });
websocketServer.on("connection", (socket) => {
  sockets.add(socket);
  socket.send(JSON.stringify(device.snapshot()));
  socket.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (!device.command(message.cmd, message.value)) {
        console.warn(`[preview] ignored unsupported command: ${message.cmd}`);
        return;
      }
      broadcast();
    } catch (error) {
      console.warn(`[preview] invalid WebSocket message: ${error.message}`);
    }
  });
  socket.on("close", () => sockets.delete(socket));
});

const canServer = http.createServer((request, response) => {
  let url;
  try {
    url = new URL(request.url ?? "/", "http://127.0.0.1");
  } catch (error) {
    text(response, 400, error.message);
    return;
  }
  if (request.method !== "GET" || url.pathname !== "/stream") {
      text(response, 404, "Not found");
      return;
    }
  response.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    Connection: "keep-alive",
  });
  let counter = 0;
  const timer = setInterval(() => {
    counter = (counter + 1) & 0xf;
    response.write(`(${(Date.now() / 1000).toFixed(6)}) can0 145#00000000000000${counter.toString(16)}\n`);
  }, 100);
  request.on("close", () => clearInterval(timer));
});

const tick = setInterval(() => {
  if (device.state.can_vehicle_detected) {
    device.state.rx_count += Math.round(device.state.fps);
    if (device.state.op_mode === 1) device.state.tx_count += 8;
  }
  broadcast();
}, 1000);

function shutdown() {
  clearScenario();
  clearInterval(tick);
  for (const socket of sockets) socket.close();
  websocketServer.close();
  httpServer.close();
  canServer.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

httpServer.listen(HTTP_PORT, "127.0.0.1", () => {
  console.log(`[preview] dashboard: http://localhost:${HTTP_PORT}`);
  console.log(`[preview] controls:  http://localhost:${HTTP_PORT}/__sim`);
  console.log(`[preview] board:     ${board}`);
});
canServer.listen(CAN_PORT, "127.0.0.1", () => {
  console.log(`[preview] CAN stream: http://localhost:${CAN_PORT}/stream`);
});
