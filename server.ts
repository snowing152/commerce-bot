import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execFile, ChildProcess } from 'child_process';
import * as http from 'http';

const app = express();
const PORT = 3000;
const CDP_PORT = 9222;

app.use(express.json());
app.use(express.static(__dirname));

let botProcess: ChildProcess | null = null;
let chromeProcess: ChildProcess | null = null;
let sseClients: express.Response[] = [];

function broadcast(type: string, data: string) {
    const msg = `data: ${JSON.stringify({ type, data })}\n\n`;
    sseClients.forEach(c => { try { c.write(msg); } catch (_) {} });
}

function findChromePath(): string {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
        `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Google\\Chrome SxS\\Application\\chrome.exe`,
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    return candidates.find(p => fs.existsSync(p)) || '';
}

function isCDPReady(): Promise<boolean> {
    return new Promise(resolve => {
        const req = http.get(`http://127.0.0.1:${CDP_PORT}/json/version`, res => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
}

// ── API ──────────────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
    try {
        const cfg = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8');
        res.json(JSON.parse(cfg));
    } catch {
        res.json({ settings: { base_url: 'https://www.coupang.com', max_pages_to_search: 3 }, tasks: [] });
    }
});

app.post('/api/config', (req, res) => {
    try {
        fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(req.body, null, 2), 'utf-8');
        res.json({ ok: true });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/status', async (req, res) => {
    res.json({
        botRunning: botProcess !== null,
        cdpReady: await isCDPReady(),
        chromeRunning: chromeProcess !== null
    });
});

// Запускаем Chrome с CDP из сервера — самый надёжный способ
app.post('/api/open-chrome', async (req, res) => {
    const chromePath = process.env.CHROME_PATH || findChromePath();
    if (!chromePath) {
        return res.status(500).json({ ok: false, error: 'Chrome не найден на этом компьютере' });
    }

    // Если CDP уже работает — просто сообщаем
    if (await isCDPReady()) {
        return res.json({ ok: true, message: 'Chrome уже запущен с отладкой' });
    }

    // Отдельный профиль чтобы не конфликтовать с открытым Chrome
    const profileDir = path.join(__dirname, 'chrome_debug_profile');
    if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

    const args = [
        `--remote-debugging-port=${CDP_PORT}`,
        `--remote-debugging-address=127.0.0.1`,
        `--user-data-dir=${profileDir}`,
        '--incognito',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--lang=ko-KR',
        '--new-window',
        'https://www.coupang.com',
    ];

    try {
        chromeProcess = execFile(chromePath, args, { windowsHide: false });
        chromeProcess.on('close', () => { chromeProcess = null; });
        chromeProcess.on('error', (e) => { console.error('Chrome error:', e.message); chromeProcess = null; });

        // Ждём пока CDP поднимется (до 15 сек)
        const start = Date.now();
        while (Date.now() - start < 15000) {
            await new Promise(r => setTimeout(r, 600));
            if (await isCDPReady()) {
                return res.json({ ok: true, message: 'Chrome запущен!' });
            }
        }
        return res.status(500).json({ ok: false, error: 'Chrome запустился но CDP не отвечает. Попробуй ещё раз.' });
    } catch (e: any) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Закрываем Chrome
app.post('/api/close-chrome', (req, res) => {
    if (chromeProcess) {
        chromeProcess.kill();
        chromeProcess = null;
    }
    res.json({ ok: true });
});

app.post('/api/start', (req, res) => {
    if (botProcess) return res.status(400).json({ ok: false, error: 'Бот уже запущен' });

    broadcast('status', 'running');
    broadcast('log', '🚀 Запускаю бота...');

    botProcess = spawn('npx', ['ts-node', path.join(__dirname, 'index.ts')], {
        cwd: __dirname,
        shell: true,
        env: { ...process.env }
    });

    botProcess.stdout?.on('data', (data: Buffer) => {
        data.toString().split('\n').filter(l => l.trim()).forEach(line => broadcast('log', line));
    });

    botProcess.stderr?.on('data', (data: Buffer) => {
        data.toString().split('\n').filter(l => l.trim()).forEach(line => broadcast('log', '⚠ ' + line));
    });

    botProcess.on('close', (code) => {
        broadcast('log', `\n— Бот завершил работу (код: ${code}) —`);
        broadcast('status', 'idle');
        botProcess = null;
        try {
            const dir = path.join(__dirname, 'screenshots');
            const files = fs.readdirSync(dir).filter(f => f.includes('final_cart')).sort().reverse();
            if (files.length > 0) broadcast('screenshot', files[0]);
        } catch (_) {}
    });

    res.json({ ok: true });
});

app.post('/api/stop', (req, res) => {
    if (botProcess) { botProcess.kill('SIGTERM'); botProcess = null; }
    broadcast('log', '🛑 Бот остановлен.');
    broadcast('status', 'idle');
    res.json({ ok: true });
});

app.get('/api/screenshots', (req, res) => {
    try {
        const dir = path.join(__dirname, 'screenshots');
        if (!fs.existsSync(dir)) return res.json([]);
        res.json(fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort().reverse().slice(0, 20));
    } catch { res.json([]); }
});

app.get('/api/screenshots/:file', (req, res) => {
    const p = path.join(__dirname, 'screenshots', req.params.file);
    fs.existsSync(p) ? res.sendFile(p) : res.status(404).send('Not found');
});

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseClients.push(res);
    res.write(`data: ${JSON.stringify({ type: 'status', data: botProcess ? 'running' : 'idle' })}\n\n`);
    req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
});

app.listen(PORT, () => {
    console.log(`\n✅ Coupang Bot GUI запущен!`);
    console.log(`🌐 http://localhost:${PORT}/gui.html\n`);
    const { exec } = require('child_process');
    setTimeout(() => exec(`start http://localhost:${PORT}/gui.html`), 800);
});