// ============================================================
// SCAATO SCAR v4.0 — Prompt Mestre
// Cenário A: Balneário Camboriú (Plano Direto BC)
// Cenário B: Nacional FIDC (Savegnago/Paulistão)
// ============================================================
const express = require("express");
const axios   = require("axios");
const path    = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const CONFIG = {
  ANTHROPIC_KEY:  process.env.ANTHROPIC_API_KEY || "",
  ZAPI_INSTANCE:  process.env.ZAPI_INSTANCE     || "3EFD49D1615EC1DB26145A83A6CF71BF",
  ZAPI_TOKEN:     process.env.ZAPI_TOKEN         || "CBB1AF359F0B2FE8B50A816B",
  ZAPI_CLIENT:    process.env.ZAPI_CLIENT        || "",
  PORT:           process.env.PORT               || 3000,
};

const conversas = new Map();
const leads     = [];

// ── LÓGICA FINANCEIRA ──────────────────────────────────────

const SEGURO  = 63.00;  // seguro por parcela
const MESES   = 24;

// ── CENÁRIO A: BALNEÁRIO CAMBORIÚ (Plano Direto BC) ────────
// Fórmula: (Target_BC - Entrada) / meses + 63.00
// Target = valor total a ser recebido pela SCAATO
// Margem ~43.5% sobre o custo (base X12: custo 8990 → target 12900)
const TARGETS_BC = {
  "Urban Plus":  11030,
  "S3 Forever":  12900,
  "X12":         12900,
  "X13":         13620,
  "X21":         13330,
  "X22":         14190,
  "S9 Forever":  15050,
};

function calcParcelaBCSimples(modelo, entrada) {
  const target = TARGETS_BC[modelo] || 0;
  const saldo  = target - (entrada || 0);
  return Math.round((saldo / MESES + SEGURO) * 100) / 100;
}

// ── CENÁRIO B: NACIONAL FIDC (Savegnago/Paulistão) ─────────
// Nível 1 Restrito, entrada zero, parcela fixa
// Fórmula deságio: (Valor - Entrada) / (1 - taxa)^24 / 24 + 63.00
const NIVEIS = {
  3: { nome: "Nome Limpo",     taxa: 0.02 },
  2: { nome: "Score Médio",    taxa: 0.03 },
  1: { nome: "Restrito/Baixo", taxa: 0.05 },
};

function calcParcelaNacional(valorVista, entrada, nivel) {
  const taxa  = NIVEIS[nivel].taxa;
  const saldo = valorVista - (entrada || 0);
  const bruta = saldo / Math.pow(1 - taxa, MESES) / MESES;
  return Math.round((bruta + SEGURO) * 100) / 100;
}

// ── CATÁLOGO ───────────────────────────────────────────────
const CATALOGO = [
  { nome: "Urban Plus",  preco: 7690,  motor: "1000W", bateria: "60V 20.8Ah", tag: "" },
  { nome: "S3 Forever",  preco: 8990,  motor: "1000W", bateria: "60V 23Ah",   tag: "" },
  { nome: "X12",         preco: 8990,  motor: "1000W", bateria: "60V 21Ah",   tag: "" },
  { nome: "X13",         preco: 9490,  motor: "1000W", bateria: "60V 20Ah",   tag: "destaque" },
  { nome: "X21",         preco: 9290,  motor: "3000W", bateria: "60V 21Ah",   tag: "fat tire" },
  { nome: "X22",         preco: 9890,  motor: "3000W", bateria: "60V 21Ah",   tag: "retrô" },
  { nome: "S9 Forever",  preco: 10490, motor: "1500W", bateria: "64V 30Ah",   tag: "maior autonomia" },
];

// ── TABELAS PARA O PROMPT ──────────────────────────────────
function tabelaBC() {
  return CATALOGO.map(m => {
    const p0  = calcParcelaBCSimples(m.nome, 0);
    const p30 = calcParcelaBCSimples(m.nome, TARGETS_BC[m.nome] * 0.30);
    return `• ${m.nome}: sem entrada R$${p0.toFixed(2)}/mês | com 30% entrada R$${p30.toFixed(2)}/mês`;
  }).join("\n");
}

function tabelaNacional() {
  return CATALOGO.map(m => {
    const p3 = calcParcelaNacional(m.preco, 0, 3);
    const p2 = calcParcelaNacional(m.preco, 0, 2);
    const p1 = calcParcelaNacional(m.preco, 0, 1);
    return `• ${m.nome}: Nome Limpo R$${p3.toFixed(2)}/mês | Score Médio R$${p2.toFixed(2)}/mês | Restrito R$${p1.toFixed(2)}/mês`;
  }).join("\n");
}

