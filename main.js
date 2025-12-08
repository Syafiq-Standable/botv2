const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        version: [2, 3000, 1027934701] // versi stabil biar gak error aneh
    });

    // Helper: set group announcement mode with fallbacks for different Baileys versions
    const setGroupAnnouncement = async (jid, announce) => {
        const mode = announce ? 'announcement' : 'not_announcement';
        if (typeof sock.groupSettingChange === 'function') {
            return sock.groupSettingChange(jid, mode);
        }
        if (typeof sock.groupSettingUpdate === 'function') {
            return sock.groupSettingUpdate(jid, mode);
        }
        if (typeof sock.groupUpdate === 'function') {
            // best-effort fallback; some implementations accept an object
            try {
                return sock.groupUpdate(jid, { announce });
            } catch (e) {
                // fallthrough to error below
            }
        }
        throw new Error('group setting change not supported by this Baileys version');
    };

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('SAM BOT NYALA GACOR BANGET BROOO 🔥🔥🔥');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.key.fromMe && m.type === 'notify') {
                const from = msg.key.remoteJid;
                const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '').trim();

                // MENU
                if (text.toLowerCase() === '.menu') {
                    await sock.sendMessage(from, { text: `*𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ* 🔥\n\n✦ .menu / .help → tampilkan menu ini\n✦ .tagall → tag semua member\n✦ .hidetag [pesan] → tag tersembunyi\n✦ .tt [link] → download TikTok\n✦ .stiker / reply .stiker → membuat stiker dari foto\n✦ .ping → memastikan bot tetap aktif dan mengecek jumlah delay\n\nowner: wa.me/628952890624` });
                    return;
                }
                    // MENU (alias .help)
                    if (text.toLowerCase() === '.menu' || text.toLowerCase() === '.help') {
                        await sock.sendMessage(from, { text: `*𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ* 🔥\n\n✦ .menu / .help → tampilkan menu ini\n✦ .tagall → tag semua member\n✦ .hidetag [pesan] → tag tersembunyi\n✦ .tt [link] → download TikTok\n✦ .stiker / reply .stiker → membuat stiker dari foto\n✦ .ping → memastikan bot tetap aktif dan mengecek jumlah delay\n\nowner: wa.me/628952890624` });
                        return;
                    }

                    // PING — cek apakah bot aktif dan tampilkan latency
                    if (text.toLowerCase() === '.ping') {
                        const msgTs = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();
                        const tick = Date.now() - msgTs;
                        await sock.sendMessage(from, { text: `haloo, bot aktif dengan "${tick}"ms` });
                        return;
                    }

                    // GROUP CONTROL — buka / tutup grup (hanya admin)
                    if (text.toLowerCase() === '.closegroup' || text.toLowerCase() === '.opengroup') {
                        if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                        const group = await sock.groupMetadata(from);
                        const sender = msg.key.participant || msg.key.remoteJid;
                        const isSenderAdmin = group.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin));
                        if (!isSenderAdmin) return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa menggunakan perintah ini.' });

                        try {
                            if (text.toLowerCase() === '.closegroup') {
                                // announcement => only admins can send messages
                                await setGroupAnnouncement(from, true);
                                await sock.sendMessage(from, { text: 'Sukses! Grup ditutup — hanya admin yang bisa mengirim pesan sekarang.' });
                            } else {
                                // not_announcement => all participants can send messages
                                await setGroupAnnouncement(from, false);
                                await sock.sendMessage(from, { text: 'Sukses! Grup dibuka — semua anggota bisa mengirim pesan sekarang.' });
                            }
                        } catch (err) {
                            console.log('Group control error:', err.message);
                            await sock.sendMessage(from, { text: `Gagal mengubah setelan grup: ${err.message}` });
                        }
                        return;
                    }

                    // PROMOTE / DEMOTE — jadikan atau cabut admin (via mention atau reply)
                    if (text.toLowerCase().startsWith('.promote') || text.toLowerCase().startsWith('.demote')) {
                        if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                        const group = await sock.groupMetadata(from);
                        const sender = msg.key.participant || msg.key.remoteJid;
                        const isSenderAdmin = group.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin));
                        if (!isSenderAdmin) return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa menggunakan perintah ini.' });

                        // Dapatkan target: mention atau reply
                        let targets = [];
                        const ext = msg.message?.extendedTextMessage;
                        if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                            targets = ext.contextInfo.mentionedJid;
                        } else if (ext?.contextInfo?.participant) {
                            targets = [ext.contextInfo.participant];
                        }

                        if (!targets.length) {
                            return sock.sendMessage(from, { text: 'Tandai (mention) atau reply ke pengguna yang ingin di-promote/demote.\nContoh: .promote @user' });
                        }

                        try {
                            const action = text.toLowerCase().startsWith('.promote') ? 'promote' : 'demote';
                            await sock.groupParticipantsUpdate(from, targets, action);
                            const mentionText = targets.map(jid => `@${jid.split('@')[0]}`).join(', ');
                            await sock.sendMessage(from, { text: `Sukses melakukan ${action} untuk ${mentionText}`, mentions: targets });
                        } catch (err) {
                            console.log('Promote/Demote error:', err.message);
                            await sock.sendMessage(from, { text: `Gagal mengubah status admin: ${err.message}` });
                        }
                        return;
                    }

                // TAGALL — BENERAN TAG SEMUA MEMBER (bukan cuma @everyone)
                if (text.toLowerCase() === '.tagall') {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Di grup aja yaaa' });
                    const group = await sock.groupMetadata(from);
                    let teks = '┌──「 TAG ALL 」\n';
                    for (let mem of group.participants) {
                        teks += `├ @${mem.id.split('@')[0]}\n`;
                    }
                    teks += `└────`;
                    await sock.sendMessage(from, { text: teks, mentions: group.participants.map(a => a.id) });
                    return;
                }

                // HIDETAG — TAG SEMUA TAPI DISEMBUNYIKAN, GANTI PESAN
                if (text.toLowerCase().startsWith('.hidetag ')) {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'bisa dipake nyaa cuma di group' });
                    const pesan = text.slice(10);
                    const group = await sock.groupMetadata(from);
                    await sock.sendMessage(from, { text: pesan ? pesan : '‎', mentions: group.participants.map(a => a.id) });
                    return;
                }

                // Fungsi SSSTik Downloader (Free, No Key)
