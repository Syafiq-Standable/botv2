// instagram-downloader-v2.js
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Gunakan plugin stealth untuk menghindari deteksi
puppeteer.use(StealthPlugin());

async function downloadInstagram(url) {
    try {
        // Validasi URL
        if (!url.includes('instagram.com')) {
            return { success: false, message: 'URL harus dari Instagram' };
        }

        // Bersihkan URL
        const cleanUrl = url.split('?')[0];
        
        // Coba metode yang berbeda secara berurutan
        const methods = [
            tryPuppeteerMethod,
            tryAlternativeAPIs,
            tryScrapingService,
            tryDirectScrape
        ];

        for (const method of methods) {
            try {
                console.log(`Mencoba metode: ${method.name}`);
                const result = await method(cleanUrl);
                if (result.success) {
                    return result;
                }
            } catch (error) {
                console.log(`Metode ${method.name} gagal:`, error.message);
                continue;
            }
        }

        return {
            success: false,
            message: 'Semua metode gagal. Coba lagi nanti.'
        };

    } catch (error) {
        console.error('Instagram Download Error:', error.message);
        return {
            success: false,
            message: `Error: ${error.message}`
        };
    }
}

// METODE 1: Puppeteer (Paling Reliable)
async function tryPuppeteerMethod(url) {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });

        const page = await browser.newPage();
        
        // Set user agent mobile
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
        
        // Navigasi ke URL
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Tunggu konten muncul
        await page.waitForSelector('video, img[src*="cdninstagram.com"], img[srcset*="cdninstagram.com"]', {
            timeout: 10000
        });

        // Ambil semua media
        const media = await page.evaluate(() => {
            const results = {
                videos: [],
                images: []
            };

            // Cari video
            document.querySelectorAll('video').forEach(video => {
                if (video.src && video.src.includes('cdninstagram.com')) {
                    results.videos.push(video.src);
                }
            });

            // Cari gambar
            document.querySelectorAll('img').forEach(img => {
                const src = img.src || img.getAttribute('srcset')?.split(',')[0]?.split(' ')[0];
                if (src && src.includes('cdninstagram.com')) {
                    results.images.push(src);
                }
            });

            return results;
        });

        await browser.close();

        // Pilih media terbaik
        if (media.videos.length > 0) {
            return {
                success: true,
                url: media.videos[0],
                type: 'video',
                source: 'puppeteer',
                thumbnail: media.images[0] || null
            };
        } else if (media.images.length > 0) {
            return {
                success: true,
                url: media.images[0],
                type: 'image',
                source: 'puppeteer'
            };
        }

        throw new Error('Media tidak ditemukan');
    } catch (error) {
        if (browser) await browser.close();
        throw error;
    }
}

// METODE 2: API Alternatif (Update 2024)
async function tryAlternativeAPIs(url) {
    const apis = [
        {
            name: 'igram',
            url: 'https://igram.io/api/',
            method: 'GET',
            params: { url },
            getLink: (data) => data.media || data.url
        },
        {
            name: 'instasave',
            url: 'https://instasave.website/wp-json/aio-dl/video-data/',
            method: 'POST',
            data: { url },
            headers: {
                'Content-Type': 'application/json'
            },
            getLink: (data) => {
                if (data.medias) {
                    // Ambil kualitas tertinggi
                    const sorted = data.medias.sort((a, b) => {
                        const sizeA = parseInt(a.size) || 0;
                        const sizeB = parseInt(b.size) || 0;
                        return sizeB - sizeA;
                    });
                    return sorted[0].url;
                }
                return null;
            }
        }
    ];

    for (const api of apis) {
        try {
            let response;
            if (api.method === 'POST') {
                response = await axios.post(api.url, api.data, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        ...api.headers
                    },
                    timeout: 10000
                });
            } else {
                response = await axios.get(api.url, {
                    params: api.params,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 10000
                });
            }

            if (response.data) {
                const downloadUrl = api.getLink(response.data);
                if (downloadUrl) {
                    return {
                        success: true,
                        url: downloadUrl,
                        type: downloadUrl.includes('.mp4') ? 'video' : 'image',
                        source: api.name
                    };
                }
            }
        } catch (error) {
            console.log(`API ${api.name} gagal:`, error.message);
            continue;
        }
    }

    throw new Error('Semua API gagal');
}

// METODE 3: Scraping Service
async function tryScrapingService(url) {
    try {
        // Gunakan layanan scraping pihak ketiga
        const response = await axios.get('https://rapidapi.com/community/api/instagram-downloader-download-instagram-videos-stories', {
            params: {
                url: encodeURIComponent(url)
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        const html = response.data;
        const $ = cheerio.load(html);
        
        // Ekstrak link download dari berbagai format
        const downloadLinks = [];
        
        // Cari link video
        $('a[href*=".mp4"], a[href*="video"]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('http')) {
                downloadLinks.push({
                    url: href,
                    type: 'video'
                });
            }
        });

        // Cari link gambar
        $('a[href*=".jpg"], a[href*=".jpeg"], a[href*=".png"], a[href*="photo"]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && href.includes('http')) {
                downloadLinks.push({
                    url: href,
                    type: 'image'
                });
            }
        });

        if (downloadLinks.length > 0) {
            // Pilih video pertama jika ada, jika tidak pilih gambar pertama
            const bestLink = downloadLinks.find(link => link.type === 'video') || downloadLinks[0];
            return {
                success: true,
                url: bestLink.url,
                type: bestLink.type,
                source: 'scraping_service'
            };
        }

        throw new Error('Link tidak ditemukan');
    } catch (error) {
        throw error;
    }
}

// METODE 4: Direct Scrape dengan Regex
async function tryDirectScrape(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive'
            },
            timeout: 10000
        });

        const html = response.data;
        
        // Regex patterns untuk mencari media
        const patterns = [
            /"video_url":"([^"]+)"/,
            /"display_url":"([^"]+)"/,
            /"display_resources":\[[^\]]*"src":"([^"]+)"/,
            /property="og:video" content="([^"]+)"/,
            /property="og:image" content="([^"]+)"/,
            /https:\/\/[^"]*\.cdninstagram\.com\/[^"]*\.(mp4|jpg|jpeg|png)/g
        ];

        for (const pattern of patterns) {
            const matches = html.match(pattern);
            if (matches) {
                let mediaUrl = matches[1] || matches[0];
                
                // Clean URL
                mediaUrl = mediaUrl
                    .replace(/\\u0026/g, '&')
                    .replace(/\\\//g, '/')
                    .replace(/["']/g, '');
                
                const isVideo = mediaUrl.includes('.mp4') || mediaUrl.includes('video');
                
                return {
                    success: true,
                    url: mediaUrl,
                    type: isVideo ? 'video' : 'image',
                    source: 'direct_scrape'
                };
            }
        }

        throw new Error('Media tidak ditemukan');
    } catch (error) {
        throw error;
    }
}

// Fungsi untuk mengatasi private/business account
async function downloadInstagramPrivate(url, cookie = null) {
    // Implementasi khusus untuk akun private
    // Memerlukan cookie login Instagram yang valid
    // Hati-hati dengan legalitas dan ToS Instagram
    
    return {
        success: false,
        message: 'Fitur download private account memerlukan autentikasi khusus'
    };
}

// Export fungsi utama
module.exports = {
    downloadInstagram,
    downloadInstagramPrivate
};