#include <DHT.h>
#include <WiFi.h>
#include <WebServer.h>
#include <math.h>

// Example pin map for ESP32 DevKit V1 (30-pin). Change only to suitable ADC pins.
static const int DHT_PIN = 4;
static const int DHT_TYPE = DHT11;
static const int SOIL_ADC_PIN = 34;  // ADC1 input-only pin
static const int RAIN_ADC_PIN = 35;  // ADC1 input-only pin
static const unsigned long SEND_INTERVAL_MS = 2000;
static const char *WIFI_SSID = "YOUR_WIFI_NAME";
static const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
static const char *DEVICE_ID = "PRITHVI-ESP32-01";

DHT dht(DHT_PIN, DHT_TYPE);
unsigned long lastSentAt = 0;
unsigned long lastWifiAttemptAt = 0;
bool ipReported = false;
float latestTemperatureC = NAN;
float latestHumidityPct = NAN;
int latestSoilRaw = -1;
int latestRainRaw = -1;
WebServer server(80);

void printNullableFloat(float value) {
  if (isnan(value) || isinf(value)) Serial.print("null");
  else Serial.print(value, 1);
}

void printNullableAdcValue(int value) {
  if (value < 0 || value > 4095) Serial.print("null");
  else Serial.print(value);
}

void appendNullableFloat(String &json, float value) {
  if (isnan(value) || isinf(value)) json += "null";
  else json += String(value, 1);
}

void appendNullableAdc(String &json, int value) {
  if (value < 0 || value > 4095) json += "null";
  else json += String(value);
}

void sendJson(const String &body) {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", body);
}

void handleHealth() {
  String body = "{\"device_id\":\"";
  body += DEVICE_ID;
  body += "\",\"status\":\"ok\"}";
  sendJson(body);
}

void handleSensors() {
  String body = "{\"device_id\":\"";
  body += DEVICE_ID;
  body += "\",\"temperature\":";
  appendNullableFloat(body, latestTemperatureC);
  body += ",\"humidity\":";
  appendNullableFloat(body, latestHumidityPct);
  body += ",\"soil_raw\":";
  appendNullableAdc(body, latestSoilRaw);
  body += ",\"rain_raw\":";
  appendNullableAdc(body, latestRainRaw);
  body += ",\"uptime_ms\":";
  body += String(millis());  // Uptime only, not a wall-clock timestamp.
  body += "}";
  sendJson(body);
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  pinMode(SOIL_ADC_PIN, INPUT);
  pinMode(RAIN_ADC_PIN, INPUT);
  dht.begin();
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptAt = millis();
  server.on("/health", HTTP_GET, handleHealth);
  server.on("/sensors", HTTP_GET, handleSensors);
  server.onNotFound([]() { server.send(404, "application/json", "{\"error\":\"not_found\"}"); });
  server.begin();
  Serial.println("PRITHVI sensor HTTP server ready; waiting for Wi-Fi.");
}

void loop() {
  server.handleClient();
  const unsigned long now = millis();
  if (WiFi.status() == WL_CONNECTED) {
    if (!ipReported) {
      Serial.print("Wi-Fi connected. ESP32 IP: http://");
      Serial.println(WiFi.localIP());
      ipReported = true;
    }
  } else {
    ipReported = false;
    if (now - lastWifiAttemptAt >= 10000) {
      lastWifiAttemptAt = now;
      WiFi.reconnect();
    }
  }
  if (now - lastSentAt < SEND_INTERVAL_MS) return;
  lastSentAt = now;

  // DHT11 can return NaN on a failed read. Keep it explicit as JSON null.
  latestTemperatureC = dht.readTemperature();
  latestHumidityPct = dht.readHumidity();
  latestSoilRaw = analogRead(SOIL_ADC_PIN);
  latestRainRaw = analogRead(RAIN_ADC_PIN);

  Serial.print("{\"device_id\":\"");
  Serial.print(DEVICE_ID);
  Serial.print("\",\"timestamp\":null,\"uptime_ms\":");
  Serial.print(now);
  Serial.print(",\"temperature_c\":");
  printNullableFloat(latestTemperatureC);
  Serial.print(",\"humidity_pct\":");
  printNullableFloat(latestHumidityPct);
  Serial.print(",\"soil_raw\":");
  printNullableAdcValue(latestSoilRaw);
  Serial.print(",\"rain_raw\":");
  printNullableAdcValue(latestRainRaw);
  Serial.println("}");  // One JSON object per line; 115200 baud.
}
