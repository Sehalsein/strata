SHELL := /usr/bin/env bash

# Where built artifacts (IPA, APK, source.json, index.html) land.
OUT_DIR := $(abspath out)

# What URL the devices will fetch from. Override for Tailscale/LAN:
#   make ios HOST=strata.tail-abc123.ts.net PORT=443 SCHEME=https
HOST   ?= $(shell ipconfig getifaddr en0 2>/dev/null || echo localhost)
PORT   ?= 8080
SCHEME ?= http
BASE_URL := $(SCHEME)://$(HOST):$(PORT)

# Strip default port suffix for cleaner URLs when on standard ports.
ifeq ($(SCHEME)$(PORT),http80)
  BASE_URL := http://$(HOST)
endif
ifeq ($(SCHEME)$(PORT),https443)
  BASE_URL := https://$(HOST)
endif

.PHONY: help ios android all serve clean print-url

help:
	@echo "Personal sideload deploy targets:"
	@echo ""
	@echo "  make ios        - Build unsigned IPA + update AltStore source.json"
	@echo "  make android    - Build debug APK + update Downloader landing page"
	@echo "  make all        - Both"
	@echo "  make serve      - Serve $(OUT_DIR) over HTTP on :$(PORT)"
	@echo "  make clean      - Remove built IPA/APK files"
	@echo "  make print-url  - Print the base URL devices should use"
	@echo ""
	@echo "Override host: make ios HOST=strata.tail-abc.ts.net PORT=443 SCHEME=https"
	@echo "Current base URL: $(BASE_URL)"

ios:
	@OUT_DIR="$(OUT_DIR)" BASE_URL="$(BASE_URL)" bash scripts/build-ipa.sh

android:
	@OUT_DIR="$(OUT_DIR)" BASE_URL="$(BASE_URL)" bash scripts/build-apk.sh

all: ios android

serve:
	@echo "Serving $(OUT_DIR) at $(BASE_URL)"
	@echo "  AltStore source: $(BASE_URL)/source.json"
	@echo "  Downloader URL : $(BASE_URL)/tv"
	@echo ""
	@cd "$(OUT_DIR)" && python3 -m http.server $(PORT)

clean:
	rm -f "$(OUT_DIR)"/*.ipa "$(OUT_DIR)"/*.apk "$(OUT_DIR)"/source.json "$(OUT_DIR)"/index.html "$(OUT_DIR)"/tv

print-url:
	@echo "$(BASE_URL)"
