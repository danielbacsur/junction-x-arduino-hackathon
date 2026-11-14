#!/bin/sh
# Replaces the board's system with the stock Debian image. Put the jumper on
# the BOOT pins and plug the board straight into the Mac first, then take the
# jumper off and replug the board once this has finished.
set -eu
cd "$(dirname "$0")/.."

exec tools/arduino-flasher-cli/arduino-flasher-cli flash unoq --version 20260528-558
