// ============================================================
// SCAATO SCAR — Servidor WhatsApp via Z-API + Claude AI
// ============================================================
// Deploy: Render.com (gratuito)
// Autor: SCAATO Mobilidade
// ============================================================

const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ─── CONFIGURAÇÕES — preencha antes do deploy ─────────────────
const CONFIG = {
  // 1. Anthropic
  ANTHROPIC_KEY: process.env.ANTHROPIC_API_KEY || "",

  // 2. Z-API
  ZAPI_INSTANCE: process.env.ZAPI_INSTANCE || "3EFD49D1615EC1DB26145A83A6CF71BF",
  ZAPI_TOKEN:    process.env.ZAPI_TOKEN    || "CBB1AF359F0B2FE8B50A816B",
  ZAPI_CLIENT:   process.env.ZAPI_CLIENT   || "", // não obrigatório no Trial

  // 3. Número da SCAATO (com DDI, sem +)
  NUMERO_SCAATO: "5547992083301",

  // 4. Porta
  PORT: process.env.PORT || 3000,
};
// ─────────────────────────────────────────────────────────────

// Histórico de conversas por contato (em memória — use Redis em produção)
const conversas = new Map();

// Leads capturados
const leads = [];

// ─── SYSTEM PROMPT SCAR ───────────────────────────────────────
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
- Cessão de recebíveis para FIDC parceiro

LÓGICA DE JUROS:
- Nome LIMPO + entrada ≥ 30% do veículo: 5,5% a.m.
- Nome LIMPO + entrada 20–29%: 7,5% a.m.
- Nome LIMPO + entrada < 20%: 9,9% a.m.
- Negativado + entrada ≥ 30%: 9,9% a.m.
- Negativado + entrada 20–29%: 11,5% a.m.
- Negativado + entrada < 20%: 13,0% a.m.

CATÁLOGO (prazo 24 meses):
1. Urban Plus — R$7.690 | 1000W | 60V 20.8Ah | NFC, 2 faróis, freio disco, alarme
   Entrada R$2.000 + nome limpo (7,5%): R$588/mês | Negativado (11,5%): R$776/mês

2. S3 Forever — R$8.990 | 1000W | 60V 23Ah | autonomia 50km | NFC, freio disco D+T
   Entrada R$2.000 + nome limpo (7,5%): R$706/mês | Negativado (11,5%): R$937/mês

3. X12 — R$8.990 | 1000W | 60V 21Ah | NFC, Bluetooth, ré, freio disco D+T
   Entrada R$2.000 + nome limpo (7,5%): R$706/mês | Negativado (11,5%): R$937/mês

4. X13 — R$9.490 | 1000W | 60V 20Ah | LED completo, piloto auto, ré, Bluetooth, freio hidráulico D+T, chave presença — A MAIS COMPLETA
   Entrada R$2.000 + nome limpo (7,5%): R$752/mês | Negativado (11,5%): R$999/mês

5. X21 — R$9.290 | 3000W | 60V 21Ah | NFC, Bluetooth, freio disco D+T | Fat Tire
   Entrada R$2.000 + nome limpo (7,5%): R$734/mês | Negativado (11,5%): R$975/mês

6. X22 — R$9.890 | 3000W | 60V 21Ah | NFC, Bluetooth, freio disco D+T | Design retrô
   Entrada R$2.000 + nome limpo (7,5%): R$788/mês | Negativado (11,5%): R$1.049/mês

7. S9 Forever — R$10.490 | 1500W | 64V 30Ah LiFePO4 | autonomia 80km | LCD, NFC — MAIOR AUTONOMIA
   Entrada R$2.000 + nome limpo (7,5%): R$1.008/mês | Negativado (11,5%): R$1.235/mês

URBAN 100 (sem entrada):
- Grupos de 100 participantes | 24 meses
- Pré-contemplação: R$467/mês | Pós-contemplação: R$567/mês
- Entregas a partir do 3º mês por ordem de ingresso

FLUXO DE QUALIFICAÇÃO (colete progressivamente):
1. Nome do cliente
2. Situação do nome (limpo ou negativado)
3. Valor disponível para entrada
4. Modelo de interesse ou uso pretendido
5. Cidade/Estado

