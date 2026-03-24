// ============================================================
// SCAATO SCAR — Servidor WhatsApp via Z-API + Claude AI
// ============================================================
const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

const CONFIG = {
  ANTHROPIC_KEY: process.env.ANTHROPIC_API_KEY || "",
  ZAPI_INSTANCE: process.env.ZAPI_INSTANCE || "3EFD49D1615EC1DB26145A83A6CF71BF",
  ZAPI_TOKEN: process.env.ZAPI_TOKEN || "CBB1AF359F0B2FE8B50A816B",
  ZAPI_CLIENT: process.env.ZAPI_CLIENT || "",
  NUMERO_SCAATO: "5547992083301",
  PORT: process.env.PORT || 3000,
};

const conversas = new Map();
const leads = [];

const SYSTEM_PROMPT = `Você é a SCAR — IA oficial de vendas e suporte da SCAATO MOBILIDADE.
Empresa: SCAATO ASSISTÊNCIA E COMÉRCIO DE VEÍCULOS LTDA | CNPJ: 64.757.314/0001-16
Endereço: R. Paulo Marciano Cunha, 13, Sala 03 – Nova Esperança, Balneário Camboriú/SC
WhatsApp: (47) 99208-3301 | Assistência: (47) 98909-8734 | Email: vendas@scaato.com.br
Simulador: https://scaato-leasing-30714265453.us-west1.run.app/

REGRA ABSOLUTA: NUNCA use "aluguel" ou "locação". Use: leasing, arrendamento mercantil, plano de aquisição programada.
CANAL: WhatsApp — seja mais direto, use emojis moderadamente, mensagens curtas (máx 3 parágrafos).

MODELO DE NEGÓCIO:
- Leasing com opção de compra em 24 meses
- Cada parcela já inclui: leasing + Seguro Porto Seguro (R$54,90) + Telemetria GPS (R$15,00)
- Contrato digital via Clicksign — título executivo extrajudicial
- Bloqueio remoto em inadimplência

LÓGICA DE JUROS:
- Nome LIMPO + entrada ≥ 30% do veículo: 5,5% a.m.
- Nome LIMPO + entrada 20–29%: 7,5% a.m.
- Nome LIMPO + entrada < 20%: 9,9% a.m.
- Negativado + entrada ≥ 30%: 9,9% a.m.
- Negativado + entrada 20–29%: 11,5% a.m.
- Negativado + entrada < 20%: 13,0% a.m.

CATÁLOGO (prazo 24 meses):
1. Urban Plus — R$7.690 | 1000W | 60V 20.8Ah | NFC, 2 faróis, freio disco, alarme
2. S3 Forever — R$8.990 | 1000W | 60V 23Ah | autonomia 50km | NFC, freio disco D+T
3. X12 — R$8.990 | 1000W | 60V 21Ah | NFC, Bluetooth, ré, freio disco D+T
4. X13 — R$9.490 | 1000W | 60V 20Ah | LED completo, piloto auto, ré, Bluetooth, freio hidráulico D+T — A MAIS COMPLETA
5. X21 — R$9.290 | 3000W | 60V 21Ah | NFC, Bluetooth, freio disco D+T | Fat Tire
6. X22 — R$9.890 | 3000W | 60V 21Ah | NFC, Bluetooth, freio disco D+T | Design retrô
7. S9 Forever — R$10.490 | 1500W | 64V 30Ah LiFePO4 | autonomia 80km | LCD, NFC — MAIOR AUTONOMIA

URBAN 100 (sem entrada): Grupos de 100 | 24 meses | Pré: R$467/mês | Pós: R$567/mês

FLUXO: nome → situação do nome → valor de entrada → modelo → cidade
COMPORTAMENTO: mensagens curtas, *negrito* WhatsApp, emojis com moderação
CTA final: sempre direcione para simulador ou fechar via WhatsApp`;

async function chamarClaude(historico, mensagemAtual) {
  const messages = [...historico, { role: "user", content: mensagemAtual }];
  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-3-5-haiku-20241022",
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages,
    },
    {
      headers: {
        "x-api-key": CONFIG.ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
    }
  );
  return response.data.content[0].text;
}

async function enviarWhatsApp(telefone, mensagem) {
  const url = `https://api.z-api.io/instances/${CONFIG.ZAPI_INSTANCE}/token/${CONFIG.ZAPI_TOKEN}/send-text`;
  const headers = { "Content-Type": "application/json" };
  if (CONFIG.ZAPI_CLIENT) headers["Client-Token"] = CONFIG.ZAPI_CLIENT;
  
  console.log(`📤 Enviando para ${telefone} via Z-API...`);
  console.log(`📤 URL: ${url}`);
  console.log(`📤 Client-Token presente: ${!!CONFIG.ZAPI_CLIENT}`);
  
  const resp = await axios.post(url, { phone: telefone, message: mensagem }, { headers });
  console.log(`✅ Z-API respondeu:`, JSON.stringify(resp.data));
  return resp.data;h
}

