#!/usr/bin/env bash
# Relatório executivo 12h/18h da Clínica Dr. Matheus Dore (Sprint D, 03/11/2026).
# Escolhe o turno pela hora local e chama o daily_summary.py (100% verídico).
set -uo pipefail

export PYTHONPATH="/home/claudeuser/.local/lib/python3.12/site-packages:${PYTHONPATH:-}"

HORA="$(date +%H)"
if [ "$HORA" -lt 12 ]; then
  SHIFT="manha"
else
  SHIFT="tarde"
fi

cd /root/apps/crm-hermes || exit 1
exec /usr/bin/python3 /root/apps/crm-hermes/daily_summary.py --shift "$SHIFT"
