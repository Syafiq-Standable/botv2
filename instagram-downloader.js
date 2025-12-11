const axios = require('axios');
const cheerio = require('cheerio');
const FormData = require('form-data');

async function downloadInstagram(url) {
    try {
        // Cek apakah URL valid
        if (!url.includes('instagram.com')) {
            return {
                success: false,
                message: 'URL harus dari Instagram (instagram.com)'
            };
        }

        // Headers untuk request
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        };

        // Ambil halaman Instagram
        const response = await axios.get(url, { headers });
        const html = response.data;
        
        // Parse HTML dengan cheerio
        const $ = cheerio.load(html);
        
        // Cari data JSON di meta tags
        let videoUrl = null;
        let imageUrls = [];
        let isVideo = false;
        let isReels = false;
        let isCarousel = false;
        let caption = '';
        let username = '';
        
        // Method 1: Cari dari meta tags (cocok untuk mobile version)
        $('meta[property="og:video"]').each((i, elem) => {
            const content = $(elem).attr('content');
            if (content && content.includes('.mp4')) {
                videoUrl = content;
                isVideo = true;
            }
        });
        
        $('meta[property="og:video:secure_url"]').each((i, elem) => {
            const content = $(elem).attr('content');
            if (content && content.includes('.mp4')) {
                videoUrl = content;
                isVideo = true;
            }
        });
        
        $('meta[property="og:image"]').each((i, elem) => {
            const content = $(elem).attr('content');
            if (content && !imageUrls.includes(content)) {
                imageUrls.push(content);
            }
        });
        
        // Method 2: Cari dari script tags (cocok untuk desktop version)
        const scriptTags = $('script[type="application/ld+json"]');
        scriptTags.each((i, elem) => {
            try {
                const jsonData = JSON.parse($(elem).html());
                if (jsonData.video) {
                    videoUrl = jsonData.video.contentUrl || jsonData.video.url;
                    isVideo = true;
                }
            } catch (e) {
                // Ignore parse errors
            }
        });
        
        // Method 3: Cari dari window.__additionalDataLoaded atau window._sharedData
        const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});/);
        if (sharedDataMatch) {
            try {
                const sharedData = JSON.parse(sharedDataMatch[1]);
                const postData = sharedData.entry_data?.PostPage?.[0]?.graphql?.shortcode_media ||
                               sharedData.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;
                
                if (postData) {
                    username = postData.owner?.username || '';
                    caption = postData.edge_media_to_caption?.edges?.[0]?.node?.text || '';
                    
                    if (postData.is_video) {
                        // Ini video atau reels
                        videoUrl = postData.video_url;
                        isVideo = true;
                        if (url.includes('/reel/') || url.includes('/reels/')) {
                            isReels = true;
                        }
                    } else if (postData.__typename === 'GraphSidecar') {
                        // Ini carousel (multiple images/videos)
                        isCarousel = true;
                        const edges = postData.edge_sidecar_to_children?.edges || [];
                        edges.forEach(edge => {
                            const node = edge.node;
                            if (node.is_video && node.video_url) {
                                imageUrls.push(node.video_url);
                            } else if (node.display_url) {
                                imageUrls.push(node.display_url);
                            }
                        });
                    } else if (postData.display_url) {
                        // Ini single image
                        imageUrls = [postData.display_url];
                    }
                }
            } catch (e) {
                console.error('Error parsing sharedData:', e.message);
            }
        }
        
        // Method 4: Cari dari additionalData
        const additionalDataMatch = html.match(/window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\);/);
        if (additionalDataMatch) {
            try {
                const additionalData = JSON.parse(additionalDataMatch[1]);
                const graphql = additionalData.graphql;
                if (graphql) {
                    const shortcodeMedia = graphql.shortcode_media;
                    if (shortcodeMedia) {
                        username = shortcodeMedia.owner?.username || '';
                        caption = shortcodeMedia.edge_media_to_caption?.edges?.[0]?.node?.text || '';
                        
                        if (shortcodeMedia.is_video) {
                            videoUrl = shortcodeMedia.video_url;
                            isVideo = true;
                            if (url.includes('/reel/') || url.includes('/reels/')) {
                                isReels = true;
                            }
                        } else if (shortcodeMedia.__typename === 'GraphSidecar') {
                            isCarousel = true;
                            const edges = shortcodeMedia.edge_sidecar_to_children?.edges || [];
                            edges.forEach(edge => {
                                const node = edge.node;
                                if (node.is_video && node.video_url) {
                                    imageUrls.push(node.video_url);
                                } else if (node.display_url) {
                                    imageUrls.push(node.display_url);
                                }
                            });
                        } else if (shortcodeMedia.display_url) {
                            imageUrls = [shortcodeMedia.display_url];
                        }
                    }
                }
            } catch (e) {
                console.error('Error parsing additionalData:', e.message);
            }
        }
        
        // Jika masih tidak dapat data, coba method fallback
        if (!videoUrl && imageUrls.length === 0) {
            // Coba ambil dari meta property alternatif
            $('meta[content*=".mp4"]').each((i, elem) => {
                const content = $(elem).attr('content');
                if (content && !videoUrl) {
                    videoUrl = content;
                    isVideo = true;
                }
            });
            
            // Cari semua URL dalam script tags
            const urlMatches = html.match(/(https?:\/\/[^\s"']+\.(mp4|jpg|jpeg|png|webp))/gi);
            if (urlMatches) {
                urlMatches.forEach(match => {
                    if (match.includes('.mp4') && !videoUrl) {
                        videoUrl = match;
                        isVideo = true;
                    } else if ((match.includes('.jpg') || match.includes('.jpeg') || match.includes('.png') || match.includes('.webp')) && 
                               !imageUrls.includes(match) && 
                               match.includes('cdninstagram')) {
                        imageUrls.push(match);
                    }
                });
            }
        }
        
        // Filter dan clean URLs
        imageUrls = imageUrls.filter(url => url && url.includes('instagram'));
        
        // Jika dapat video URL, return video
        if (videoUrl) {
            return {
                success: true,
                type: isReels ? 'reels' : 'video',
                url: videoUrl,
                thumbnail: imageUrls.length > 0 ? imageUrls[0] : null,
                caption: caption || '',
                username: username || '',
                download_url: videoUrl
            };
        }
        
        // Jika dapat image URLs
        if (imageUrls.length > 0) {
            return {
                success: true,
                type: isCarousel ? 'carousel' : 'photo',
                urls: imageUrls,
                thumbnail: imageUrls[0],
                caption: caption || '',
                username: username || '',
                download_url: imageUrls[0],
                count: imageUrls.length
            };
        }
        
        return {
            success: false,
            message: 'Tidak dapat mengambil media dari URL tersebut'
        };
        
    } catch (error) {
        console.error('Instagram Download Error:', error.message);
        return {
            success: false,
            message: `Error: ${error.message}`
        };
    }
}

// Alternative: Menggunakan API pihak ketiga (lebih reliable)
async function downloadInstagramAPI(url) {
    try {
        const apiEndpoints = [
            'https://api.vevioz.com/api/button/mp4',
            'https://api.vevioz.com/api/button/mp3',
            'https://api.download-lagump3.com/api/convert',
            'https://api.snaptik.site/video'
        ];
        
        // Coba endpoint pertama
        const formData = new FormData();
        formData.append('url', url);
        
        const response = await axios.post('https://api.vevioz.com/api/button/mp4', formData, {
            headers: {
                ...formData.getHeaders(),
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data && response.data.url) {
            return {
                success: true,
                url: response.data.url,
                type: 'video',
                source: 'api'
            };
        }
        
        return {
            success: false,
            message: 'Tidak dapat mendownload melalui API'
        };
        
    } catch (error) {
        return {
            success: false,
            message: `API Error: ${error.message}`
        };
    }
}

// Fungsi utama dengan fallback
async function instagramDownloader(url, useAPI = true) {
    // Coba method direct parsing dulu
    const directResult = await downloadInstagram(url);
    
    if (directResult.success) {
        return directResult;
    }
    
    // Jika direct gagal dan diperbolehkan menggunakan API
    if (useAPI) {
        const apiResult = await downloadInstagramAPI(url);
        return apiResult;
    }
    
    return directResult;
}

module.exports = {
    downloadInstagram,
    downloadInstagramAPI,
    instagramDownloader
};