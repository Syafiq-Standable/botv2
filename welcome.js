// welcome.js — Welcome otomatis + .setwelcome
const fs = require('fs');
const path = require('path');

const WELCOME_DB = path.join(__dirname, 'data', 'welcome.json');

const loadWelcomes = () => {
    try {
        if (!fs.existsSync(WELCOME_DB)) return {};
        return JSON.parse(fs.readFileSync(WELCOME_DB, 'utf8'));
    } catch (e) {
        return {};
    }
};

const saveWelcomes = (data) => {
    fs.writeFileSync(WELCOME_DB, JSON.stringify(data, null, 2));
};

module.exports = (sock) => {
    // Command .setwelcome
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        if (!msg.message.conversation && !msg.message.extendedTextMessage?.text) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage.text || '').trim();
        const from = msg.key.remoteJid;

        if (text.toLowerCase().startsWith('.setwelcome ') && from.endsWith('@g.us')) {
            const group = await sock.groupMetadata(from);
            const sender = msg.key.participant;
            const isAdmin = group.participants.find(p => p.id === sender)?.admin;
            if (!isAdmin) return;

            const newMsg = text.slice(12).trim();
            if (!newMsg) return sock.sendMessage(from, { text: 'Cara: .setwelcome [pesan]\nGunakan $nama, $nomor, $grup' });

            const welcomes = loadWelcomes();
            welcomes[from] = newMsg;
            saveWelcomes(welcomes);

            await sock.sendMessage(from, { text: `Welcome message diupdate!\n\nPreview:\n${newMsg.replace('$nama', 'NamaUser').replace('$nomor', '628xxx').replace('$grup', group.subject)}` });
        }
    });

    // Auto welcome pas join
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        if (action !== 'add') return;

        const welcomes = loadWelcomes();
        const defaultCaption = `SELAMAT DATANG $nama DI GRUP $grup!\nNomor: $nomor\n\nSemoga betah ya kak! 😎🔥`;

        const captionTemplate = welcomes[id] || defaultCaption;

        for (const user of participants) {
            try {
                const meta = await sock.groupMetadata(id);
                const pp = await sock.profilePictureUrl(user, 'image').catch(() => 'https://i.ibb.co/3mZmy8Z/default-pp.jpg');

                let caption = captionTemplate
                    .replace(/\$nama/g, (await sock.getName(user)) || 'User')
                    .replace(/\$nomor/g, user.split('@')[0])
                    .replace(/\$grup/g, meta.subject);

                await sock.sendMessage(id, {
                    image: { url: pp },
                    caption: caption
                });
            } catch (e) {
                console.log('Welcome error:', e.message);
            }
        }
    });

    console.log('Fitur welcome + .setwelcome aktif!');
};