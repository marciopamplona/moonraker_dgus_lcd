#!/bin/bash
# Install the DGUS LCD service (Moonraker-driven DGUS Reloaded touchscreen)
set -e

SRCDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME="${SUDO_USER:-$USER}"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
VENV="${HOME_DIR}/dgus-env"
PRINTER_DATA="${HOME_DIR}/printer_data"
SERVICE=dgus_lcd

echo "==> Python virtualenv: ${VENV}"
if [ ! -x "${VENV}/bin/python" ]; then
    python3 -m venv "${VENV}"
fi
"${VENV}/bin/pip" install -q --upgrade pyserial jinja2 websockets

echo "==> Config files"
for f in dgus_lcd.cfg dgus_macros.cfg; do
    if [ ! -e "${PRINTER_DATA}/config/${f}" ]; then
        cp "${SRCDIR}/config/${f}" "${PRINTER_DATA}/config/${f}"
        echo "    installed ${f}"
    else
        echo "    kept existing ${f}"
    fi
done
mkdir -p "${PRINTER_DATA}/logs" "${PRINTER_DATA}/dgus_lcd"

echo "==> Serial port access (dialout group)"
if ! id -nG "${USER_NAME}" | grep -qw dialout; then
    sudo usermod -aG dialout "${USER_NAME}"
fi

echo "==> systemd service"
sed -e "s|@USER@|${USER_NAME}|g" \
    -e "s|@SRCDIR@|${SRCDIR}|g" \
    -e "s|@VENV@|${VENV}|g" \
    -e "s|@PRINTER_DATA@|${PRINTER_DATA}|g" \
    "${SRCDIR}/config/${SERVICE}.service" \
    | sudo tee /etc/systemd/system/${SERVICE}.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE}
sudo systemctl restart ${SERVICE}

echo "==> Allow Moonraker/Mainsail to restart the service"
ASVC="${PRINTER_DATA}/moonraker.asvc"
if [ -f "${ASVC}" ] && ! grep -qx "${SERVICE}" "${ASVC}"; then
    echo "${SERVICE}" >> "${ASVC}"
    echo "    added ${SERVICE} to moonraker.asvc (restart Moonraker to apply)"
fi

echo "Done. Logs: ${PRINTER_DATA}/logs/dgus_lcd.log"
