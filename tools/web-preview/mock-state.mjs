import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(HERE, ".preview-state.json");
const persistentKeys = new Set([
  "op_mode",
  "hw_override",
  "ignore_ota",
  "fsd_unlock",
  "nag_killer",
  "continuous_ap",
  "ap_first",
  "ap_first_edge",
  "ap_first_minimal",
  "nag_faithful",
  "soft_engage",
  "nag_burst",
  "abort_guard",
  "cfg_das_id",
  "cfg_apb",
  "cfg_aps",
  "cfg_apm",
  "cfg_hob",
  "cfg_hos",
  "cfg_hom",
  "cfg_steer_id",
  "cfg_shi",
  "cfg_slo",
  "blackbox_enabled",
  "bms_output",
  "force_fsd",
  "china_mode",
  "suppress_speed_chime",
  "tlssc_restore",
  "summon_unlock",
  "summon_auto_control",
  "continue_on_green",
  "assist_tlssc_bit38",
  "assist_rhd_override",
  "assist_telemetry_off",
  "apmv3_branch",
  "track_mode_inject",
  "track_rotation_pct",
  "track_stability_pct",
  "track_post_cooling",
  "track_cmp_overclock",
  "firmware_14x_warning",
  "display_enabled",
  "display_brightness",
  "display_timeout_s",
  "sleep_ms",
  "wifi_ssid",
  "wifi_pass",
  "wifi_hidden",
  "wifi_sta_ssid",
  "wifi_sta_pass",
]);

const defaults = {
  fsd_enabled: true,
  ap_active: false,
  op_mode: 0,
  hw_override: 0,
  hw_version: 3,
  ota: false,
  ignore_ota: false,
  fsd_unlock: false,
  nag_killer: true,
  continuous_ap: false,
  ap_first: false,
  ap_first_edge: false,
  ap_first_minimal: false,
  nag_faithful: false,
  soft_engage: false,
  nag_burst: false,
  abort_guard: false,
  blackbox_enabled: true,
  cfg_das_id: 0,
  cfg_apb: 0,
  cfg_aps: 0,
  cfg_apm: 15,
  cfg_hob: 0,
  cfg_hos: 0,
  cfg_hom: 15,
  cfg_steer_id: 0,
  cfg_shi: 1,
  cfg_slo: 0,
  bms_output: false,
  force_fsd: false,
  china_mode: false,
  suppress_speed_chime: true,
  tlssc_restore: false,
  summon_unlock: true,
  summon_unlock_configured: true,
  summon_auto_control: 1,
  summon_temp_disabled: false,
  summon_temp_disabled_ms: 0,
  continue_on_green: false,
  assist_tlssc_bit38: false,
  assist_rhd_override: false,
  assist_telemetry_off: false,
  apmv3_branch: 255,
  track_mode_inject: false,
  track_rotation_pct: 100,
  track_stability_pct: 30,
  track_post_cooling: false,
  track_cmp_overclock: false,
  firmware_14x_warning: false,
  display_enabled: true,
  display_brightness: 50,
  display_timeout_s: 60,
  can_vehicle_detected: true,
  vehicle_speed_kph: 0,
  speed_seen: true,
  driver_brake_applied: false,
  brake_status_seen: true,
  vehicle_gear: 1,
  vehicle_gear_seen: true,
  scenario_phase: "Idle",
  bms_hv_seen: 420,
  bms_soc_seen: 420,
  bms_thermal_seen: 420,
  rx_count: 125000,
  tx_count: 950,
  tx_modified: 600,
  crc_errors: 0,
  fps: 825.4,
  bms: {
    seen: true,
    voltage: 398.2,
    current: -12.4,
    soc: 72,
    temp_min: 24,
    temp_max: 28,
  },
  fw_build: "Web Preview",
  can_dump: false,
  sleep_ms: 300000,
  wifi_clients: 1,
  wifi_ssid: "Tesla-FSD-Preview",
  wifi_pass: "***",
  wifi_hidden: false,
  wifi_sta_ssid: "",
  wifi_sta_pass: "",
  ota_partition: { running: "ota_0", state: 2, has_ota: true },
  http_can_stream: {
    active: true,
    buffered: 0,
    dropped: 0,
    filtered: 0,
    rx_missed: 0,
  },
};

