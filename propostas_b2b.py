# -*- coding: utf-8 -*-
"""
Propostas comerciais B2B em PDF (sprint 03/11/2026).

Módulo PURO (só stdlib) que monta, renderiza (HTML A4) e gera o PDF da
proposta comercial. Dois templates:

  A) "peixaria"     -> Pescados & Atacado (Peixaria do William)
  B) "dedetizacao" -> Controle de Pragas & Laudo Sanitário (Adriano Dedetização)

Premissa central do dono (Telegram 5983): hoje NÃO existe pré-cadastro de
cliente. O que se sabe de um lead é basically nome + telefone — e o nome que
vem atrelado ao número no banco NÃO é necessariamente o nome fantasia do
comércio. Por isso:

  - `cliente.nome`      = nome do contato (vem do banco, pode ser o "Maria Silva")
  - `cliente.empresa`   = nome fantasia do comércio (EDITÁVEL pelo operador)
  - se `empresa` vazio  -> o PDF imprime "(a confirmar)" e a mensagem de
    WhatsApp pede a identificação, sem inventar dado.

O gerador de PDF usa Playwright + Chrome do sistema (/usr/bin/google-chrome);
se não houver Chrome, cai para o HTML (o frontend ainda imprime).
"""

from __future__ import annotations

import html as _html
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _tz_br() -> timezone:
    """Brasil/Nordeste (UTC-3) — a proposta vale por data local."""
    return timezone(timedelta(hours=-3))


def _esc(v: Any) -> str:
    if v is None:
        return ""
    return _html.escape(str(v))


