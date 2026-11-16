#!/bin/sh
# b.sh <cmd> [json-args]  — команда окну Tauri через http-bridge
curl -s localhost:47322/cmd -d "{\"cmd\":\"$1\",\"args\":${2:-{\}}}"
