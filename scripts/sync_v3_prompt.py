"""
sync_v3_prompt.py — Sincroniza o system_prompt v3 (criado no Deskcomm) para o tenant no Supabase.
"""
import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

BASE_DIR = Path("/root/apps/crm-hermes")
load_dotenv(BASE_DIR / ".env")

v3_prompt_path = Path("/root/.gemini/antigravity-ide/brain/d29c7fb3-2656-44c4-91af-748c30aee0c8/scratch/v3_prompt.txt")
v3_text = v3_prompt_path.read_text(encoding="utf-8").strip()

sb = create_client(os.environ["VITE_SUPABASE_URL"], os.environ["VITE_SUPABASE_ANON_KEY"])

tenant_id = "11111111-1111-1111-1111-111111111111"
res = sb.table("tenants").update({
    "system_prompt": v3_text,
    "persona_name": "Assistente Virtual",
    "doctor_name": "Dr. Matheus Dore",
    "specialty": "Psiquiatria",
}).eq("id", tenant_id).execute()

print("Resultado update tenant:", len(res.data) if res.data else 0)
if res.data:
    print("Atualizado com sucesso! Tamanho do prompt:", len(res.data[0].get("system_prompt") or ""))
