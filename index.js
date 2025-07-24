const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const cors = require('cors');

// ✅ CHANGED: We now need both libraries
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');

// --- 1. Express App Setup ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: 'https://ephemeral-chat.netlify.app/' // Your Netlify frontend
}));
app.use(express.json()); // Modern replacement for body-parser

// --- 2. WhatsApp & Bot Configuration ---
let sock; // This will be our socket instance
const WHATSAPP_GROUP_ID = process.env.WHATSAPP_GROUP_ID;
const KEYWORDS = ['#Prayer', '#Prayer request', 'error', '#prayer', 'prayer request'];

// --- 3. Baileys Connection Logic ---
async function connectToWhatsApp() {
    const authPath = process.env.AUTH_PATH || 'auth_info_baileys';
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // ✅ CHANGED: This block now generates a URL for the QR code
        if (qr) {
            console.log('QR code received. Generating URL...');
            qrcode.toDataURL(qr, (err, url) => {
                if (err) {
                    console.error('Failed to generate QR code data URL', err);
                } else {
                    console.log('✅ Please open this link in a browser to scan the QR code:');
                    console.log(url); // This will print a long "data:image/png;base64,..." URL
                }
            });
            // This line keeps the QR code in your local terminal for testing
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
            // ✅ FIXED: Removed a typo from this block
        } else if (connection === 'open') {
            console.log('✅ WhatsApp connection opened!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// --- 4. Webhook Endpoint ---
app.post('/incoming', async (req, res) => {
    if (!sock || sock.user === undefined) {
        console.error('WhatsApp is not connected yet.');
        return res.status(503).json({ error: 'WhatsApp client not ready' });
    }

    const { text, user } = req.body;
    if (!text) {
        return res.status(400).json({ error: 'Missing text field' });
    }

    const found = KEYWORDS.find(k => text.toLowerCase().includes(k.toLowerCase()));

    if (!found) {
        return res.status(200).json({ message: 'No keyword match' });
    }

    const alertMsg = `🚨 *${found.toUpperCase()}* detected from ${user}:\n${text}`;

    try {
        await sock.sendMessage(WHATSAPP_GROUP_ID, { text: alertMsg });
        console.log(`Alert sent to group for keyword: ${found}`);
        res.json({ message: 'Alert sent' });
    } catch (err) {
        console.error('WhatsApp send error:', err);
        res.status(500).json({ error: 'Failed to send alert' });
    }
});

// --- 5. Start Everything ---
connectToWhatsApp();
app.listen(PORT, () => console.log(`🚀 Agent listening on http://localhost:${PORT}`));