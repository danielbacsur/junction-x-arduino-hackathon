#include <Arduino_RouterBridge.h>
#include <Arduino_Modulino.h>
#include <Arduino_LED_Matrix.h>

ModulinoThermo thermo;
ArduinoLEDMatrix matrix;
unsigned long lastReading = 0;
unsigned long lastEye = 0;
bool sensorReady = false;

void drawEye(bool blink) {
  uint8_t pixels[8][13] = {};
  for (int y = 1; y < 7; y++) {
    for (int x = 1; x < 12; x++) {
      int dx = x - 6;
      int dy = 2 * y - 7;
      bool outline = (dx * dx + dy * dy >= 20) && (dx * dx + dy * dy <= 36);
      bool pupil = (x >= 5 && x <= 7 && y >= 3 && y <= 4);
      pixels[y][x] = blink ? (y == 4) : (outline || pupil);
    }
  }
  matrix.renderBitmap(pixels, 8, 13);
}

void setup() {
  Bridge.begin();
  Modulino.begin(Wire1);
  sensorReady = thermo.begin();
  matrix.begin();
  drawEye(false);
}

void loop() {
  unsigned long now = millis();
  if (now - lastReading >= 1000) {
    lastReading = now;
    if (sensorReady) {
      float temperature = thermo.getTemperature();
      float humidity = thermo.getHumidity();
      if (!isnan(temperature)) Bridge.notify("temperature", temperature, humidity);
    }
  }
  if (now - lastEye >= 100) {
    lastEye = now;
    drawEye((now % 5000) < 150);
  }
}