// ── SYSTEM PROMPT MESTRE ───────────────────────────────────
const SYSTEM_PROMPT = `Você é o SCAR — assistente de inteligência de atendimento da SCAATO MOBILIDADE.
Sua missão: qualificar leads, simular parcelamentos e direcionar o cliente para o franqueado mais próximo.

EMPRESA: SCAATO ASSISTÊNCIA E COMÉRCIO DE VEÍCULOS LTDA | CNPJ: 64.757.314/0001-16
WhatsApp: (47) 99208-3301 | Assistência: (47) 98909-8734 | Email: vendas@scaato.com.br

═══════════════════════════════════════
REGRAS ABSOLUTAS — JAMAIS VIOLAR:
1. NUNCA mencione taxa de juros, % a.m., deságio ou qualquer percentual financeiro ao cliente
2. NUNCA use "aluguel" ou "locação" — use: leasing, plano, contrato, parcela
3. NUNCA revele back-office, fundo FIDC, targets ou margens internas
4. NUNCA mencione Savegnago/Paulistão pelo nome — diga apenas "quiosque SCAATO parceiro"
5. Se perguntarem sobre juros: "Trabalhamos com parcela fixa — sem surpresas no bolso! 😊"
6. Todas as unidades já saem com rastreador instalado e seguro incluso na parcela
═══════════════════════════════════════

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ETAPA 1 — FILTRO GEOGRÁFICO (OBRIGATÓRIO)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Antes de qualquer simulação, SEMPRE peça o CEP do cliente.

📍 CENÁRIO A — BALNEÁRIO CAMBORIÚ (CEPs 88330 a 88339):
→ Use o Plano Direto BC
→ Fórmula: (Target_Modelo - Entrada) ÷ 24 + R$63,00 seguro
→ Vantagem para o cliente: "Contrato direto com a loja, aprovação na hora, sem banco!"

TABELA DE PARCELAS BC (24 meses, seguro incluso):
${tabelaBC()}

📍 CENÁRIO B — DEMAIS REGIÕES (Nacional / Savegnago):
→ Use o Modelo Nacional FIDC
→ Foco: cliente com restrição/score baixo, ENTRADA ZERO
→ Parcela fixa: R$ 738,00/mês (24 meses)
→ Diga ao cliente: "São 24 parcelas de R$ 738,00, já com seguro de R$15.000 e rastreador 24h!"
→ Após aceite: "Identifiquei um quiosque SCAATO parceiro na sua região. Vou enviar seus dados para o nosso consultor local finalizar sua entrega! 🛵"

TABELA NACIONAL (referência interna, não mostrar ao cliente):
${tabelaNacional()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ETAPA 2 — QUALIFICAÇÃO E SIMULAÇÃO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PARA BC (Cenário A):
1. Perguntar qual modelo interessa
2. Perguntar se tem entrada disponível (não obrigatória)
3. Calcular e apresentar a parcela
4. Fechar: "Posso já registrar seu interesse para nossa equipe em BC entrar em contato?"

PARA NACIONAL (Cenário B):
1. Identificar o modelo de interesse
2. Apresentar direto: "São 24x de R$ 738,00 com seguro e rastreador inclusos!"
3. Se reclamar do valor: "Com uma entrada consigo reduzir bastante. Tem algum valor disponível?"
4. Se tiver avalista: "Com alguém de nome limpo como avalista, as parcelas ficam bem menores!"
5. Após aceite: coletar Nome + CEP + Modelo e encaminhar para franqueado

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ETAPA 3 — GARANTIAS E DIFERENCIAIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Sempre reforce ao cliente:
✅ Aprovação imediata — sem burocracia de banco
✅ Contrato de leasing — proteção jurídica para ambos
✅ Rastreador/Telemetria 24h — segurança total
✅ Seguro de R$15.000 incluso na parcela
✅ Parcela fixa — sem reajuste em 24 meses

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CATÁLOGO SCAATO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛵 Urban Plus | 1000W | 60V 20.8Ah | NFC, freio disco, alarme
🛵 S3 Forever | 1000W | 60V 23Ah | autonomia 50km
🛵 X12 | 1000W | 60V 21Ah | Bluetooth, ré
⭐ X13 | 1000W | 60V 20Ah | LED, piloto auto, ré, hidráulico — A MAIS COMPLETA
⚡ X21 | 3000W | 60V 21Ah | Fat Tire — MAIS POTENTE
🏍️ X22 | 3000W | 60V 21Ah | Design retrô
🏆 S9 Forever | 1500W | 64V 30Ah LiFePO4 | 80km — MAIOR AUTONOMIA

TOM: WhatsApp — mensagens curtas, *negrito* para destaque, emojis com moderação, caloroso e direto.`;