function readPersistentState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return Object.fromEntries(
      Object.entries(parsed).filter(([key]) => persistentKeys.has(key)),
    );
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Could not read ${STATE_FILE}: ${error.message}`);
  }
}

export class MockDevice {
  constructor() {
    this.state = { ...defaults, ...readPersistentState() };
    this.state.summon_unlock_configured = this.state.summon_unlock;
    this.bootedAt = Date.now();
    this.brakeApplied = false;
    this.blackboxEvents = [];
    this.blackboxSequence = 0;
    this.aux = {
      blackbox: {
        enabled: this.state.blackbox_enabled,
        armed: false,
        backend: "preview",
        psram: true,
        volatile: false,
        cap: 4096,
        events: 0,
        captures: 0,
      },
      capability: { state: 0, ms_left: 0, buses: [] },
      profile: { suggested: false },
    };
  }

  snapshot() {
    const uptime_s = Math.floor((Date.now() - this.bootedAt) / 1000);
    const hw = this.state.hw_version;
    return {
      ...this.state,
      wifi_pass: this.state.wifi_pass ? "***" : "",
      wifi_sta_pass: this.state.wifi_sta_pass ? "***" : "",
      speed_fresh: this.state.speed_seen && this.state.can_vehicle_detected,
      uptime_s,
      ap_das_profile:
        hw === 3 ? "HW4: DAS 0x39B + ISA 0x399" :
        hw === 2 ? "HW3: DAS 0x399" :
        hw === 1 ? "Legacy: DAS 0x399" :
        "Waiting for HW detection",
      isa_speed_enabled: hw === 3,
    };
  }

  auxSnapshot() {
    this.aux.blackbox.enabled = this.state.blackbox_enabled;
    this.aux.blackbox.events = this.blackboxEvents.length;
    this.aux.blackbox.captures = this.blackboxEvents.length;
    return this.aux;
  }

  save() {
    const persistent = Object.fromEntries(
      Object.entries(this.state).filter(([key]) => persistentKeys.has(key)),
    );
    persistent.summon_unlock = this.state.summon_unlock_configured;
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(persistent, null, 2)}\n`);
  }

  command(command, value) {
    const aliases = {
      nag: "nag_killer",
      bms: "bms_output",
      "14x_warning": "firmware_14x_warning",
      disp: "display_enabled",
      disp_br: "display_brightness",
      disp_to: "display_timeout_s",
      dump: "can_dump",
      sleep: "sleep_ms",
    };
    const stateKey = aliases[command] ?? command;

    if (command === "mode") {
      this.state.op_mode = this.state.op_mode === 1 ? 0 : 1;
    } else if (command === "summon_unlock") {
      this.state.summon_unlock = Boolean(value);
      this.state.summon_unlock_configured = this.state.summon_unlock;
      this.clearTemporaryGuard();
    } else if (command === "summon_runtime") {
      this.state.summon_unlock =
        this.state.summon_unlock_configured && Boolean(value);
      this.clearTemporaryGuard();
    } else if (command === "summon_auto_control") {
      const mode = Number(value);
      if (![0, 1, 2].includes(mode)) return false;
      this.state.summon_auto_control = mode;
      this.clearTemporaryGuard();
    } else if (command === "hw_override") {
      const hw = Number(value);
      if (![0, 1, 2, 3].includes(hw)) return false;
      this.state.hw_override = hw;
      if (hw !== 0) this.state.hw_version = hw;
    } else if (command === "wifi_cfg" && value && typeof value === "object") {
      this.state.wifi_ssid = String(value.ssid ?? this.state.wifi_ssid);
      if (value.pass !== undefined && value.pass !== "***") {
        this.state.wifi_pass = String(value.pass);
      }
      this.state.wifi_hidden = Boolean(value.hidden);
      this.state.wifi_sta_ssid = String(value.sta_ssid ?? "");
      if (value.sta_pass !== undefined && value.sta_pass !== "***") {
        this.state.wifi_sta_pass = String(value.sta_pass);
      }
    } else if (command === "sig_cfg" && typeof value === "string") {
      const fields = value.split(",").map((entry) => Number(entry));
      if (fields.length !== 10 || fields.some((entry) => !Number.isFinite(entry))) return false;
      [
        "cfg_das_id", "cfg_apb", "cfg_aps", "cfg_apm", "cfg_hob",
        "cfg_hos", "cfg_hom", "cfg_steer_id", "cfg_shi", "cfg_slo",
      ].forEach((key, index) => {
        this.state[key] = fields[index];
      });
    } else if (command === "blackbox_enable") {
      this.state.blackbox_enabled = Boolean(value);
    } else if (command === "blackbox_mark") {
      const sequence = ++this.blackboxSequence;
      this.blackboxEvents.push({
        name: `preview-event-${sequence}`,
        summary: {
          detail: "manual preview mark",
          trigger: "manual",
          hw: ["Unknown", "Legacy", "HW3", "HW4"][this.state.hw_version] ?? "Unknown",
          frames: 24,
          buses: { dual_can: true },
        },
      });
    } else if (command === "blackbox_delete_all") {
      this.blackboxEvents = [];
    } else if (command === "blackbox_delete") {
      this.blackboxEvents = this.blackboxEvents.filter((event) => event.name !== value);
    } else if (command === "capability_recheck") {
      this.aux.capability = {
        state: 2,
        ms_left: 0,
        buses: [{
          bus: "Preview CAN",
          frames: 2400,
          nag_killer: 2,
          ap_first: 2,
          fsd_activation: 2,
          soft_engage: 1,
          body_control: 0,
          hint: "Vehicle CAN",
        }],
      };
    } else if (stateKey in this.state) {
      this.state[stateKey] = value;
    } else {
      return false;
    }
    this.save();
    return true;
  }

  blackboxList() {
    return this.blackboxEvents;
  }

  blackboxFile(name, type) {
    const event = this.blackboxEvents.find((entry) => entry.name === name);
    if (!event) return null;
    if (type === "json") return `${JSON.stringify(event, null, 2)}\n`;
    return [
      `# ${event.summary.detail}`,
      "(0.000000) can0 145#0000000000000000",
      "(0.010000) can1 3FD#0102030405060708",
      "",
    ].join("\n");
  }

  clearTemporaryGuard() {
    this.state.summon_temp_disabled = false;
    this.state.summon_temp_disabled_ms = 0;
  }

  action(action, value) {
    switch (action) {
      case "brake-press":
        if (!this.brakeApplied) {
          this.brakeApplied = true;
          this.state.driver_brake_applied = true;
          if (
            this.state.summon_auto_control === 1 &&
            this.state.summon_unlock &&
            this.state.summon_temp_disabled &&
            this.state.vehicle_gear === 1
          ) {
            this.clearTemporaryGuard();
          } else if (
            this.state.summon_auto_control === 1 &&
            this.state.summon_unlock &&
            !this.state.summon_temp_disabled
          ) {
            this.state.summon_temp_disabled = true;
            this.state.summon_temp_disabled_ms = Date.now() - this.bootedAt;
          }
        }
        break;
      case "brake-release":
        this.brakeApplied = false;
        this.state.driver_brake_applied = false;
        break;
      case "shift-r":
      case "shift-n":
      case "shift-d":
      case "shift-p": {
        const gears = {
          "shift-p": 1,
          "shift-r": 2,
          "shift-n": 3,
          "shift-d": 4,
        };
        this.state.vehicle_gear = gears[action];
        if (
          action === "shift-d" &&
          this.state.summon_auto_control === 0 &&
          this.state.summon_unlock
        ) {
          this.state.summon_unlock = false;
          this.state.summon_unlock_configured = false;
          this.save();
        }
        break;
      }
      case "power-cycle":
        this.bootedAt = Date.now();
        this.brakeApplied = false;
        this.state.driver_brake_applied = false;
        this.state.vehicle_speed_kph = 0;
        this.state.vehicle_gear = 1;
        this.state.scenario_phase = "Idle";
        this.state.summon_unlock = this.state.summon_unlock_configured;
        this.clearTemporaryGuard();
        this.state.rx_count = 0;
        this.state.tx_count = 0;
        break;
      case "clear-runtime-guard":
        this.clearTemporaryGuard();
        break;
      case "set-hardware":
        if (![0, 1, 2, 3].includes(Number(value))) return false;
        this.state.hw_version = Number(value);
        break;
      case "toggle-can":
        this.state.can_vehicle_detected = !this.state.can_vehicle_detected;
        break;
      case "toggle-ota":
        this.state.ota = !this.state.ota;
        break;
      case "toggle-bms":
        this.state.bms = { ...this.state.bms, seen: !this.state.bms.seen };
        break;
      default:
        return false;
    }
    return true;
  }
}
