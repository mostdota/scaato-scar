// ============================================================
// SCAATO SCAR v3.0 — WhatsApp Bot + CRM Admin
// Lógica: deságio 7% a.m. ao fundo — cliente vê só a parcela
// ============================================================
const express = require("express");
const axios = require("axios");
const path = require("path");
const app = express();
app.use(express.json());
app.use(express.static("public"));

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

// ── LÓGICA FINANCEIRA ──────────────────────────────────────
// Deságio do fundo: 7% a.m. — cliente nunca vê taxas
// VP = PMT × [1-(1.07)^-24] / 0.07 = PMT × 11.4693
// PMT = valor_financiado / 11.4693

const FATOR_VP = 11.4693; // fator valor presente 7% a.m. / 24 meses
const SEGURO   = 54.90;
const GPS      = 15.00;
const PRAZO    = 24;

function calcularParcela(valorMoto, entrada) {
  const financiado = valorMoto - (entrada || 0);
  const pmtLeasing = financiado / FATOR_VP;
  const total = pmtLeasing + SEGURO + GPS;
  const vpFundo = financiado; // fundo paga exatamente o valor financiado
  return {
    financiado: Math.round(financiado * 100) / 100,
    pmtLeasing: Math.round(pmtLeasing * 100) / 100,
    seguro: SEGURO,
    gps: GPS,
    total: Math.round(total * 100) / 100,
    vpFundo: Math.round(vpFundo * 100) / 100,
    prazo: PRAZO,
  };
}

const CATALOGO = [
  { nome: "Urban Plus", preco: 7690,  motor: "1000W", bateria: "60V 20.8Ah", cores: "Branca, Cinza",                          tag: "entrada" },
  { nome: "S3 Forever", preco: 8990,  motor: "1000W", bateria: "60V 23Ah",   cores: "Roxo, Cinza",                            tag: "" },
  { nome: "X12",        preco: 8990,  motor: "1000W", bateria: "60V 21Ah",   cores: "Branca, Preta",                          tag: "" },
  { nome: "X13",        preco: 9490,  motor: "1000W", bateria: "60V 20Ah",   cores: "Carbono, Preta, Azul",                   tag: "mais completa" },
  { nome: "X21",        preco: 9290,  motor: "3000W", bateria: "60V 21Ah",   cores: "Carbono, Preta, Azul",                   tag: "fat tire" },
  { nome: "X22",        preco: 9890,  motor: "3000W", bateria: "60V 21Ah",   cores: "Branca, Cinza, Vinho",                   tag: "retrô" },
  { nome: "S9 Forever", preco: 10490, motor: "1500W", bateria: "64V 30Ah",   cores: "Vermelha, Preta, Roxa, Branca, Cinza",   tag: "maior autonomia" },
];

// Tabela de parcelas pré-calculada para o SCAR usar
function tabelaParcelas() {
  return CATALOGO.map(m => {
    const s0  = calcularParcela(m.preco, 0);
    const s10 = calcularParcela(m.preco, m.preco * 0.10);
    const s20 = calcularParcela(m.preco, m.preco * 0.20);
    const s30 = calcularParcela(m.preco, m.preco * 0.30);
    return `${m.nome} (R$${m.preco.toLocaleString('pt-BR')}): sem entrada R$${s0.total.toFixed(0)}/mês | entrada 10% R$${s10.total.toFixed(0)}/mês | entrada 20% R$${s20.total.toFixed(0)}/mês | entrada 30% R$${s30.total.toFixed(0)}/mês`;
  }).join('\n');
}