def _num(v: Any, default: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return default
        if isinstance(v, str):
            v = v.replace("R$", "").replace(".", "").replace(",", ".").strip()
        return float(v)
    except Exception:
        return default


def brl(v: Any, com_simbolo: bool = True) -> str:
    """1234.5 -> 'R$ 1.234,50'"""
    n = _num(v)
    txt = f"{n:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return f"R$ {txt}" if com_simbolo else txt


def _data_br(dt: Optional[datetime] = None) -> str:
    dt = dt or datetime.now(_tz_br())
    return dt.strftime("%d/%m/%Y")


def _tel_br(tel: Any) -> str:
    digits = re.sub(r"\D", "", str(tel or ""))
    if not digits:
        return ""
    if len(digits) == 13 and digits.startswith("55"):
        digits = digits[2:]  # remove o DDI
    if len(digits) == 11:
        return f"({digits[:2]}) {digits[2:6]}-{digits[6:]}"
    if len(digits) == 10:
        return f"({digits[:2]}) {digits[2:6]}-{digits[6:]}"
    return str(tel)


# --------------------------------------------------------------------------
# Catálogo padrão (editável pelo operador antes do envio)
# --------------------------------------------------------------------------

CATALOGO_PADRAO: Dict[str, List[Dict[str, Any]]] = {
    "peixaria": [
        {
            "descricao": "Filé de tilápia fresco, eviscerado e higienizado",
            "quantidade": 10,
            "unidade": "kg",
            "valor_unitario": 32.90,
        },
        {
            "descricao": "Filé de robalo (peixe inteiro eviscerado)",
            "quantidade": 10,
            "unidade": "kg",
            "valor_unitario": 69.90,
        },
        {
            "descricao": "Posta de atum (bluefin) — cadeia fria",
            "quantidade": 5,
            "unidade": "kg",
            "valor_unitario": 89.90,
        },
        {
            "descricao": "Camarão cinza limpo, head-on",
            "quantidade": 5,
            "unidade": "kg",
            "valor_unitario": 74.90,
        },
        {
            "descricao": "Camarão rosa limpo (filetado)",
            "quantidade": 3,
            "unidade": "kg",
            "valor_unitario": 98.00,
        },
        {
            "descricao": "Mexilhão fresco limpo",
            "quantidade": 5,
            "unidade": "kg",
            "valor_unitario": 42.50,
        },
        {
            "descricao": "Ostras frescos (meio concha)",
            "quantidade": 12,
            "unidade": "dz",
            "valor_unitario": 29.90,
        },
        {
            "descricao": "Polvo fresco limpo",
            "quantidade": 3,
            "unidade": "kg",
            "valor_unitario": 79.90,
        },
    ],
    "dedetizacao": [
        {
            "descricao": "Desinsetização — controle de insetos voadores e rasteiros",
            "quantidade": 100,
            "unidade": "m²",
            "valor_unitario": 12.00,
        },
        {
            "descricao": "Desratização — controle de roedores (armadilhas e atrativo)",
            "quantidade": 100,
            "unidade": "m²",
            "valor_unitario": 15.00,
        },
        {
            "descricao": "Descupinização — controle de cupins",
            "quantidade": 100,
            "unidade": "m²",
            "valor_unitario": 18.00,
        },
        {
            "descricao": "Limpeza e sanitização de reservatório (caixa d'água)",
            "quantidade": 2,
            "unidade": "un.",
            "valor_unitario": 95.00,
        },
        {
            "descricao": "Laudo sanitário / certificado de controle de pragas",
            "quantidade": 1,
            "unidade": "un.",
            "valor_unitario": 45.00,
        },
        {
            "descricao": "Contrato de manutenção periódica (visita mensal)",
            "quantidade": 6,
            "unidade": "visita",
            "valor_unitario": 180.00,
        },
    ],
}


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------

TEMPLATES: Dict[str, Dict[str, Any]] = {
    "peixaria": {
        "rotulo": "Pescados & Atacado",
        "titulo": "PROPOSTA COMERCIAL — PESCADOS E ATACADO",
        "subtitulo": "Fornecimento de peixes frescos, camarões e mariscos para bares, restaurantes, quiosques e mercearias",
        "cor": "#006699",
        "cor_escura": "#004466",
        "validade_dias": 3,
        "pagamento": "PIX (5% de desconto) ou Faturado — 15 dias",
        "entrega": "Entrega em rota diária (Natal/RN). Frete combinado conforme volume. Entrega refrigerada em caixa isotérmica.",
        "garantia": "Produto com respaldo sanitário e rastreio de origem. Trocas somente mediante nota fiscal e produto refrigerado. Peixes frescos: consumir em até 24h após a entrega.",
        "observacoes": "Preços válidos para a validade desta proposta. Estoque sujeito a confirmação conforme disponibilidade diária do pescado. Amostra do lote pode ser solicitada sem custo.",
        "rodape": "Peixaria do William — Atacado de Pescados Frescos, Camarões e Mariscos | Natal/RN",
        "rotulo_medida": "Quantidade / Medida",
        "rotulo_valor": "Valor unitário",
        "rotulo_total": "Total",
    },
    "dedetizacao": {
        "rotulo": "Controle de Pragas & Laudo Sanitário",
        "titulo": "PROPOSTA COMERCIAL — CONTROLE DE PRAGAS E LAUDO SANITÁRIO",
        "subtitulo": "Desinsetização, desratização, descupinização, limpeza de reservatórios e emissão de laudo sanitário",
        "cor": "#166534",
        "cor_escura": "#0f3d20",
        "validade_dias": 15,
        "pagamento": "PIX, cartão ou Faturado — 15 dias",
        "entrega": "Atendimento no local, mediante agendamento. Metragem (m²) conferida no dia do serviço.",
        "garantia": "Garantia de 3 a 6 meses conforme periodicidade contratada, com reatendimento gratuito no período e laudo sanitário emitido após cada aplicação.",
        "observacoes": "Alvará Sanitário e laudo de controle de pragas emitidos após a aplicação. Equipamentos de proteção individual (EPI) utilizados em todas as visitas. Necessário agendamento prévio.",
        "rodape": "Adriano Dedetização — Controle de Pragas e Sanitização | Natal/RN",
        "rotulo_medida": "Metragem / Quantidade",
        "rotulo_valor": "Valor unitário",
        "rotulo_total": "Total",
    },
}


# --------------------------------------------------------------------------
# Montagem da proposta
# --------------------------------------------------------------------------


def detectar_template(tenant: Dict[str, Any], lead: Optional[Dict[str, Any]] = None) -> str:
    """Deduz o template pelo tenant (nicho/tipo/slug/nome)."""
    t = tenant or {}
    blob = " ".join(
        str(t.get(k) or "")
        for k in ("slug", "name", "business_type", "business_niche", "niche", "specialty")
    ).lower()
    lead = lead or {}
    lblob = str(lead.get("tenant_niche") or lead.get("niche") or "").lower()
    blob = f"{blob} {lblob}"

    if any(k in blob for k in ("dedetiz", "praga", "sanitar", "control")):
        return "dedetizacao"
    if any(k in blob for k in ("peix", "pisc", "atacad", "peixe", "marisc")):
        return "peixaria"
    return "peixaria"


def _condicoes_padrao(tpl: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "validade_dias": tpl["validade_dias"],
        "pagamento": tpl["pagamento"],
        "entrega": tpl["entrega"],
        "garantia": tpl["garantia"],
        "observacoes": tpl["observacoes"],
    }


def _itens_de(extra: Any, tpl_key: str) -> List[Dict[str, Any]]:
    """Normaliza a lista de itens vinda do frontend (ou usa o catálogo padrão)."""
    itens: List[Dict[str, Any]] = []
    if isinstance(extra, list) and extra:
        for it in extra:
            if not isinstance(it, dict):
                continue
            desc = str(it.get("descricao") or "").strip()
            if not desc:
                continue
            qtd = it.get("quantidade")
            uni = str(it.get("unidade") or "").strip()
            vu = _num(it.get("valor_unitario"))
            itens.append(
                {
                    "descricao": desc,
                    "quantidade": qtd,
                    "unidade": uni,
                    "valor_unitario": vu,
                    "total": _num(it.get("total"), _num(qtd) * vu),
                }
            )
    if not itens:
        for it in CATALOGO_PADRAO.get(tpl_key, []):
            itens.append(
                {
                    "descricao": it["descricao"],
                    "quantidade": it["quantidade"],
                    "unidade": it["unidade"],
                    "valor_unitario": it["valor_unitario"],
                    "total": _num(it["quantidade"]) * _num(it["valor_unitario"]),
                }
            )
    return itens


def _medida(it: Dict[str, Any]) -> str:
    q = it.get("quantidade")
    uni = str(it.get("unidade") or "").strip()
    if q is None or q == "":
        return uni or "—"
    if isinstance(q, float) and q.is_integer():
        q = int(q)
    return f"{q} {uni}".strip()


def montar_proposta(
    tenant: Dict[str, Any],
    lead: Dict[str, Any],
    itens: Any = None,
    cliente: Any = None,
    condicoes: Any = None,
    numero: Optional[str] = None,
    template: Optional[str] = None,
) -> Dict[str, Any]:
    """Monta o dicionário da proposta com os dados REAIS do lead + tenant."""
    tpl_key = template or detectar_template(tenant, lead)
    if tpl_key not in TEMPLATES:
        tpl_key = "peixaria"
    tpl = TEMPLATES[tpl_key]

    cli = dict(cliente or {}) if isinstance(cliente, dict) else {}
    cond = dict(condicoes or {}) if isinstance(condicoes, dict) else {}

    # --- cliente: nome (contato) + empresa (fantasia, editável) + telefone ---
    nome = (
        cli.get("nome")
        or lead.get("nome_fantasia")
        or lead.get("name")
        or "Cliente"
    )
    empresa = (
        cli.get("empresa")
        or cli.get("nome_fantasia")
        or lead.get("empresa")
        or lead.get("nome_fantasia")
        or ""
    )
    telefone = cli.get("telefone") or lead.get("phone") or ""
    cidade = cli.get("cidade") or lead.get("cidade") or ""
    bairro = cli.get("bairro") or lead.get("bairro") or ""
    cidade_bairro = cli.get("cidade_bairro") or " - ".join(
        [c for c in (cidade, bairro) if c]
    )
    if not cidade_bairro:
        cidade_bairro = str(lead.get("internal_notes") or "").split("Endereço:")[-1].split(".")[0].strip()

    # --- empresa (quem emite) ---
    empresa_emissora = {
        "nome": str(tenant.get("name") or "").strip(),
        "razao_social": str(tenant.get("razao_social") or tenant.get("name") or "").strip(),
        "cnpj": str(tenant.get("cnpj") or "").strip(),
        "telefone": str(tenant.get("phone") or "").strip(),
        "whatsapp": str(tenant.get("whatsapp") or tenant.get("phone") or "").strip(),
        "email": str(tenant.get("email") or "").strip(),
        "endereco": str(tenant.get("endereco") or tenant.get("address") or "").strip(),
        "cidade": str(tenant.get("city") or "").strip(),
        "logo_url": str(tenant.get("logo_url") or "").strip(),
        "logo_data_uri": str(tenant.get("logo_data_uri") or "").strip(),
        "cor": str(tenant.get("primary_color") or tpl["cor"]).strip(),
    }

    itens_norm = _itens_de(itens, tpl_key)
    total = sum(_num(i.get("total")) for i in itens_norm)

    cond_base = _condicoes_padrao(tpl)
    for k in ("validade_dias", "pagamento", "entrega", "garantia", "observacoes"):
        if cond.get(k) not in (None, ""):
            cond_base[k] = cond[k]
    try:
        validade_dias = int(_num(cond_base.get("validade_dias"), tpl["validade_dias"]))
    except Exception:
        validade_dias = int(tpl["validade_dias"])
    cond_base["validade_dias"] = validade_dias

    hoje = datetime.now(_tz_br())
    validade = hoje + timedelta(days=validade_dias)

    return {
        "template": tpl_key,
        "template_rotulo": tpl["rotulo"],
        "titulo": tpl["titulo"],
        "subtitulo": tpl["subtitulo"],
        "cor": empresa_emissora["cor"] or tpl["cor"],
        "cor_escura": tpl["cor_escura"],
        "numero": numero or f"PROP-{hoje.year}-{hoje.strftime('%m%d')}",
        "emissao": _data_br(hoje),
        "validade": _data_br(validade),
        "empresa": empresa_emissora,
        "cliente": {
            "nome": nome,
            "empresa": empresa,
            "telefone": telefone,
            "cidade": cidade,
            "bairro": bairro,
            "cidade_bairro": cidade_bairro,
        },
        "itens": itens_norm,
        "total": total,
        "condicoes": cond_base,
        "rodape": tpl["rodape"],
        "rotulo_medida": tpl["rotulo_medida"],
        "rotulo_valor": tpl["rotulo_valor"],
    }


def validar(p: Dict[str, Any]) -> List[str]:
    """Pendências que o operador deve resolver antes de enviar (vai pro card)."""
    pend: List[str] = []
    cli = p.get("cliente") or {}
    if not cli.get("telefone"):
        pend.append("Telefone do cliente não informado — não dá para enviar no WhatsApp.")
    if not cli.get("empresa"):
        pend.append(
            "Nome fantasia do comércio não informado (o nome do banco pode não ser o do negócio). "
            "Edite no lápis do card."
        )
    if not p.get("itens"):
        pend.append("Nenhum item na proposta.")
    return pend


# --------------------------------------------------------------------------
# HTML A4
# --------------------------------------------------------------------------


def render_html(p: Dict[str, Any]) -> str:
    """HTML A4 imprimível (usado no preview e no PDF via Chrome)."""
    emp = p.get("empresa") or {}
    cli = p.get("cliente") or {}
    itens = p.get("itens") or []
    cond = p.get("condicoes") or {}
    cor = p.get("cor") or "#006699"
    cor_escura = p.get("cor_escura") or "#004466"

    logo = emp.get("logo_data_uri") or emp.get("logo_url") or ""
    logo_html = (
        f'<img src="{_esc(logo)}" alt="logo" style="max-height:64px;max-width:190px;'
        f'object-fit:contain;" />'
        if logo
        else f'<div style="width:120px;height:56px;border-radius:10px;background:{_esc(cor)};'
        f'color:#fff;display:flex;align-items:center;justify-content:center;'
        f'font:700 20px Arial,sans-serif;letter-spacing:1px;">'
        f'{_esc((emp.get("nome") or "EMPRESA")[:2].upper())}</div>'
    )

    empresa_nome = emp.get("razao_social") or emp.get("nome") or "—"
    contatos = []
    if emp.get("cnpj"):
        contatos.append(f"CNPJ: {_esc(emp['cnpj'])}")
    if emp.get("telefone"):
        contatos.append(f"Tel: {_esc(_tel_br(emp['telefone']))}")
    if emp.get("whatsapp") and emp.get("whatsapp") != emp.get("telefone"):
        contatos.append(f"WhatsApp: {_esc(_tel_br(emp['whatsapp']))}")
    if emp.get("email"):
        contatos.append(f"E-mail: {_esc(emp['email'])}")
    endereco = ", ".join(
        [x for x in (emp.get("endereco"), emp.get("cidade")) if x]
    )
    if endereco:
        contatos.append(_esc(endereco))

    def linha_cliente(rotulo: str, valor: str, vazio: str = "— a confirmar —") -> str:
        if not valor:
            valor = f'<span style="color:#b45309;font-style:italic;">{vazio}</span>'
        else:
            valor = _esc(valor)
        return (
            f'<div style="margin-bottom:6px;"><span style="display:inline-block;'
            f'min-width:118px;font-size:9.5px;letter-spacing:.6px;text-transform:uppercase;'
            f'color:#64748b;font-weight:700;">{_esc(rotulo)}</span>'
            f'<span style="font-size:11.5px;color:#0f172a;font-weight:600;"> {valor}</span></div>'
        )

    linhas_itens = []
    for it in itens:
        linhas_itens.append(
            "<tr>"
            f'<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;'
            f'color:#0f172a;">{_esc(it.get("descricao"))}</td>'
            f'<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;'
            f'text-align:center;color:#334155;white-space:nowrap;">{_esc(_medida(it))}</td>'
            f'<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;'
            f'text-align:right;color:#0f172a;white-space:nowrap;">{_esc(brl(it.get("valor_unitario")))}</td>'
            f'<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;'
            f'text-align:right;color:#0f172a;font-weight:700;white-space:nowrap;">'
            f'{_esc(brl(it.get("total")))}</td>'
            "</tr>"
        )
    if not linhas_itens:
        linhas_itens.append(
            '<tr><td colspan="4" style="padding:14px;text-align:center;color:#94a3b8;'
            'font-size:11px;">Nenhum item informado</td></tr>'
        )

    def cond_bloco(rotulo: str, texto: str) -> str:
        if not texto:
            return ""
        return (
            f'<div style="margin-bottom:9px;"><span style="display:block;font-size:9.5px;'
            f'letter-spacing:.6px;text-transform:uppercase;color:{_esc(cor)};font-weight:800;'
            f'margin-bottom:2px;">{_esc(rotulo)}</span>'
            f'<span style="font-size:11px;color:#1e293b;line-height:1.45;">{_esc(texto)}</span></div>'
        )

    return f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>{_esc(p.get("titulo"))} {_esc(p.get("numero"))}</title>
<style>
  @page {{ size: A4; margin: 11mm 12mm 12mm 12mm; }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin:0; padding:0; }}
  body {{ font-family: Arial, Helvetica, sans-serif; color:#0f172a; font-size:11px;
          -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  .topo {{ display:flex; justify-content:space-between; align-items:flex-start;
           border-bottom:3px solid {cor}; padding-bottom:10px; }}
  .marca {{ font-size:16px; font-weight:800; color:{cor_escura}; letter-spacing:.2px; }}
  .sub {{ font-size:9.5px; color:#64748b; margin-top:2px; }}
  .doc {{ text-align:right; }}
  .doc .t {{ font-size:12px; font-weight:800; color:{cor_escura}; letter-spacing:.4px; }}
  .doc .n {{ font-size:11px; color:#334155; margin-top:3px; font-weight:700; }}
  .faixa {{ background:{cor}; color:#fff; padding:9px 14px; margin:12px 0 0; border-radius:6px; }}
  .faixa h1 {{ margin:0; font-size:14px; letter-spacing:.4px; font-weight:800; }}
  .faixa p {{ margin:3px 0 0; font-size:10px; opacity:.92; line-height:1.35; }}
  .grade {{ display:flex; gap:12px; margin-top:12px; }}
  .caixa {{ flex:1; border:1px solid #e2e8f0; border-radius:8px; padding:11px 13px;
            background:#f8fafc; }}
  .caixa h3 {{ margin:0 0 7px; font-size:9.5px; letter-spacing:.8px; text-transform:uppercase;
               color:{cor}; font-weight:800; }}
  table {{ width:100%; border-collapse:collapse; margin-top:13px; }}
  thead th {{ background:{cor_escura}; color:#fff; font-size:9.5px; letter-spacing:.5px;
              text-transform:uppercase; padding:8px 10px; text-align:left; font-weight:700; }}
  thead th:nth-child(2), thead th:nth-child(3), thead th:nth-child(4) {{ text-align:right; }}
  thead th:nth-child(2) {{ text-align:center; }}
  tfoot td {{ padding:9px 10px; font-size:11.5px; font-weight:800; color:{cor_escura};
              text-align:right; }}
  tfoot td:first-child {{ text-align:left; font-size:10px; letter-spacing:.6px;
                          text-transform:uppercase; color:#64748b; font-weight:700; }}
  .obs {{ margin-top:12px; border-left:3px solid {cor}; background:#f8fafc; padding:9px 12px;
          border-radius:0 6px 6px 0; }}
  .obs p {{ margin:0 0 4px; font-size:10.5px; color:#334155; line-height:1.45; }}
  .assinatura {{ margin-top:22px; display:flex; justify-content:space-between; align-items:flex-end; }}
  .assinatura div {{ width:44%; border-top:1px solid #94a3b8; padding-top:5px;
                      font-size:9.5px; color:#64748b; text-align:center; }}
  .rodape {{ margin-top:16px; border-top:1px solid #e2e8f0; padding-top:7px;
             font-size:9px; color:#94a3b8; text-align:center; }}
  .validade {{ margin-top:9px; font-size:10px; color:#b45309; font-weight:700; }}
</style></head>
<body>
  <div class="topo">
    <div style="display:flex;gap:12px;align-items:center;">
      {logo_html}
      <div>
        <div class="marca">{_esc(empresa_nome)}</div>
        <div class="sub">{_esc(p.get("template_rotulo"))}</div>
        <div class="sub">{" &nbsp;·&nbsp; ".join(contatos)}</div>
      </div>
    </div>
    <div class="doc">
      <div class="t">PROPOSTA COMERCIAL</div>
      <div class="n">Nº {_esc(p.get("numero"))}</div>
      <div class="sub">Emissão: {_esc(p.get("emissao"))}</div>
      <div class="sub">Validade: {_esc(p.get("validade"))}</div>
    </div>
  </div>

  <div class="faixa">
    <h1>{_esc(p.get("titulo"))}</h1>
    <p>{_esc(p.get("subtitulo"))}</p>
  </div>

  <div class="grade">
    <div class="caixa">
      <h3>Cliente</h3>
      {linha_cliente("Nome / Contato", cli.get("nome"))}
      {linha_cliente("Empresa", cli.get("empresa"), "(nome fantasia a confirmar)")}
      {linha_cliente("Telefone", _tel_br(cli.get("telefone")) if cli.get("telefone") else "",
                     "(telefone a confirmar)")}
      {linha_cliente("Cidade / Bairro", cli.get("cidade_bairro"), "(cidade a confirmar)")}
    </div>
    <div class="caixa">
      <h3>Condições comerciais</h3>
      {cond_bloco("Validade da proposta", f"{cond.get('validade_dias')} dias ({p.get('validade')})")}
      {cond_bloco("Forma de pagamento", str(cond.get("pagamento") or ""))}
      {cond_bloco("Entrega / atendimento", str(cond.get("entrega") or ""))}
      {cond_bloco("Garantia", str(cond.get("garantia") or ""))}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:46%;">Descrição</th>
        <th style="width:16%;">{_esc(p.get("rotulo_medida"))}</th>
        <th style="width:18%;">{_esc(p.get("rotulo_valor"))}</th>
        <th style="width:20%;">Total</th>
      </tr>
    </thead>
    <tbody>{''.join(linhas_itens)}</tbody>
    <tfoot>
      <tr>
        <td>Total da proposta</td>
        <td></td>
        <td></td>
        <td>{_esc(brl(p.get("total")))}</td>
      </tr>
    </tfoot>
  </table>

  <div class="obs">
    {cond_bloco("Observações", str(cond.get("observacoes") or ""))}
  </div>

  <div class="validade">
    Esta proposta é válida por {cond.get("validade_dias")} dias a partir da emissão
    ({_esc(p.get("emissao"))}) e está sujeita à confirmação de estoque/serviço.
  </div>

  <div class="assinatura">
    <div>{_esc(empresa_nome)}<br>Responsável comercial</div>
    <div>Aceite do cliente<br>Data: ____/____/______</div>
  </div>

  <div class="rodape">{_esc(p.get("rodape"))}</div>
</body></html>"""


# --------------------------------------------------------------------------
# Texto para WhatsApp
# --------------------------------------------------------------------------


def render_whatsapp(p: Dict[str, Any]) -> str:
    """Mensagem de texto (sem PDF) — mesma informação da proposta, em texto puro."""
    emp = p.get("empresa") or {}
    cli = p.get("cliente") or {}
    cond = p.get("condicoes") or {}
    itens = p.get("itens") or []

    partes: List[str] = []
    partes.append(f"*{emp.get('nome') or ''}* — Proposta Comercial {p.get('numero')}")
    partes.append("")
    nome = cli.get("nome") or ""
    if cli.get("empresa"):
        partes.append(f"Cliente: {cli['empresa']}")
    if nome and nome.lower() != str(cli.get("empresa") or "").lower():
        partes.append(f"Contato: {nome}")
    if cli.get("telefone"):
        partes.append(f"Telefone: {_tel_br(cli.get('telefone'))}")
    if cli.get("cidade_bairro"):
        partes.append(f"Cidade/Bairro: {cli.get('cidade_bairro')}")
    partes.append("")
    partes.append("*Itens:*")
    for it in itens:
        partes.append(
            f"• {it.get('descricao')} — {_medida(it)} × {brl(it.get('valor_unitario'))} "
            f"= {brl(it.get('total'))}"
        )
    partes.append("")
    partes.append(f"*Total: {brl(p.get('total'))}*")
    partes.append("")
    partes.append("*Condições:*")
    partes.append(f"• Validade: {cond.get('validade_dias')} dias ({p.get('validade')})")
    if cond.get("pagamento"):
        partes.append(f"• Pagamento: {cond.get('pagamento')}")
    if cond.get("entrega"):
        partes.append(f"• Entrega: {cond.get('entrega')}")
    if cond.get("garantia"):
        partes.append(f"• Garantia: {cond.get('garantia')}")
    if cond.get("observacoes"):
        partes.append(f"• Observações: {cond.get('observacoes')}")
    partes.append("")
    if not cli.get("empresa"):
        partes.append(
            "Obs.: falta o nome fantasia do seu comércio (o cadastro antigo tem só o "
            "nome do contato) — me confirma que eu já atualizo a proposta."
        )
        partes.append("")
    partes.append(
        "Se estiver de acordo, é só confirmar que eu já deixo tudo pronto. "
        "Qualquer ajuste de item ou quantidade é só falar."
    )
    return "\n".join(partes)


# --------------------------------------------------------------------------
# PDF (Playwright + Chrome do sistema)
# --------------------------------------------------------------------------

CHROME_CANDIDATOS = (
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
)


def _chrome_path() -> Optional[str]:
    import os

    for c in CHROME_CANDIDATOS:
        if os.path.exists(c):
            return c
    return None


def gerar_pdf(html: str) -> bytes:
    """HTML -> PDF A4 (Playwright + Chrome). Levanta RuntimeError se não houver Chrome."""
    chrome = _chrome_path()
    if not chrome:
        raise RuntimeError(
            "Chrome/Chromium não encontrado no servidor — não foi possível gerar o PDF. "
            "Instale o google-chrome ou use o envio em texto."
        )
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"Playwright indisponível: {exc}") from exc

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=chrome,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        try:
            page = browser.new_page()
            page.set_content(html, wait_until="load")
            page.emulate_media(media="print")
            pdf = page.pdf(
                format="A4",
                print_background=True,
                margin={"top": "0mm", "bottom": "0mm", "left": "0mm", "right": "0mm"},
            )
        finally:
            browser.close()
    return pdf
