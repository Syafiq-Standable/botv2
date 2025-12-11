// instagram-downloader.js
const axios = require('axios');
const cheerio = require('cheerio');

async function downloadInstagram(url) {
    try {
        if (!url.includes('instagram.com')) {
            return { success: false, message: 'URL harus dari Instagram' };
        }

        // API yang masih aktif (per Desember 2024)
        const apis = [
            {
                name: 'youtube4kdownloader',
                url: 'https://www.youtube4kdownloader.com/api/convert',
                method: 'POST',
                data: { url: url },
                getLink: (data) => data.url || data.downloadUrl
            },
            {
                name: 'snapsave',
                url: 'https://snapsave.app/action.php',
                method: 'POST',
                data: { url: url },
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                getLink: (data) => {
                    if (data.data && data.data.length > 0) {
                        // Ambil kualitas tertinggi
                        const sorted = data.data.sort((a, b) => {
                            const qualityA = parseInt(a.quality) || 0;
                            const qualityB = parseInt(b.quality) || 0;
                            return qualityB - qualityA;
                        });
                        return sorted[0].url;
                    }
                    return null;
                }
            },
            {
                name: 'savefrom',
                url: `https://api.savefrom.net/service/convert`,
                method: 'GET',
                params: {
                    url: url,
                    sf_url: url,
                    sf_datatype: 'JSON'
                },
                getLink: (data) => {
                    if (data.url) return data.url;
                    if (data.urls && data.urls.length > 0) {
                        return data.urls[0].url;
                    }
                    return null;
                }
            },
            {
                name: 'instadownloader',
                url: 'https://instadownloader.co/api/ajaxSearch',
                method: 'POST',
                data: `q=${encodeURIComponent(url)}&t=media&lang=en`,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                getLink: (data) => {
                    if (data.data && data.data.length > 0) {
                        const item = data.data[0];
                        return item.video || item.src;
                    }
                    return null;
                }
            }
        ];

        // Coba semua API satu per satu
        for (const api of apis) {
            try {
                console.log(`Trying API: ${api.name}`);
                
                let response;
                if (api.method === 'POST') {
                    response = await axios.post(api.url, api.data, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'application/json, text/plain, */*',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Origin': 'https://snapsave.app',
                            'Referer': 'https://snapsave.app/',
                            ...api.headers
                        },
                        timeout: 15000
                    });
                } else {
                    response = await axios.get(api.url, {
                        params: api.params,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'application/json, text/plain, */*',
                            ...api.headers
                        },
                        timeout: 15000
                    });
                }

                if (response.data) {
                    const downloadUrl = api.getLink(response.data);
                    if (downloadUrl) {
                        console.log(`Success with API: ${api.name}`);
                        return {
                            success: true,
                            url: downloadUrl,
                            type: 'video',
                            source: api.name
                        };
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000)); // Delay antar request
            } catch (apiError) {
                console.log(`API ${api.name} failed:`, apiError.message);
                continue;
            }
        }

        // Jika semua API gagal, coba metode scraping langsung
        return await scrapeInstagramDirect(url);

    } catch (error) {
        console.error('Instagram Download Error:', error.message);
        return {
            success: false,
            message: `Error: ${error.message}`
        };
    }
}

