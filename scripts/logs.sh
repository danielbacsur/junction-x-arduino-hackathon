#!/bin/sh
# Follows the app's log on the board over adb.
exec adb shell arduino-app-cli app logs user:board --follow
