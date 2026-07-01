// SentinelGrid edge fleet simulator.
//
// Reads a flat device list from a JSON seed file and emits one NDJSON
// telemetry line per device per cycle on stdout. Each line matches
// docs/MQTT_CONTRACT.md plus an extra "topic" field so a downstream
// bridge can publish it to MQTT without re-deriving the topic.
//
// Self-contained: standard library only, deterministic per --seed.

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <random>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace {

struct Device {
  std::string device_id;
  std::string display_name;
  std::string region;
  std::string kind;
  double lat = 0.0;
  double lon = 0.0;
  std::string firmware_version;
};

struct DeviceState {
  std::mt19937 rng;
  double battery_pct = 100.0;
  double rssi_base = -67.0;
  double temp_bias = 0.0;
  double wind_bias = 0.0;
  double water_bias = 0.0;
  std::uint64_t sequence = 0;
  std::uint64_t uptime_s = 0;
};

struct Options {
  std::uint64_t seed = 42;
  int interval_ms = 2000;
  long long count = 0;  // 0 = infinite
  std::string devices_path = "db/seeds/devices.json";
};

// ---------------------------------------------------------------------------
// Minimal JSON reading for the flat devices.json array. The file format is
// stable: an array of objects whose values are strings or plain numbers,
// with no nested objects/arrays and no escaped quotes in values.
// ---------------------------------------------------------------------------

void skip_ws(const std::string& s, size_t& i) {
  while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) ++i;
}

bool parse_string(const std::string& s, size_t& i, std::string& out) {
  if (i >= s.size() || s[i] != '"') return false;
  ++i;
  out.clear();
  while (i < s.size() && s[i] != '"') {
    if (s[i] == '\\' && i + 1 < s.size()) {
      ++i;
      switch (s[i]) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        default: out += s[i]; break;
      }
    } else {
      out += s[i];
    }
    ++i;
  }
  if (i >= s.size()) return false;
  ++i;  // closing quote
  return true;
}

bool parse_number(const std::string& s, size_t& i, double& out) {
  size_t start = i;
  while (i < s.size() &&
         (std::isdigit(static_cast<unsigned char>(s[i])) || s[i] == '-' || s[i] == '+' ||
          s[i] == '.' || s[i] == 'e' || s[i] == 'E')) {
    ++i;
  }
  if (i == start) return false;
  try {
    out = std::stod(s.substr(start, i - start));
  } catch (...) {
    return false;
  }
  return true;
}