// Metode scraping langsung dari Instagram
async function scrapeInstagramDirect(url) {
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        };

        const response = await axios.get(url, { headers, timeout: 10000 });
        const html = response.data;
        
        // Cari URL video atau gambar
        const patterns = [
            /"video_url":"([^"]+\.mp4[^"]*)"/,
            /"display_url":"([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/,
            /property="og:video" content="([^"]+)"/,
            /property="og:image" content="([^"]+)"/,
            /src="([^"]+\.mp4[^"]*)" type="video\/mp4"/,
            /src="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/,
            /https:\/\/[^"]*\.cdninstagram\.com[^"]*\.(mp4|jpg|jpeg|png)/g
        ];

        let mediaUrl = null;
        let isVideo = false;

        for (const pattern of patterns) {
            const matches = html.match(pattern);
            if (matches) {
                if (Array.isArray(matches)) {
                    for (const match of matches) {
                        if (match && match.includes('http')) {
                            const url = match.replace(/["']/g, '');
                            if (url.includes('.mp4')) {
                                mediaUrl = url;
                                isVideo = true;
                                break;
                            } else if (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png')) {
                                mediaUrl = url;
                                isVideo = false;
                                break;
                            }
                        }
                    }
                } else if (matches.includes('http')) {
                    mediaUrl = matches.replace(/["']/g, '');
                    isVideo = matches.includes('.mp4');
                }
                if (mediaUrl) break;
            }
        }

        if (mediaUrl) {
            // Clean URL
            mediaUrl = mediaUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
            
            return {
                success: true,
                url: mediaUrl,
                type: isVideo ? 'video' : 'photo',
                source: 'direct_scrape'
            };
        }

        return {
            success: false,
            message: 'Tidak dapat menemukan media'
        };

    } catch (error) {
        return {
            success: false,
            message: `Scraping error: ${error.message}`
        };
    }
}

// API alternatif khusus untuk Indonesia
async function downloadInstagramID(url) {
    try {
        // API Indonesia yang mungkin masih aktif
        const indoAPIs = [
            {
                name: 'instagram downloader id',
                url: 'https://www.instagramdownloaderd.com/api/async',
                method: 'POST',
                data: `url=${encodeURIComponent(url)}`,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                getLink: (data) => {
                    try {
                        const $ = cheerio.load(data);
                        const downloadBtn = $('a.download-btn');
                        if (downloadBtn.length > 0) {
                            return downloadBtn.attr('href');
                        }
                    } catch (e) {
                        return null;
                    }
                    return null;
                }
            },
            {
                name: 'saveig',
                url: 'https://saveig.app/api/ajaxSearch',
                method: 'POST',
                data: `q=${encodeURIComponent(url)}&t=media&lang=en`,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                getLink: (data) => {
                    if (data.data) {
                        const html = data.data;
                        const $ = cheerio.load(html);
                        const downloadLink = $('a.download[href*=".mp4"]').attr('href') || 
                                            $('a[href*="cdninstagram"]').attr('href');
                        return downloadLink;
                    }
                    return null;
                }
            }
        ];

        for (const api of indoAPIs) {
            try {
                console.log(`Trying Indo API: ${api.name}`);
                
                const response = await axios.post(api.url, api.data, {
                    headers: api.headers,
                    timeout: 10000
                });

                const downloadUrl = api.getLink(response.data);
                if (downloadUrl) {
                    return {
                        success: true,
                        url: downloadUrl,
                        type: 'video',
                        source: api.name
                    };
                }
            } catch (error) {
                console.log(`Indo API ${api.name} failed:`, error.message);
                continue;
            }
        }

        return {
            success: false,
            message: 'Semua API Indonesia gagal'
        };

    } catch (error) {
        return {
            success: false,
            message: `API Indonesia error: ${error.message}`
        };
    }
}

// Fungsi utama dengan fallback ke semua metode
async function instagramDownloader(url) {
    console.log(`Starting download for: ${url}`);
    
    // Coba API utama dulu
    const apiResult = await downloadInstagram(url);
    if (apiResult.success) return apiResult;
    
    // Coba API Indonesia
    const indoResult = await downloadInstagramID(url);
    if (indoResult.success) return indoResult;
    
    // Coba scraping langsung
    const scrapeResult = await scrapeInstagramDirect(url);
    if (scrapeResult.success) return scrapeResult;
    
    // Semua gagal
    return {
        success: false,
        message: 'Gagal mendownload dari semua sumber. Coba gunakan link yang berbeda atau coba lagi nanti.'
    };
}

module.exports = instagramDownloader;