function detectarLead(telefone, mensagem) {
  const emailMatch = mensagem.match(/[\w.-]+@[\w.-]+\.\w+/);
  const nomeMatch = mensagem.match(/(?:me\s+chamo|meu\s+nome\s+[eé]|sou\s+(?:o|a)\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
  if (emailMatch || nomeMatch) {
    const leadExistente = leads.find(l => l.telefone === telefone);
    if (leadExistente) {
      if (emailMatch) leadExistente.email = emailMatch[0];
      if (nomeMatch) leadExistente.nome = nomeMatch[1];
      leadExistente.updatedAt = new Date().toISOString();
    } else {
      leads.push({
        telefone,
        email: emailMatch ? emailMatch[0] : null,
        nome: nomeMatch ? nomeMatch[1] : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        canal: "whatsapp",
        status: "novo",
      });
      console.log(`🎯 Novo lead: ${telefone}`);
    }
  }
}

// ─── WEBHOOK ────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    
    // Log completo do body para debug
    console.log("📨 Webhook body:", JSON.stringify(body).substring(0, 200));

    if (body.fromMe) return res.sendStatus(200);
    if (body.isGroup) return res.sendStatus(200);

    // Z-API pode mandar o telefone em diferentes campos
    const telefone = body.phone || body.from || body.sender;
    
    // Z-API pode mandar a mensagem em diferentes campos
    const mensagem = 
      body.text?.message ||
      body.message?.conversation ||
      body.message?.extendedTextMessage?.text ||
      body.body ||
      body.content ||
      "";

    if (!telefone || !mensagem) {
      console.log("⚠️ Sem telefone ou mensagem:", JSON.stringify(body).substring(0, 300));
      return res.sendStatus(200);
    }

    console.log(`📱 De ${telefone}: ${mensagem.substring(0, 80)}`);

    if (!conversas.has(telefone)) conversas.set(telefone, []);
    const historico = conversas.get(telefone);
    const historicoLimitado = historico.slice(-20);

    const resposta = await chamarClaude(historicoLimitado, mensagem);

    historico.push({ role: "user", content: mensagem });
    historico.push({ role: "assistant", content: resposta });

    detectarLead(telefone, mensagem);

    await enviarWhatsApp(telefone, resposta);
    console.log(`✅ Resposta enviada para ${telefone}`);

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Erro:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.json({
    status: "🟢 SCAR Online",
    empresa: "SCAATO MOBILIDADE",
    versao: "2.0.0",
    conversas_ativas: conversas.size,
    leads_capturados: leads.length,
    uptime: process.uptime(),
    config: {
      zapi_instance: CONFIG.ZAPI_INSTANCE ? "✅" : "❌",
      zapi_token: CONFIG.ZAPI_TOKEN ? "✅" : "❌",
      zapi_client: CONFIG.ZAPI_CLIENT ? "✅" : "❌",
      anthropic: CONFIG.ANTHROPIC_KEY ? "✅" : "❌",
    }
  });
});

app.get("/leads", (req, res) => {
  res.json({ total: leads.length, leads: leads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
});

app.get("/conversas", (req, res) => {
  const lista = [];
  conversas.forEach((msgs, telefone) => {
    lista.push({ telefone, mensagens: msgs.length, ultima: msgs[msgs.length - 1]?.content?.substring(0, 80) || "" });
  });
  res.json({ total: lista.length, conversas: lista });
});

app.get("/conversa/:telefone", (req, res) => {
  const hist = conversas.get(req.params.telefone);
  if (!hist) return res.status(404).json({ erro: "Não encontrada" });
  res.json({ telefone: req.params.telefone, mensagens: hist });
});

app.delete("/conversa/:telefone", (req, res) => {
  conversas.delete(req.params.telefone);
  res.json({ ok: true });
});

app.post("/enviar", async (req, res) => {
  const { telefone, mensagem } = req.body;
  if (!telefone || !mensagem) return res.status(400).json({ erro: "telefone e mensagem são obrigatórios" });
  try {
    await enviarWhatsApp(telefone, mensagem);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.response?.data || e.message });
  }
});

app.listen(CONFIG.PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║ 🛵 SCAATO SCAR — WhatsApp Bot       ║
║ Status: 🟢 Online                   ║
║ Porta: ${CONFIG.PORT}                       ║
║ Webhook: /webhook                   ║
║ Leads: /leads                       ║
╚══════════════════════════════════════╝
  `);
  console.log("🔑 Config:");
  console.log("  ZAPI_INSTANCE:", CONFIG.ZAPI_INSTANCE ? "✅" : "❌ FALTANDO");
  console.log("  ZAPI_TOKEN:", CONFIG.ZAPI_TOKEN ? "✅" : "❌ FALTANDO");
  console.log("  ZAPI_CLIENT:", CONFIG.ZAPI_CLIENT ? "✅ " + CONFIG.ZAPI_CLIENT.substring(0,8) + "..." : "❌ FALTANDO");
  console.log("  ANTHROPIC_KEY:", CONFIG.ANTHROPIC_KEY ? "✅" : "❌ FALTANDO");
});
