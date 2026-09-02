# ESP32 Web Preview

Runs the dashboard embedded in `esp32/.firmware/web_dashboard.cpp` without ESP32
hardware. The tool extracts the actual board-specific C++ raw strings and
provides mock HTTP, WebSocket, auxiliary API, and CAN stream endpoints.

```powershell
Set-Location tools\web-preview
npm install
npm start
```

Open:

- Dashboard: <http://localhost:8080>
- Simulator controls: <http://localhost:8080/__sim>

The simulator includes a **Run brake -> D -> stop -> P** scenario. It enables
Summon EU Unlock in Brake mode, presses the brake in P, shifts to D, accelerates
to 50 km/h, stops, shifts back to P, and presses the brake again to restore
Summon for the current boot.

Select another firmware board when needed:

```powershell
npm start -- --board=ttgo-tdisplay
```

Supported boards are `lilygo-t2can`, `esp32-lilygo`, `ttgo-tdisplay`,
`m5stack-atom`, `m5stack-atom-matrix`, and `waveshare-s3-can`.
