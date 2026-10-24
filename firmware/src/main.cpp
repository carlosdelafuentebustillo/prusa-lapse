#include <Arduino.h>
#include "esp_camera.h"
#include <WiFiManager.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include <SD_MMC.h>
#include <FS.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>
#include <Update.h>

String prusaIp = "";
String prusaApiKey = "";
String prusaConnectToken = "";
String prusaConnectFingerprint = "";
int last_prusa_connect_code = 0;
String cameraName = "PrusaLapse Camera";
#define VERSION_MAJOR 1
#define VERSION_MINOR 10
#define FIRMWARE_VERSION "v1.2.3"

bool offlineMode = false;
bool sdCardAvailable = false;
int sessionId = 0;
String previousPrinterState = "";
String sessionStartTimestamp = "";

int brightnessVal = 0;
int contrastVal = 0;
int hmirrorVal = 0;
int vflipVal = 0;
volatile int led_state = 1;

Preferences preferences;

TaskHandle_t previewTaskHandle = NULL;
TaskHandle_t sdWriteTaskHandle = NULL;
TaskHandle_t heartbeatTaskHandle = NULL;
TaskHandle_t captureTaskHandle = NULL;
TaskHandle_t prusaLinkTaskHandle = NULL;

void saveConfigToSD() {
  if (sdCardAvailable) {
    File file = SD_MMC.open("/config.txt", FILE_WRITE);
    if (file) {
      file.printf("PRUSA_IP=%s\n", prusaIp.c_str());
      file.printf("PRUSA_API_KEY=%s\n", prusaApiKey.c_str());
      file.printf("PRUSA_CONNECT_TOKEN=%s\n", prusaConnectToken.c_str());
      file.printf("OFFLINE_MODE=%d\n", offlineMode ? 1 : 0);
      file.printf("CAMERA_NAME=%s\n", cameraName.c_str());
      file.printf("BRIGHTNESS=%d\n", brightnessVal);
      file.printf("CONTRAST=%d\n", contrastVal);
      file.printf("HMIRROR=%d\n", hmirrorVal);
      file.printf("VFLIP=%d\n", vflipVal);
      file.printf("LED_STATE=%d\n", led_state);
      if (WiFi.SSID() != "") file.printf("WIFI_SSID=%s\n", WiFi.SSID().c_str());
      file.close();
      Serial.println("Saved config to SD config.txt");
    }
  }
}

void syncConfig() {
  preferences.begin("prusalapse", false);
  
  // 1. Load NVS fallback
  prusaIp = preferences.getString("prusaIp", "");
  prusaApiKey = preferences.getString("prusaApiKey", "");
  prusaConnectToken = preferences.getString("connectToken", "");
  String customFp = preferences.getString("fingerprint", "");
  if (customFp.length() >= 16) {
    prusaConnectFingerprint = customFp;
  }
  if (prusaConnectToken.indexOf('*') != -1) {
    // Clear corrupted token that was saved with asterisks
    prusaConnectToken = "";
    preferences.putString("connectToken", "");
  }
  offlineMode = preferences.getBool("offlineMode", false);
  sessionId = preferences.getInt("sessionId", 0);
  cameraName = preferences.getString("cameraName", "PrusaLapse Camera");
  brightnessVal = preferences.getInt("brightness", 0);
  contrastVal = preferences.getInt("contrast", 0);
  hmirrorVal = preferences.getInt("hmirror", 0);
  vflipVal = preferences.getInt("vflip", 0);
  led_state = preferences.getInt("led", 1);
  preferences.end();
  
  if (sdCardAvailable) {
    if (SD_MMC.exists("/config.txt")) {
      // 2. Read SD Card. It takes priority over NVS!
      bool sdHasData = false;
      String sdSsid = "";
      String sdPass = "";
      
      File file = SD_MMC.open("/config.txt", FILE_READ);
      while(file.available()) {
        String line = file.readStringUntil('\n');
        line.trim();
        if (line.length() == 0) continue;
        
        if (line.startsWith("PRUSA_IP=")) { prusaIp = line.substring(9); sdHasData = true; }
        else if (line.startsWith("PRUSA_API_KEY=")) { prusaApiKey = line.substring(14); sdHasData = true; }
        else if (line.startsWith("OFFLINE_MODE=1")) { offlineMode = true; sdHasData = true; }
        else if (line.startsWith("OFFLINE_MODE=0")) { offlineMode = false; sdHasData = true; }
        else if (line.startsWith("PRUSA_CONNECT_TOKEN=")) { prusaConnectToken = line.substring(20); sdHasData = true; }
        else if (line.startsWith("CAMERA_NAME=")) { cameraName = line.substring(12); sdHasData = true; }
        else if (line.startsWith("BRIGHTNESS=")) { brightnessVal = line.substring(11).toInt(); sdHasData = true; }
        else if (line.startsWith("CONTRAST=")) { contrastVal = line.substring(9).toInt(); sdHasData = true; }
        else if (line.startsWith("HMIRROR=")) { hmirrorVal = line.substring(8).toInt(); sdHasData = true; }
        else if (line.startsWith("VFLIP=")) { vflipVal = line.substring(6).toInt(); sdHasData = true; }
        else if (line.startsWith("LED_STATE=")) { led_state = line.substring(10).toInt(); sdHasData = true; }
        else if (line.startsWith("WIFI_SSID=")) { sdSsid = line.substring(10); }
        else if (line.startsWith("WIFI_PASS=")) { sdPass = line.substring(10); }
      }
      file.close();
      
      if (sdHasData) {
        // Save the new SD values into NVS
        preferences.begin("prusalapse", false);
        preferences.putString("prusaIp", prusaIp);
        preferences.putString("prusaApiKey", prusaApiKey);
        preferences.putString("connectToken", prusaConnectToken);
        preferences.putBool("offlineMode", offlineMode);
        preferences.putString("cameraName", cameraName);
        preferences.putInt("brightness", brightnessVal);
        preferences.putInt("contrast", contrastVal);
        preferences.putInt("hmirror", hmirrorVal);
        preferences.putInt("vflip", vflipVal);
        preferences.putInt("led", led_state);
        preferences.end();
      }
      
      // Check if user provided new Wi-Fi credentials in config.txt
      if (sdSsid != "" && sdPass != "") {
        Serial.printf("Wi-Fi credentials provided in config.txt. Connecting to %s...\n", sdSsid.c_str());
        WiFi.begin(sdSsid.c_str(), sdPass.c_str());
        
        int attempts = 0;
        while (WiFi.status() != WL_CONNECTED && attempts < 15) {
          delay(1000);
          Serial.print(".");
          attempts++;
        }
        Serial.println();
        
        if (WiFi.status() == WL_CONNECTED) {
          Serial.println("Wi-Fi connected successfully using SD credentials.");
          
          // Now rewrite the config.txt WITHOUT the WIFI_PASS so it isn't left in plain text
          saveConfigToSD();
          Serial.println("config.txt updated (password removed).");
        } else {
          Serial.println("Failed to connect using SD credentials. Password not removed.");
        }
      }
      
    } else {
      // 3. SD card is empty/missing config.txt. Sync NVS -> SD Card
      saveConfigToSD();
    }
  } else {
    // Write defaults to NVS if it's completely empty and no SD
    preferences.begin("prusalapse", false);
    if (preferences.getString("cameraName", "") == "") {
      preferences.putString("cameraName", cameraName);
      preferences.putBool("offlineMode", offlineMode);
    }
    preferences.end();
  }
}

