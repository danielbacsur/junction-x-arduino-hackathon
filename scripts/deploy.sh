#!/bin/sh
# Copies the app to the board over adb, writes its settings and restarts it.
# The board is known by the MAC printed on its Wi-Fi module, and its token is
# derived from that, so each board gets its own.
set -eu
cd "$(dirname "$0")/.."
. ./.env

# The radio's own address is read, because the interface shows a random one
# while it scans.
id=$(adb shell cat /sys/class/net/wlan0/phy80211/macaddress | tr -d ':\r\n' | tr a-f A-F)
printf '%s' "$id" | grep -Eqx '[0-9A-F]{12}' || { echo "No board answered over adb." >&2; exit 1; }
token=$(printf '%s' "$id" | openssl dgst -sha256 -hmac "$DEVICE_SECRET" -hex | awk '{print $NF}')
app=/home/arduino/ArduinoApps/board

adb shell mkdir -p "$app/data" "$app/models"
adb push apps/board/. "$app/"

printf 'SERVER_URL=%s\nDEVICE_ID=%s\nDEVICE_TOKEN=%s\n' "$SERVER_URL" "$id" "$token" |
  adb shell "cat > $app/.env && chmod 600 $app/.env"

adb shell arduino-app-cli app restart user:board

owner=$(printf 'owner:%s' "$id" | openssl dgst -sha256 -hmac "$DEVICE_SECRET" -hex | awk '{print $NF}')
echo "Board $id is deployed. Keep this owner link secret: $SERVER_URL/$id#owner=$owner"
echo "Live cards are available on the board LAN address, port 7000."
