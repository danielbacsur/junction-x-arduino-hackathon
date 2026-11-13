# Tools

Host tools the scripts in `scripts/` rely on, kept here so a checkout can flash a board without fetching anything first.

## arduino-flasher-cli

`arduino-flasher-cli/` is the unmodified `v0.5.4` release for macOS on Apple silicon.

- Archive: <https://github.com/arduino/arduino-flasher-cli/releases/download/v0.5.4/arduino-flasher-cli-0.5.4-darwin-arm64.tar.gz>
- SHA-256 of the archive: `9683d219f3af10015aa8b17635cdf6f27b7a7d22a8ff20d2029573578e4ce27f`
- License: GPL-3.0-or-later, see `arduino-flasher-cli/LICENSE` and `arduino-flasher-cli/NOTICE.md`.
- Source for this exact binary: <https://github.com/arduino/arduino-flasher-cli/tree/v0.5.4>. It embeds a static `qdl`, whose source is <https://github.com/linux-msm/qdl> as packaged by <https://github.com/arduino/qdl-packing>.

The Debian image is about 2.3 GB and is not kept here. The flasher downloads and verifies it by version.

## adb

The scripts talk to the board through `adb`, which is expected on the `PATH` (`brew install android-platform-tools`).
