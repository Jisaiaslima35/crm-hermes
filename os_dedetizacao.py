"""
ORDEM DE SERVIÇO DE DEDETIZAÇÃO — modelo pronto + montagem + impressão (02/11/2026)

Sprint "dedetização" do CRM-Hermes (tenant Adriano Dedetização).

O módulo é puro (sem dependências) para poder ser importado tanto pelo
`webhook_server.py` (API :3010) quanto por scripts avulsos de emissão.

O que tem aqui:
  * MODELO_OS       — o modelo de campos de uma OS de dedetização (o "coração
                      do negócio" do Adriano, já que a OS é o documento que
                      sustenta a garantia).
  * CHECKLIST       — a inspeção de diagnóstico que o técnico preenche.
  * montar_os()     — junta tenant + lead + agendamento num rascunho já
                      preenchido (o que dá no CRM tem prefixo automático).
  * render_html()   — versão imprimível A4 (o técnico imprime/assina).
  * render_whatsapp() — versão texto para mandar no WhatsApp.
  * validar_os()    — lista de campos faltantes (a OS não sai "pronta" vazia).

Campos que NÃO são automaticos (o operador preenche no formulário):
endereço/documentos, tipo de praga, área, produto/dose, EPI e assinaturas —
o CRM não tem esses dados em nenhuma tabela.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

# Prazo padrão de garantia (3 meses) — o mais comum no mercado de dedetização
GARANTIA_PADRAO_DIAS = 90

# Praças típicas — o técnico marca o que encontrou na inspeção
CHECKLIST_DIAGNOSTICO = [
    "Fezes / marcas de atividade",
    "Odor característico",
    "Posturas de forrageamento (paredes, rodapés, tetos)",
    "Pontos de entrada e infiltração (trincas, tubulações, vãos)",
    "Focos de calor e umidade",
    "Ninhos ou colônias",
]

# Escopo padrão de cobertura da garantia
PRAGAS_PADRAO = ["Baratas", "Cupins", "Formigas"]

# Etapas de Dedetização (mesma esteira do kanban_stages_config do tenant)
ETAPAS_SERVICO = [
    "orcamento_enviado",
    "servico_agendado",
    "servico_realizado",
    "garantia_reforco",
    "manutencao_recorrente",
    "contrato_recorrente",
]


def _tz_br() -> timezone:
    """BRT (Fortaleza) — mesmo fuso usado pelo resto do CRM."""
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo("America/Fortaleza")
    except Exception:
        return timezone(timedelta(hours=-3))


def numero_os(sequencia: int, ano: Optional[int] = None, prefixo: str = "OS") -> str:
    """Numeração sequencial por tenant: OS-2026-0007."""
    ano = ano or datetime.now(_tz_br()).year
    return f"{prefixo}-{ano}-{int(sequencia):04d}"


def _fmt_data(valor: Any, fmt: str = "%d/%m/%Y") -> str:
    if valor is None or valor == "":
        return ""
    if isinstance(valor, datetime):
        return valor.astimezone(_tz_br()).strftime(fmt)
    if isinstance(valor, str):
        try:
            return datetime.fromisoformat(valor.replace("Z", "+00:00")).astimezone(_tz_br()).strftime(fmt)
        except Exception:
            return valor
    return str(valor)


def _esc(texto: Any) -> str:
    """Escapa HTML (nomes/documentos vêm do usuário)."""
    s = "" if texto is None else str(texto)
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def montar_os(
    tenant: Dict[str, Any],
    lead: Optional[Dict[str, Any]] = None,
    appointment: Optional[Dict[str, Any]] = None,
    numero: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Rascunho de OS já preenchido com o que o CRM sabe."""
    tenant = tenant or {}
    lead = lead or {}
    appointment = appointment or {}
    extra = extra or {}

    agora = datetime.now(_tz_br())
    inicio = appointment.get("start_time")
    fim = appointment.get("end_time") or (inicio + timedelta(hours=2) if inicio else None)

    os_dados: Dict[str, Any] = {
        # Identificação
        "numero": numero or numero_os(1, agora.year),
        "emissao": agora.isoformat(),
        "tenant_id": tenant.get("id"),
        "empresa": tenant.get("name") or "Adriano Dedetização",
        "empresa_cnpj": extra.get("empresa_cnpj", ""),
        "empresa_telefone": tenant.get("phone") or extra.get("empresa_telefone", ""),
        "responsavel_tecnico": extra.get("responsavel_tecnico", ""),
        "registro_tecnico": extra.get("registro_tecnico", ""),
        # Cliente / contratante
        "lead_id": lead.get("id"),
        "cliente_nome": lead.get("name") or "",
        "cliente_telefone": lead.get("phone") or "",
        "cliente_documento": extra.get("cliente_documento", ""),
        "cliente_tipo": extra.get("cliente_tipo", "Física"),
        "endereco": extra.get("endereco", ""),
        "complemento": extra.get("complemento", ""),
        "cidade": extra.get("cidade", tenant.get("city") or ""),
        "uf": extra.get("uf", ""),
        "cep": extra.get("cep", ""),
        "local_servico": extra.get("local_servico", ""),
        "tipo_imovel": extra.get("tipo_imovel", ""),
        # Serviço
        "tipo_praga": extra.get("tipo_praga", ""),
        "area": extra.get("area", ""),
        "data_inicio": inicio,
        "data_fim": fim,
        "produto": extra.get("produto", ""),
        "principio_ativo": extra.get("principio_ativo", ""),
        "dose": extra.get("dose", ""),
        "metodo": extra.get("metodo", ""),
        "epi": extra.get("epi", "Luva, máscara, bota e jaleco"),
        "checklist": extra.get("checklist") or {},
        "observacoes": extra.get("observacoes", ""),
        # Garantia
        "garantia_dias": extra.get("garantia_dias", GARANTIA_PADRAO_DIAS),
        "garantia_pragas": extra.get("garantia_pragas", PRAGAS_PADRAO),
        "garantia_observacoes": extra.get(
            "garantia_observacoes",
            "Reagendamento gratuito em caso de reincidência dentro do prazo de garantia.",
        ),
        # Contrato
        "valor_contrato": extra.get("valor_contrato", ""),
        "forma_pagamento": extra.get("forma_pagamento", ""),
        "assinatura_tecnico": "",
        "assinatura_cliente": "",
    }
    return os_dados


