const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const bakulan = require('./bakulan');
const promo = require('./promo');
const welcome = require('./welcome');
const cron = require('node-cron');
const instagramDownloader = require('./instagram-downloader');


async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        version: [2, 3000, 1027934701] // versi stabil biar gak error aneh
    });

    // ====================== PROMO HARIAN + .topup (SATU TEMPAT) ======================
    const PROMO_TARGET = '6289528950624@s.whatsapp.net'; // ganti kalau mau ke grup
    const FOLDER = path.join(__dirname, 'data');

    const promos = [
        {
            time: '30 8 * * *', photo: 'promo_3d.jpg', caption: `🔥 *JASA 3D FREE FIRE MURAH!*\n` +
                `• 3D Solo       : 50rb\n` +
                `• 3D Couple     : 70rb\n` +
                `• 3D Squad     : 100rb-150rb\n\n` +
                `Hasil Super HD! + Anti Pasaran!! \n` +
                `Minat? Chat sekarang:\nwa.me/6289528950624\n\n` +
                `#3DFreeFire #3DFF #Jasa3D`
        },
        {
            time: '30 8 * * *', photo: 'promo_topup.jpg', caption:
                `𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ
💎 TOPUP GAME MURAHHH!

🔥 Free Fire
70 Diamond              : Rp7.951
140 Diamond             : Rp15.502
🪪 Weekly Membership    : Rp26.127

⚡ Mobile Legends
3 Diamond               : Rp1.217
1050 Diamond            : Rp262.196
🪪 Weekly Pass          : Rp26.985

🎮 Game Lainnya
Roblox 1500 Robux       : Rp215.438
PUBG 120 UC             : Rp29.917
Genshin 60 Crystals     : Rp12.211

Keterangan lebih lanjut langsung chat:
wa.me/6289528950624
#TopUpMurah #SamSukabyone #DiamondMurah` },
        {
            time: '30 8 * * *', photo: 'promo_sewa.jpg', caption: `🤖 *SEWA BOT WHATSAPP PREMIUM CUMA 10K/BULAN!*\n` +
                `Fitur gacor:\n` +
                `• Tagall / Hidetag\n` +
                `• Downloader (TT, IG, YT)\n` +
                `• Stiker otomatis\n` +
                `• Anti link + kick otomatis\n` +
                `• Play lagu, open/close grup, dll\n` +
                `Bot on 24 jam • Gacor • Zero DC\n` +
                `Langsung sewa:\nwa.me/6289528950624\n` +
                `#SewaBot #BotWA #BotPremium`
        },
        {
            time: '15 19 * * *', photo: 'promo_3d.jpg', caption: `🌙 *MALAM GACOR — PROMO 3D SPESIAL!*\n` +
                `Order 3D malam ini diskon 20rb untuk semua tipe!\n` +
                `Dikerjakan langsung! Garansi 1 Jam Selesai!\n` +
                `Langsung chat sebelum kehabisan slot:\nwa.me/6289528950624\n\n` +
                `#3DMalam #PromoMalam`
        }
    ];

    promos.forEach(p => {
        cron.schedule(p.time, async () => {
            const photoPath = path.join(FOLDER, p.photo);
            if (fs.existsSync(photoPath)) {
                await sock.sendMessage(PROMO_TARGET, { image: fs.readFileSync(photoPath), caption: p.caption });
            }
        }, { timezone: 'Asia/Jakarta' });
    });

    // ====================== WELCOME + .setwelcome ======================
    const WELCOME_DB = path.join(__dirname, 'data', 'welcome.json');
    const loadWelcome = () => fs.existsSync(WELCOME_DB) ? JSON.parse(fs.readFileSync(WELCOME_DB)) : {};
    const saveWelcome = (data) => fs.writeFileSync(WELCOME_DB, JSON.stringify(data, null, 2));

    sock.ev.on('group-participants.update', async (update) => {
        if (update.action !== 'add') return;
        const welcomes = loadWelcome();
        const caption = welcomes[update.id] || `SELAMAT DATANG $nama DI $grup!\nNomor: $nomor\nSemoga betah ya! 🔥`;

        for (const user of update.participants) {
            try {
                const meta = await sock.groupMetadata(update.id);
                const pp = await sock.profilePictureUrl(user, 'image').catch(() => 'https://i.ibb.co/3mZmy8Z/default-pp.jpg');
                const name = await sock.getName(user) || 'User';
                const finalCaption = caption
                    .replace('$nama', name)
                    .replace('$nomor', user.split('@')[0])
                    .replace('$grup', meta.subject);

                await sock.sendMessage(update.id, { image: { url: pp }, caption: finalCaption });
            } catch (e) { }
        }
    });

    // Auto kick banned user pas join grup (DI LUAR messages.upsert)
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        if (action !== 'add') return;

        const bans = loadBans();
        if (!bans[id]) return;

        const toKick = participants.filter(p => bans[id].includes(p));
        if (toKick.length > 0) {
            try {
                await sock.groupParticipantsUpdate(id, toKick, 'remove');
                for (const p of toKick) {
                    await sock.sendMessage(id, { text: `@${p.split('@')[0]} dibanned dari grup ini!`, mentions: [p] });
                }
            } catch (e) { console.log('Auto kick join error:', e); }
        }
    });

    // ====================== FITUR .topup & .setwelcome di messages.upsert ======================
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '').trim().toLowerCase();

        // .topup command
        if (text === '.topup' || text === '.harga') {
            const photo = path.join(FOLDER, 'promo_topup.jpg');
            if (fs.existsSync(photo)) {
                await sock.sendMessage(from, { image: fs.readFileSync(photo), caption: promos[1].caption });
            }
            return;
        }

        // .setwelcome
        if (text.startsWith('.setwelcome ') && from.endsWith('@g.us')) {
            const group = await sock.groupMetadata(from);
            const isAdmin = group.participants.find(p => p.id === msg.key.participant)?.admin;
            if (!isGroupAdmin) return sock.sendMessage(from, { text: 'Hanya admin group!' });

            const newMsg = text.slice(12);
            const welcomes = loadWelcome();
            welcomes[from] = newMsg;
            saveWelcome(welcomes);

            await sock.sendMessage(from, { text: `Welcome diupdate!\nPreview:\n${newMsg.replace('$nama', 'Nama').replace('$nomor', '628xxx').replace('$grup', group.subject)}` });
            return;
        }
    });

    // ====================== SISTEM BAN PER GRUP ======================
    const BANNED_DB = path.join(__dirname, 'data', 'banned.json');

    const loadBans = () => {
        try {
            if (!fs.existsSync(BANNED_DB)) return {};
            return JSON.parse(fs.readFileSync(BANNED_DB, 'utf8'));
        } catch (e) {
            console.log('Load bans error:', e.message);
            return {};
        }
    };

    const saveBans = (data) => {
        try {
            fs.mkdirSync(path.dirname(BANNED_DB), { recursive: true });
            fs.writeFileSync(BANNED_DB, JSON.stringify(data, null, 2));
        } catch (e) {
            console.log('Save bans error:', e.message);
        }
    };

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

    // Users DB path
    const USERS_DB = path.join(__dirname, 'data', 'users.json');
    // Ensure data directory exists
    try {
        const dir = path.dirname(USERS_DB);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
        console.log('Could not ensure data directory:', e.message);
    }

    const loadUsers = () => {
        try {
            if (!fs.existsSync(USERS_DB)) return {};
            const raw = fs.readFileSync(USERS_DB, 'utf8');
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.log('Users DB load error:', e.message);
            return {};
        }
    };

    // Rentals DB (sewa) path
    const RENTALS_DB = path.join(__dirname, 'data', 'rentals.json');

    const loadRentals = () => {
        try {
            if (!fs.existsSync(RENTALS_DB)) return {};
            const raw = fs.readFileSync(RENTALS_DB, 'utf8');
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.log('Rentals DB load error:', e.message);
            return {};
        }
    };

    const saveRentals = (r) => {
        try {
            fs.writeFileSync(RENTALS_DB, JSON.stringify(r, null, 2), 'utf8');
        } catch (e) {
            console.log('Rentals DB save error:', e.message);
        }
    };

    // Operators DB (editable)
    const OPERATORS_DB = path.join(__dirname, 'data', 'operators.json');

    const loadOperators = () => {
        try {
            if (!fs.existsSync(OPERATORS_DB)) return [];
            const raw = fs.readFileSync(OPERATORS_DB, 'utf8');
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.log('Operators DB load error:', e.message);
            return [];
        }
    };

    // Check operator robustly: accept numeric id or full JID appearance
    const isOperator = (fullJid) => {
        if (!fullJid) return false;
        try {
            const list = loadOperators();
            const numeric = fullJid.split('@')[0];

            // Allow bot's own account to act as operator as well
            try {
                const myId = (sock?.user && (sock.user.id || sock.user.jid)) || null;
                if (myId) {
                    if (fullJid.includes(myId) || fullJid.endsWith(`${myId}@s.whatsapp.net`)) return true;
                }
            } catch (e) {
                // ignore
            }

            for (const op of list) {
                if (!op) continue;
                if (String(op) === numeric) return true;
                if (fullJid.includes(String(op))) return true;
                if (fullJid.endsWith(`${op}@s.whatsapp.net`) || fullJid.endsWith(`${op}@c.us`) || fullJid.endsWith(`${op}@g.us`)) return true;
            }
        } catch (e) {
            console.log('isOperator check error:', e.message);
            return false;
        }
        return false;
    };

    const grantRental = (scope, id, tier, days, grantedBy) => {
        const rentals = loadRentals();
        const key = id;
        const expires = Date.now() + (Number(days) || 0) * 24 * 60 * 60 * 1000;
        rentals[key] = { scope, tier, expires, grantedBy, grantedAt: Date.now(), notified3days: false, notified1day: false, notifiedExpired: false };
        saveRentals(rentals);
        return rentals[key];
    };

    const revokeRental = (id) => {
        const rentals = loadRentals();
        if (rentals[id]) delete rentals[id];
        saveRentals(rentals);
    };

    const getRental = (id) => {
        const rentals = loadRentals();
        const r = rentals[id];
        if (!r) return null;
        if (r.expires && Date.now() > r.expires) {
            // expired
            revokeRental(id);
            return null;
        }
        return r;
    };

    // Scheduler: remind tenants when their rental is nearing expiration
    const scheduleRentalReminders = () => {
        const HOUR = 60 * 60 * 1000;
        setInterval(async () => {
            try {
                const rentals = loadRentals();
                const now = Date.now();
                let changed = false;
                for (const [key, r] of Object.entries(rentals)) {
                    if (!r || !r.expires) continue;
                    const remaining = r.expires - now;
                    if (remaining <= 0) {
                        if (!r.notifiedExpired) {
                            const target = r.scope === 'group' ? key : `${key}@s.whatsapp.net`;
                            const text = `⚠️ Masa sewa Anda untuk *${r.scope}* telah berakhir. Akses fitur akan dihentikan. Ketik .sewa untuk info.`;
                            try { await sock.sendMessage(target, { text }); } catch (e) { }
                            r.notifiedExpired = true; changed = true;
                        }
                        continue;
                    }
                    if (remaining <= 24 * 3600 * 1000 && !r.notified1day) {
                        const target = r.scope === 'group' ? key : `${key}@s.whatsapp.net`;
                        const text = `📢 Pengingat: masa sewa akan berakhir dalam kurang dari 24 jam (${formatDuration(remaining)}). Silakan perpanjang.`;
                        try { await sock.sendMessage(target, { text }); } catch (e) { }
                        r.notified1day = true; changed = true;
                    } else if (remaining <= 3 * 24 * 3600 * 1000 && !r.notified3days) {
                        const target = r.scope === 'group' ? key : `${key}@s.whatsapp.net`;
                        const text = `📢 Pengingat: masa sewa akan berakhir dalam ${Math.ceil(remaining / (24 * 3600 * 1000))} hari (${formatDuration(remaining)}).`;
                        try { await sock.sendMessage(target, { text }); } catch (e) { }
                        r.notified3days = true; changed = true;
                    }
                }
                if (changed) saveRentals(rentals);
            } catch (e) {
                console.log('rental scheduler error:', e.message);
            }
        }, HOUR);
    };

    const hasAccessForCommand = (command, isGroup, senderFullJid, groupId) => {
        // operator always allowed
        if (isOperator(senderFullJid)) return true;
        const cmd = command.toLowerCase();
        // always allow .sewa so non-rented users can see how to rent
        if (cmd === '.sewa') return true;
        // check rental: if group context, check group rental; otherwise check private rental for sender
        if (isGroup) {
            const rental = getRental(groupId);
            return !!rental;
        } else {
            const senderId = (senderFullJid || '').split('@')[0];
            const rental = getRental(senderId);
            return !!rental;
        }
    };

    const saveUsers = (users) => {
        try {
            fs.writeFileSync(USERS_DB, JSON.stringify(users, null, 2), 'utf8');
        } catch (e) {
            console.log('Users DB save error:', e.message);
        }
    };

    const updateUserRecord = async (msg) => {
        try {
            const userJid = msg.key.participant || msg.key.remoteJid;
            if (!userJid) return;
            const users = loadUsers();
            const id = userJid.split('@')[0];
            const now = Date.now();
            if (!users[id]) {
                users[id] = {
                    jid: userJid,
                    name: msg.pushName || '',
                    firstSeen: now,
                    count: 1
                };
            } else {
                users[id].count = (users[id].count || 0) + 1;
                if (msg.pushName) users[id].name = msg.pushName;
                if (!users[id].firstSeen) users[id].firstSeen = now;
            }
            saveUsers(users);
        } catch (e) {
            console.log('updateUserRecord error:', e.message);
        }
    };

    const formatDate = (ts) => {
        try {
            const d = new Date(Number(ts));
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}-${mm}-${yyyy}`;
        } catch (e) {
            return 'Unknown';
        }
    };

    const formatDuration = (ms) => {
        if (ms <= 0) return 'Kadaluarsa';

        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        const parts = [];
        if (days > 0) parts.push(`${days} hari`);
        if (hours % 24 > 0) parts.push(`${hours % 24} jam`);
        if (minutes % 60 > 0 && days === 0) parts.push(`${minutes % 60} menit`);
        // Tampilkan setidaknya 1 nilai, kalau durasinya sangat pendek
        if (parts.length === 0 && ms > 0) {
            return 'Kurang dari 1 menit';
        }

        return parts.join(', ');
    };

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.clear(); // biar bersih dulu
            console.log('\x1b[38;5;196m'); // warna merah terang (kalau terminal support)
            console.log(`
 ▀█████████▄   ▄██████▄      ███             ▄████████    ▄████████   ▄▄▄▄███▄▄▄▄  
  ███    ███ ███    ███ ▀█████████▄        ███    ███   ███    ███ ▄██▀▀▀███▀▀▀██▄
  ███    ███ ███    ███    ▀███▀▀██        ███    █▀    ███    ███ ███   ███   ███
 ▄███▄▄▄██▀  ███    ███     ███   ▀        ███          ███    ███ ███   ███   ███
▀▀███▀▀▀██▄  ███    ███     ███          ▀███████████ ▀███████████ ███   ███   ███
  ███    ██▄ ███    ███     ███                   ███   ███    ███ ███   ███   ███
  ███    ███ ███    ███     ███             ▄█    ███   ███    ███ ███   ███   ███
▄█████████▀   ▀██████▀     ▄████▀         ▄████████▀    ███    █▀   ▀█   ███   █▀                               

                ╔══════════════════════════════════════════════╗
                ║          SAM BOT SUKSES DINYALAKAN!!!        ║
                ║       ON 24/7 • VPS • ZERO DC • PREMIUM      ║
                ║           MADE BY SUKABYONE © 2025           ║
                ╚══════════════════════════════════════════════╝
            `);
            console.log('\x1b[0m'); // reset warna

            // start rental reminder scheduler when connection is open
            try {
                scheduleRentalReminders();
            } catch (e) {
                console.log('Failed to start rental scheduler:', e.message);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.key.fromMe && m.type === 'notify') {
                const from = msg.key.remoteJid;
                const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '').trim();


                if (!msg.message || msg.key.fromMe) return;

                // .admins - Show admin list
                if (text === '.admins') {
                    return await bakulan.showAdmins(sock, from, msg);
                }

                // .addadmin - Add admin
                if (text.startsWith('.addadmin')) {
                    return await bakulan.addAdmin(sock, from, text, msg);
                }

                // .myadmin - Check admin status
                if (text === '.myadmin') {
                    const sender = msg.key.participant || from;
                    const isAdmin = bakulan.isAdmin(sender, sock);
                    return sock.sendMessage(from, {
                        text: `🔐 Status Admin: ${isAdmin ? '✅ YA' : '❌ TIDAK'}`
                    });
                }

                // ===============================
                // BAKULAN SYSTEM COMMANDS
                // ===============================

                // .jualan - Show menu
                if (text === '.jualan' || text === '.bakulan') {
                    return await bakulan.jualMenu(sock, from, msg);
                }

                if (text === '.owners') {
                    return await bakulan.showOwners(sock, from, msg);
                }

                if (text.startsWith('.addowner')) {
                    return await bakulan.addOwner(sock, from, text, msg);
                }

                // .order|... - Add new order
                if (text.startsWith('.order|')) {
                    return await bakulan.addOrder(sock, from, text);
                }

                // .orders - View all orders (paginated)
                if (text.startsWith('.orders')) {
                    return await bakulan.viewOrders(sock, from, text);
                }

                // .order ID - View single order
                if (text.match(/^\.order\s+\w+/i)) {
                    return await bakulan.viewOrder(sock, from, text);
                }

                // .done ID - Mark as done
                if (text.match(/^\.done\s+\w+/i)) {
                    return await bakulan.markDone(sock, from, text);
                }

                // .search|... - Search orders
                if (text.startsWith('.search')) {
                    return await bakulan.searchOrders(sock, from, text);
                }

                // .today - Today's orders
                if (text === '.today') {
                    return await bakulan.todayOrders(sock, from);
                }

                // .pending - Pending orders
                if (text === '.pending') {
                    return await bakulan.pendingOrders(sock, from);
                }

                // .stats - Statistics
                if (text === '.stats') {
                    return await bakulan.showStats(sock, from);
                }

                // .report YYYY-MM - Monthly report
                if (text.startsWith('.report')) {
                    return await bakulan.monthlyReport(sock, from, text);
                }

                // .export - Export data
                if (text === '.export') {
                    return await bakulan.exportData(sock, from);
                }

                // .cleanup - Cleanup old data
                if (text === '.cleanup') {
                    return await bakulan.systemCleanup(sock, from);
                }

                // .edit ID|field|value - Edit order
                if (text.startsWith('.edit')) {
                    return await bakulan.editOrder(sock, from, text);
                }

                // .status ID|status - Change status
                if (text.startsWith('.status')) {
                    return await bakulan.changeStatus(sock, from, text);
                }

                // .delete ID - Delete order
                if (text.startsWith('.delete')) {
                    return await bakulan.deleteOrder(sock, from, text);
                }

                // .top - Top products
                if (text === '.top') {
                    return await bakulan.showTopProducts(sock, from);
                }

                // .chart - Show chart
                if (text === '.chart') {
                    return await bakulan.showChart(sock, from);
                }

                // ====================== SISTEM BAN PER GRUP (DI DALAM messages.upsert) ======================
                // Auto kick banned user kalau kirim pesan
                if (from.endsWith('@g.us')) {
                    const bans = loadBans();
                    const sender = msg.key.participant;
                    if (bans[from]?.includes(sender)) {
                        try {
                            await sock.groupParticipantsUpdate(from, [sender], 'remove');
                            await sock.sendMessage(from, { text: `@${sender.split('@')[0]} dibanned dari grup ini!`, mentions: [sender] });
                        } catch (e) { }
                        return;
                    }
                }

                // .BAN command
                if (text.toLowerCase().startsWith('.ban ')) {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Fitur .ban hanya bisa di grup!' });

                    const group = await sock.groupMetadata(from);
                    const isAdmin = group.participants.find(p => p.id === (msg.key.participant || msg.key.remoteJid))?.admin;
                    if (!isAdmin) return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa ban!' });
                    if (!getRental(from)) return sock.sendMessage(from, { text: 'Grup ini belum sewa bot!' });

                    let target = null;
                    if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
                        target = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                    } else if (text.split(' ')[1]) {
                        target = text.split(' ')[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    }

                    if (!target) return sock.sendMessage(from, { text: 'Cara pakai: .ban @user atau .ban 628xxx' });

                    try {
                        await sock.groupParticipantsUpdate(from, [target], 'remove');
                        const bans = loadBans();
                        if (!bans[from]) bans[from] = [];
                        if (!bans[from].includes(target)) bans[from].push(target);
                        saveBans(bans);
                        await sock.sendMessage(from, { text: `✅ @${target.split('@')[0]} berhasil dibanned & dikick!`, mentions: [target] });
                    } catch (e) {
                        await sock.sendMessage(from, { text: 'Gagal ban: ' + e.message });
                    }
                    return;
                }

                // .UNBAN command
                if (text.toLowerCase().startsWith('.unban ')) {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Fitur .unban hanya bisa di grup!' });

                    const group = await sock.groupMetadata(from);
                    const isAdmin = group.participants.find(p => p.id === (msg.key.participant || msg.key.remoteJid))?.admin;
                    if (!isAdmin) return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa unban!' });

                    let target = null;
                    if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
                        target = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                    } else if (text.split(' ')[1]) {
                        target = text.split(' ')[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    }

                    if (!target) return sock.sendMessage(from, { text: 'Cara pakai: .unban @user atau .unban 628xxx' });

                    const bans = loadBans();
                    if (bans[from]?.includes(target)) {
                        bans[from] = bans[from].filter(u => u !== target);
                        if (bans[from].length === 0) delete bans[from];
                        saveBans(bans);
                        await sock.sendMessage(from, { text: `✅ @${target.split('@')[0]} berhasil di-unban!`, mentions: [target] });
                    } else {
                        await sock.sendMessage(from, { text: 'User ini gak ada di daftar banned.' });
                    }
                    return;
                }
                // ====================== END SISTEM BAN PER GRUP ======================



                // Update user record (count, name, firstSeen)
                await updateUserRecord(msg);

                // MENU / HELP
                if (text.toLowerCase() === '.menu' || text.toLowerCase() === '.help') {
                    await sock.sendMessage(from, {
                        text: `📌 *𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ 🔥*
• .menu / .help - Tampilkan menu
• .ping - Cek status & latency
• .profile [@user] - Lihat profil
• .stiker - Buat stiker dari gambar
• .cekidgroup - Lihat ID grup

📥 *DOWNLOADER:*
• .tt [link] - Download TikTok
• .ig [link] - Download Instagram

👥 *ADMIN GRUP:*
• .tagall - Tag semua anggota
• .hidetag [pesan] - Tag tanpa notif
• .promote/demote [@user] - Atur admin
• .kick/ban/unban [@user] - Kelola member
• .close/opengroup - Buka/tutup grup

🔐 *SEWA & AKSES:*
• .sewa - Info sewa bot
• .ceksewa - Cek status sewa

────────────────────
📞 *KONTAK OWNER:*
wa.me/6289528950624 - Sam @Sukabyone

💎 *Note:* Beberapa fitur membutuhkan sewa bot. Ketik .sewa untuk info lengkap!`
                    });
                    return;
                }

                // PING — cek apakah bot aktif dan tampilkan latency
                if (text.toLowerCase() === '.ping') {
                    // Ambil waktu pesan dikirim (dalam ms)
                    const msgTs = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();

                    // Hitung latency dalam milidetik (ms)
                    const tickMs = Date.now() - msgTs;

                    // Konversi ke detik (s) dan bulatkan 2 angka di belakang koma
                    const tickS = (tickMs / 1000).toFixed(2);

                    await sock.sendMessage(from, { text: `🚀 Bot aktif!\nLatency: ${tickS} detik (${tickMs} ms)` });
                    return;
                }

                // PROFILE — tampilkan profil pengguna (nama, WA id, total penggunaan, bergabung sejak)
                if (text.toLowerCase() === '.profile' || text.toLowerCase() === '.profil') {
                    // target via mention or reply, default = sender
                    const ext = msg.message?.extendedTextMessage;
                    let targetJid = null;
                    if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                        targetJid = ext.contextInfo.mentionedJid[0];
                    } else if (ext?.contextInfo?.participant) {
                        targetJid = ext.contextInfo.participant;
                    } else {
                        targetJid = msg.key.participant || msg.key.remoteJid;
                    }

                    const users = loadUsers();
                    const id = (targetJid || msg.key.remoteJid).split('@')[0];
                    const record = users[id] || { jid: targetJid || msg.key.remoteJid, name: msg.pushName || 'Unknown', firstSeen: null, count: 0 };
                    const name = record.name || 'Unknown';
                    const waId = id;
                    const count = record.count || 0;
                    const firstSeen = record.firstSeen ? formatDate(record.firstSeen) : 'Unknown';

                    const profileText = `*-- [ PROFILE KAMU ] --*\n👤 Nama: ${name}\n📞 NO. HP: ${waId}\n📊 Total Penggunaan: ${count} chat\nTerus gunakan bot ini ya! 😉`;

                    const mentions = targetJid ? [targetJid] : [];
                    await sock.sendMessage(from, { text: profileText, mentions });
                    return;
                }

                // GROUP CONTROL — buka / tutup grup (hanya admin)
                if (text.toLowerCase() === '.closegroup' || text.toLowerCase() === '.opengroup') {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                    const group = await sock.groupMetadata(from);
                    const sender = msg.key.participant || msg.key.remoteJid;
                    const isSenderAdmin = group.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin));
                    if (!isSenderAdmin) return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa menggunakan perintah ini.' });
                    // check rental: group must have active rental
                    const fullSender = msg.key.participant || msg.key.remoteJid;
                    if (!hasAccessForCommand(text.split(' ')[0], true, fullSender, from)) return sock.sendMessage(from, { text: 'Fitur ini membutuhkan paket sewa. Ketik .sewa untuk info.' });

                    try {
                        if (text.toLowerCase() === '.closegroup') {
                            await setGroupAnnouncement(from, true);
                            await sock.sendMessage(from, { text: 'Sukses! Grup ditutup — hanya admin yang bisa mengirim pesan sekarang.' });

                        } else { // ini berarti .opengroup
                            await setGroupAnnouncement(from, false);
                            await sock.sendMessage(from, { text: 'Sukses! Grup dibuka — semua anggota bisa mengirim pesan sekarang.' });
                        }
                    } catch (err) {
                        console.log('Group control error:', err.message);

                        // 👇 Custom pesan error berdasarkan command
                        let customErrorMessage = 'Gagal mengubah setelan grup. Pastikan bot adalah admin grup dan memiliki izin penuh!';

                        if (text.toLowerCase() === '.closegroup') {
                            customErrorMessage = 'Gagal menutup grup. Mungkin bot bukan admin? 😭';
                        } else if (text.toLowerCase() === '.opengroup') {
                            customErrorMessage = 'Gagal membuka grup. Cek lagi status admin bot! 🤔';
                        }

                        await sock.sendMessage(from, { text: customErrorMessage });
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
                    // check rental: group must have active rental
                    const fullSenderProm = msg.key.participant || msg.key.remoteJid;
                    if (!hasAccessForCommand(text.split(' ')[0], true, fullSenderProm, from)) return sock.sendMessage(from, { text: 'Fitur ini membutuhkan paket sewa. Ketik .sewa untuk info.' });

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
                        await sock.sendMessage(from, { text: `Gagal mengubah status admin \n\n_keterangan: bot belum menjadi admin atau target merupakan pembuat group_` });
                    }
                    return;
                }

                // TAGALL — BENERAN TAG SEMUA MEMBER (bukan cuma @everyone)
                if (text.toLowerCase() === '.tagall') {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Di grup aja yaaa' });
                    const fullSender = msg.key.participant || msg.key.remoteJid;
                    if (!hasAccessForCommand('.tagall', true, fullSender, from)) return sock.sendMessage(from, { text: 'Fitur ini hanya tersedia untuk grup yang menyewa bot. Ketik .sewa untuk info.' });
                    const group = await sock.groupMetadata(from);
                    let teks = 'TAG SEMUA ORANG!\n';
                    for (let mem of group.participants) {
                        teks += ` @${mem.id.split('@')[0]}\n`;
                    }
                    teks += ` \nBERHASIL TAG SEMUA ORANG ✅`;
                    await sock.sendMessage(from, { text: teks, mentions: group.participants.map(a => a.id) });
                    return;
                }

                // HIDETAG — TAG SEMUA TAPI DISEMBUNYIKAN, GANTI PESAN
                if (text.toLowerCase().startsWith('.hidetag ') || text.toLowerCase().startsWith('.h ') || text.toLowerCase() === '.hidetag' || text.toLowerCase() === '.h') {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'bisa dipake nyaa cuma di group' });

                    const fullSender = msg.key.participant || msg.key.remoteJid;
                    if (!hasAccessForCommand('.hidetag', true, fullSender, from)) return sock.sendMessage(from, { text: 'Fitur ini hanya tersedia untuk grup yang menyewa bot. Ketik .sewa untuk info.' });

                    // Ambil pesan setelah command
                    let pesan = '';
                    if (text.toLowerCase().startsWith('.hidetag ')) {
                        pesan = text.slice(9).trim();
                    } else if (text.toLowerCase().startsWith('.h ')) {
                        pesan = text.slice(3).trim();
                    }
                    // Untuk '.hidetag' atau '.h' tanpa spasi dan tanpa pesan, pesan tetap string kosong

                    const messageToSend = pesan ? pesan : '\n‎';

                    const group = await sock.groupMetadata(from);
                    await sock.sendMessage(from, {
                        text: messageToSend,
                        mentions: group.participants.map(a => a.id)
                    });
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
                if (text.toLowerCase().startsWith('.tt ') || text.toLowerCase().startsWith('.tiktok ') || text.toLowerCase() === '.tt' || text.toLowerCase() === '.tiktok') {
                    // Cek apakah hanya command tanpa URL
                    const isCommandOnly = text.toLowerCase() === '.tt' || text.toLowerCase() === '.tiktok';

                    if (isCommandOnly) {
                        return sock.sendMessage(from, {
                            text: 'apa? bisa gaa?\ngini loh caranyaa\n".tt https://vt.tiktok.com/abc" \n\ngitu aja gabisa'
                        }, { quoted: msg });
                    }

                    const url = text.split(' ').slice(1).join(' ');
                    if (!url.includes('tiktok')) return sock.sendMessage(from, { text: 'link TikTok-nya SALAAHHHHH!\ngini nih contoh yang bener: .tt https://vt.tiktok.com/abc' });

                    await sock.sendMessage(from, { text: 'Sabar yaaa, lagi diprosess... ⏳' });

                    try {
                        // check access: rental required (single-tier)
                        const fullSenderForTt = msg.key.participant || msg.key.remoteJid;
                        const isGroup = from.endsWith('@g.us');
                        const groupId = from;
                        if (!hasAccessForCommand('.tt', isGroup, fullSenderForTt, groupId)) {
                            return sock.sendMessage(from, { text: 'Fitur ini hanya tersedia untuk akun/grup yang menyewa bot. Ketik .sewa untuk info.' });
                        }
                        const res = await axios.get(`https://tikwm.com/api/?url=${url}`);
                        if (res.data.code !== 0) throw new Error('API error: ' + res.data.msg);

                        const videoUrl = res.data.data.play;  // URL video no watermark HD
                        const title = res.data.data.title || 'TikTok Video Gacor';
                        const author = res.data.data.author.unique_id || 'unknown';

                        await sock.sendMessage(from, {
                            video: { url: videoUrl },
                            caption: `✅ TikTok Video Downloaded!\n\n📌 Title: ${title}\n👤 Author: ${author}\n\n_Downloaded by SAM BOT🔥_`
                        });
                    } catch (err) {
                        console.log('TikWM Error:', err.message);  // Buat debug di terminal
                        await sock.sendMessage(from, { text: `yaahhh gagalll😭\nError: ${err.message}\ncoba link lain atau tunggu bentar.` });
                    }
                    return;
                }

                // SEWA — promotional info and how to rent
                if (text.toLowerCase() === '.sewa') {
                    const ops = loadOperators();
                    const opText = ops && ops.length ? ops.join(', ') : '6289528950624 - Sam @Sukabyone';
                    const promo = `🌟 *Sistem Penyewaan Bot* 🌟 \n 𝐒𝐚𝐦𝐀𝐥 | รักและรักคุณจริงๆ \n\n` +
                        `✨ *Sistem sewa sederhana:*\n` +
                        `• *Sewa = Bisa menggunakan semua fitur bot*\n` +
                        `• *Tidak sewa = Tidak bisa menggunakan sama sekali*\n\n` +
                        `📌 Cara penyewaan:\n` +
                        `• Hubungi kontak Owner / Admin di bawah \n` +
                        `• Chat Admin dan katakan bahwa ingin menyewa bot. \n  •_contoh: "Saya ingin menyewa bot selama 30 hari"_ \n\n` +
                        `💰 *Harga Sewa:*\n` +
                        `• Rp 10.000 untuk 30 hari (1 bulan)\n` +
                        `• Rp 25.000 untuk 90 hari (3 bulan)\n` +
                        `• Rp 45.000 untuk 180 hari (6 bulan)\n\n` +
                        `📞 *Kontak Owner / Admin:*\n` +
                        `• wa.me/6289528950624 - Sam @Sukabyone \n\n` +
                        `Terima kasih! ✨`;
                    await sock.sendMessage(from, { text: promo });
                    return;
                }

                // OPERATOR COMMAND: .grant & .revoke (FIXED 100% NO SYNTAX ERROR)
                if (text.toLowerCase().startsWith('.grant ') || text.toLowerCase().startsWith('.revoke ')) {
                    if (!isOperator(msg.key.participant || msg.key.remoteJid)) {
                        return sock.sendMessage(from, { text: 'Hanya operator yang boleh pakai perintah ini!' });
                    }

                    const args = text.trim().split(' ');
                    const cmd = args[0].toLowerCase();

                    try {
                        if (cmd === '.grant') {
                            const scope = args[1]?.toLowerCase();
                            const target = args[2];
                            const days = parseInt(args[3] || args[2]);

                            if (!scope || !target || isNaN(days) || days <= 0) {
                                return sock.sendMessage(from, { text: 'Format: .grant private/group <id/grup> <hari>' });
                            }

                            let id = scope === 'private' ? target.replace(/[^0-9]/g, '') : (from.endsWith('@g.us') ? from : target);
                            if (id.startsWith('0')) id = '62' + id.slice(1);

                            grantRental(scope, id, 'premium', days, msg.key.participant || msg.key.remoteJid);
                            sock.sendMessage(from, { text: `✅ ${scope.toUpperCase()} ${id} berhasil disewa ${days} hari!` });
                        }

                        if (cmd === '.revoke') {
                            const targetRaw = args[1]; // Ambil target mentah (id, jid, atau kosong)
                            let keyToRevoke = targetRaw;

                            // Jika target tidak ada, cek apakah ini di grup. Jika iya, targetnya adalah grup itu sendiri.
                            if (!keyToRevoke && from.endsWith('@g.us')) {
                                keyToRevoke = from; // Default revoke group current
                            } else if (!keyToRevoke) {
                                // Kalau di private chat tanpa argumen, gak jelas mau revoke siapa.
                                return sock.sendMessage(from, { text: 'Format: .revoke <groupId> atau .revoke <idUser>' });
                            }

                            // --- NORMALISASI ID UNTUK PRIVATE ---
                            if (!keyToRevoke.includes('@g.us')) { // Cek jika ini BUKAN Group JID
                                // Hapus semua karakter non-angka dan pecah JID jika ada
                                if (keyToRevoke.includes('@')) keyToRevoke = keyToRevoke.split('@')[0];
                                keyToRevoke = String(keyToRevoke).replace(/[^0-9]/g, '');

                                // Tambahkan 62 jika dimulai dengan 0 (Normalisasi seperti saat Grant)
                                if (keyToRevoke.startsWith('0')) {
                                    keyToRevoke = '62' + keyToRevoke.slice(1);
                                }
                            }

                            // --- Eksekusi Revoke ---
                            revokeRental(keyToRevoke);
                            sock.sendMessage(from, { text: `❌ Rental untuk *${keyToRevoke}* berhasil dicabut!` });
                        }
                    } catch (e) {
                        sock.sendMessage(from, { text: 'Error: ' + e.message });
                    }
                    return;
                }

                // --- OPERATOR COMMAND: .UPDATE / .UP (Otomatisasi Git Pull & PM2 Restart) ---
                if (text.toLowerCase() === '.update' || text.toLowerCase() === '.up') {
                    // Cek Operator
                    if (!isOperator(msg.key.participant || msg.key.remoteJid)) {
                        return sock.sendMessage(from, { text: '🚨 Hanya operator yang boleh pakai perintah ini!' });
                    }

                    // 1. Kirim notif bahwa proses update dimulai
                    await sock.sendMessage(from, { text: '🚀 Proses update bot dimulai! \n\n~ Menarik Kode Terbaru\n~ Mengaktifkan Kode Baru\n\nMohon tunggu sebentar...' });

                    // 2. Eksekusi Skrip Update
                    // Pastikan kamu sudah membuat file update.sh dan memberinya izin eksekusi (+x)
                    exec('./update.sh', async (error, stdout, stderr) => {
                        if (error) {
                            console.error(`Exec Error (.update): ${error.message}`);
                            return sock.sendMessage(from, {
                                text: `❌ GAGAL UPDATE (Exec Error):\n\`\`\`\n${error.message}\n\`\`\``
                            });
                        }

                        // Output dari skrip kita kirimkan.
                        // Bagian logs dari PM2 akan ada di stdout.
                        let outputText = `✅ UPDATE BOT SELESAI!\n\n--- Output Konsol ---\n\`\`\`\n${stdout}\n\`\`\``;

                        // Jika ada stderr, tambahkan sebagai peringatan
                        if (stderr) {
                            outputText += `\n\n⚠️ Peringatan (Stderr):\n\`\`\`\n${stderr}\n\`\`\``;
                        }

                        await sock.sendMessage(from, { text: outputText });

                        // Note: Karena PM2 restart sudah dijalankan di dalam skrip, bot seharusnya sekarang
                        // sudah menjalankan kode terbaru.
                    });

                    return;
                }

                // === STIKER COMMAND ===
                // trigger: .s, .stiker, .sticker
                const triggers = ['.s', '.stiker', '.sticker'];

                const lowerText = text.toLowerCase();
                const isTrigger = triggers.some(t => lowerText.includes(t));

                if (isTrigger) {

                    let imgMsg = null;

                    // === 1. Caption mengandung trigger → gunakan foto yang dikirim ===
                    if (msg.message?.imageMessage) {
                        const caption = (msg.message.imageMessage.caption || '').toLowerCase();
                        const captionIsTrigger = triggers.some(t => caption.includes(t));

                        if (captionIsTrigger) {
                            imgMsg = msg.message.imageMessage;
                        }
                    }

                    // === 2. Reply ke pesan foto + ketik .stiker/.s ===
                    if (!imgMsg && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                        imgMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    }

                    // === Jika tidak ada gambar ===
                    if (!imgMsg) {
                        return sock.sendMessage(from, {
                            text: 'Cara pakai:\n• Kirim foto + caption *.stiker*\n• Atau reply foto + ketik *.stiker*\n\nSupport JPG/PNG/GIF!'
                        });
                    }

                    await sock.sendMessage(from, { text: 'Oke bentar, lagi kubikin stikernya... 🔥' });

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
                        await sock.sendMessage(from, { sticker: stickerBuffer });

                    } catch (err) {
                        console.log('Stiker Sharp error:', err.message);
                        await sock.sendMessage(from, { text: 'Yahhhh gagall, fotonya terlalu HD kayanya deh 😭\nCoba foto yang lebih kecil (max 1MB) atau format JPG/PNG.' });
                    }
                    return;
                }

                // CEKIDGROUP — tunjukkan ID grup
                if (text.toLowerCase() === '.cekidgroup') {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                    const meta = await sock.groupMetadata(from);
                    const gid = from;
                    const title = meta?.subject || 'Group';
                    await sock.sendMessage(from, { text: `Group: ${title}\nID: ${gid}` });
                    return;
                }

                // JOIN — gabung ke grup lewat link: .join https://chat.whatsapp.com/XXXXXXXX
                if (text.toLowerCase().startsWith('.join ')) {
                    const parts = text.split(/\s+/);
                    const link = parts[1];
                    if (!link || !link.includes('chat.whatsapp.com')) return sock.sendMessage(from, { text: 'Format: .join <link chat.whatsapp.com/...>' });
                    const code = link.split('chat.whatsapp.com/')[1];
                    if (!code) return sock.sendMessage(from, { text: 'Link invalid.' });
                    try {
                        await sock.groupAcceptInvite(code);
                        await sock.sendMessage(from, { text: 'Berhasil join grup via link!' });
                    } catch (e) {
                        console.log('join error:', e.message);
                        await sock.sendMessage(from, { text: `Gagal join: ${e.message}` });
                    }
                    return;
                }

                // KICK — keluarkan member via mention/reply
                if (text.toLowerCase().startsWith('.kick')) {
                    if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'Perintah ini hanya untuk grup.' });
                    const group = await sock.groupMetadata(from);
                    const sender = msg.key.participant || msg.key.remoteJid;
                    const isSenderAdmin = group.participants.some(p => p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin));
                    if (!isSenderAdmin) return sock.sendMessage(from, { text: 'Hanya admin grup yang bisa menggunakan perintah ini.' });
                    const fullSender = msg.key.participant || msg.key.remoteJid;
                    if (!hasAccessForCommand('.kick', true, fullSender, from)) return sock.sendMessage(from, { text: 'Fitur ini membutuhkan paket sewa. Ketik .sewa untuk info.' });

                    // get targets
                    let targets = [];
                    const ext = msg.message?.extendedTextMessage;
                    if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                        targets = ext.contextInfo.mentionedJid;
                    } else if (ext?.contextInfo?.participant) {
                        targets = [ext.contextInfo.participant];
                    }
                    if (!targets.length) return sock.sendMessage(from, { text: 'Tandai (mention) atau reply ke pengguna yang ingin dikick.' });
                    try {
                        await sock.groupParticipantsUpdate(from, targets, 'remove');
                        await sock.sendMessage(from, { text: `Sukses mengeluarkan: ${targets.map(t => '@' + t.split('@')[0]).join(', ')}`, mentions: targets });
                    } catch (e) {
                        console.log('kick error:', e.message);
                        await sock.sendMessage(from, { text: `Gagal kick: ${e.message}` });
                    }
                    return;
                }

                // CEKSEWA — cek status sewa untuk group atau private
                if (text.toLowerCase().startsWith('.ceksewa')) {
                    try {
                        const parts = text.trim().split(/\s+/);
                        // formats supported:
                        // .ceksewa group <groupId>
                        // .ceksewa private <@mention|id>
                        // .ceksewa <id>  (auto-detect private)
                        // .ceksewa (inside group -> checks that group)

                        const arg1 = parts[1];
                        const arg2 = parts[2];
                        const ext = msg.message?.extendedTextMessage;

                        let scope = null;
                        let target = null;

                        if (!arg1) {
                            // no args: if in group, check that group; else check sender
                            if (from && from.endsWith('@g.us')) {
                                scope = 'group';
                                target = from;
                            } else {
                                scope = 'private';
                                target = (msg.key.participant || msg.key.remoteJid).split('@')[0];
                            }
                        } else if (arg1.toLowerCase() === 'group') {
                            scope = 'group';
                            target = arg2 || (from.endsWith('@g.us') ? from : null);
                        } else if (arg1.toLowerCase() === 'private') {
                            scope = 'private';
                            target = arg2 || null;
                        } else {
                            // could be direct id or mention
                            if (arg1.includes('@') || (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length)) {
                                // if mention present, use that
                                if (ext?.contextInfo?.mentionedJid && ext.contextInfo.mentionedJid.length) {
                                    scope = 'private';
                                    target = ext.contextInfo.mentionedJid[0];
                                } else {
                                    // direct jid passed
                                    if (arg1.includes('@')) {
                                        // group or user jid
                                        if (arg1.endsWith('@g.us')) {
                                            scope = 'group';
                                            target = arg1;
                                        } else {
                                            scope = 'private';
                                            target = arg1.split('@')[0];
                                        }
                                    } else {
                                        // numeric id passed, treat as private
                                        scope = 'private';
                                        target = arg1;
                                    }
                                }
                            } else {
                                // numeric or string without @ -> assume private id
                                scope = 'private';
                                target = arg1;
                            }
                        }

                        if (!scope || !target) return sock.sendMessage(from, { text: 'Format: .ceksewa group <groupId> atau .ceksewa private <@mention|idUser> atau jalankan di grup tanpa argumen untuk cek grup.' });

                        // normalize target key used by getRental
                        let key = target;
                        if (scope === 'private') {
                            if (typeof key === 'string' && key.includes('@')) key = key.split('@')[0];
                            key = String(key).replace(/[^0-9]/g, '');
                            if (key.startsWith('0')) key = '62' + key.slice(1);
                        }

                        const rental = getRental(key);
                        if (!rental) {
                            return sock.sendMessage(from, { text: `Tidak ada sewa aktif untuk ${scope} ${target}` });
                        }

                        const remainingMs = rental.expires - Date.now();
                        const textOut = `📌 Info Sewa (${scope})\n` +
                            `Target: ${target}\n` +
                            `Kadaluarsa: ${formatDate(rental.expires)} (${formatDuration(remainingMs)})\n` +
                            `Diberikan oleh: ${rental.grantedBy || 'unknown'}`;

                        return sock.sendMessage(from, { text: textOut });
                    } catch (e) {
                        console.log('ceksewa error:', e.message);
                        return sock.sendMessage(from, { text: 'Terjadi error saat memeriksa sewa: ' + e.message });
                    }
                }

                // INSTAGRAM DOWNLOADER
                if (text.toLowerCase().startsWith('.ig') || text.toLowerCase().startsWith('.instagram')) {
                    if (text.toLowerCase().startsWith('.ig') || text.toLowerCase().startsWith('.instagram')) {
                        const args = text.split(' ');
                        if (args.length < 2) {
                            return sock.sendMessage(from, { text: 'linknya maneeeee?\n gini lohh\n".ig https://instagram.com/reel/..."' }, { quoted: msg });
                        }

                        const url = args[1].trim();
                        const processingMsg = await sock.sendMessage(from, { text: '⏳ Mengunduh...' }, { quoted: msg });

                        try {
                            const apiUrl = `http://localhost:3000/igdl?url=${encodeURIComponent(url)}`;
                            console.log('[DEBUG] Request ke API:', apiUrl);

                            const response = await axios.get(apiUrl, { timeout: 30000 });
                            console.log('[DEBUG] Respons API:', JSON.stringify(response.data, null, 2));

                            // CARA 1: Akses yang lebih aman dengan optional chaining
                            const videoData = response.data?.url?.data?.[0];

                            if (videoData && videoData.url) {
                                const videoUrl = videoData.url;
                                console.log('[DEBUG] Link video (String):', videoUrl);
                                console.log('[DEBUG] Tipe videoUrl:', typeof videoUrl); // Harusnya "string"

                                // Hapus pesan "sedang memproses"
                                if (processingMsg?.key) {
                                    await sock.sendMessage(from, { delete: processingMsg.key });
                                }

                                // KIRIM VIDEO - Cara yang benar
                                await sock.sendMessage(from, {
                                    video: { url: videoUrl }, // Pastikan videoUrl adalah STRING
                                    caption: '✅ Instagram Reel berhasil diunduh',
                                    mimetype: 'video/mp4'
                                });

                            } else {
                                // Debug: Tampilkan struktur jika tidak sesuai
                                console.error('[ERROR] Struktur data tidak sesuai:', response.data);
                                throw new Error('Link download tidak ditemukan dalam respons API');
                            }

                        } catch (error) {
                            console.error('[ERROR] Detail:', error.message, error.stack);

                            let errorMsg = '❌ Gagal mengunduh video. ';
                            if (error.message.includes('path') && error.message.includes('Object')) {
                                errorMsg += 'Terjadi kesalahan: URL video bukan string. Cek log server.';
                            } else {
                                errorMsg += `Detail: ${error.message}`;
                            }

                            await sock.sendMessage(from, { text: errorMsg }, { quoted: msg });
                        }
                    }
                }

                // STIKER — 100% JADI & GAK "Cannot view sticker information" LAGI
                // Error handling for the event handler
            }
        } catch (e) {
            console.log('messages.upsert error:', e.message);
        }
    });
}

connectToWhatsApp();