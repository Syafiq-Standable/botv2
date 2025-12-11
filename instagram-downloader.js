// instagram-downloader.js
const axios = require('axios');
const cheerio = require('cheerio');
const FormData = require('form-data');

async function downloadInstagram(url) {
    try {
        if (!url.includes('instagram.com')) {
            return { success: false, message: 'URL harus dari Instagram' };
        }

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        };

        const response = await axios.get(url, { headers });
        const html = response.data;
        const $ = cheerio.load(html);
        
        let videoUrl = null;
        let imageUrls = [];
        let isVideo = false;
        let isReels = false;
        let isCarousel = false;
        let caption = '';
        let username = '';

        // Method 1: Cari dari meta tags
        $('meta[property="og:video"]').each((i, elem) => {
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

        // Method 2: Cari dari window._sharedData
        const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});/);
        if (sharedDataMatch) {
            try {
                const sharedData = JSON.parse(sharedDataMatch[1]);
                const postData = sharedData.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;
                
                if (postData) {
                    username = postData.owner?.username || '';
                    caption = postData.edge_media_to_caption?.edges?.[0]?.node?.text || '';
                    
                    if (postData.is_video) {
                        videoUrl = postData.video_url;
                        isVideo = true;
                        if (url.includes('/reel/') || url.includes('/reels/')) {
                            isReels = true;
                        }
                    } else if (postData.__typename === 'GraphSidecar') {
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
                        imageUrls = [postData.display_url];
                    }
                }
            } catch (e) {
                console.error('Error parsing sharedData:', e.message);
            }
        }

        // Method 3: Cari dari additionalData
        const additionalDataMatch = html.match(/window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\);/);
        if (additionalDataMatch && !videoUrl && imageUrls.length === 0) {
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

        // Filter URLs
        imageUrls = imageUrls.filter(url => url && url.includes('instagram'));

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

async function downloadInstagramAPI(url) {
    try {
        // Coba berbagai API publik
        const apis = [
            {
                url: 'https://api.vevioz.com/api/button/mp4',
                method: 'POST',
                data: { url: url }
            },
            {
                url: 'https://api.snaptik.site/video',
                method: 'POST',
                data: { url: url }
            },
            {
                url: `https://api.download-lagump3.com/api/convert?url=${encodeURIComponent(url)}`,
                method: 'GET'
            }
        ];

        for (const api of apis) {
            try {
                let response;
                if (api.method === 'POST') {
                    const formData = new FormData();
                    formData.append('url', url);
                    
                    response = await axios.post(api.url, formData, {
                        headers: {
                            ...formData.getHeaders(),
                            'Accept': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                } else {
                    response = await axios.get(api.url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                }

                if (response.data) {
                    // Parse response berdasarkan API
                    let downloadUrl = null;
                    
                    if (api.url.includes('vevioz')) {
                        if (response.data.url) downloadUrl = response.data.url;
                    } else if (api.url.includes('snaptik')) {
                        if (response.data.data && response.data.data.play) {
                            downloadUrl = response.data.data.play;
                        }
                    } else if (api.url.includes('download-lagump3')) {
                        if (response.data.url) downloadUrl = response.data.url;
                    }

                    if (downloadUrl) {
                        return {
                            success: true,
                            url: downloadUrl,
                            type: 'video',
                            source: 'api'
                        };
                    }
                }
            } catch (apiError) {
                console.log(`API ${api.url} failed:`, apiError.message);
                continue;
            }
        }

        return {
            success: false,
            message: 'Semua API gagal'
        };
        
    } catch (error) {
        return {
            success: false,
            message: `API Error: ${error.message}`
        };
    }
}

// Fungsi utama
async function instagramDownloader(url, useAPI = true) {
    const directResult = await downloadInstagram(url);
    
    if (directResult.success) {
        return directResult;
    }
    
    if (useAPI) {
        const apiResult = await downloadInstagramAPI(url);
        return apiResult;
    }
    
    return directResult;
}

module.exports = instagramDownloader;