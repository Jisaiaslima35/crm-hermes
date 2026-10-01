import sys
# Ensure real supabase from site-packages is imported
sys.path = [p for p in sys.path if p not in ('', '/root/apps/crm-hermes')]
sys.path.insert(0, '/home/claudeuser/.local/lib/python3.12/site-packages')

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv('/root/apps/crm-hermes/.env')

from supabase import create_client

url = os.environ["VITE_SUPABASE_URL"]
key = os.environ["VITE_SUPABASE_ANON_KEY"]
sb = create_client(url, key)

v3_prompt_path = Path("/root/.gemini/antigravity-ide/brain/d29c7fb3-2656-44c4-91af-748c30aee0c8/scratch/v3_prompt.txt")
v3_text = v3_prompt_path.read_text(encoding="utf-8").strip()

tenant_id = "11111111-1111-1111-1111-111111111111"

# Query current
r1 = sb.table("tenants").select("id, name, doctor_name, system_prompt").eq("id", tenant_id).execute()
print("Antes - len:", len(r1.data[0]["system_prompt"]) if r1.data else 0)

# Update
r2 = sb.table("tenants").update({
    "system_prompt": v3_text,
    "doctor_name": "Dr. Matheus Dore",
    "specialty": "Psiquiatria",
    "persona_name": "Assistente Virtual",
}).eq("id", tenant_id).execute()
print("Update returned:", len(r2.data) if r2.data else 0)

# Query after
r3 = sb.table("tenants").select("id, name, doctor_name, system_prompt").eq("id", tenant_id).execute()
after_len = len(r3.data[0]["system_prompt"]) if r3.data else 0
print("Depois - len:", after_len)
print("Contem Beatriz:", "Beatriz" in (r3.data[0]["system_prompt"] if r3.data else ""))
print("Contem 300:", "300" in (r3.data[0]["system_prompt"] if r3.data else ""))