// ── SYSTEM PROMPT ──────────────────────────────────────────
const SYSTEM_PROMPT = `Você é a SCAR — IA oficial de vendas da SCAATO MOBILIDADE.
Empresa: SCAATO | CNPJ: 64.757.314/0001-16
WhatsApp vendas: (47) 99208-3301 | Assistência: (47) 98909-8734
Email: vendas@scaato.com.br | Site: https://www.scaato.com.br
Simulador: https://scaato-leasing-30714265453.us-west1.run.app/

REGRAS ABSOLUTAS:
1. NUNCA mencione taxa de juros, percentual ao mês, % a.m. ou qualquer taxa
2. NUNCA use "aluguel" ou "locação" — use: leasing, plano de aquisição, contrato
3. Foque SEMPRE no valor da parcela mensal — simples e acessível
4. NUNCA mencione "fundo de investimento" ou como funciona o back-office
5. Se o cliente perguntar sobre juros diga: "Nosso modelo é diferente — você paga uma parcela fixa mensal, sem surpresas"

MODELO DE NEGÓCIO (interno — nunca revelar):
- Contratos de 24 meses com parcela fixa
- Cada parcela inclui: leasing + Seguro Porto Seguro (R$54,90) + Telemetria GPS (R$15,00)
- O cliente pode comprar ao final pelo valor residual
- Aprovação facilitada — atendemos nome limpo e negativado

TABELA DE PARCELAS (24 meses, já inclui seguro+GPS):
${tabelaParcelas()}

FLUXO DE ATENDIMENTO:
1. Saudação calorosa → perguntar o nome
2. Perguntar qual modelo interessa ou mostrar o catálogo
3. Perguntar se tem valor de entrada disponível (não é obrigatório)
4. Apresentar a parcela: "São R$ XXX/mês por 24 meses, já com seguro e rastreador inclusos!"
5. Coletar: nome, cidade, interesse no modelo → direcionar para fechamento

CATÁLOGO:
- Urban Plus: R$7.690 | 1000W | 60V 20.8Ah | NFC, freio disco, alarme
- S3 Forever: R$8.990 | 1000W | 60V 23Ah | autonomia 50km
- X12: R$8.990 | 1000W | 60V 21Ah | Bluetooth, ré
- X13: R$9.490 | 1000W | 60V 20Ah | LED, piloto automático, ré — A MAIS COMPLETA ⭐
- X21: R$9.290 | 3000W | 60V 21Ah | Fat Tire — MAIS POTENTE
- X22: R$9.890 | 3000W | 60V 21Ah | Design retrô
- S9 Forever: R$10.490 | 1500W | 64V 30Ah LiFePO4 | 80km autonomia — MAIOR AUTONOMIA 🏆

PROGRAMA URBAN 100 (sem entrada):
Grupos de 100 participantes | 24 meses | Pré-contemplação: R$467/mês | Pós: R$567/mês

TOM: WhatsApp — mensagens curtas, *negrito* para destaque, emojis com moderação, direto ao ponto.
CTA: sempre feche com simulação de parcela + link do simulador ou convite para fechar.`;

