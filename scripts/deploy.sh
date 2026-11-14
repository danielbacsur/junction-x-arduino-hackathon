#!/bin/sh
# Copies the app to the board over adb, writes its settings and restarts it.
# The token is derived from the board's serial, so each board gets its own.
set -eu
cd "$(dirname "$0")/.."
. ./.env

id=$(adb shell cat /sys/devices/soc0/serial_number | tr -d '\r\n')
[ -n "$id" ] || { echo "No board answered over adb." >&2; exit 1; }
token=$(printf '%s' "$id" | openssl dgst -sha256 -hmac "$DEVICE_SECRET" -hex | awk '{print $NF}')
app=/home/arduino/ArduinoApps/board

adb shell mkdir -p "$app"
adb push apps/board/. "$app/"

printf 'SERVER_URL=%s\nDEVICE_ID=%s\nDEVICE_TOKEN=%s\n' "$SERVER_URL" "$id" "$token" |
  adb shell "cat > $app/.env && chmod 600 $app/.env"

adb shell arduino-app-cli app restart user:board

echo "Board $id is deployed. Watch it at $SERVER_URL/$id"