std::vector<Device> load_devices(const std::string& path) {
  std::ifstream file(path);
  if (!file) {
    std::cerr << "edge-sim: cannot open devices file: " << path << "\n";
    std::exit(1);
  }
  std::stringstream buf;
  buf << file.rdbuf();
  const std::string text = buf.str();

  std::vector<Device> devices;
  size_t i = 0;
  skip_ws(text, i);
  if (i >= text.size() || text[i] != '[') {
    std::cerr << "edge-sim: devices file must be a JSON array: " << path << "\n";
    std::exit(1);
  }
  ++i;

  while (true) {
    skip_ws(text, i);
    if (i >= text.size()) break;
    if (text[i] == ']') break;
    if (text[i] == ',') { ++i; continue; }
    if (text[i] != '{') {
      std::cerr << "edge-sim: unexpected character in devices file at offset " << i << "\n";
      std::exit(1);
    }
    ++i;  // '{'
    Device d;
    while (true) {
      skip_ws(text, i);
      if (i >= text.size()) break;
      if (text[i] == '}') { ++i; break; }
      if (text[i] == ',') { ++i; continue; }
      std::string key;
      if (!parse_string(text, i, key)) {
        std::cerr << "edge-sim: malformed object key in devices file\n";
        std::exit(1);
      }
      skip_ws(text, i);
      if (i >= text.size() || text[i] != ':') {
        std::cerr << "edge-sim: expected ':' in devices file\n";
        std::exit(1);
      }
      ++i;
      skip_ws(text, i);
      if (i < text.size() && text[i] == '"') {
        std::string value;
        if (!parse_string(text, i, value)) {
          std::cerr << "edge-sim: malformed string value in devices file\n";
          std::exit(1);
        }
        if (key == "device_id") d.device_id = value;
        else if (key == "display_name") d.display_name = value;
        else if (key == "region") d.region = value;
        else if (key == "kind") d.kind = value;
        else if (key == "firmware_version") d.firmware_version = value;
      } else {
        double value = 0.0;
        if (!parse_number(text, i, value)) {
          std::cerr << "edge-sim: malformed number value in devices file\n";
          std::exit(1);
        }
        if (key == "lat") d.lat = value;
        else if (key == "lon") d.lon = value;
      }
    }
    if (!d.device_id.empty()) devices.push_back(d);
  }
  return devices;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

std::string iso_timestamp_utc() {
  const auto now = std::chrono::system_clock::now();
  const auto time = std::chrono::system_clock::to_time_t(now);
  std::tm tm{};
#if defined(_WIN32)
  gmtime_s(&tm, &time);
#else
  gmtime_r(&time, &tm);
#endif
  std::ostringstream out;
  out << std::put_time(&tm, "%Y-%m-%dT%H:%M:%SZ");
  return out.str();
}

double gauss(std::mt19937& rng, double mean, double stddev) {
  std::normal_distribution<double> dist(mean, stddev);
  return dist(rng);
}

double uniform(std::mt19937& rng, double lo, double hi) {
  std::uniform_real_distribution<double> dist(lo, hi);
  return dist(rng);
}

double clamp(double v, double lo, double hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

std::string json_escape(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (char c : s) {
    if (c == '"' || c == '\\') { out += '\\'; out += c; }
    else if (c == '\n') out += "\\n";
    else out += c;
  }
  return out;
}

std::string num(double v, int precision = 4) {
  if (!std::isfinite(v)) v = 0.0;
  std::ostringstream out;
  out << std::fixed << std::setprecision(precision) << v;
  return out.str();
}

Options parse_args(int argc, char** argv) {
  Options opts;
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    auto need_value = [&](const char* flag) -> std::string {
      if (i + 1 >= argc) {
        std::cerr << "edge-sim: missing value for " << flag << "\n";
        std::exit(2);
      }
      return argv[++i];
    };
    if (arg == "--seed") opts.seed = std::stoull(need_value("--seed"));
    else if (arg == "--interval-ms") opts.interval_ms = std::stoi(need_value("--interval-ms"));
    else if (arg == "--count") opts.count = std::stoll(need_value("--count"));
    else if (arg == "--devices") opts.devices_path = need_value("--devices");
    else if (arg == "--help" || arg == "-h") {
      std::cout << "usage: edge-sim [--seed N] [--interval-ms N] [--count N] [--devices PATH]\n"
                << "  --seed        deterministic RNG seed (default 42)\n"
                << "  --interval-ms delay between cycles in milliseconds (default 2000)\n"
                << "  --count       number of cycles, 0 = infinite (default 0)\n"
                << "  --devices     path to devices.json (default db/seeds/devices.json)\n";
      std::exit(0);
    } else {
      std::cerr << "edge-sim: unknown flag: " << arg << "\n";
      std::exit(2);
    }
  }
  return opts;
}

DeviceState make_state(const Device& device, std::uint64_t seed, size_t index) {
  // Stable per-device stream: mix the global seed with the device index so
  // each device gets an independent but reproducible RNG.
  std::seed_seq seq{static_cast<std::uint32_t>(seed),
                    static_cast<std::uint32_t>(seed >> 32),
                    static_cast<std::uint32_t>(index + 1)};
  DeviceState st;
  st.rng = std::mt19937(seq);
  st.battery_pct = uniform(st.rng, 62.0, 100.0);
  st.rssi_base = uniform(st.rng, -82.0, -55.0);
  // Small per-device environmental biases so kinds/regions differ a little.
  st.temp_bias = gauss(st.rng, 0.0, 1.0);
  st.wind_bias = device.kind == "coastal" ? 1.0 : 0.0;
  st.water_bias = (device.kind == "wash" || device.kind == "coastal") ? 0.15 : 0.0;
  return st;
}

void emit_reading(const Device& d, DeviceState& st, int interval_ms) {
  std::mt19937& rng = st.rng;
  st.sequence += 1;
  st.uptime_s += static_cast<std::uint64_t>(interval_ms) / 1000;

  // Battery drains slowly with a little noise; never below 1%.
  st.battery_pct -= uniform(rng, 0.005, 0.03);
  st.battery_pct = clamp(st.battery_pct, 1.0, 100.0);

  // RSSI wobbles around the device's base signal strength.
  const double rssi = st.rssi_base + gauss(rng, 0.0, 3.0);

  double lat = d.lat + gauss(rng, 0.0, 0.0004);
  double lon = d.lon + gauss(rng, 0.0, 0.0004);

  std::vector<std::string> flags;
  if (st.battery_pct < 20.0) flags.push_back("low_battery");
  if (rssi < -85.0) flags.push_back("weak_signal");
  if (uniform(rng, 0.0, 1.0) < 0.02) {
    flags.push_back("gps_jitter");
    lat += gauss(rng, 0.0, 0.01);
    lon += gauss(rng, 0.0, 0.01);
  }

  const double temperature_c = gauss(rng, 30.0 + st.temp_bias, 3.5);
  const double humidity_pct = clamp(gauss(rng, 28.0, 8.0), 0.0, 100.0);
  const double pm25_ugm3 = clamp(gauss(rng, 16.0, 6.0), 0.0, 500.0);
  const double smoke_ppm = clamp(gauss(rng, 2.0, 1.0), 0.0, 100.0);
  const double water_level_m = clamp(gauss(rng, 1.2 + st.water_bias, 0.15), 0.0, 30.0);
  const double wind_speed_mps = clamp(gauss(rng, 4.5 + st.wind_bias, 1.2), 0.0, 80.0);

  std::string flags_json = "[";
  for (size_t i = 0; i < flags.size(); ++i) {
    if (i) flags_json += ",";
    flags_json += "\"" + flags[i] + "\"";
  }
  flags_json += "]";

  std::cout << "{"
            << "\"topic\":\"sentinelgrid/v1/devices/" << json_escape(d.device_id)
            << "/telemetry\","
            << "\"schema_version\":\"1.0\","
            << "\"device_id\":\"" << json_escape(d.device_id) << "\","
            << "\"timestamp\":\"" << iso_timestamp_utc() << "\","
            << "\"location\":{\"lat\":" << num(lat, 6) << ",\"lon\":" << num(lon, 6) << "},"
            << "\"readings\":{"
            << "\"temperature_c\":" << num(temperature_c, 2) << ","
            << "\"humidity_pct\":" << num(humidity_pct, 2) << ","
            << "\"pm25_ugm3\":" << num(pm25_ugm3, 2) << ","
            << "\"smoke_ppm\":" << num(smoke_ppm, 2) << ","
            << "\"water_level_m\":" << num(water_level_m, 3) << ","
            << "\"wind_speed_mps\":" << num(wind_speed_mps, 2)
            << "},"
            << "\"health\":{"
            << "\"battery_pct\":" << num(st.battery_pct, 2) << ","
            << "\"rssi_dbm\":" << static_cast<int>(std::lround(rssi)) << ","
            << "\"uptime_s\":" << st.uptime_s << ","
            << "\"firmware_version\":\"" << json_escape(d.firmware_version) << "\""
            << "},"
            << "\"quality\":{"
            << "\"sequence\":" << st.sequence << ","
            << "\"source\":\"simulated\","
            << "\"flags\":" << flags_json
            << "}"
            << "}\n";
}

}  // namespace

int main(int argc, char** argv) {
  const Options opts = parse_args(argc, argv);
  const std::vector<Device> devices = load_devices(opts.devices_path);
  if (devices.empty()) {
    std::cerr << "edge-sim: no devices loaded from " << opts.devices_path << "\n";
    return 1;
  }
  std::cerr << "edge-sim: loaded " << devices.size() << " devices from "
            << opts.devices_path << " (seed=" << opts.seed << ", interval-ms="
            << opts.interval_ms << ", count=" << opts.count << ")\n";

  std::vector<DeviceState> states;
  states.reserve(devices.size());
  for (size_t i = 0; i < devices.size(); ++i) {
    states.push_back(make_state(devices[i], opts.seed, i));
  }

  for (long long cycle = 0; opts.count == 0 || cycle < opts.count; ++cycle) {
    for (size_t i = 0; i < devices.size(); ++i) {
      emit_reading(devices[i], states[i], opts.interval_ms);
    }
    std::cout.flush();
    const bool last = opts.count != 0 && cycle + 1 >= opts.count;
    if (!last && opts.interval_ms > 0) {
      std::this_thread::sleep_for(std::chrono::milliseconds(opts.interval_ms));
    }
  }
  return 0;
}
