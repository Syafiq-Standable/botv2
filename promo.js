// promo.js — Promosi terpisah + jam gacor usia SMA-35 tahun
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

module.exports = (sock) => {
    const TARGET = '6289528950624@s.whatsapp.net'; // ganti kalau mau kirim ke grup promo juga
    const FOLDER = path.join(__dirname, 'data');

    const promos = [
        {
            time: '30 7 * * *', // 07:30 pagi
            photo: path.join(FOLDER, 'promo_3d.jpg'),
            caption: `🔥 *JASA 3D FREE FIRE MURAH!*\n\n` +
                     `• 3D Solo       : 50rb\n` +
                     `• 3D Couple     : 70rb\n` +
                     `• 3D Squad     : 100rb-150rb\n\n` +
                     `Hasil Super HD! + Anti Pasaran!! \n` +
                     `Minat? Chat sekarang:\nwa.me/6289528950624\n\n` +
                     `#3DFreeFire #3DFF #Jasa3D`
        },
        {
            time: '0 12 * * *', // 12:00 siang
            photo: path.join(FOLDER, 'promo_topup.jpg'),
            caption: `💎 *TOPUP GAME TERMURAH SE-NUSANTARA!*\n\n` +
                     `🔥 *Free Fire*\n` +
                     `• 70 Diamond   : Rp10.000\n` +
                     `• 140 Diamond  : Rp20.000\n\n` +
                     `⚡ *Mobile Legends*\n` +
                     `• 86 Diamond   : Rp22.000\n` +
                     `• 172 Diamond  : Rp42.000\n` +
                     `• Weekly Pass  : Rp25.000 (unlimited 30 hari)\n\n` +
                     `🎮 *Lainnya*\n` +
                     `• Roblox 400 Robux     : Rp18.000\n` +
                     `• PUBG 60 UC           : Rp16.000\n` +
                     `• Genshin 60 Crystals  : Rp24.000\n\n` +
                     `\nKeterangan lebih lanjut langsung chat:\nwa.me/6289528950624\n\n` +
                     `#TopUpMurah #DiamondMurah #TopUpFF`
        },
        {
            time: '0 18 * * *', // 18:00 sore
            photo: path.join(FOLDER, 'promo_sewa.jpg'),
            caption: `🤖 *SEWA BOT WHATSAPP PREMIUM CUMA 10K/BULAN!*\n\n` +
                     `Fitur gacor:\n` +
                     `• Tagall / Hidetag\n` +
                     `• Downloader (TT, IG, YT)\n` +
                     `• Stiker otomatis\n` +
                     `• Anti link + kick otomatis\n` +
                     `• Play lagu, open/close grup, dll\n\n` +
                     `Bot on 24 jam • Gacor • Zero DC\n` +
                     `Langsung sewa:\nwa.me/6289528950624\n\n` +
                     `#SewaBot #BotWA #BotPremium`
        },
        {
            time: '30 20 * * *', // 20:30 malam (bonus)
            photo: path.join(FOLDER, 'promo_3d.jpg'), // bisa ganti atau random
            caption: `🌙 *MALAM GACOR — PROMO 3D SPESIAL!*\n\n` +
                     `Order 3D malam ini diskon 20rb untuk semua tipe!\n` +
                     `Dikerjakan langsung! Garansi 1 Jam Selesai!\n` +
                     `Langsung chat sebelum kehabisan slot:\nwa.me/6289528950624\n\n` +
                     `#3DMalam #PromoMalam`
        }
    ];

    promos.forEach(p => {
        cron.schedule(p.time, async () => {
            if (!fs.existsSync(p.photo)) {
                console.log(`Foto promo gak ada: ${p.photo}`);
                return;
            }

            try {
                await sock.sendMessage(TARGET, {
                    image: fs.readFileSync(p.photo),
                    caption: p.caption
                });
                console.log(`Promosi terkirim: ${p.time}`);
            } catch (e) {
                console.log('Error kirim promo:', e.message);
            }
        }, { timezone: 'Asia/Jakarta' });
    });

    console.log('Fitur promosi terpisah aktif! (07:30, 12:00, 18:00, 20:30 WIB)');
};