def validar_os(os_dados: Dict[str, Any]) -> List[str]:
    """Campos obrigatórios que ainda estão vazios."""
    obrigatorios = [
        ("cliente_nome", "Nome do cliente"),
        ("cliente_telefone", "Telefone do cliente"),
        ("endereco", "Endereço do serviço"),
        ("tipo_praga", "Tipo de praga"),
        ("data_inicio", "Data/hora do atendimento"),
        ("produto", "Produto aplicado"),
        ("metodo", "Método de aplicação"),
    ]
    faltando = []
    for chave, rotulo in obrigatorios:
        if not str(os_dados.get(chave) or "").strip():
            faltando.append(rotulo)
    return faltando


def render_whatsapp(os_dados: Dict[str, Any]) -> str:
    """Versão curta para mandar no WhatsApp (sem HTML)."""
    linhas = [
        f"*{os_dados.get('empresa', '')}* — Ordem de Serviço {os_dados.get('numero', '')}",
        "",
        f"Cliente: {os_dados.get('cliente_nome', '')}",
    ]
    if os_dados.get("endereco"):
        linhas.append(f"Endereço: {os_dados.get('endereco', '')}")
    if os_dados.get("tipo_praga"):
        linhas.append(f"Praga: {os_dados.get('tipo_praga', '')}")
    if os_dados.get("area"):
        linhas.append(f"Área: {os_dados.get('area', '')}")
    if os_dados.get("data_inicio"):
        linhas.append(f"Atendimento: {_fmt_data(os_dados.get('data_inicio'), '%d/%m/%Y às %H:%M')}")
    if os_dados.get("produto"):
        linhas.append(f"Produto: {os_dados.get('produto', '')}")
    if os_dados.get("tecnico") or os_dados.get("responsavel_tecnico"):
        linhas.append(f"Técnico: {os_dados.get('tecnico') or os_dados.get('responsavel_tecnico', '')}")
    linhas += [
        f"Garantia: {os_dados.get('garantia_dias', GARANTIA_PADRAO_DIAS)} dias "
        f"({'/'.join(os_dados.get('garantia_pragas') or PRAGAS_PADRAO)})",
        "",
        "Certificado de garantia e OS digital disponíveis no sistema.",
        os_dados.get("empresa_telefone", ""),
    ]
    return "\n".join([ln for ln in linhas if ln is not None])