COMPORTAMENTO NO WHATSAPP:
- Mensagens curtas e diretas — máx 200 palavras
- Use *negrito* com asteriscos (formato WhatsApp)
- Use emojis com moderação
- Sempre pergunte: nome limpo ou negativado? + valor de entrada disponível
- Com essas infos, apresente simulação personalizada
- CTA final: sempre direcione para simulador ou para fechar via WhatsApp
- Se cliente der nome + email: registre como lead qualificado
- Encaminhe para equipe humana se: reclamação grave, proposta acima de 3 unidades, solicitação de contrato`;

// ─── FUNÇÃO: Chamar Claude ────────────────────────────────────
async function chamarClaude(historico, mensagemAtual) {
  const messages = [
    ...historico,
    { role: "user", content: mensagemAtual },
  ];

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

// ─── FUNÇÃO: Enviar mensagem WhatsApp via Z-API ───────────────
async function enviarWhatsApp(telefone, mensagem) {
  const url = `https://api.z-api.io/instances/${CONFIG.ZAPI_INSTANCE}/token/${CONFIG.ZAPI_TOKEN}/send-text`;
  const headers = { "Content-Type": "application/json" };
  if (CONFIG.ZAPI_CLIENT) headers["Client-Token"] = CONFIG.ZAPI_CLIENT;
  await axios.post(url, { phone: telefone, message: mensagem }, { headers });
}
// ─── FUNÇÃO: Detectar e salvar lead ──────────────────────────
function detectarLead(telefone, mensagem, resposta) {
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
      console.log(`🎯 Novo lead capturado: ${telefone}`);
    }
  }
}

// ─── WEBHOOK — recebe mensagens do Z-API ─────────────────────
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // Ignora mensagens enviadas pela própria conta
    if (body.fromMe) return res.sendStatus(200);

    // Ignora mensagens de grupo
    if (body.isGroup) return res.sendStatus(200);

    // Extrai dados da mensagem
    const telefone = body.phone || body.from;
    const mensagem = body.text?.message || body.body || "";

    if (!telefone || !mensagem) return res.sendStatus(200);

    console.log(`📱 Mensagem recebida de ${telefone}: ${mensagem.substring(0, 50)}...`);

    // Recupera ou inicia histórico da conversa
    if (!conversas.has(telefone)) {
      conversas.set(telefone, []);
    }
    const historico = conversas.get(telefone);

    // Limita histórico a 20 mensagens (10 trocas) para economizar tokens
    const historicoLimitado = historico.slice(-20);

    // Chama a SCAR (Claude)
    const resposta = await chamarClaude(historicoLimitado, mensagem);

    // Atualiza histórico
    historico.push({ role: "user", content: mensagem });
    historico.push({ role: "assistant", content: resposta });

    // Detecta leads
    detectarLead(telefone, mensagem, resposta);

    // Envia resposta via WhatsApp
    await enviarWhatsApp(telefone, resposta);

    console.log(`✅ Resposta enviada para ${telefone}`);
    res.sendStatus(200);

  } catch (error) {
    console.error("❌ Erro no webhook:", error.message);
    res.sendStatus(500);
  }
});

// ─── ROTAS DE ADMINISTRAÇÃO ───────────────────────────────────

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "🟢 SCAR Online",
    empresa: "SCAATO MOBILIDADE",
    versao: "1.0.0",
    conversas_ativas: conversas.size,
    leads_capturados: leads.length,
    uptime: process.uptime(),
  });
});

// Lista leads
app.get("/leads", (req, res) => {
  res.json({
    total: leads.length,
    leads: leads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  });
});

// Lista conversas ativas
app.get("/conversas", (req, res) => {
  const lista = [];
  conversas.forEach((msgs, telefone) => {
    lista.push({
      telefone,
      mensagens: msgs.length,
      ultima: msgs[msgs.length - 1]?.content?.substring(0, 80) || "",
    });
  });
  res.json({ total: lista.length, conversas: lista });
});

// Histórico de um contato
app.get("/conversa/:telefone", (req, res) => {
  const hist = conversas.get(req.params.telefone);
  if (!hist) return res.status(404).json({ erro: "Conversa não encontrada" });
  res.json({ telefone: req.params.telefone, mensagens: hist });
});

// Limpar histórico de um contato (reinicia conversa)
app.delete("/conversa/:telefone", (req, res) => {
  conversas.delete(req.params.telefone);
  res.json({ ok: true, mensagem: "Histórico limpo" });
});

// Enviar mensagem manual (equipe de vendas)
app.post("/enviar", async (req, res) => {
  const { telefone, mensagem } = req.body;
  if (!telefone || !mensagem) {
    return res.status(400).json({ erro: "telefone e mensagem são obrigatórios" });
  }
  try {
    await enviarWhatsApp(telefone, mensagem);
    res.json({ ok: true, mensagem: "Enviado com sucesso" });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ─── START ────────────────────────────────────────────────────
app.listen(CONFIG.PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║   🛵 SCAATO SCAR — WhatsApp Bot      ║
║   Status: 🟢 Online                  ║
║   Porta: ${CONFIG.PORT}                       ║
║   Webhook: /webhook                  ║
║   Leads: /leads                      ║
╚══════════════════════════════════════╝
  `);
});
