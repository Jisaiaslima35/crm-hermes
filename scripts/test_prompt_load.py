import sys
from pathlib import Path

BASE_DIR = Path("/root/apps/crm-hermes")
sys.path.insert(0, str(BASE_DIR))

from webhook_server import _get_tenant_config, _build_system_prompt

cfg = _get_tenant_config("11111111-1111-1111-1111-111111111111")
print("Tenant Name:", cfg["name"])
print("Doctor:", cfg["doctor_name"])
print("Prompt Len:", len(cfg["system_prompt"]))

prompt = _build_system_prompt(cfg, {"name": "João", "insurance": "Unimed", "stage": "novo_contato"})
print("Has Beatriz in prompt:", "Beatriz" in prompt)
print("Has 300 in prompt:", "300" in prompt)
print("Has 350 in prompt:", "350" in prompt)