const getSsStikUrl = async (url) => {
    try {
        // Step 1: GET homepage buat ambil token 'tt'
        const homeRes = await axios.get('https://ssstik.io/en');
        const ttToken = homeRes.data.match(/tt:\'([\w\d]+)\'/)[1];  // Extract token

        // Step 2: POST ke endpoint
        const postRes = await axios.post('https://ssstik.io/abc?url=dl', {
            id: url,
            locale: 'en',
            tt: ttToken
        }, {
            headers: {
                'hx-current-url': 'https://ssstik.io/en',
                'hx-request': 'true',
                'hx-target': 'target',
                'hx-trigger': '_gcaptcha_pt',
                'origin': 'https://ssstik.io',
                'pragma': 'no-cache',
                'referer': 'https://ssstik.io/en',
                'content-type': 'application/x-www-form-urlencoded'
            }
        });

        // Parse HTML response buat dapet video URL (no WM)
        const videoMatch = postRes.data.match(/hdsrc="([^"]+)"/);
        return videoMatch ? videoMatch[1] : null;
    } catch (err) {
        throw new Error('SSSTik error: ' + err.message);
    }
};

// Di event messages.upsert, ganti handler TikTok jadi ini:
if (text.toLowerCase().startsWith('.tt ') || text.toLowerCase().startsWith('.tiktok ')) {
    const url = text.split(' ').slice(1).join(' ');
    if (!url.includes('tiktok')) return sock.sendMessage(from, { text: 'link TikTok manaaaa? gini nih contohnya: .tt https://vt.tiktok.com/abc' });

    await sock.sendMessage(from, { text: 'Sabar yaaa, lagi diprosess... ⏳' });
    try {
        const res = await axios.get(`https://tikwm.com/api/?url=${url}`);
        if (res.data.code !== 0) throw new Error('API error: ' + res.data.msg);
        
        const videoUrl = res.data.data.play;  // URL video no watermark HD
        const title = res.data.data.title || 'TikTok Video Gacor';
        const author = res.data.data.author.unique_id || 'unknown';

        await sock.sendMessage(from, { 
            video: { url: videoUrl }, 
            caption: `*𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ* ✅\n\n👤 Akun: @${author}\n📝 ${title}\n\donee, VT HD siap jadi SW — No Watermark! 🔥\nOriginal: ${url}` 
        });
    } catch (err) {
        console.log('TikWM Error:', err.message);  // Buat debug di terminal
        await sock.sendMessage(from, { text: `yaahhh gagalll😭\nError: ${err.message}\ncoba link lain atau tunggu bentar.` });
    }
    return;
}

                // STIKER — 100% JADI & GAK "Cannot view sticker information" LAGI
                if (text.toLowerCase().includes('.stiker') || text.toLowerCase().includes('.sticker') || text.toLowerCase().includes('.s')) {
                    let imgMsg = null;

                    // Cara 1: Kirim gambar + caption !stiker langsung
                    if (msg.message?.imageMessage && (msg.message.imageMessage.caption || '').toLowerCase().includes('.stiker')) {
                        imgMsg = msg.message.imageMessage;
                    }
                    // Cara 2: Reply gambar + !stiker
                    else if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                        imgMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    }

                    if (!imgMsg) {
                        return sock.sendMessage(from, { text: 'Cara pakai:\n• Kirim foto + caption *.stiker*\n• Atau reply foto + ketik *.stiker*\n\nSupport JPG/PNG/GIF kecil!' });
                    }

                    await sock.sendMessage(from, { text: 'Sabar yaaa, lagi ku buat stikernyaaa... 🔥' });

                    try {
                        // Download buffer gambar
                        const stream = await downloadContentFromMessage(imgMsg, 'image');
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) {
                            buffer = Buffer.concat([buffer, chunk]);
                        }

                        // Convert ke WebP stiker pake Sharp (resize 512x512, quality 80)
                        const sharp = require('sharp');
                        const stickerBuffer = await sharp(buffer)
                            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                            .webp({ quality: 80 })
                            .toBuffer();

                        // Kirim stiker final
                        await sock.sendMessage(from, {
                            sticker: stickerBuffer
                        }, {
                            packname: "𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ",
                            author: "Owner Ganteng",
                            categories: ['👍', '❤️']
                        });

                    } catch (err) {
                        console.log('Stiker Sharp error:', err.message);
                        await sock.sendMessage(from, { text: 'Yahhhh gagall, fotonya terlalu HD kayanya deh 😭\nCoba foto yang lebih kecil (max 1MB) atau format JPG/PNG.' });
                    }
                    return;
                }
            }
        } catch (err) {
            console.log('Error tapi bot tetep hidup:', err.message);
        }
    });
}

connectToWhatsApp();