// ── CLAUDE ─────────────────────────────────────────────────
async function chamarClaude(historico, mensagemAtual) {
  const messages = [...historico, { role: "user", content: mensagemAtual }];
  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-haiku-4-5-20251001",
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

// ── Z-API ──────────────────────────────────────────────────
async function enviarWhatsApp(telefone, mensagem) {
  const url = `https://api.z-api.io/instances/${CONFIG.ZAPI_INSTANCE}/token/${CONFIG.ZAPI_TOKEN}/send-text`;
  const headers = { "Content-Type": "application/json" };
  if (CONFIG.ZAPI_CLIENT) headers["Client-Token"] = CONFIG.ZAPI_CLIENT;
  console.log(`📤 Enviando para ${telefone}...`);
  const resp = await axios.post(url, { phone: telefone, message: mensagem }, { headers });
  console.log(`✅ Enviado:`, JSON.stringify(resp.data));
  return resp.data;
}

// ── LEADS ──────────────────────────────────────────────────
function detectarLead(telefone, mensagem) {
  const emailMatch = mensagem.match(/[\w.-]+@[\w.-]+\.\w+/);
  const nomeMatch  = mensagem.match(/(?:me\s+chamo|meu\s+nome\s+[eé]|sou\s+(?:o|a)\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
  if (emailMatch || nomeMatch) {
    const ex = leads.find(l => l.telefone === telefone);
    if (ex) {
      if (emailMatch) ex.email = emailMatch[0];
      if (nomeMatch) ex.nome = nomeMatch[1];
      ex.updatedAt = new Date().toISOString();
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

// ── WEBHOOK ────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("📨 Webhook:", JSON.stringify(body).substring(0, 200));

    if (body.fromMe || body.isGroup || body.isNewsletter) return res.sendStatus(200);

    const telefone = body.phone || body.from || body.sender;
    const mensagem =
      body.text?.message ||
      body.message?.conversation ||
      body.message?.extendedTextMessage?.text ||
      body.body || body.content || "";

    if (!telefone || !mensagem || !telefone.match(/^\d+$/)) {
      console.log("⚠️ Ignorado (sem telefone/mensagem válidos)");
      return res.sendStatus(200);
    }

    console.log(`📱 De ${telefone}: ${mensagem.substring(0, 80)}`);

    if (!conversas.has(telefone)) conversas.set(telefone, []);
    const historico = conversas.get(telefone);
    const resposta = await chamarClaude(historico.slice(-20), mensagem);

    historico.push({ role: "user",      content: mensagem });
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

// ── API ENDPOINTS ──────────────────────────────────────────
app.get("/api/status", (req, res) => {
  res.json({
    status: "🟢 SCAR Online",
    empresa: "SCAATO MOBILIDADE",
    versao: "3.0.0",
    conversas_ativas: conversas.size,
    leads_capturados: leads.length,
    uptime: process.uptime(),
    config: {
      zapi_instance: CONFIG.ZAPI_INSTANCE ? "✅" : "❌",
      zapi_token:    CONFIG.ZAPI_TOKEN    ? "✅" : "❌",
      zapi_client:   CONFIG.ZAPI_CLIENT   ? "✅" : "❌",
      anthropic:     CONFIG.ANTHROPIC_KEY ? "✅" : "❌",
    },
  });
});

app.get("/api/leads", (req, res) => {
  res.json({ total: leads.length, leads: leads.sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)) });
});

app.get("/api/conversas", (req, res) => {
  const lista = [];
  conversas.forEach((msgs, telefone) => {
    lista.push({
      telefone,
      mensagens: msgs.length,
      ultima: msgs[msgs.length-1]?.content?.substring(0, 100) || "",
    });
  });
  res.json({ total: lista.length, conversas: lista });
});

app.get("/api/conversa/:telefone", (req, res) => {
  const hist = conversas.get(req.params.telefone);
  if (!hist) return res.status(404).json({ erro: "Não encontrada" });
  res.json({ telefone: req.params.telefone, mensagens: hist });
});

app.delete("/api/conversa/:telefone", (req, res) => {
  conversas.delete(req.params.telefone);
  res.json({ ok: true });
});

app.post("/api/enviar", async (req, res) => {
  const { telefone, mensagem } = req.body;
  if (!telefone || !mensagem) return res.status(400).json({ erro: "telefone e mensagem obrigatórios" });
  try {
    await enviarWhatsApp(telefone, mensagem);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: e.response?.data || e.message });
  }
});

// API de simulação (para o CRM)
app.get("/api/simular", (req, res) => {
  const { modelo, entrada } = req.query;
  const m = CATALOGO.find(c => c.nome.toLowerCase() === (modelo||"").toLowerCase());
  if (!m) return res.status(404).json({ erro: "Modelo não encontrado", modelos: CATALOGO.map(c=>c.nome) });
  const calc = calcularParcela(m.preco, parseFloat(entrada)||0);
  res.json({ modelo: m.nome, preco: m.preco, entrada: parseFloat(entrada)||0, ...calc });
});

app.get("/api/catalogo", (req, res) => res.json(CATALOGO));

// Legado (compatibilidade)
app.get("/",         (req, res) => res.redirect("/api/status"));
app.get("/leads",    (req, res) => res.redirect("/api/leads"));
app.get("/conversas",(req, res) => res.redirect("/api/conversas"));
app.get("/conversa/:t", (req, res) => res.redirect(`/api/conversa/${req.params.t}`));

app.listen(CONFIG.PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║ 🛵 SCAATO SCAR v3.0                 ║
║ Status: 🟢 Online                   ║
║ Porta: ${CONFIG.PORT}                       ║
╚══════════════════════════════════════╝`);
  console.log("🔑 Config:");
  console.log("  ZAPI_INSTANCE:", CONFIG.ZAPI_INSTANCE ? "✅" : "❌");
  console.log("  ZAPI_TOKEN:",    CONFIG.ZAPI_TOKEN    ? "✅" : "❌");
  console.log("  ZAPI_CLIENT:",   CONFIG.ZAPI_CLIENT   ? "✅ "+CONFIG.ZAPI_CLIENT.substring(0,8)+"..." : "❌");
  console.log("  ANTHROPIC_KEY:", CONFIG.ANTHROPIC_KEY ? "✅" : "❌");
});
