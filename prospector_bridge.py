#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
prospector_bridge.py — Ponte CRM Hermes -> motor do Prospector SaaS (/opt/prospector).

Executa FORA do processo do CRM (subprocesso) para reutilizar o minerador
original (Google Maps Playwright + Overpass) e a validacao de WhatsApp da
Evolution, salvando os resultados na tabela prospector_leads do Supabase do
CRM (tenant do CRM, nao o SQLite do SaaS).

Uso: python3 prospector_bridge.py '{"tenant_id": "...", "category": "...", "city": "...", "neighborhood": "", "instance": "...", "limit": 80}'
Progresso: linhas JSON em stdout (phase/found/valid/saved).
"""
import asyncio
import json
import os
import sys
import urllib.request

sys.path.insert(0, "/opt/prospector")
os.chdir("/opt/prospector")

try:
    from dotenv import load_dotenv

    load_dotenv("/opt/prospector/.env")
    for _secret in ("evolution.env",):
        _p = f"/root/.hermes/secrets/{_secret}"
        if os.path.exists(_p):
            load_dotenv(_p, override=False)
    load_dotenv("/root/apps/crm-hermes/.env", override=False)
except Exception:
    pass


def emit(obj):
    print(json.dumps(obj), flush=True)


async def main():
    args = json.loads(sys.argv[1])
    tenant_id = args["tenant_id"]
    category = args["category"]
    city = args["city"]
    neighborhood = args.get("neighborhood") or None
    instance = (args.get("instance") or "").strip()
    limit = int(args.get("limit") or 80)

    import miner

    emit({"phase": "minerando"})
    pois = await miner.mine_businesses(category, city, neighborhood, limit=limit)
    emit({"phase": "extraindo_telefones", "found": len(pois)})

    numbers: list[str] = []
    for p in pois:
        dig = miner.extract_cell_phone(p) or miner._br_phone_digits(p.get("telefone_raw") or "")
        if dig:
            p["telefone_raw"] = dig
            if dig not in numbers:
                numbers.append(dig)
    emit({"phase": "validando_whatsapp", "count": len(numbers)})

    api_key = os.environ.get("EVOLUTION_API_KEY") or ""
    default_instance = os.environ.get("PROSPECTOR_INSTANCE_NAME", "formiga")
    wmap: dict[str, bool] = {}
    if numbers and api_key:
        if instance:
            wmap = await miner.evolution_check_whatsapp_batch(instance, numbers, api_key, timeout_s=20.0)
        if not wmap:
            # Instancia do tenant indisponivel/desconectada: valida pela do Prospector
            wmap = await miner.evolution_check_whatsapp_batch(default_instance, numbers, api_key, timeout_s=20.0)
    emit({"phase": "salvando", "valid": sum(1 for v in wmap.values() if v)})

    sb_url = os.environ.get("VITE_SUPABASE_URL", "https://supabase.automacaojs.us").rstrip("/")
    sb_key = (
        os.environ.get("VITE_SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("VITE_SUPABASE_ANON_KEY")
        or ""
    )
    saved = 0
    skipped = 0
    for p in pois:
        phone = p.get("telefone_raw")
        if not phone:
            continue
        # So salva celular BR canonico (13 digitos, 55+DDD+9+8). Antes, quando
        # a validacao nao rodava (nenhum celular extraido -> numbers vazio ->
        # wmap {}), o telefone cru (ex.: fixo "(84) 3211-7503") caia aqui e era
        # salvo como lead pendente "valido" — lixo que quebraria o disparo.
        if not miner._br_phone_digits(phone):
            skipped += 1
            continue
        if wmap and not wmap.get(phone):
            skipped += 1
            continue
        row = {
            "tenant_id": tenant_id,
            "business_name": str(p.get("nome") or "Empresa")[:255],
            "phone": phone,
            "category": category,
            "city": str(p.get("cidade") or city)[:100],
            "neighborhood": str(p.get("bairro") or neighborhood or "")[:100] or None,
            # wmap vazio = validacao nao retornou nada (instancias fora):
            # marca como nao-confirmado em vez de "valido" por default.
            "whatsapp_valid": bool(wmap.get(phone)) if wmap else False,
            "status": "pendente",
        }
        req = urllib.request.Request(
            f"{sb_url}/rest/v1/prospector_leads",
            data=json.dumps(row).encode("utf-8"),
            method="POST",
            headers={
                "apikey": sb_key,
                "Authorization": f"Bearer {sb_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=ignore-duplicates",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status in (200, 201):
                    saved += 1
        except Exception:
            pass

    emit({"phase": "done", "found": len(pois), "saved": saved, "skipped_no_whatsapp": skipped})


if __name__ == "__main__":
    asyncio.run(main())
