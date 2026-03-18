// ============================================================
//  BOLETIM TCE-RO — Bot Semanal de Notícias
//  Toda segunda-feira às 07:00 (Porto Velho)
//  Atualiza o site automaticamente — sem WhatsApp
// ============================================================
require('dotenv').config();
const schedule  = require('node-schedule');
const Anthropic = require('@anthropic-ai/sdk');
const express   = require('express');
const fs        = require('fs');
const path      = require('path');

const DATA_FILE    = path.join(__dirname, 'public', 'noticias.json');
const HISTORY_FILE = path.join(__dirname, 'historico.json');
const PORT         = process.env.PORT || 3000;
const SITE_URL     = process.env.SITE_URL || `http://localhost:${PORT}`;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Persistência ──────────────────────────────────────────────
function loadHistory() {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return []; }
}
function saveHistory(h) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2)); }
function loadNoticias() {
    if (!fs.existsSync(DATA_FILE)) return { gerado_em: null, edicao: 0, noticias: [] };
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return { gerado_em: null, edicao: 0, noticias: [] }; }
}
function saveNoticias(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

// ── Pesquisa com Claude AI ─────────────────────────────────────
async function pesquisarNoticias() {
    console.log('\n🔍 Iniciando pesquisa semanal com IA...\n');
    const historico = loadHistory();
    const titulosAnteriores = historico.slice(-60).join(' | ');

    const prompt = `Você é um especialista em controle externo, licitações e gestão pública de Rondônia.

Faça uma pesquisa aprofundada e ATUAL (últimos 7 dias) sobre:
1. TCE-RO: julgamentos, acórdãos, decisões, notificações, multas aplicadas, aprovação/rejeição de contas
2. Licitações públicas: pregões eletrônicos, concorrências, dispensas, inexigibilidades
3. Obras públicas: contratos firmados, aditivos, paralisações, fiscalizações, entrega de obras
4. Fiscalizações e auditorias: relatórios TCE-RO, CGE-RO, CGU, TCU em Rondônia
5. Novos decretos estaduais (governo RO) e municipais (Porto Velho)
6. Irregularidades: denúncias, improbidade, punições por órgãos de controle

FONTES: tce.ro.gov.br | diof.ro.gov.br | portaltransparencia.ro.gov.br | portovelho.ro.gov.br | g1.globo.com/ro | rondoniaovivo.com | hojerondonianoticia.com.br | rondoniadinamica.com

REGRAS:
- Apenas fatos dos ÚLTIMOS 7 DIAS
- NÃO repita: ${titulosAnteriores || 'nenhum ainda'}
- Inclua valores, nomes, números de processo
- Mínimo 6, máximo 10 notícias
- Pelo menos 2 com destaque: true

Retorne APENAS JSON válido:
{
  "noticias": [
    { "titulo": "...", "categoria": "TCE-RO", "resumo": "3-5 frases com fatos concretos.", "fonte_nome": "...", "fonte_url": "https://...", "data_noticia": "DD/MM/AAAA", "destaque": true }
  ],
  "sumario_executivo": "4-6 frases resumindo a semana.",
  "total_encontradas": 7
}
Categorias válidas: TCE-RO | Licitações | Obras Públicas | Fiscalização | Auditoria | Decretos`;

    try {
        const response = await anthropic.messages.create({
            model: 'claude-opus-4-5',
            max_tokens: 4000,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            messages: [{ role: 'user', content: prompt }]
        });
        const textos = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
        const jsonMatch = textos.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('JSON não encontrado');
        const resultado = JSON.parse(jsonMatch[0]);
        saveHistory([...historico, ...resultado.noticias.map(n => n.titulo)].slice(-200));
        console.log(`✅ ${resultado.noticias.length} notícias encontradas.`);
        return resultado;
    } catch (err) {
        console.error('❌ Erro na pesquisa:', err.message);
        return null;
    }
}

// ── Atualiza o site ───────────────────────────────────────────
function atualizarSite(resultado) {
    const anterior = loadNoticias();
    const edicao = (anterior.edicao || 0) + 1;
    saveNoticias({
        gerado_em: new Date().toISOString(),
        edicao,
        sumario: resultado.sumario_executivo,
        noticias: resultado.noticias,
        total: resultado.total_encontradas
    });
    console.log(`📰 Site atualizado — Edição #${edicao}`);
    return edicao;
}

// ── Pipeline principal ────────────────────────────────────────
async function executarBoletimSemanal() {
    console.log('\n🚀 ===== BOLETIM SEMANAL INICIADO =====\n');
    const resultado = await pesquisarNoticias();
    if (!resultado?.noticias?.length) { console.error('❌ Sem notícias. Abortando.'); return; }
    const edicao = atualizarSite(resultado);
    console.log(`\n✅ ===== BOLETIM #${edicao} PUBLICADO =====\n`);
}

// ── Agendamento: toda segunda-feira às 07:00 (Porto Velho) ────
schedule.scheduleJob({ rule: '0 7 * * 1', tz: 'America/Porto_Velho' }, executarBoletimSemanal);
console.log('📅 Agendado: toda segunda-feira às 07:00 (Porto Velho)');

// ── Servidor Express ──────────────────────────────────────────
const app = express();
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-token');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/noticias', (req, res) => res.json(loadNoticias()));

app.get('/api/status', (req, res) => {
    const n = loadNoticias();
    res.json({ status: 'ok', edicao: n.edicao, gerado_em: n.gerado_em, site: SITE_URL });
});

// Disparo manual protegido por token
app.post('/api/executar', async (req, res) => {
    if (req.headers['x-token'] !== process.env.ADMIN_TOKEN)
        return res.status(403).json({ error: 'Token inválido.' });
    res.json({ ok: true, message: 'Boletim iniciado.' });
    executarBoletimSemanal();
});

app.get('/api/embed-snippet', (req, res) => {
    res.type('text').send(`<iframe src="${SITE_URL}/widget.html" width="100%" height="900" frameborder="0" style="border-radius:12px;border:none;" title="Boletim TCE-RO"></iframe>`);
});

app.listen(PORT, () => console.log(`\n🌐 Servidor rodando na porta ${PORT} — ${SITE_URL}\n`));
