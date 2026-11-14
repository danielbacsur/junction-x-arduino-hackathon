#!/bin/sh
# Prepares a freshly flashed board over adb: the account password, the Wi-Fi
# region and network, and the unit that starts the app on every boot. Run it
# once with the board plugged straight into the Mac, then run deploy.sh.
set -eu
cd "$(dirname "$0")/.."
. ./.env

root() {
  printf '%s\n' "$BOARD_PASSWORD" | adb shell "sudo -S -p '' $*"
}

case "$WIFI_COUNTRY" in
  [A-Z][A-Z]) ;;
  *) echo "WIFI_COUNTRY must be a two-letter country code." >&2; exit 1 ;;
esac

# The image ships the account without a password, and sudo refuses that.
printf '%s\n' "$BOARD_PASSWORD" | adb shell sudo /usr/local/bin/arduino-passwd

# Without a region the radio only listens on 5 GHz, so it never finds a
# hidden network there, such as a phone hotspot.
root "sh -c 'echo options cfg80211 ieee80211_regdom=$WIFI_COUNTRY > /etc/modprobe.d/cfg80211.conf'"

# The network name and password travel on stdin, so quotes in them are safe.
printf '%s\n%s\n' "$WIFI_SSID" "$WIFI_PASSWORD" | adb shell '
  IFS= read -r ssid
  IFS= read -r psk
  nmcli connection delete wifi >/dev/null 2>&1
  nmcli connection add type wifi ifname wlan0 con-name wifi ssid "$ssid" \
    wifi.hidden yes wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$psk" \
    connection.autoconnect-retries 0
'

adb push scripts/board.service /tmp/board.service
root "install -m 644 /tmp/board.service /etc/systemd/system/board.service"
root "systemctl enable board.service"

echo "Board $(adb shell cat /sys/devices/soc0/serial_number) is provisioned. Reboot it to apply the Wi-Fi region."