def render_html(os_dados: Dict[str, Any]) -> str:
    """OS imprimível em A4 (o técnico imprime, assina e leva ao cliente)."""
    e = _esc
    ini = _fmt_data(os_dados.get("data_inicio"), "%d/%m/%Y")
    fim = _fmt_data(os_dados.get("data_fim"), "%d/%m/%Y")
    hora_ini = _fmt_data(os_dados.get("data_inicio"), "%H:%M")
    hora_fim = _fmt_data(os_dados.get("data_fim"), "%H:%M")

    checklist_rows = ""
    marcados = os_dados.get("checklist") or {}
    for item in CHECKLIST_DIAGNOSTICO:
        marcado = "X" if marcados.get(item) else " "
        checklist_rows += (
            f'<tr><td class="ck">{_esc(marcado)}</td><td>{_esc(item)}</td></tr>'
        )

    def campo(rotulo: str, valor: Any) -> str:
        return (
            f'<div class="field"><span class="lbl">{_esc(rotulo)}</span>'
            f'<span class="val">{_esc(valor) if valor not in (None, "") else "&nbsp;"}</span></div>'
        )

    cabecalho = "".join(
        [
            campo("Cliente", os_dados.get("cliente_nome")),
            campo("CPF / CNPJ", os_dados.get("cliente_documento")),
            campo("Telefone", os_dados.get("cliente_telefone")),
            campo("Tipo de imóvel", os_dados.get("tipo_imovel")),
            campo("Local do serviço", os_dados.get("local_servico")),
            campo("Endereço", os_dados.get("endereco")),
            campo("Complemento", os_dados.get("complemento")),
            campo("Cidade / UF / CEP", " / ".join(
                x for x in [os_dados.get("cidade"), os_dados.get("uf"), os_dados.get("cep")] if x
            )),
        ]
    )

    execucao = "".join(
        [
            campo("Data do atendimento", f"{ini} às {hora_ini}" if ini else ""),
            campo("Término", f"{fim} às {hora_fim}" if fim else ""),
            campo("Tipo de praga", os_dados.get("tipo_praga")),
            campo("Área atendida", os_dados.get("area")),
            campo("Produto aplicado", os_dados.get("produto")),
            campo("Princípio ativo", os_dados.get("principio_ativo")),
            campo("Dose / concentração", os_dados.get("dose")),
            campo("Método de aplicação", os_dados.get("metodo")),
            campo("EPI utilizados", os_dados.get("epi")),
            campo("Valor do serviço", os_dados.get("valor_contrato")),
            campo("Forma de pagamento", os_dados.get("forma_pagamento")),
        ]
    )

    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Ordem de Serviço {_esc(os_dados.get('numero', ''))}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ font-family: Arial, Helvetica, sans-serif; color:#0f172a; background:#f1f5f9;
         margin:0; padding:18px; font-size:12px; }}
  .sheet {{ width:210mm; min-height:297mm; margin:0 auto; background:#fff; padding:14mm 13mm;
            box-shadow:0 6px 24px rgba(0,0,0,.18); }}
  header {{ border-bottom:2px solid #0f172a; padding-bottom:8px; margin-bottom:12px; }}
  h1 {{ font-size:17px; margin:0 0 2px; letter-spacing:.5px; }}
  .sub {{ font-size:10px; color:#475569; text-transform:uppercase; letter-spacing:1.2px; }}
  .meta {{ display:flex; justify-content:space-between; font-size:11px; margin-top:6px; }}
  .meta b {{ font-size:13px; }}
  h2 {{ font-size:11px; text-transform:uppercase; letter-spacing:1px; background:#0f172a; color:#fff;
        padding:4px 8px; margin:14px 0 6px; border-radius:3px; }}
  .grid {{ display:grid; grid-template-columns:1fr 1fr; gap:2px 14px; }}
  .field {{ display:flex; gap:6px; border-bottom:1px dotted #cbd5e1; padding:3px 0; min-height:17px; }}
  .lbl {{ width:132px; flex:none; font-size:10px; color:#64748b; text-transform:uppercase; }}
  .val {{ font-size:11px; font-weight:600; }}
  table {{ width:100%; border-collapse:collapse; }}
  td {{ border-bottom:1px solid #e2e8f0; padding:3px 4px; font-size:11px; }}
  td.ck {{ width:18px; text-align:center; font-weight:700; border:1px solid #94a3b8; }}
  .assin {{ display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:26px; }}
  .linha {{ border-top:1px solid #0f172a; padding-top:4px; font-size:10px; color:#475569; text-align:center; }}
  .obs {{ border:1px solid #cbd5e1; min-height:52px; padding:6px; margin-top:6px; font-size:11px;
          white-space:pre-wrap; }}
  .garantia {{ border:1px solid #0f172a; border-radius:4px; padding:8px 10px; font-size:10.5px;
               line-height:1.55; }}
  footer {{ margin-top:14px; border-top:1px solid #cbd5e1; padding-top:6px; font-size:9px;
            color:#64748b; display:flex; justify-content:space-between; }}
  @media print {{ body {{ background:#fff; padding:0; }} .sheet {{ box-shadow:none; margin:0; }} }}
</style>
</head>
<body>
<div class="sheet">
  <header>
    <h1>ORDEM DE SERVIÇO — CONTROLE DE PRAGAS</h1>
    <div class="sub">{_esc(os_dados.get('empresa', ''))}</div>
    <div class="meta">
      <div><b>OS N.º {_esc(os_dados.get('numero', ''))}</b></div>
      <div>Emissão: {_fmt_data(os_dados.get('emissao'), '%d/%m/%Y às %H:%M')}</div>
    </div>
  </header>

  <h2>1. Identificação do contratante</h2>
  <div class="grid">{cabecalho}</div>

  <h2>2. Diagnóstico / inspeção</h2>
  <table>{checklist_rows}</table>

  <h2>3. Execução do serviço</h2>
  <div class="grid">{execucao}</div>

  <h2>4. Garantia</h2>
  <div class="garantia">
    <b>Prazo de garantia: {e(os_dados.get('garantia_dias', GARANTIA_PADRAO_DIAS))} dias</b>
    a partir da data do atendimento.<br/>
    <b>Pragas cobertas:</b> {e(', '.join(os_dados.get('garantia_pragas') or PRAGAS_PADRAO))}.<br/>
    {e(os_dados.get('garantia_observacoes', ''))}<br/>
    <b>Não cobre:</b> novas infestações originadas por terceiros, obras/reformas, mudança de
    endereço ou rompimento da barreira química por limpeza excessiva.
  </div>

  <h2>5. Observações</h2>
  <div class="obs">{e(os_dados.get('observacoes', ''))}</div>

  <div class="assin">
    <div>
      <div class="linha">Responsável técnico — {_esc(os_dados.get('responsavel_tecnico', ''))}
      {_esc(os_dados.get('registro_tecnico', ''))}</div>
    </div>
    <div>
      <div class="linha">Contratante — {_esc(os_dados.get('cliente_nome', ''))}</div>
    </div>
  </div>

  <footer>
    <span>{_esc(os_dados.get('empresa', ''))} — {_esc(os_dados.get('empresa_telefone', ''))}</span>
    <span>Documento digital válido — OS {_esc(os_dados.get('numero', ''))}</span>
  </footer>
</div>
</body>
</html>"""
