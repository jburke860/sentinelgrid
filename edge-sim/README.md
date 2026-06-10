# Edge Simulator

`edge-sim` will be a C++ virtual sensor publisher. It should simulate many field devices and publish MQTT telemetry using the contract in `docs/MQTT_CONTRACT.md`.

Initial behavior:

- deterministic random seed
- configurable device count
- configurable publish interval
- JSON telemetry output
- MQTT publish target
- failure-mode flags

Future behavior:

- replay public environmental data
- Zephyr `native_sim` target
- Wokwi ESP32 demo