// ── CLAUDE ─────────────────────────────────────────────────
async function chamarClaude(historico, mensagem) {
  const messages = [...historico, { role: "user", content: mensagem }];
  const r = await axios.post(
    "https://api.anthropic.com/v1/messages",
    { model: "claude-haiku-4-5-20251001", max_tokens: 600, system: SYSTEM_PROMPT, messages },
    { headers: { "x-api-key": CONFIG.ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" } }
  );
  return r.data.content[0].text;
}

// ── Z-API ──────────────────────────────────────────────────
async function enviarWhatsApp(telefone, mensagem) {
  const url     = `https://api.z-api.io/instances/${CONFIG.ZAPI_INSTANCE}/token/${CONFIG.ZAPI_TOKEN}/send-text`;
  const headers = { "Content-Type": "application/json" };
  if (CONFIG.ZAPI_CLIENT) headers["Client-Token"] = CONFIG.ZAPI_CLIENT;
  console.log(`📤 Enviando para ${telefone}...`);
  const r = await axios.post(url, { phone: telefone, message: mensagem }, { headers });
  console.log(`✅ Enviado: ${JSON.stringify(r.data)}`);
  return r.data;
}

// ── LEADS ──────────────────────────────────────────────────
function detectarLead(telefone, mensagem) {
  const emailRe = mensagem.match(/[\w.-]+@[\w.-]+\.\w+/);
  const nomeRe  = mensagem.match(/(?:me\s+chamo|meu\s+nome\s+[eé]|sou\s+(?:o|a)\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
  const cepRe   = mensagem.match(/\b\d{5}-?\d{3}\b/);
  const ex = leads.find(l => l.telefone === telefone);
  if (ex) {
    if (emailRe) ex.email  = emailRe[0];
    if (nomeRe)  ex.nome   = nomeRe[1];
    if (cepRe)   ex.cep    = cepRe[0];
    ex.updatedAt = new Date().toISOString();
    // Detecta região BC
    if (cepRe) {
      const cepNum = parseInt(cepRe[0].replace("-",""));
      ex.regiao = (cepNum >= 88330000 && cepNum <= 88339999) ? "BC" : "Nacional";
    }
  } else if (emailRe || nomeRe || cepRe) {
    const cepNum = cepRe ? parseInt(cepRe[0].replace("-","")) : 0;
    leads.push({
      telefone,
      email:     emailRe ? emailRe[0] : null,
      nome:      nomeRe  ? nomeRe[1]  : null,
      cep:       cepRe   ? cepRe[0]   : null,
      regiao:    (cepNum >= 88330000 && cepNum <= 88339999) ? "BC" : "Nacional",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      canal:     "whatsapp",
      status:    "novo",
    });
    console.log(`🎯 Novo lead: ${telefone}`);
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
    if (!telefone || !mensagem || !String(telefone).match(/^\d+$/)) {
      console.log("⚠️ Ignorado");
      return res.sendStatus(200);
    }
    console.log(`📱 De ${telefone}: ${mensagem.substring(0, 80)}`);
    if (!conversas.has(telefone)) conversas.set(telefone, []);
    const hist = conversas.get(telefone);
    const resposta = await chamarClaude(hist.slice(-20), mensagem);
    hist.push({ role: "user",      content: mensagem });
    hist.push({ role: "assistant", content: resposta });
    detectarLead(telefone, mensagem);
    await enviarWhatsApp(telefone, resposta);
    console.log(`✅ Resposta enviada para ${telefone}`);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

// ── API ────────────────────────────────────────────────────
app.get("/api/status", (req, res) => res.json({
  status: "🟢 SCAR Online", empresa: "SCAATO MOBILIDADE", versao: "4.0.0",
  conversas_ativas: conversas.size, leads_capturados: leads.length, uptime: process.uptime(),
  config: {
    zapi_instance: CONFIG.ZAPI_INSTANCE ? "✅" : "❌",
    zapi_token:    CONFIG.ZAPI_TOKEN    ? "✅" : "❌",
    zapi_client:   CONFIG.ZAPI_CLIENT   ? "✅" : "❌",
    anthropic:     CONFIG.ANTHROPIC_KEY ? "✅" : "❌",
  },
}));

app.get("/api/leads",     (req, res) => res.json({ total: leads.length, leads: [...leads].sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)) }));

app.get("/api/conversas", (req, res) => {
  const lista = [];
  conversas.forEach((msgs, tel) => lista.push({ telefone: tel, mensagens: msgs.length, ultima: msgs[msgs.length-1]?.content?.substring(0,100)||"" }));
  res.json({ total: lista.length, conversas: lista });
});

app.get("/api/conversa/:tel", (req, res) => {
  const h = conversas.get(req.params.tel);
  if (!h) return res.status(404).json({ erro: "Não encontrada" });
  res.json({ telefone: req.params.tel, mensagens: h });
});

app.delete("/api/conversa/:tel", (req, res) => { conversas.delete(req.params.tel); res.json({ ok: true }); });

app.post("/api/enviar", async (req, res) => {
  const { telefone, mensagem } = req.body;
  if (!telefone || !mensagem) return res.status(400).json({ erro: "telefone e mensagem obrigatórios" });
  try { await enviarWhatsApp(telefone, mensagem); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ erro: e.response?.data || e.message }); }
});

app.get("/api/simular", (req, res) => {
  const { modelo, entrada, regiao, nivel } = req.query;
  const m = CATALOGO.find(c => c.nome.toLowerCase() === (modelo||"").toLowerCase());
  if (!m) return res.status(404).json({ erro: "Modelo não encontrado", modelos: CATALOGO.map(c=>c.nome) });
  const ent = parseFloat(entrada) || 0;
  const nv  = parseInt(nivel) || 3;
  if ((regiao||"").toUpperCase() === "BC") {
    const parcela = calcParcelaBCSimples(m.nome, ent);
    return res.json({ modelo: m.nome, regiao: "BC", target: TARGETS_BC[m.nome], entrada: ent, parcela, meses: MESES, seguro: SEGURO });
  }
  const parcela = calcParcelaNacional(m.preco, ent, nv);
  res.json({ modelo: m.nome, regiao: "Nacional", preco: m.preco, entrada: ent, nivel: nv, perfil: NIVEIS[nv].nome, parcela, meses: MESES, seguro: SEGURO });
});

app.get("/api/catalogo",  (req, res) => res.json(CATALOGO));
app.get("/api/parcelas",  (req, res) => res.json(CATALOGO.map(m => ({
  modelo: m.nome, preco: m.preco, targetBC: TARGETS_BC[m.nome],
  parcelaBC:     calcParcelaBCSimples(m.nome, 0),
  nacional_n3:   calcParcelaNacional(m.preco, 0, 3),
  nacional_n2:   calcParcelaNacional(m.preco, 0, 2),
  nacional_n1:   calcParcelaNacional(m.preco, 0, 1),
  nacional_fixo: 738.00,
}))));

// Legado
app.get("/",           (req, res) => res.redirect("/api/status"));
app.get("/leads",      (req, res) => res.redirect("/api/leads"));
app.get("/conversas",  (req, res) => res.redirect("/api/conversas"));
app.get("/conversa/:t",(req, res) => res.redirect(`/api/conversa/${req.params.t}`));

// ── START ──────────────────────────────────────────────────
app.listen(CONFIG.PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║  🛵 SCAATO SCAR v4.0                ║
║  Status: 🟢 Online                  ║
║  Cenário A: BC (Plano Direto)       ║
║  Cenário B: Nacional (FIDC)         ║
╚══════════════════════════════════════╝`);
  console.log("🔑 Config:");
  console.log("  ZAPI_INSTANCE:", CONFIG.ZAPI_INSTANCE ? "✅" : "❌ FALTANDO");
  console.log("  ZAPI_TOKEN:",    CONFIG.ZAPI_TOKEN    ? "✅" : "❌ FALTANDO");
  console.log("  ZAPI_CLIENT:",   CONFIG.ZAPI_CLIENT   ? `✅ ${CONFIG.ZAPI_CLIENT.substring(0,8)}...` : "❌ FALTANDO");
  console.log("  ANTHROPIC_KEY:", CONFIG.ANTHROPIC_KEY ? "✅" : "❌ FALTANDO");
});
