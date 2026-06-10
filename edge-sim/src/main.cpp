#include <chrono>
#include <iomanip>
#include <iostream>
#include <random>
#include <sstream>
#include <string>
#include <thread>

namespace {

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

double sample(std::mt19937& rng, double mean, double stddev) {
  std::normal_distribution<double> dist(mean, stddev);
  return dist(rng);
}

}  // namespace

int main() {
  std::mt19937 rng(42);
  const std::string device_id = "edge-ca-001";

  for (int sequence = 1; sequence <= 5; ++sequence) {
    const double lat = 34.0522 + sample(rng, 0.0, 0.002);
    const double lon = -118.2437 + sample(rng, 0.0, 0.002);
    const double temperature_c = sample(rng, 30.0, 3.5);
    const double humidity_pct = sample(rng, 25.0, 8.0);
    const double pm25_ugm3 = sample(rng, 18.0, 6.0);
    const double smoke_ppm = sample(rng, 2.0, 1.0);
    const double battery_pct = 92.0 - sequence * 0.1;

    std::cout << "{"
              << "\"schema_version\":\"1.0\","
              << "\"device_id\":\"" << device_id << "\","
              << "\"timestamp\":\"" << iso_timestamp_utc() << "\","
              << "\"location\":{\"lat\":" << lat << ",\"lon\":" << lon << "},"
              << "\"readings\":{"
              << "\"temperature_c\":" << temperature_c << ","
              << "\"humidity_pct\":" << humidity_pct << ","
              << "\"pm25_ugm3\":" << pm25_ugm3 << ","
              << "\"smoke_ppm\":" << smoke_ppm << ","
              << "\"water_level_m\":" << sample(rng, 1.2, 0.1) << ","
              << "\"wind_speed_mps\":" << sample(rng, 4.5, 1.2)
              << "},"
              << "\"health\":{"
              << "\"battery_pct\":" << battery_pct << ","
              << "\"rssi_dbm\":-67,"
              << "\"uptime_s\":" << sequence * 30 << ","
              << "\"firmware_version\":\"0.1.0\""
              << "},"
              << "\"quality\":{"
              << "\"sequence\":" << sequence << ","
              << "\"source\":\"simulated\","
              << "\"flags\":[]"
              << "}"
              << "}\n";

    std::this_thread::sleep_for(std::chrono::milliseconds(250));
  }

  return 0;
}

