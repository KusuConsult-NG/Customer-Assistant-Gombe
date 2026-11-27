#!/usr/bin/env bash
# Install and configure the Alphatech → ElevenLabs SIP bridge on Ubuntu 22.04/24.04.
#   cp bridge.env.example bridge.env && nano bridge.env && sudo ./setup.sh
# Safe to re-run: it re-renders the config from bridge.env and restarts Asterisk.
set -euo pipefail
cd "$(dirname "$0")"

[ "$(id -u)" = 0 ] || { echo "Run as root: sudo ./setup.sh"; exit 1; }
[ -f bridge.env ] || { echo "Missing bridge.env — copy bridge.env.example and fill it in."; exit 1; }
chmod 600 bridge.env
# Read KEY=VALUE as TEXT, never `source` it: a password with ( ) ! $ or a
# space is legal in the file and a syntax error (or worse) when executed.
while IFS= read -r line || [ -n "$line" ]; do
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || { echo "bridge.env: cannot read line: $line"; exit 1; }
  val="${BASH_REMATCH[2]}"
  val="${val%\"}"; val="${val#\"}"
  export "${BASH_REMATCH[1]}=$val"
done < bridge.env

if [ -z "${ALPHATECH_IP:-}" ]; then
  ALPHATECH_IP="$(getent ahostsv4 "$ALPHATECH_HOST" | awk 'NR==1{print $1}')"
  export ALPHATECH_IP
fi
for v in ALPHATECH_HOST ALPHATECH_IP ALPHATECH_EXTENSION ALPHATECH_PASSWORD ELEVENLABS_SIP_HOST \
         ELEVENLABS_SIP_USERNAME ELEVENLABS_SIP_PASSWORD TOLLFREE_E164; do
  [ -n "${!v:-}" ] || { echo "bridge.env: $v is empty"; exit 1; }
done
[[ "$TOLLFREE_E164" =~ ^\+[0-9]{8,15}$ ]] || { echo "TOLLFREE_E164 must be E.164, e.g. +2348000000779"; exit 1; }
FALLBACK_SOUND="${FALLBACK_SOUND:-all-circuits-busy-now}"
INTRO_SOUND="${INTRO_SOUND:-}"
VOICE_MODE="${VOICE_MODE:-elevenlabs}"
if [ -z "${PUBLIC_IP:-}" ]; then
  PUBLIC_IP="$(curl -fsS -4 --max-time 10 https://api.ipify.org || true)"
  [ -n "$PUBLIC_IP" ] || { echo "Could not detect the public IP; set PUBLIC_IP in bridge.env"; exit 1; }
fi
export PUBLIC_IP FALLBACK_SOUND INTRO_SOUND VOICE_MODE

echo "==> Installing Asterisk"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq asterisk gettext-base ufw curl python3 >/dev/null

echo "==> Rendering configuration (public IP ${PUBLIC_IP}, mode ${VOICE_MODE})"
VARS='${PUBLIC_IP} ${ALPHATECH_HOST} ${ALPHATECH_IP} ${ALPHATECH_EXTENSION} ${ALPHATECH_PASSWORD} ${ELEVENLABS_SIP_HOST} ${ELEVENLABS_SIP_USERNAME} ${ELEVENLABS_SIP_PASSWORD} ${TOLLFREE_E164} ${FALLBACK_SOUND} ${INTRO_SOUND} ${VOICE_MODE}'
for f in pjsip extensions rtp modules; do
  envsubst "$VARS" < "templates/${f}.conf.template" > "/etc/asterisk/${f}.conf"
done
chown asterisk:asterisk /etc/asterisk/{pjsip,extensions,rtp,modules}.conf
chmod 640 /etc/asterisk/pjsip.conf

if [ "$VOICE_MODE" = "spitch-ivr" ] && [ -n "${SPITCH_API_KEY:-}" ]; then
  echo "==> Generating bilingual Spitch IVR prompts (Hausa + Nigerian English)"
  chmod +x generate-ivr-prompts.py spitch-voice-agent.py
  BRIDGE_ENV_FILE="$(pwd)/bridge.env" python3 ./generate-ivr-prompts.py
  chown -R asterisk:asterisk /var/lib/asterisk/sounds/en/custom

  echo "==> Installing gombe-spitch-voice systemd service"
  cat > /etc/systemd/system/gombe-spitch-voice.service <<EOF
[Unit]
Description=Gombe APC 2027 Spitch Bilingual Voice Agent (Hausa + Nigerian English)
After=network.target asterisk.service

[Service]
Type=simple
WorkingDirectory=$(pwd)
Environment=BRIDGE_ENV_FILE=$(pwd)/bridge.env
ExecStart=/usr/bin/python3 $(pwd)/spitch-voice-agent.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable gombe-spitch-voice >/dev/null 2>&1 || true
  systemctl restart gombe-spitch-voice
fi

echo "==> Firewall: SSH, SIP 5060 (UDP+TCP), RTP 10000-20000/UDP"
ufw allow OpenSSH >/dev/null
ufw allow 5060/udp >/dev/null
ufw allow 5060/tcp >/dev/null
ufw allow 10000:20000/udp >/dev/null
ufw --force enable >/dev/null

echo "==> Restarting Asterisk"
systemctl enable asterisk >/dev/null 2>&1 || true
systemctl restart asterisk
sleep 8

echo "==> Status"
./check.sh || true
if [ "$VOICE_MODE" = "spitch-ivr" ]; then
  curl -fsS http://127.0.0.1:9091/health && echo
fi
echo
echo "Bridge ready (mode: ${VOICE_MODE}, public IP: ${PUBLIC_IP})."