time_t parseHttpDate(String dateStr) {
  // Format: "Wed, 03 Jun 2026 21:11:51 GMT" or similar
  int firstSpace = dateStr.indexOf(' ');
  if (firstSpace == -1) return 0;
  String sub = dateStr.substring(firstSpace + 1);
  sub.trim();
  
  char monthStr[4];
  int day, year, hour, min, sec;
  if (sscanf(sub.c_str(), "%d %3s %d %d:%d:%d", &day, monthStr, &year, &hour, &min, &sec) == 6) {
    struct tm tm;
    tm.tm_sec = sec;
    tm.tm_min = min;
    tm.tm_hour = hour;
    tm.tm_mday = day;
    tm.tm_year = year - 1900;
    
    const char* months[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
    tm.tm_mon = 0;
    for (int i = 0; i < 12; i++) {
      if (strcmp(monthStr, months[i]) == 0) {
        tm.tm_mon = i;
        break;
      }
    }
    tm.tm_isdst = 0;
    
    // Calculate Epoch manually for UTC to avoid local timezone offsets from mktime
    int y = tm.tm_year + 1900;
    int m = tm.tm_mon + 1;
    int d = tm.tm_mday;
    
    long days = d - 1;
    int month_days[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    for (int i = 1; i < m; i++) {
      days += month_days[i - 1];
      if (i == 2 && ((y % 4 == 0 && y % 100 != 0) || (y % 400 == 0))) {
        days += 1;
      }
    }
    for (int i = 1970; i < y; i++) {
      days += 365;
      if ((i % 4 == 0 && i % 100 != 0) || (i % 400 == 0)) {
        days += 1;
      }
    }
    
    return days * 86400 + hour * 3600 + min * 60 + sec;
  }
  return 0;
}

int last_http_code = 0; // Added globally for diagnostics
int offlineFrameCount = 0;
uint32_t lastPollTime = 0;
float currentZValue = -1.0;
float maxConfirmedZ = -1.0;
float prevPollZ = -1.0;
int zStableCount = 0;
bool gcodeTriggerUsedInJob = false;
int currentJobId = -1;
String currentPrinterState = "";
float currentJobProgress = 0.0;
float currentTempNozzle = 0.0;
float currentTargetNozzle = 0.0;
String activeTriggerMode = "auto";
uint32_t lastHeartbeatTime = 0;

// Prusa Connect Cloud Camera Integration
bool prusaConnectInfoSent = false;
bool pendingOTAUpdate = false;
#define PREVIEW_CAPTURE_INTERVAL 10000  // Take a VGA preview snapshot every 10 seconds

// ISRG Root X1 CA Certificate (used by connect.prusa3d.com / webcam.connect.prusa3d.com)
const char prusa_connect_ca[] PROGMEM = R"rawliteral(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)rawliteral";

SemaphoreHandle_t camera_mutex = NULL;
SemaphoreHandle_t snapshot_mutex = NULL;
SemaphoreHandle_t sd_mutex = NULL;
SemaphoreHandle_t sd_write_semaphore = NULL;
bool sd_write_in_progress = false;
int consecutiveCaptureFailures = 0;

void setupCamera();

// ==========================================
// CAMERA PIN CONFIGURATION (Ai-Thinker)
// ==========================================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

AsyncWebServer server(80);
uint8_t *captured_photo_buf = NULL;
size_t captured_photo_len = 0;

// Shared snapshot buffer (updated every 10s by the background task, served to both Prusa Connect and webapp)
uint8_t *snapshot_buf = NULL;
size_t snapshot_buf_size = 0;
size_t snapshot_len = 0;

// ==========================================
volatile bool capture_in_progress = false;

// HQ Timelapse Capture (UXGA) — triggered by PrusaLink Z-change or M220 S99
void captureTask(void *pvParameters) {
    capture_in_progress = true;
    
    if (camera_mutex && xSemaphoreTake(camera_mutex, pdMS_TO_TICKS(6000)) == pdTRUE) {
      sensor_t * s = esp_camera_sensor_get();
      if (!s) {
        Serial.println("captureTask: Sensor not initialized, attempting recovery...");
        esp_camera_deinit();
        setupCamera();
        s = esp_camera_sensor_get();
      }

      // Auto Flash (led_state = 2)
      if (led_state == 2) {
        digitalWrite(4, HIGH);
        vTaskDelay(pdMS_TO_TICKS(150)); // let auto-exposure adjust to the light
      }
      
      // Switch to UXGA for high-quality timelapse capture
      if (s && psramFound()) {
        s->set_framesize(s, FRAMESIZE_UXGA);
      }
      
      // Flush stale frames and let sensor settle at new resolution
      // (2 frames with 120ms delay flushes fb_count=2 buffers in ~0.5s total)
      for (int i = 0; i < 2; i++) {
        vTaskDelay(pdMS_TO_TICKS(120));
        camera_fb_t *old_fb = esp_camera_fb_get();
        if (old_fb) esp_camera_fb_return(old_fb);
      }
      
      camera_fb_t *fb = esp_camera_fb_get();
      
      // Turn flash back off if in Auto mode
      if (led_state == 2) {
        digitalWrite(4, LOW);
      }
      
      if (!fb || fb->len < 10000) {
        Serial.println("HQ Capture failed or image too small");
        if (fb) esp_camera_fb_return(fb);
        consecutiveCaptureFailures++;
        if (consecutiveCaptureFailures >= 3) {
          Serial.println("3 consecutive capture failures — power-cycling camera sensor...");
          esp_camera_deinit();
          setupCamera();
          consecutiveCaptureFailures = 0;
        } else if (s) {
          s->set_framesize(s, FRAMESIZE_VGA);
        }
        xSemaphoreGive(camera_mutex);
        capture_in_progress = false;
        vTaskDelete(NULL);
        return;
      }
      consecutiveCaptureFailures = 0;
      
      // Store in HQ timelapse buffer (overwritten each capture)
      if (captured_photo_buf) {
        free(captured_photo_buf);
        captured_photo_buf = NULL;
        captured_photo_len = 0;
      }
      
      if (psramFound()) {
        captured_photo_buf = (uint8_t *)ps_malloc(fb->len);
      } else {
        captured_photo_buf = (uint8_t *)malloc(fb->len);
      }
      
      if (captured_photo_buf) {
        memcpy(captured_photo_buf, fb->buf, fb->len);
        captured_photo_len = fb->len;
        Serial.printf("HQ Capture: %d bytes (UXGA)\n", fb->len);
      }
      
      // Wake up the background SD writer task
      if (sd_write_semaphore != NULL) {
        xSemaphoreGive(sd_write_semaphore);
      }
      
      esp_camera_fb_return(fb);
      
      // Switch back to VGA (idle resolution for previews)
      if (s) s->set_framesize(s, FRAMESIZE_VGA);
      
      xSemaphoreGive(camera_mutex);
    }
    
    capture_in_progress = false;
    vTaskDelete(NULL);
}

void takePreviewSnapshot() {
  if (camera_mutex && xSemaphoreTake(camera_mutex, pdMS_TO_TICKS(2000)) == pdTRUE) {
    sensor_t * s = esp_camera_sensor_get();
    if (!s) {
      Serial.println("takePreviewSnapshot: Sensor not found, attempting recovery...");
      esp_camera_deinit();
      setupCamera();
      s = esp_camera_sensor_get();
    }
    if (led_state == 2) digitalWrite(4, HIGH); // Auto Flash on inside mutex

    // Camera should already be at VGA, but ensure it
    if (s) s->set_framesize(s, FRAMESIZE_VGA);
    
    if (led_state == 2) vTaskDelay(pdMS_TO_TICKS(150)); // let auto-exposure adjust

    // Flush stale frames from the hardware buffer
    for (int i = 0; i < 2; i++) {
      camera_fb_t *old_fb = esp_camera_fb_get();
      if (old_fb) esp_camera_fb_return(old_fb);
    }
    
    // Grab one fresh frame
    camera_fb_t *fb = esp_camera_fb_get();

    if (led_state == 2) digitalWrite(4, LOW); // Auto Flash off
    
    if (fb) {
      // Store in the preview buffer (overwrite previous)
      if (snapshot_mutex && xSemaphoreTake(snapshot_mutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
        if (!snapshot_buf || snapshot_buf_size < fb->len) {
          if (snapshot_buf) free(snapshot_buf);
          if (psramFound()) {
            snapshot_buf = (uint8_t *)ps_malloc(fb->len);
          } else {
            snapshot_buf = (uint8_t *)malloc(fb->len);
          }
          if (snapshot_buf) snapshot_buf_size = fb->len;
        }
        if (snapshot_buf) {
          memcpy(snapshot_buf, fb->buf, fb->len);
          snapshot_len = fb->len;
        }
        xSemaphoreGive(snapshot_mutex);
      }
      esp_camera_fb_return(fb);
    }
    
    xSemaphoreGive(camera_mutex);
    // Camera is now idle until next trigger
  }
}

// ==========================================
// PERIODIC PREVIEW + PRUSA CONNECT UPLOAD TASK
// Every 10s: wake camera → VGA capture → store in snapshot_buf → upload to Prusa Connect → idle
// ==========================================
void previewAndUploadTask(void *pvParameters) {
  int prusaConnectFailures = 0;
  int backoffCycles = 0;

  while (true) {
    vTaskDelay(pdMS_TO_TICKS(PREVIEW_CAPTURE_INTERVAL));

    if (capture_in_progress || sd_write_in_progress) {
      continue; // Don't interfere with HQ timelapse captures or SD writes
    }

    // If printing and Prusa Connect is offline/unconfigured, don't disturb the UXGA sensor every 10s
    bool wantPrusaConnect = (WiFi.status() == WL_CONNECTED && prusaConnectToken.length() > 0 && prusaConnectFingerprint.length() > 0);
    if (currentPrinterState == "PRINTING" && (!wantPrusaConnect || prusaConnectFailures >= 2)) {
      continue;
    }

    // --- 1. Take a fresh VGA preview snapshot ---
    takePreviewSnapshot();

    if (!wantPrusaConnect) {
      continue;
    }

    if (backoffCycles > 0) {
      backoffCycles--;
      continue;
    }

    // --- 2. Prusa Connect: send info payload if not yet registered ---
    if (!prusaConnectInfoSent) {
      WiFiClientSecure infoClient;
      infoClient.setInsecure();
      infoClient.setTimeout(3);
      if (infoClient.connect("camera-service.prusa3d.com", 443, 3000)) {
        String jsonPayload = "{\"config\":{\"name\":\"" + cameraName + "\",\"trigger_scheme\":\"TEN_SEC\"},\"device\":{\"type\":\"ESP32\",\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\",\"hardware_version\":\"ESP32-CAM\"}}";
        
        infoClient.println("PUT /v1/camera-info HTTP/1.1");
        infoClient.println("Host: camera-service.prusa3d.com");
        infoClient.println("User-Agent: ESP32-CAM-PrusaLapse/" + String(FIRMWARE_VERSION));
        infoClient.println("Connection: close");
        infoClient.println("Content-Type: application/json");
        infoClient.println("Fingerprint: " + prusaConnectFingerprint);
        infoClient.println("Token: " + prusaConnectToken);
        infoClient.println("Content-Length: " + String(jsonPayload.length()));
        infoClient.println();
        infoClient.print(jsonPayload);
        
        unsigned long timeout = millis() + 3500;
        int code = 0;
        while (infoClient.connected() && millis() < timeout) {
          if (infoClient.available()) {
            String line = infoClient.readStringUntil('\n');
            line.trim();
            if (line.startsWith("HTTP/1.")) {
              int sp = line.indexOf(' ');
              if (sp != -1) {
                code = line.substring(sp + 1, sp + 4).toInt();
              }
              last_prusa_connect_code = code;
              if (code >= 200 && code < 300) {
                prusaConnectInfoSent = true;
                prusaConnectFailures = 0;
                Serial.printf("Prusa Connect: Camera Info registered successfully (HTTP %d).\n", code);
              } else {
                prusaConnectFailures++;
                Serial.printf("Prusa Connect: Info payload failed with code %d\n", code);
              }
              break;
            }
          }
          vTaskDelay(pdMS_TO_TICKS(10));
        }
        infoClient.stop();
        continue; // Let connection close and memory settle; snapshots begin next loop
      } else {
        Serial.println("Prusa Connect: Info client HTTPS connection failed");
        last_prusa_connect_code = -1;
        prusaConnectFailures++;
        if (prusaConnectFailures >= 2) backoffCycles = 5; // Wait ~60s before retrying unreachable cloud
        infoClient.stop();
        continue;
      }
    }

    // --- 3. Upload the preview buffer to Prusa Connect ---
    if (WiFi.status() == WL_CONNECTED && prusaConnectToken.length() > 0 && prusaConnectFingerprint.length() > 0) {
      uint8_t *upload_buf = NULL;
      size_t upload_len = 0;
      
      if (snapshot_mutex && xSemaphoreTake(snapshot_mutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
        if (snapshot_buf && snapshot_len > 0) {
          if (psramFound()) {
            upload_buf = (uint8_t *)ps_malloc(snapshot_len);
          } else {
            upload_buf = (uint8_t *)malloc(snapshot_len);
          }
          if (upload_buf) {
            memcpy(upload_buf, snapshot_buf, snapshot_len);
            upload_len = snapshot_len;
          }
        }
        xSemaphoreGive(snapshot_mutex);
      }

      if (upload_buf && upload_len > 0) {
        WiFiClientSecure client;
        client.setInsecure();
        client.setTimeout(3);

        if (client.connect("camera-service.prusa3d.com", 443, 3000)) {
          client.println("PUT /v1/snapshot HTTP/1.1");
          client.println("Host: camera-service.prusa3d.com");
          client.println("User-Agent: ESP32-CAM-PrusaLapse/" + String(FIRMWARE_VERSION));
          client.println("Connection: close");
          client.println("Content-Type: image/jpeg");
          client.println("Fingerprint: " + prusaConnectFingerprint);
          client.println("Token: " + prusaConnectToken);
          client.println("Content-Length: " + String(upload_len));
          client.println();

          size_t sent = 0;
          const size_t chunkSize = 2048;
          uint8_t *buf = upload_buf;
          size_t remaining = upload_len;
          while (remaining > 0) {
            size_t toSend = (remaining > chunkSize) ? chunkSize : remaining;
            sent += client.write(buf, toSend);
            buf += toSend;
            remaining -= toSend;
          }

          unsigned long responseTimeout = millis() + 3500;
          int httpCode = 0;
          while (client.connected() && millis() < responseTimeout) {
            if (client.available()) {
              String line = client.readStringUntil('\n');
              line.trim();
              if (line.startsWith("HTTP/1.")) {
                int sp = line.indexOf(' ');
                if (sp != -1) {
                  httpCode = line.substring(sp + 1, sp + 4).toInt();
                }
                last_prusa_connect_code = httpCode;
                prusaConnectFailures = 0;
              }
              if (line.length() == 0) {
                Serial.printf("Prusa Connect upload: %d (%d/%d bytes)\n", httpCode, sent, upload_len);
                break;
              }
            }
            vTaskDelay(pdMS_TO_TICKS(10));
          }
          client.stop();
        } else {
          Serial.println("Prusa Connect: HTTPS connection failed");
          last_prusa_connect_code = -1;
          prusaConnectFailures++;
          if (prusaConnectFailures >= 2) backoffCycles = 5;
          client.stop();
        }
      }
      
      if (upload_buf) free(upload_buf);
    }
  }
}

void setupCamera() {
  // Power-cycle the OV2640 sensor via PWDN pin (GPIO 32) to recover from warm reboots / brownouts
  pinMode(PWDN_GPIO_NUM, OUTPUT);
  digitalWrite(PWDN_GPIO_NUM, HIGH);
  delay(120);
  digitalWrite(PWDN_GPIO_NUM, LOW);
  delay(120);

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 10000000; // Lowered to 10MHz to prevent image corruption (green bars/white screens)
  config.pixel_format = PIXFORMAT_JPEG;
  
  if(psramFound()){
    config.frame_size = FRAMESIZE_UXGA; // Allocate buffers for high-res UXGA captures
    config.jpeg_quality = 10;
    config.fb_count = 2;
  } else {
    config.frame_size = FRAMESIZE_VGA; // Fallback for non-PSRAM
    config.jpeg_quality = 12;
    config.fb_count = 1;
  }
  
  esp_err_t err = ESP_FAIL;
  for (int attempt = 1; attempt <= 3; attempt++) {
    err = esp_camera_init(&config);
    if (err == ESP_OK && esp_camera_sensor_get() != NULL) {
      Serial.printf("Camera initialized successfully on attempt %d.\n", attempt);
      break;
    }
    Serial.printf("Camera init attempt %d failed with error 0x%x. Power-cycling sensor...\n", attempt, err);
    esp_camera_deinit();
    digitalWrite(PWDN_GPIO_NUM, HIGH);
    delay(250);
    digitalWrite(PWDN_GPIO_NUM, LOW);
    delay(250);
  }

  // Explicitly configure sensor settings and disable color bar/test pattern
  sensor_t * s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, brightnessVal);     // -2 to 2
    s->set_contrast(s, contrastVal);       // -2 to 2
    s->set_saturation(s, 0);     // -2 to 2
    s->set_special_effect(s, 0); // 0 to 6
    s->set_whitebal(s, 1);       // 0 = disable , 1 = enable
    s->set_awb_gain(s, 1);       // 0 = disable , 1 = enable
    s->set_wb_mode(s, 0);        // 0 to 4 (0 = Auto)
    s->set_exposure_ctrl(s, 1);  // 0 = disable , 1 = enable
    s->set_aec2(s, 0);           // 0 = disable , 1 = enable
    s->set_ae_level(s, 0);       // -2 to 2
    s->set_gain_ctrl(s, 1);      // 0 = disable , 1 = enable
    s->set_agc_gain(s, 0);       // 0 to 30
    s->set_gainceiling(s, (gainceiling_t)0);
    s->set_bpc(s, 0);            // 0 = disable , 1 = enable
    s->set_wpc(s, 1);            // 0 = disable , 1 = enable
    s->set_raw_gma(s, 1);        // 0 = disable , 1 = enable
    s->set_lenc(s, 1);           // 0 = disable , 1 = enable
    s->set_hmirror(s, hmirrorVal);        // 0 = disable , 1 = enable
    s->set_vflip(s, vflipVal);          // 0 = disable , 1 = enable
    s->set_dcw(s, 1);            // 0 = disable , 1 = enable
    s->set_colorbar(s, 0);       // Ensure test pattern / color bar is DISABLED!
    s->set_framesize(s, FRAMESIZE_VGA); // Boot at VGA — idle resolution for previews
  }
}



// ==========================================
// BACKGROUND TAR PACKING TASK
// Packs a finished session's JPGs into a single .tar file
// Uses heap/PSRAM buffers and sd_mutex to prevent stack overflow and FATFS corruption
// ==========================================
void packTarTask(void *pvParameters) {
  int sId = (intptr_t)pvParameters;
  char sessionIdStr[16];
  snprintf(sessionIdStr, sizeof(sessionIdStr), "s%04d", sId);
  
  String tarTmpPath = String("/lapse/") + sessionIdStr + ".tar.tmp";
  String tarPath = String("/lapse/") + sessionIdStr + ".tar";
  String prefix = String(sessionIdStr) + "_";
  Serial.printf("Background Task: Starting to pack %s\n", tarPath.c_str());

  uint8_t *header = (uint8_t *)(psramFound() ? ps_malloc(512) : malloc(512));
  uint8_t *buf = (uint8_t *)(psramFound() ? ps_malloc(4096) : malloc(4096));
  uint8_t *empty = (uint8_t *)(psramFound() ? ps_malloc(1024) : malloc(1024));
  if (!header || !buf || !empty) {
    if (header) free(header);
    if (buf) free(buf);
    if (empty) free(empty);
    Serial.println("Background Task: Out of memory for TAR buffers");
    vTaskDelete(NULL);
    return;
  }

  if (sd_mutex) xSemaphoreTake(sd_mutex, portMAX_DELAY);

  File tarFile = SD_MMC.open(tarTmpPath.c_str(), FILE_WRITE);
  if (!tarFile) {
    if (sd_mutex) xSemaphoreGive(sd_mutex);
    free(header); free(buf); free(empty);
    Serial.println("Background Task: Failed to create TAR file");
    vTaskDelete(NULL);
    return;
  }
  
  File dir = SD_MMC.open("/lapse");
  if (!dir) {
    tarFile.close();
    if (sd_mutex) xSemaphoreGive(sd_mutex);
    free(header); free(buf); free(empty);
    vTaskDelete(NULL);
    return;
  }
  
  bool isDir = false;
  String nextPath = dir.getNextFileName(&isDir);
  while (nextPath.length() > 0) {
    String filename = nextPath;
    int lastSlash = filename.lastIndexOf('/');
    if (lastSlash != -1) filename = filename.substring(lastSlash + 1);

    if (!isDir && filename.startsWith(prefix) && filename.endsWith(".jpg")) {
      String fullFilePath = String("/lapse/") + filename;
      File file = SD_MMC.open(fullFilePath.c_str(), FILE_READ);
      if (file) {
        memset(header, 0, 512);
        strncpy((char*)header, filename.c_str(), 99);
        strcpy((char*)header + 100, "0000644");
        strcpy((char*)header + 108, "0000000");
        strcpy((char*)header + 116, "0000000");
        
        size_t filesize = file.size();
        snprintf((char*)header + 124, 12, "%011o", (unsigned int)filesize);
        strcpy((char*)header + 136, "00000000000");
        header[156] = '0';
        
        strcpy((char*)header + 257, "ustar");
        header[262] = ' ';
        strcpy((char*)header + 263, " ");
        
        memset((char*)header + 148, ' ', 8);
        unsigned int checksum = 0;
        for (int i = 0; i < 512; i++) checksum += header[i];
        snprintf((char*)header + 148, 8, "%06o", checksum);
        
        tarFile.write(header, 512);
        
        size_t remaining = filesize;
        while (remaining > 0) {
          size_t toRead = remaining > 4096 ? 4096 : remaining;
          size_t bytesRead = file.read(buf, toRead);
          if (bytesRead == 0) break;
          tarFile.write(buf, bytesRead);
          size_t mod512 = bytesRead % 512;
          if (mod512 != 0) {
            size_t pad = 512 - mod512;
            memset(buf, 0, pad);
            tarFile.write(buf, pad);
          }
          remaining -= bytesRead;
          vTaskDelay(pdMS_TO_TICKS(1)); // feed watchdog
        }
        file.close();
      }
    }
    nextPath = dir.getNextFileName(&isDir);
    vTaskDelay(pdMS_TO_TICKS(1));
  }
  dir.close();
  
  memset(empty, 0, 1024);
  tarFile.write(empty, 1024);
  tarFile.close();
  
  if (SD_MMC.exists(tarPath.c_str())) {
    SD_MMC.remove(tarPath.c_str());
  }
  SD_MMC.rename(tarTmpPath.c_str(), tarPath.c_str());

  if (sd_mutex) xSemaphoreGive(sd_mutex);
  free(header); free(buf); free(empty);
  
  Serial.printf("Background Task: Finished packing %s\n", tarPath.c_str());
  vTaskDelete(NULL);
}

// ==========================================
// BACKGROUND SD WRITER TASK
// ==========================================
void sdWriteTask(void *pvParameters) {
  while (true) {
    if (xSemaphoreTake(sd_write_semaphore, portMAX_DELAY) == pdTRUE) {
      sd_write_in_progress = true;
      
      if (sdCardAvailable && captured_photo_buf && captured_photo_len > 0) {
        char filename[64];
        if (offlineMode && sessionId > 0) {
          snprintf(filename, sizeof(filename), "/lapse/s%04d_f%04d.jpg", sessionId, offlineFrameCount);
        } else {
          snprintf(filename, sizeof(filename), "/lapse/frame_%04d.jpg", offlineFrameCount);
        }
        if (sd_mutex) xSemaphoreTake(sd_mutex, portMAX_DELAY);
        File file = SD_MMC.open(filename, FILE_WRITE);
        if (file) {
          file.write(captured_photo_buf, captured_photo_len);
          file.close();
          Serial.printf("Background Task: Saved photo to SD: %s\n", filename);
          offlineFrameCount++; // Increment only on successful save
        } else {
          Serial.printf("Background Task: Failed to save to SD: %s\n", filename);
        }
        if (sd_mutex) xSemaphoreGive(sd_mutex);
      } else if (!sdCardAvailable) {
        // If no SD card is present, we still increment the frame count!
        // This alerts the webapp's new RAM fetcher loop to download the photo via /saved-photo.jpg
        offlineFrameCount++;
        Serial.printf("Background Task: Photo buffered in RAM (Frame %d). Waiting for webapp to fetch.\n", offlineFrameCount);
      }
      
      sd_write_in_progress = false;
    }
  }
}

void blinkFlash(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(4, HIGH); // Turn on Flash LED
    vTaskDelay(pdMS_TO_TICKS(150));
    digitalWrite(4, LOW); // Turn off
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

void heartbeatTask(void *pvParameters) {
  while (true) {
    // Calculate sine wave for smooth breathing effect (3 seconds per full cycle)
    float breath = (sin(millis() / 500.0) + 1.0) / 2.0;
    
    // Map to duty cycle. Pin 33 is inverted (255 = OFF, 0 = ON)
    // We want a faint glow, so map from 255 (off) down to 100 (faint)
    int duty = 255 - (int)(breath * 155.0);
    
    analogWrite(33, duty);
    vTaskDelay(pdMS_TO_TICKS(20)); // ~50fps smooth update rate
  }
}

volatile bool hardware_trigger_flag = false;
volatile uint32_t last_hardware_trigger_time = 0;

void IRAM_ATTR gpioTriggerISR() {
  uint32_t current_time = millis();
  if (current_time - last_hardware_trigger_time > 1000) { // 1 second debounce
    hardware_trigger_flag = true;
    last_hardware_trigger_time = current_time;
  }
}

void setupWebServer() {
  // --- REST API ENDPOINTS --- //

  // 1. Capture action (triggers the photo and saves buffer to RAM in a background task)
  server.on("/action_capture", HTTP_GET, [](AsyncWebServerRequest *request){
    bool forceCapture = request->hasArg("force");
    if (!forceCapture && prusaIp != "" && previousPrinterState != "PRINTING") {
      request->send(400, "text/plain", "Rejected: Printer is not printing");
      return;
    }
    if (capture_in_progress) {
      request->send(503, "text/plain", "Capture already in progress");
      return;
    }
    // Run the capture on core 1 so it doesn't block the AsyncTCP thread
    xTaskCreate(captureTask, "captureTask", 8192, NULL, 1, &captureTaskHandle);
    request->send(200, "text/plain", "Capture Started");
  });

  // 2. Download endpoint (serves the RAM buffer directly)
  server.on("/saved-photo.jpg", HTTP_GET, [](AsyncWebServerRequest *request){
    if (capture_in_progress) {
      request->send(503, "text/plain", "Capture in progress, try again later");
      return;
    }
    if (!captured_photo_buf || captured_photo_len == 0) {
      request->send(404, "text/plain", "Photo not found!");
      return;
    }
    
    AsyncWebServerResponse *response = request->beginResponse(200, "image/jpeg", captured_photo_buf, captured_photo_len);
    response->addHeader("Content-Disposition", "inline; filename=capture.jpg");
    request->send(response);
    
    Serial.println("Sent saved photo via HTTP");
  });

  // 3. Snapshot endpoint — serves the VGA preview buffer, or takes a fresh capture on ?fresh=1
  server.on("/snapshot.jpg", HTTP_GET, [](AsyncWebServerRequest *request){
    
    // Manual refresh: user clicked the image in the webapp — take a fresh VGA capture now
    if (request->hasArg("fresh")) {
      takePreviewSnapshot();
    }
    
    // Serve the preview buffer (populated either by the 10s background task or the fresh capture above)
    if (snapshot_mutex && xSemaphoreTake(snapshot_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
      if (!snapshot_buf || snapshot_len == 0) {
        xSemaphoreGive(snapshot_mutex);
        request->send(503, "text/plain", "Snapshot not yet available");
        return;
      }
      uint8_t* temp_buf = NULL;
      if (psramFound()) {
        temp_buf = (uint8_t*)ps_malloc(snapshot_len);
      } else {
        temp_buf = (uint8_t*)malloc(snapshot_len);
      }
      if (!temp_buf) {
        xSemaphoreGive(snapshot_mutex);
        request->send(500, "text/plain", "Memory error");
        return;
      }
      memcpy(temp_buf, snapshot_buf, snapshot_len);
      size_t temp_len = snapshot_len;
      xSemaphoreGive(snapshot_mutex);

      AsyncWebServerResponse *response = request->beginResponse(200, "image/jpeg", temp_buf, temp_len);
      response->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      response->addHeader("Access-Control-Allow-Origin", "*");
      request->onDisconnect([temp_buf]() {
        if (temp_buf) free(temp_buf);
      });
      request->send(response);
    } else {
      request->send(503, "text/plain", "Buffer busy");
    }
  });

  // 4. Camera control endpoint (adjust settings on the fly)
  server.on("/control", HTTP_GET, [](AsyncWebServerRequest *request){
    sensor_t * s = esp_camera_sensor_get();
    if (!s) {
      request->send(500, "text/plain", "Sensor not found");
      return;
    }
    
    int status = 400;
    String message = "Invalid parameters";
    
    if (request->hasArg("var") && (request->hasArg("val") || request->hasArg("token") || request->hasArg("name") || request->hasArg("fingerprint"))) {
      String var = request->arg("var");
      int val = request->hasArg("val") ? request->arg("val").toInt() : 0;
      int res = 0;
      
      if (var == "led" || var == "flash") {
        if (val == 2) { // Auto mode
          led_state = 2;
          digitalWrite(4, LOW); // Make sure it's off while waiting
        } else {
          digitalWrite(4, val ? HIGH : LOW);
          led_state = val ? 1 : 0;
        }
        preferences.begin("prusalapse", false);
        preferences.putInt("led", led_state);
        preferences.end();
        saveConfigToSD();
        status = 200;
        message = "OK";
        Serial.printf("Flash LED set: %d\n", val);
      } else if (var == "prusa_connect_token") {
        String newToken = "";
        if (request->hasArg("token")) {
          newToken = request->arg("token");
        } else {
          newToken = request->arg("val");
        }
        newToken.trim();
        
        // Prevent saving masked tokens containing asterisks
        if (newToken.indexOf('*') != -1) {
          request->send(400, "text/plain", "Invalid token: contains asterisks");
          return;
        }

        prusaConnectToken = newToken;
        prusaConnectInfoSent = false; // Reset to re-register info next loop
        
        // Save to NVS
        preferences.begin("prusalapse", false);
        preferences.putString("connectToken", prusaConnectToken);
        preferences.end();
        
        // Save to config.txt
        saveConfigToSD();
        status = 200;
        message = "OK";
        Serial.printf("Prusa Connect token set: %s\n", prusaConnectToken.length() > 0 ? "SET" : "CLEARED");
      } else if (var == "fingerprint") {
        String newFp = "";
        if (request->hasArg("fingerprint")) {
          newFp = request->arg("fingerprint");
        } else {
          newFp = request->arg("val");
        }
        newFp.trim();
        preferences.begin("prusalapse", false);
        if (newFp.length() >= 16) {
          prusaConnectFingerprint = newFp;
          preferences.putString("fingerprint", prusaConnectFingerprint);
        } else if (newFp.length() == 0) {
          preferences.remove("fingerprint");
          uint8_t mac[6];
          WiFi.macAddress(mac);
          char fpBuf[64];
          snprintf(fpBuf, sizeof(fpBuf), "%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X",
            mac[0], mac[1], mac[2], mac[3], mac[4], mac[5],
            mac[5], mac[4], mac[3], mac[2], mac[1], mac[0],
            mac[0] ^ 0xAA, mac[1] ^ 0x55, mac[2] ^ 0xFF, mac[3] ^ 0x42);
          prusaConnectFingerprint = String(fpBuf);
        }
        preferences.end();
        prusaConnectInfoSent = false;
        status = 200;
        message = "OK";
        Serial.printf("Fingerprint updated: %s\n", prusaConnectFingerprint.c_str());
      } else if (var == "offline") {
        offlineMode = (val == 1);
        if (request->hasArg("prusa_ip")) {
          prusaIp = request->arg("prusa_ip");
        }
        if (request->hasArg("prusa_key")) {
          prusaApiKey = request->arg("prusa_key");
        }
        
        // Save to NVS
        preferences.begin("prusalapse", false);
        preferences.putBool("offlineMode", offlineMode);
        preferences.putString("prusaIp", prusaIp);
        preferences.putString("prusaApiKey", prusaApiKey);
        preferences.end();
        
        // Save to config.txt
        saveConfigToSD();
        status = 200;
        message = "OK";
        Serial.printf("Offline mode set: %d, IP: %s\n", val, prusaIp.c_str());
      } else if (var == "camera_name") {
        if (request->hasArg("name")) {
          cameraName = request->arg("name");
        } else {
          cameraName = request->arg("val");
        }
        preferences.begin("prusalapse", false);
        preferences.putString("cameraName", cameraName);
        preferences.end();
        saveConfigToSD();
        status = 200;
        message = "OK";
        Serial.printf("Camera name set: %s\n", cameraName.c_str());
      } else {
        // Use 100ms lock check to prevent blocking the network task during active capturing
        if (camera_mutex && xSemaphoreTake(camera_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
          if (var == "brightness") { res = s->set_brightness(s, val); if (res == 0) brightnessVal = val; }
          else if (var == "contrast") { res = s->set_contrast(s, val); if (res == 0) contrastVal = val; }
          else if (var == "saturation") res = s->set_saturation(s, val); // -2 to 2
          else if (var == "hmirror") { res = s->set_hmirror(s, val); if (res == 0) hmirrorVal = val; }
          else if (var == "vflip") { res = s->set_vflip(s, val); if (res == 0) vflipVal = val; }
          else if (var == "quality") res = s->set_quality(s, val); // 10 to 63
          else res = -1;
          xSemaphoreGive(camera_mutex);
        } else {
          request->send(503, "text/plain", "Camera busy");
          return;
        }
        
        if (res == 0) {
          if (var == "brightness" || var == "contrast" || var == "hmirror" || var == "vflip") {
            preferences.begin("prusalapse", false);
            preferences.putInt(var.c_str(), val);
            preferences.end();
            saveConfigToSD();
          }
          status = 200;
          message = "OK";
          Serial.printf("Control set: %s = %d\n", var.c_str(), val);
        } else if (res == -1) {
          status = 400;
          message = "Unknown variable";
        } else {
          status = 500;
          message = "Failed to set value";
        }
      }
    }
    
    request->send(status, "text/plain", message);
  });

  // 5. Get current camera status
  server.on("/status", HTTP_GET, [](AsyncWebServerRequest *request){
    sensor_t * s = esp_camera_sensor_get();
    
    // Build JSON with Prusa Connect token (masked for security)
    String tokenMasked = "";
    if (prusaConnectToken.length() > 4) {
      tokenMasked = prusaConnectToken.substring(0, 4) + "****";
    } else if (prusaConnectToken.length() > 0) {
      tokenMasked = "****";
    }

    char json[768];
    snprintf(json, sizeof(json), 
      "{\"brightness\":%d,\"contrast\":%d,\"hmirror\":%d,\"vflip\":%d,\"led\":%d,\"sd_available\":%d,\"offline_mode\":%d,\"prusa_connect_token\":\"%s\",\"prusa_connect_configured\":%d,\"prusa_connect_code\":%d,\"fingerprint\":\"%s\",\"camera_name\":\"%s\",\"firmware_version\":\"%s\",\"sensor_ok\":%d}",
      s ? s->status.brightness : brightnessVal,
      s ? s->status.contrast : contrastVal,
      s ? s->status.hmirror : hmirrorVal,
      s ? s->status.vflip : vflipVal,
      led_state,
      sdCardAvailable ? 1 : 0,
      offlineMode ? 1 : 0,
      tokenMasked.c_str(),
      prusaConnectToken.length() > 0 ? 1 : 0,
      last_prusa_connect_code,
      prusaConnectFingerprint.c_str(),
      cameraName.c_str(),
      FIRMWARE_VERSION,
      s ? 1 : 0
    );
    
    request->send(200, "application/json", json);
  });

  // 6. SD Card Endpoints
  server.on("/list_sd", HTTP_GET, [](AsyncWebServerRequest *request){
    if (!sdCardAvailable) { request->send(503, "text/plain", "SD Card not available"); return; }
    if (sd_mutex && xSemaphoreTake(sd_mutex, pdMS_TO_TICKS(3000)) != pdTRUE) {
      request->send(503, "text/plain", "SD Card busy");
      return;
    }
    
    size_t bufSize = 32768; // 32KB can hold ~1000 filenames
    char *outBuf = NULL;
    if (psramFound()) {
      outBuf = (char *)ps_malloc(bufSize);
    } else {
      outBuf = (char *)malloc(bufSize);
    }
    if (!outBuf) {
      if (sd_mutex) xSemaphoreGive(sd_mutex);
      request->send(500, "text/plain", "Out of memory");
      return;
    }
    
    File dir = SD_MMC.open("/lapse");
    strcpy(outBuf, "[");
    size_t len = 1;
    bool first = true;
    
    if (dir) {
      bool isDir = false;
      String filepath = dir.getNextFileName(&isDir);
      while (filepath.length() > 0) {
        if (!isDir) {
          int lastSlash = filepath.lastIndexOf('/');
          if (lastSlash != -1) filepath = filepath.substring(lastSlash + 1);
          if (len + filepath.length() + 5 >= bufSize) break;
          if (!first) { outBuf[len++] = ','; }
          outBuf[len++] = '"';
          strcpy(outBuf + len, filepath.c_str());
          len += filepath.length();
          outBuf[len++] = '"';
          first = false;
        }
        filepath = dir.getNextFileName(&isDir);
      }
      dir.close();
    }
    if (sd_mutex) xSemaphoreGive(sd_mutex);
    outBuf[len++] = ']';
    outBuf[len] = '\0';
    
    String finalJson = String(outBuf);
    free(outBuf);
    request->send(200, "application/json", finalJson);
  });

  server.on("/download_sd", HTTP_GET, [](AsyncWebServerRequest *request){
    if (!sdCardAvailable) { request->send(503, "text/plain", "SD Card not available"); return; }
    if (request->hasArg("file")) {
      String filename = "/lapse/" + request->arg("file");
      if (SD_MMC.exists(filename)) {
        String contentType = "image/jpeg";
        if (filename.endsWith(".tar")) contentType = "application/x-tar";
        else if (filename.endsWith(".jsonl")) contentType = "application/json";

        File file = SD_MMC.open(filename, FILE_READ);
        if (file) {
          size_t filesize = file.size();
          // Buffer files smaller than 1.5MB in PSRAM to prevent the AsyncTCP network thread from blocking on SD Card reads
          if (filesize > 0 && filesize < 1572864 && psramFound()) {
            uint8_t *file_buf = (uint8_t *)ps_malloc(filesize);
            if (file_buf) {
              size_t readBytes = file.read(file_buf, filesize);
              file.close();
              if (readBytes == filesize) {
                AsyncWebServerResponse *response = request->beginResponse(200, contentType, file_buf, filesize);
                response->addHeader("Connection", "close");
                response->addHeader("Access-Control-Allow-Origin", "*");
                request->onDisconnect([file_buf]() {
                  if (file_buf) free(file_buf);
                });
                request->send(response);
                Serial.printf("Served %s from PSRAM (%d bytes)\n", filename.c_str(), (int)filesize);
                return;
              } else {
                free(file_buf);
                // Re-open if read failed to let fallback stream it
                File fileRetry = SD_MMC.open(filename, FILE_READ);
                if (fileRetry) file = fileRetry;
              }
            }
          }
          file.close();
        }

        // Fallback to streaming directly from SD Card if too large or PSRAM allocation failed
        AsyncWebServerResponse *response = request->beginResponse(SD_MMC, filename, contentType);
        response->addHeader("Connection", "close");
        response->addHeader("Access-Control-Allow-Origin", "*");
        request->send(response);
        Serial.printf("Served %s streaming from SD Card\n", filename.c_str());
      } else {
        request->send(404, "text/plain", "File not found");
      }
    } else {
      request->send(400, "text/plain", "Missing file parameter");
    }
  });

  // Define variables for diagnostic tracking
  // last_http_code is declared globally

  server.on("/camera_status", HTTP_GET, [](AsyncWebServerRequest *request){
    String json = "{";
    json += "\"frame_count\":" + String(offlineFrameCount) + ",";
    json += "\"prusa_ip\":\"" + prusaIp + "\",";
    json += "\"prusa_key\":\"" + prusaApiKey + "\",";
    json += "\"poll_url\":\"http://" + prusaIp + "/api/v1/status\",";
    json += "\"offline_mode\":" + String(offlineMode ? 1 : 0) + ",";
    json += "\"sd_available\":" + String(sdCardAvailable ? 1 : 0) + ",";
    json += "\"free_heap\":" + String(ESP.getFreeHeap()) + ",";
    json += "\"min_free_heap\":" + String(ESP.getMinFreeHeap()) + ",";
    json += "\"free_psram\":" + String(psramFound() ? ESP.getFreePsram() : 0) + ",";
    json += "\"last_http_code\":" + String(last_http_code) + ",";
    json += "\"last_prusa_connect_code\":" + String(last_prusa_connect_code) + ",";
    json += "\"prusa_connect_info_sent\":" + String(prusaConnectInfoSent ? 1 : 0) + ",";
    json += "\"fingerprint\":\"" + prusaConnectFingerprint + "\",";
    json += "\"last_z\":" + String(currentZValue) + ",";
    json += "\"max_z\":" + String(maxConfirmedZ) + ",";
    json += "\"trigger_mode\":\"" + activeTriggerMode + "\",";
    json += "\"job_id\":" + String(currentJobId) + ",";
    json += "\"printer_state\":\"" + currentPrinterState + "\",";
    json += "\"job_progress\":" + String(currentJobProgress, 1) + ",";
    json += "\"temp_nozzle\":" + String(currentTempNozzle, 1) + ",";
    json += "\"camera_name\":\"" + cameraName + "\",";
    json += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
    json += "\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"";
    json += "}";
    request->send(200, "application/json", json);
  });

  server.on("/delete_session_sd", HTTP_GET, [](AsyncWebServerRequest *request){
    if (!sdCardAvailable) { request->send(503, "text/plain", "SD Card not available"); return; }
    if (!request->hasArg("session")) { request->send(400, "text/plain", "Missing session parameter"); return; }
    String sessionParam = request->arg("session"); // e.g. "s0001"
    if (sd_mutex && xSemaphoreTake(sd_mutex, pdMS_TO_TICKS(3000)) == pdTRUE) {
      // Immediately update sessions.jsonl so the session disappears from the queue right away
      File jsonFile = SD_MMC.open("/lapse/sessions.jsonl", FILE_READ);
      if (jsonFile) {
        String newContent = "";
        while (jsonFile.available()) {
          String line = jsonFile.readStringUntil('\n');
          if (line.indexOf("\"session\":\"" + sessionParam + "\"") == -1 && line.length() > 0) {
            newContent += line + "\n";
          }
        }
        jsonFile.close();
        
        File outFile = SD_MMC.open("/lapse/sessions.jsonl", FILE_WRITE);
        if (outFile) {
          outFile.print(newContent);
          outFile.close();
        }
      }
      xSemaphoreGive(sd_mutex);
    }

    // Delete jpg and tar files asynchronously in a background task so AsyncTCP never blocks or resets
    char *sessArg = (char *)malloc(32);
    if (sessArg) {
      strncpy(sessArg, sessionParam.c_str(), 31);
      sessArg[31] = '\0';
      xTaskCreatePinnedToCore([](void *param) {
        String sess = String((char *)param);
        free(param);
        if (sd_mutex) xSemaphoreTake(sd_mutex, portMAX_DELAY);
        File dir = SD_MMC.open("/lapse");
        if (dir) {
          bool isDir = false;
          String filepath = dir.getNextFileName(&isDir);
          while (filepath.length() > 0) {
            if (!isDir && (filepath.indexOf(sess + "_") != -1 || filepath.endsWith("/" + sess + ".tar"))) {
              if (!filepath.startsWith("/")) filepath = "/" + filepath;
              if (!filepath.startsWith("/lapse/")) filepath = "/lapse/" + filepath;
              SD_MMC.remove(filepath);
              vTaskDelay(pdMS_TO_TICKS(2));
            }
            filepath = dir.getNextFileName(&isDir);
          }
          dir.close();
        }
        if (sd_mutex) xSemaphoreGive(sd_mutex);
        Serial.printf("Background Task: Deleted session %s from SD\n", sess.c_str());
        vTaskDelete(NULL);
      }, "delSessTask", 8192, sessArg, 1, NULL, 1);
    }
    
    request->send(200, "text/plain", "Session " + sessionParam + " deleted");
  });

  server.on("/wipe_sd", HTTP_GET, [](AsyncWebServerRequest *request){
    if (!sdCardAvailable) { request->send(503, "text/plain", "SD Card not available"); return; }
    offlineFrameCount = 0;
    sessionId = 0;
    preferences.begin("prusalapse", false);
    preferences.putInt("sessionId", 0);
    preferences.end();

    if (sd_mutex && xSemaphoreTake(sd_mutex, pdMS_TO_TICKS(2000)) == pdTRUE) {
      SD_MMC.remove("/lapse/sessions.jsonl");
      xSemaphoreGive(sd_mutex);
    }

    // Delete all files in /lapse asynchronously in a background task so AsyncTCP never times out
    xTaskCreatePinnedToCore([](void *param) {
      if (sd_mutex) xSemaphoreTake(sd_mutex, portMAX_DELAY);
      File dir = SD_MMC.open("/lapse");
      if (dir) {
        bool isDir = false;
        String filepath = dir.getNextFileName(&isDir);
        while (filepath.length() > 0) {
          if (!isDir) {
            if (!filepath.startsWith("/")) filepath = "/" + filepath;
            if (!filepath.startsWith("/lapse/")) filepath = "/lapse/" + filepath;
            SD_MMC.remove(filepath);
            vTaskDelay(pdMS_TO_TICKS(2));
          }
          filepath = dir.getNextFileName(&isDir);
        }
        dir.close();
      }
      if (sd_mutex) xSemaphoreGive(sd_mutex);
      Serial.println("Background Task: SD Card /lapse wipe complete");
      vTaskDelete(NULL);
    }, "wipeSdTask", 8192, NULL, 1, NULL, 1);

    request->send(200, "text/plain", "SD Card Wiped");
  });

  // Simple homepage
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
    request->send(200, "text/html", "<h1>PrusaLapse Camera</h1><p>API is active.</p><ul><li><a href='/snapshot.jpg'>VGA Snapshot</a></li><li><a href='/action_capture'>Trigger Capture</a></li><li><a href='/saved-photo.jpg'>View Saved Photo</a></li><li><a href='/status'>Status JSON</a></li><li><a href='/camera_status'>Diagnostics JSON</a></li><li><a href='/list_sd'>List SD JSON</a></li></ul>");
  });

  // Remote reboot endpoint
  server.on("/reboot", HTTP_GET, [](AsyncWebServerRequest *request) {
    AsyncWebServerResponse *response = request->beginResponse(200, "text/plain", "Rebooting");
    response->addHeader("Connection", "close");
    response->addHeader("Access-Control-Allow-Origin", "*");
    request->send(response);
    extern bool pendingOTAUpdate;
    pendingOTAUpdate = true;
  });

  // OTA Update endpoint
  server.on("/update", HTTP_POST, [](AsyncWebServerRequest *request) {
    bool shouldReboot = !Update.hasError();
    AsyncWebServerResponse *response = request->beginResponse(200, "text/plain", shouldReboot ? "OK" : "FAIL");
    response->addHeader("Connection", "close");
    response->addHeader("Access-Control-Allow-Origin", "*");
    request->send(response);
    if (shouldReboot) {
      // Do not block the AsyncTCP thread with delay() or restart() here,
      // otherwise the HTTP response will never be sent to the browser.
      extern bool pendingOTAUpdate;
      pendingOTAUpdate = true;
    }
  }, [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
    if (!index) {
      Serial.printf("Update Start: %s\n", filename.c_str());
      
      // Suspend all background tasks to prevent them from accessing PSRAM
      // when the flash cache is disabled during OTA update, which causes abort() panics.
      if (previewTaskHandle != NULL) vTaskSuspend(previewTaskHandle);
      if (sdWriteTaskHandle != NULL) vTaskSuspend(sdWriteTaskHandle);
      if (heartbeatTaskHandle != NULL) vTaskSuspend(heartbeatTaskHandle);
      if (captureTaskHandle != NULL) vTaskSuspend(captureTaskHandle);
      if (prusaLinkTaskHandle != NULL) vTaskSuspend(prusaLinkTaskHandle);
      
      if (Update.isRunning()) {
        Update.abort();
      }
      if (!Update.begin((ESP.getFreeSketchSpace() - 0x1000) & 0xFFFFF000)) {
        Update.printError(Serial);
      }
    }
    if (!Update.hasError()) {
      if (Update.write(data, len) != len) {
        Update.printError(Serial);
      }
    }
    if (final) {
      if (Update.end(true)) {
        Serial.printf("Update Success: %uB\n", index + len);
      } else {
        Update.printError(Serial);
      }
    }
  });

  server.on("/update", HTTP_OPTIONS, [](AsyncWebServerRequest *request) {
    AsyncWebServerResponse *response = request->beginResponse(204);
    response->addHeader("Access-Control-Allow-Origin", "*");
    response->addHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response->addHeader("Access-Control-Allow-Headers", "*");
    request->send(response);
  });

  server.begin();
}

void setupWiFi() {
  // Initialize WiFiManager
  // Creates an AP "PrusaLapse-Camera" if it can't connect to saved WiFi
  WiFiManager wm;
  wm.setConnectTimeout(20); // Prevent indefinite blocking if connection fails
  bool res = wm.autoConnect("PrusaLapse-Camera", "12345678");
  
  if(!res) {
    Serial.println("Failed to connect to WiFi!");
  } else {
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("");
      Serial.print("Camera IP: ");
      Serial.println(WiFi.localIP());
      WiFi.setSleep(false); // Disable WiFi sleep to reduce latency and prevent disconnections
      WiFi.setTxPower(WIFI_POWER_15dBm); // Reduce TX power to limit current draw and avoid power brownouts/stalls
    }
  }
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable brownout detector
  Serial.begin(115200);
  
  // Setup GPIO Interrupt Trigger (Pin 12)
  esp_log_level_set("gpio", ESP_LOG_NONE);
  pinMode(12, INPUT_PULLDOWN);
  attachInterrupt(12, gpioTriggerISR, RISING);
  
  // Initialize SD Card
  WiFi.mode(WIFI_STA); // Start WiFi subsystem to load NVS credentials
  
  if (SD_MMC.begin("/sdcard", true)) { // 1-bit mode
    sdCardAvailable = true;
    Serial.println("SD Card initialized.");
    SD_MMC.mkdir("/lapse");
  } else {
    Serial.println("SD Card mount failed.");
  }

  syncConfig(); // Synchronize NVS and SD Card configurations
  Serial.printf("Config loaded: IP=%s, Offline=%d, ConnectToken=%s\n", prusaIp.c_str(), offlineMode, prusaConnectToken.length() > 0 ? "SET" : "NONE");

  camera_mutex = xSemaphoreCreateMutex();
  snapshot_mutex = xSemaphoreCreateMutex();
  sd_mutex = xSemaphoreCreateMutex();
  
  sd_write_semaphore = xSemaphoreCreateBinary();
  xTaskCreatePinnedToCore(sdWriteTask, "sdWriteTask", 8192, NULL, 1, &sdWriteTaskHandle, 1);
  
  // Flash LED off
  pinMode(4, OUTPUT);
  digitalWrite(4, LOW);
  
  // Start continuous breathing heartbeat on Red Status LED (Pin 33)
  xTaskCreate(heartbeatTask, "heartbeatTask", 2048, NULL, 1, &heartbeatTaskHandle);
  
  setupCamera();
  
  setupWiFi();

  setupWebServer();


  // Generate Prusa Connect fingerprint from MAC address if not loaded from NVS
  if (prusaConnectFingerprint.length() == 0) {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char fpBuf[64];
    snprintf(fpBuf, sizeof(fpBuf), "%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X%02X",
      mac[0], mac[1], mac[2], mac[3], mac[4], mac[5],
      mac[5], mac[4], mac[3], mac[2], mac[1], mac[0],
      mac[0] ^ 0xAA, mac[1] ^ 0x55, mac[2] ^ 0xFF, mac[3] ^ 0x42);
    prusaConnectFingerprint = String(fpBuf);
  }
  Serial.printf("Prusa Connect Fingerprint: %s\n", prusaConnectFingerprint.c_str());

  // Start Prusa Connect upload background task
  xTaskCreatePinnedToCore(previewAndUploadTask, "previewAndUpload", 8192, NULL, 1, &previewTaskHandle, 0);
  Serial.println("Preview + Prusa Connect upload task started (runs on Core 0)");

  // Start PrusaLink polling background task
  xTaskCreatePinnedToCore([](void *pvParameters) {
    static uint32_t pollInterval = 2000; 

    while (true) {
      if (WiFi.status() == WL_CONNECTED && prusaIp != "") {
        prusaIp.trim();
        prusaApiKey.trim();
        
        HTTPClient http;
        http.setReuse(false);
        http.setTimeout(2500);
        
        http.begin("http://" + prusaIp + "/api/v1/status");
        http.addHeader("X-Api-Key", prusaApiKey);
        const char* headers[] = {"Date"};
        http.collectHeaders(headers, 1);
        int httpCode = http.GET();
        last_http_code = httpCode;
        if (httpCode == 200) {
          String dateHeader = http.header("Date");
          if (dateHeader.length() > 0) {
            time_t parsedTime = parseHttpDate(dateHeader);
            if (parsedTime > 1000000) {
              struct timeval tv;
              tv.tv_sec = parsedTime;
              tv.tv_usec = 0;
              settimeofday(&tv, NULL);
            }
          }
          String payload = http.getString();
          
          String state = "";
          float axis_z = -1.0;
          int stateIdx = payload.indexOf("\"state\":");
          if (stateIdx != -1) {
            int startQuote = payload.indexOf("\"", stateIdx + 8);
            if (startQuote != -1) {
              int endQuote = payload.indexOf("\"", startQuote + 1);
              if (endQuote != -1) {
                state = payload.substring(startQuote + 1, endQuote);
              }
            }
          }
          
          // Adjust polling interval dynamically based on printer state
          if (state == "PRINTING") {
            pollInterval = 300; // Poll fast during prints to catch M220 S99
          } else {
            pollInterval = 2000; // Throttled poll when idle, paused, or finished
          }

          int zIdx = payload.indexOf("\"axis_z\":");
          if (zIdx != -1) {
            int endZ = payload.indexOf(",", zIdx);
            if (endZ == -1) endZ = payload.indexOf("}", zIdx);
            axis_z = payload.substring(zIdx + 9, endZ).toFloat();
          }
          int timePrintingIdx = payload.indexOf("\"time_printing\":");
          float time_printing = -1.0;
          if (timePrintingIdx != -1) {
            int endTP = payload.indexOf(",", timePrintingIdx);
            if (endTP == -1) endTP = payload.indexOf("}", timePrintingIdx);
            time_printing = payload.substring(timePrintingIdx + 16, endTP).toFloat();
          }
          int progressIdx = payload.indexOf("\"progress\":");
          float job_progress = -1.0;
          if (progressIdx != -1) {
            int endP = payload.indexOf(",", progressIdx);
            if (endP == -1) endP = payload.indexOf("}", progressIdx);
            job_progress = payload.substring(progressIdx + 11, endP).toFloat();
          }

          int speedIdx = payload.indexOf("\"speed\":");
          int current_speed = 100;
          if (speedIdx != -1) {
            int endS = payload.indexOf(",", speedIdx);
            if (endS == -1) endS = payload.indexOf("}", speedIdx);
            current_speed = payload.substring(speedIdx + 8, endS).toInt();
          }

          int flowIdx = payload.indexOf("\"flow\":");
          int current_flow = 100;
          if (flowIdx != -1) {
            int endF = payload.indexOf(",", flowIdx);
            if (endF == -1) endF = payload.indexOf("}", flowIdx);
            current_flow = payload.substring(flowIdx + 7, endF).toInt();
          }

          int tempNozIdx = payload.indexOf("\"temp_nozzle\":");
          float temp_nozzle = -1.0;
          if (tempNozIdx != -1) {
            int endTN = payload.indexOf(",", tempNozIdx);
            if (endTN == -1) endTN = payload.indexOf("}", tempNozIdx);
            temp_nozzle = payload.substring(tempNozIdx + 14, endTN).toFloat();
          }

          int targetNozIdx = payload.indexOf("\"target_nozzle\":");
          float target_nozzle = -1.0;
          if (targetNozIdx != -1) {
            int endTGN = payload.indexOf(",", targetNozIdx);
            if (endTGN == -1) endTGN = payload.indexOf("}", targetNozIdx);
            target_nozzle = payload.substring(targetNozIdx + 16, endTGN).toFloat();
          }

          int jobId = -1;
          int jobSectionIdx = payload.indexOf("\"job\":");
          if (jobSectionIdx != -1) {
            int idIdx = payload.indexOf("\"id\":", jobSectionIdx);
            int jobEndIdx = payload.indexOf("}", jobSectionIdx);
            if (idIdx != -1 && (jobEndIdx == -1 || idIdx < jobEndIdx)) {
              int endId = payload.indexOf(",", idIdx);
              if (endId == -1 || (jobEndIdx != -1 && endId > jobEndIdx)) endId = jobEndIdx;
              if (endId != -1) {
                jobId = payload.substring(idIdx + 5, endId).toInt();
              }
            }
          }

          currentPrinterState = state;
          if (job_progress >= 0.0f) currentJobProgress = job_progress;
          if (temp_nozzle >= 0.0f) currentTempNozzle = temp_nozzle;
          if (target_nozzle >= 0.0f) currentTargetNozzle = target_nozzle;

          static bool printSessionActive = false;

          // Detect job change or new print session start
          if (jobId > 0 && currentJobId > 0 && jobId != currentJobId) {
            maxConfirmedZ = -1.0;
            prevPollZ = -1.0;
            zStableCount = 0;
            gcodeTriggerUsedInJob = false;
            activeTriggerMode = "auto";
          }
          if (jobId > 0) {
            currentJobId = jobId;
          }

          // Session state management
          if (state != "") {
            if (state == "PRINTING" && !printSessionActive) {
              printSessionActive = true;
              maxConfirmedZ = -1.0;
              prevPollZ = -1.0;
              zStableCount = 0;
              gcodeTriggerUsedInJob = false;
              activeTriggerMode = "auto";

              if (offlineMode) {
                // Check if current sessionId on SD card was left open (unfinalized in sessions.jsonl) due to a mid-print reboot
                bool resumeExistingSession = false;
                int existingFrames = 0;
                if (sdCardAvailable && sessionId > 0) {
                  char curSessTag[24];
                  snprintf(curSessTag, sizeof(curSessTag), "\"session\":\"s%04d\"", sessionId);
                  char curPrefix[16];
                  snprintf(curPrefix, sizeof(curPrefix), "s%04d_f", sessionId);

                  if (sd_mutex) xSemaphoreTake(sd_mutex, portMAX_DELAY);
                  bool finalizedInJsonl = false;
                  File jf = SD_MMC.open("/lapse/sessions.jsonl", FILE_READ);
                  if (jf) {
                    while (jf.available()) {
                      String line = jf.readStringUntil('\n');
                      if (line.indexOf(curSessTag) != -1) {
                        finalizedInJsonl = true;
                        break;
                      }
                    }
                    jf.close();
                  }

                  if (!finalizedInJsonl) {
                    resumeExistingSession = true;
                    File dir = SD_MMC.open("/lapse");
                    if (dir) {
                      bool isDir = false;
                      String fn = dir.getNextFileName(&isDir);
                      while (fn.length() > 0) {
                        int ls = fn.lastIndexOf('/');
                        if (ls != -1) fn = fn.substring(ls + 1);
                        if (!isDir && fn.startsWith(curPrefix) && fn.endsWith(".jpg")) {
                          existingFrames++;
                        }
                        fn = dir.getNextFileName(&isDir);
                      }
                      dir.close();
                    }
                  }
                  if (sd_mutex) xSemaphoreGive(sd_mutex);
                }

                if (resumeExistingSession) {
                  offlineFrameCount = existingFrames;
                  Serial.printf("Resuming unfinalized offline session s%04d at frame %d (job %d)\n", sessionId, offlineFrameCount, currentJobId);
                } else {
                  sessionId++;
                  preferences.begin("prusalapse", false);
                  preferences.putInt("sessionId", sessionId);
                  preferences.end();
                  offlineFrameCount = 0;
                }

                time_t now = time(nullptr);
                if (now > 1000000) {
                  struct tm timeinfo;
                  gmtime_r(&now, &timeinfo);
                  char buf[20];
                  snprintf(buf, sizeof(buf), "%04d%02d%02d_%02d%02d%02d",
                           timeinfo.tm_year + 1900,
                           timeinfo.tm_mon + 1,
                           timeinfo.tm_mday,
                           timeinfo.tm_hour,
                           timeinfo.tm_min,
                           timeinfo.tm_sec);
                  sessionStartTimestamp = String(buf);
                } else {
                  sessionStartTimestamp = "";
                }
                Serial.printf("Active offline session s%04d (job %d, startFrame %d) at %s\n", sessionId, currentJobId, offlineFrameCount, sessionStartTimestamp.c_str());
              }
            } else if (printSessionActive && state != "PRINTING" && state != "PAUSED" && state != "ATTENTION" && state != "BUSY") {
              printSessionActive = false;
              activeTriggerMode = "auto";

              if (offlineMode && sdCardAvailable && offlineFrameCount > 0) {
                if (sd_mutex) xSemaphoreTake(sd_mutex, portMAX_DELAY);
                File jsonFile = SD_MMC.open("/lapse/sessions.jsonl", FILE_APPEND);
                if (jsonFile) {
                  String ts = sessionStartTimestamp;
                  if (ts == "") {
                    time_t now = time(nullptr);
                    if (now > 1000000) {
                      struct tm timeinfo;
                      gmtime_r(&now, &timeinfo);
                      char buf[20];
                      snprintf(buf, sizeof(buf), "%04d%02d%02d_%02d%02d%02d",
                               timeinfo.tm_year + 1900,
                               timeinfo.tm_mon + 1,
                               timeinfo.tm_mday,
                               timeinfo.tm_hour,
                               timeinfo.tm_min,
                               timeinfo.tm_sec);
                      ts = String(buf);
                    }
                  }
                  if (ts != "") {
                    jsonFile.printf("{\"session\":\"s%04d\",\"frames\":%d,\"timestamp\":\"%s\",\"job_id\":%d}\n", sessionId, offlineFrameCount, ts.c_str(), currentJobId);
                  } else {
                    jsonFile.printf("{\"session\":\"s%04d\",\"frames\":%d,\"job_id\":%d}\n", sessionId, offlineFrameCount, currentJobId);
                  }
                  jsonFile.close();
                  if (sd_mutex) xSemaphoreGive(sd_mutex);
                  Serial.println("Updated sessions.jsonl");

                  // Launch background TAR packing task with 8192-byte stack
                  xTaskCreate(packTarTask, "packTarTask", 8192, (void*)(intptr_t)sessionId, 1, NULL);
                } else {
                  if (sd_mutex) xSemaphoreGive(sd_mutex);
                }
              }
            }
            previousPrinterState = state;
          }

          if (axis_z != -1.0) {
            currentZValue = axis_z;
          }

          // =========================================================
          // HYBRID TIMELAPSE TRIGGER ENGINE
          // 1. Parked G-Code Trigger (M220 S99 or M221 S99)
          // 2. Smart Z-Height Trigger (Automatic zero-G-code fallback)
          // =========================================================
          static bool trigger_active = false;
          bool isParkedTriggerSignal = (current_speed == 99 || current_flow == 99);

          if (state == "PRINTING" && isParkedTriggerSignal) {
            gcodeTriggerUsedInJob = true;
            activeTriggerMode = "gcode";
            if (!trigger_active) {
              trigger_active = true;
              Serial.printf("PrusaLink Polling: G-CODE TRIGGER (Speed=%d%%, Flow=%d%%) detected! Capturing layer...\n", current_speed, current_flow);
              if (!capture_in_progress && !sd_write_in_progress) {
                xTaskCreate(captureTask, "captureTask", 8192, NULL, 1, &captureTaskHandle);
              }
            }
          } else {
            if (!isParkedTriggerSignal) {
              trigger_active = false;
            }

            // Smart Z-Height Fallback (when no M220/M221 S99 is used in this print job)
            if (state == "PRINTING" && !gcodeTriggerUsedInJob && axis_z >= 0.10f && axis_z <= 250.0f) {
              // Thermal guard: ignore Z movements during MBL / pre-heating before nozzle reaches printing temp
              // (If target_nozzle < 0, telemetry omitted temp fields e.g. mock test, so allow it)
              bool nozzleReady = (target_nozzle < 0.0f) || (target_nozzle >= 170.0f && temp_nozzle >= (target_nozzle - 4.0f));

              if (nozzleReady) {
                if (prevPollZ >= 0.0f && fabs(axis_z - prevPollZ) < 0.015f) {
                  zStableCount++;
                } else {
                  prevPollZ = axis_z;
                  zStableCount = 1;
                }

                if (maxConfirmedZ < 0.0f) {
                  // Initialize baseline Z once stable at first layer (or current layer if booted mid-print)
                  if (zStableCount >= 3) {
                    maxConfirmedZ = axis_z;
                    activeTriggerMode = "smart_z";
                    Serial.printf("PrusaLink Polling: SMART Z baseline locked at Z=%.2fmm. Capturing initial layer...\n", axis_z);
                    if (!capture_in_progress && !sd_write_in_progress) {
                      xTaskCreate(captureTask, "captureTask", 8192, NULL, 1, &captureTaskHandle);
                    }
                  }
                } else {
                  float deltaZ = axis_z - maxConfirmedZ;
                  // Standard layer step (0.04mm - 0.24mm): confirm after 3 consecutive stable polls (~0.9s)
                  // Larger step (0.24mm - 0.60mm, e.g. 0.30mm Z-hop vs 0.30mm thick layer): require 6 stable polls (~1.8s) to reject travel Z-hops
                  bool confirmedNormalLayer = (deltaZ >= 0.04f && deltaZ <= 0.24f && zStableCount >= 3);
                  bool confirmedThickLayer  = (deltaZ > 0.24f && deltaZ <= 0.60f && zStableCount >= 6);

                  if (confirmedNormalLayer || confirmedThickLayer) {
                    maxConfirmedZ = axis_z;
                    activeTriggerMode = "smart_z";
                    Serial.printf("PrusaLink Polling: SMART Z-TRIGGER (Z=%.2fmm, +%.2fmm, stable=%d) confirmed! Capturing layer...\n", axis_z, deltaZ, zStableCount);
                    if (!capture_in_progress && !sd_write_in_progress) {
                      xTaskCreate(captureTask, "captureTask", 8192, NULL, 1, &captureTaskHandle);
                    }
                  }
                }
              }
            }
          }

        } else {
          // HTTP connection failed, timed out, or returned an error.
          // If a print is active, retry after 1s instead of 15s so we never miss layer triggers!
          pollInterval = (previousPrinterState == "PRINTING") ? 1000 : 10000;
          Serial.printf("PrusaLink poll failed (code %d). Next poll in %dms.\n", httpCode, pollInterval);
        }
        http.end();
      }
      vTaskDelay(pdMS_TO_TICKS(pollInterval));
    }
  }, "prusaLinkTask", 8192, NULL, 1, &prusaLinkTaskHandle, 0);
  Serial.println("PrusaLink task started (runs on Core 0)");

  // Initialization Blink Sequence
  // 1 Blink = WiFi Only
  // 2 Blinks = WiFi + SD Card
  // 3 Blinks = WiFi + SD Card + PrusaConnect Token
  int initScore = 1; // Reached end of setup (WiFi connected)
  if (sdCardAvailable) initScore++;
  if (prusaConnectToken != "") initScore++;
  
  Serial.printf("Initialization complete. Score: %d/3\n", initScore);
  blinkFlash(initScore);
}

void loop() {
  if (pendingOTAUpdate) {
    Serial.println("OTA Update complete. Rebooting in 1 second...");
    delay(1000);
    ESP.restart();
  }

  // Monitor WiFi connection and auto-reconnect if it drops
  static uint32_t lastWiFiCheck = 0;
  if (millis() - lastWiFiCheck > 10000) {
    lastWiFiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi connection lost. Reconnecting...");
      WiFi.reconnect();
    }
  }

  // Diagnostic printing
  static uint32_t lastHeapPrint = 0;
  if (millis() - lastHeapPrint > 30000) {
    lastHeapPrint = millis();
    Serial.printf("Diagnostics - Free Heap: %d B | Min Free Heap: %d B\n", ESP.getFreeHeap(), ESP.getMinFreeHeap());
  }

  // Process hardware triggers (GPIO 12 or Serial M118)
  static String serialBuffer = "";
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBuffer.indexOf("action:capture_photo") != -1) {
        Serial.println("Direct Serial: MAGIC TRIGGER detected! Capturing layer...");
        hardware_trigger_flag = true;
      }
      serialBuffer = "";
    } else {
      serialBuffer += c;
      if (serialBuffer.length() > 256) serialBuffer = ""; // Prevent overflow
    }
  }

  if (hardware_trigger_flag) {
    hardware_trigger_flag = false;
    Serial.println("Hardware Trigger (GPIO/Serial) detected! Capturing layer...");
    if (!capture_in_progress && !sd_write_in_progress) {
      xTaskCreate(captureTask, "captureTask", 8192, NULL, 1, &captureTaskHandle);
    }
  }

  // Dynamic polling interval based on printer state is now handled in prusaLinkTask
  
  delay(100);
}
