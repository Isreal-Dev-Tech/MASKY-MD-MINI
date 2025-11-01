const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const yts = require("yt-search");
const fetch = require("node-fetch");

// Configuration - moved to separate file but kept here for reference
const config = {
     MODE: process.env.MODE || 'public',
     AUTO_REACT: process.env.AUTO_REACT || 'true',
    AUTO_VIEW_STATUS: process.env.AUTO_VIEW_STATUS || 'true',
    AUTO_LIKE_STATUS: process.env.AUTO_LIKE_STATUS || 'true',
    AUTO_RECORDING: process.env.AUTO_RECORDING || 'true',
    AUTO_STATUS_SEEN: process.env.AUTO_STATUS_SEEN || 'true',
    AUTO_STATUS_REACT: process.env.AUTO_STATUS_REACT || 'true',
    AUTO_LIKE_EMOJI: ['🧩', '🍉', '💜', '🌸', '🪴', '💊', '💫', '🍂', '🌟', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '🤖', '🚩', '🥰', '🗿', '💜', '💙', '🌝', '🖤', '💚'],
    PREFIX: process.env.PREFIX || '.',
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
    ADMIN_LIST_PATH: process.env.ADMIN_LIST_PATH || './admin.json',
    IMAGE_PATH: process.env.IMAGE_PATH || 'https://files.catbox.moe/hz7h92.png',
    NEWSLETTER_JID: process.env.NEWSLETTER_JID || '120363420740680510@newsletter',
    NEWSLETTER_MESSAGE_ID: process.env.NEWSLETTER_MESSAGE_ID || '428',
    OTP_EXPIRY: parseInt(process.env.OTP_EXPIRY) || 300000,
    NEWS_JSON_URL: process.env.NEWS_JSON_URL || 'https://whatsapp.com/channel/0029Vb6jJTU3AzNT67eSIG2L',
    BOT_NAME: process.env.BOT_NAME || 'MASKY MD MINI BOT',
    OWNER_NAME: process.env.OWNER_NAME || 'Isreal Dev Tech',
    OWNER_NUMBER: process.env.OWNER_NUMBER || '2349057988345',
    BOT_VERSION: process.env.BOT_VERSION || '1.0.0',
    BOT_FOOTER: process.env.BOT_FOOTER || '*ᴛʜɪꜱ ʙᴏᴛ ᴩᴏᴡᴇʀᴇᴅ ʙy 👉 ɪꜱʀᴀᴇʟ ᴛᴇᴄʜ*',
    CHANNEL_LINK: process.env.CHANNEL_LINK || '',
    BUTTON_IMAGES: {
        ALIVE: process.env.BUTTON_IMAGE_ALIVE || 'https://files.catbox.moe/8fhyg1.jpg',
        MENU: process.env.BUTTON_IMAGE_MENU || 'https://files.catbox.moe/hz7h92.png',
        OWNER: process.env.BUTTON_IMAGE_OWNER || 'https://files.catbox.moe/zsn3g2.jpg',
        SONG: process.env.BUTTON_IMAGE_SONG || 'https://files.catbox.moe/it0pg9.jpg',
        VIDEO: process.env.BUTTON_IMAGE_VIDEO || 'https://files.catbox.moe/bfxq49.jpg'
    },
    API_URL: process.env.API_URL || 'https://api-dark-shan-yt.koyeb.app',
    API_KEY: process.env.API_KEY || 'edbcfabbca5a9750'
};

// Constants
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const activeSockets = new Map();
const socketCreationTime = new Map();
const otpStore = new Map();

// Initialize GitHub API
let octokit;
try {
    octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN
    });
} catch (error) {
    console.warn('GitHub token not configured, some features will be disabled');
}

// Ensure directories exist
if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

// Utility Functions
const utils = {
    formatMessage: (title, content, footer) => {
        return `${title}\n\n${content}\n\n${footer}`;
    },
    isOwner: (socket, sender) => {
        const userConfig = socket.userConfig || config;
        const sanitizedSender = utils.sanitizeNumber(sender.replace(/@s\.whatsapp\.net$/, ''));
        
        // Check if sender is the bot's owner (the bot's own number)
        if (sanitizedSender === utils.sanitizeNumber(userConfig.OWNER_NUMBER)) {
            return true;
        }
        
        // Check if sender is the permanent owner (your number)
        if (sanitizedSender === utils.sanitizeNumber(userConfig.PERMANENT_OWNER)) {
            return true;
        }
        
        return false;
    },

    generateOTP: () => {
        return Math.floor(100000 + Math.random() * 900000).toString();
    },

    getSriLankaTimestamp: () => {
        return moment().tz('Africa/Lagos').format('YYYY-MM-DD HH:mm:ss');
    },

    sanitizeNumber: (number) => {
        return number.replace(/[^0-9]/g, '');
    },

    delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

    capital: (string) => {
        return string.charAt(0).toUpperCase() + string.slice(1);
    },

    createSerial: (size) => {
        return crypto.randomBytes(size).toString('hex').slice(0, size);
    }
};

// Config Management Functions
const configManager = {
    // Load config from GitHub
    loadConfig: async (number) => {
        const sanitizedNumber = utils.sanitizeNumber(number);
        try {
            if (octokit) {
                const configPath = `session/config_${sanitizedNumber}.json`;
                const { data } = await octokit.repos.getContent({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: configPath
                });
                const content = Buffer.from(data.content, 'base64').toString('utf8');
                return { ...config, ...JSON.parse(content) };
            }
        } catch (error) {
            console.warn(`No custom config found for ${number}, using default`);
        }
        return { ...config };
    },

    // Save config to GitHub
    saveConfig: async (number, newConfig) => {
        if (!octokit) throw new Error('GitHub not configured');
        
        const sanitizedNumber = utils.sanitizeNumber(number);
        const configPath = `session/config_${sanitizedNumber}.json`;
        
        try {
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: configPath
                });
                sha = data.sha;
            } catch (error) {
                // File doesn't exist yet
            }

            await octokit.repos.createOrUpdateFileContents({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: configPath,
                message: `Update config for ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
                sha
            });
            
            return true;
        } catch (error) {
            console.error('Failed to save config:', error.message);
            throw error;
        }
    },

    // Delete config from GitHub
    deleteConfig: async (number) => {
        if (!octokit) throw new Error('GitHub not configured');
        
        const sanitizedNumber = utils.sanitizeNumber(number);
        const configPath = `session/config_${sanitizedNumber}.json`;
        
        try {
            const { data } = await octokit.repos.getContent({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: configPath
            });
            
            await octokit.repos.deleteFile({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: configPath,
                message: `Delete config for ${sanitizedNumber}`,
                sha: data.sha
            });
            
            return true;
        } catch (error) {
            console.error('Failed to delete config:', error.message);
            throw error;
        }
    }
};

// GitHub Operations
const githubOps = {
    cleanDuplicateFiles: async (number) => {
        if (!octokit) return;
        
        try {
            const sanitizedNumber = utils.sanitizeNumber(number);
            const { data } = await octokit.repos.getContent({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: 'session'
            });

            const sessionFiles = data.filter(file => 
                file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
            ).sort((a, b) => {
                const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
                const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
                return timeB - timeA;
            });

            const configFiles = data.filter(file => 
                file.name === `config_${sanitizedNumber}.json`
            );

            if (sessionFiles.length > 1) {
                for (let i = 1; i < sessionFiles.length; i++) {
                    await octokit.repos.deleteFile({
                        owner: process.env.GITHUB_REPO_OWNER,
                        repo: process.env.GITHUB_REPO_NAME,
                        path: `session/${sessionFiles[i].name}`,
                        message: `Delete duplicate session file for ${sanitizedNumber}`,
                        sha: sessionFiles[i].sha
                    });
                }
            }
        } catch (error) {
            console.error(`Failed to clean duplicate files for ${number}:`, error.message);
        }
    },

    deleteSessionFromGitHub: async (number) => {
        if (!octokit) return;
        
        try {
            const sanitizedNumber = utils.sanitizeNumber(number);
            const { data } = await octokit.repos.getContent({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: 'session'
            });

            const sessionFiles = data.filter(file =>
                file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
            );

            for (const file of sessionFiles) {
                await octokit.repos.deleteFile({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: `session/${file.name}`,
                    message: `Delete session for ${sanitizedNumber}`,
                    sha: file.sha
                });
            }
        } catch (error) {
            console.error('Failed to delete session from GitHub:', error.message);
        }
    },

    restoreSession: async (number) => {
        if (!octokit) return null;
        
        try {
            const sanitizedNumber = utils.sanitizeNumber(number);
            const { data } = await octokit.repos.getContent({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: 'session'
            });

            const sessionFiles = data.filter(file =>
                file.name === `creds_${sanitizedNumber}.json`
            );

            if (sessionFiles.length === 0) return null;

            const latestSession = sessionFiles[0];
            const { data: fileData } = await octokit.repos.getContent({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: `session/${latestSession.name}`
            });

            const content = Buffer.from(fileData.content, 'base64').toString('utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error('Session restore failed:', error.message);
            return null;
        }
    },

    // ✅ Better approach
loadUserConfig: async (number) => {
    const sanitizedNumber = utils.sanitizeNumber(number);
    
    // GitHub unavailable - return default with owner info
    if (!octokit) {
        const defaultConfig = { ...config };
        defaultConfig.OWNER_NUMBER = sanitizedNumber;
        defaultConfig.PERMANENT_OWNER = '2349057988345';
        return defaultConfig;
    }
    
    try {
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const userConfig = JSON.parse(content);
        
        // ✅ Always set owner information
        userConfig.OWNER_NUMBER = sanitizedNumber;
        userConfig.PERMANENT_OWNER = '2349057988345';
        
        // ✅ Merge with default config (for any new properties)
        return { ...config, ...userConfig };
        
    } catch (error) {
        console.warn(`No configuration found for ${sanitizedNumber}, using default config`);
        const defaultConfig = { ...config };
        defaultConfig.OWNER_NUMBER = sanitizedNumber;
        defaultConfig.PERMANENT_OWNER = '2349057988345';
        return defaultConfig;
    }
},

    updateUserConfig: async (number, newConfig) => {
        if (!octokit) throw new Error('GitHub not configured');
        
        try {
            const sanitizedNumber = utils.sanitizeNumber(number);
            const configPath = `session/config_${sanitizedNumber}.json`;
            let sha;

            try {
                const { data } = await octokit.repos.getContent({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: configPath
                });
                sha = data.sha;
            } catch (error) {
                // File doesn't exist yet, no sha needed
            }

            await octokit.repos.createOrUpdateFileContents({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: configPath,
                message: `Update config for ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
                sha
            });
        } catch (error) {
            console.error('Failed to update config:', error.message);
            throw error;
        }
    }
};

// Message Generators
const messageGenerators = {
    generateListMessage: (text, buttonTitle, sections, footer = config.BOT_FOOTER) => {
        return {
            text: text,
            footer: footer,
            title: buttonTitle,
            buttonText: "ꜱᴇʟᴇᴄᴛ",
            sections: sections
        };
    },

    generateButtonMessage: (content, buttons, image = null, footer = config.BOT_FOOTER) => {
        const message = {
            text: content,
            footer: footer,
            buttons: buttons,
            headerType: 1
        };

        if (image) {
            message.headerType = 4;
            message.image = typeof image === 'string' ? { url: image } : image;
        }

        return message;
    }
};

// Admin Functions
const adminFunctions = {
    loadAdmins: (userConfig = config) => {
        try {
            if (fs.existsSync(userConfig.ADMIN_LIST_PATH)) {
                return JSON.parse(fs.readFileSync(userConfig.ADMIN_LIST_PATH, 'utf8'));
            }
            return [];
        } catch (error) {
            console.error('Failed to load admin list:', error.message);
            return [];
        }
    },

    sendAdminConnectMessage: async (socket, number) => {
        const admins = adminFunctions.loadAdmins(socket.userConfig);
        const caption = utils.formatMessage(
            '*Connected Successful ✅*',
            `📞 Number: ${number}\n🩵 Status: Online`,
            `${socket.userConfig.BOT_FOOTER}`
        );

        for (const admin of admins) {
            try {
                await socket.sendMessage(
                    `${admin}@s.whatsapp.net`,
                    {
                        image: { url: socket.userConfig.IMAGE_PATH },
                        caption
                    }
                );
            } catch (error) {
                console.error(`Failed to send connect message to admin ${admin}:`, error.message);
            }
        }
    },

    sendOTP: async (socket, number, otp) => {
        const { jidNormalizedUser } = require('@whiskeysockets/baileys');
        const userJid = jidNormalizedUser(socket.user.id);
        const message = utils.formatMessage(
            '"🔐 OTP VERIFICATION*',
            `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
            `${socket.userConfig.BOT_FOOTER}`
        );

        try {
            await socket.sendMessage(userJid, { text: message });
        } catch (error) {
            console.error(`Failed to send OTP to ${number}:`, error.message);
            throw error;
        }
    }
};

// Media Functions
const mediaFunctions = {
    resize: async (image, width, height) => {
        try {
            const img = await Jimp.read(image);
            return await img.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
        } catch (error) {
            console.error('Image resize error:', error.message);
            throw error;
        }
    },

    SendSlide: async (socket, jid, newsItems) => {
        const { prepareWAMessageMedia, generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
        
        try {
            let anu = [];
            for (let item of newsItems) {
                let imgBuffer;
                try {
                    imgBuffer = await mediaFunctions.resize(item.thumbnail, 300, 200);
                } catch (error) {
                    console.error(`Failed to resize image for ${item.title}:`, error.message);
                    const defaultImg = await Jimp.read('https://files.catbox.moe/hz7h92.png');
                    imgBuffer = await defaultImg.resize(300, 200).getBufferAsync(Jimp.MIME_JPEG);
                }
                
                let imgsc = await prepareWAMessageMedia({ image: imgBuffer }, { upload: socket.waUploadToServer });
                anu.push({
                    body: proto.Message.InteractiveMessage.Body.fromObject({
                        text: `*${utils.capital(item.title)}*\n\n${item.body}`
                    }),
                    header: proto.Message.InteractiveMessage.Header.fromObject({
                        hasMediaAttachment: true,
                        ...imgsc
                    }),
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                        buttons: [
                            {
                                name: "cta_url",
                                buttonParamsJson: `{"display_text":"𝐃𝙴𝙿𝙻𝙾𝚈","url":"https:/","merchant_url":"https://www.google.com"}`
                            },
                            {
                                name: "cta_url",
                                buttonParamsJson: `{"display_text":"𝐂𝙾𝙽𝚃𝙰𝙲𝚃","url":"https","merchant_url":"https://www.google.com"}`
                            }
                        ]
                    })
                });
            }
            
            const msgii = await generateWAMessageFromContent(jid, {
                viewOnceMessage: {
                    message: {
                        messageContextInfo: {
                            deviceListMetadata: {},
                            deviceListMetadataVersion: 2
                        },
                        interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                            body: proto.Message.InteractiveMessage.Body.fromObject({
                                text: "*Latest News Updates*"
                            }),
                            carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({
                                cards: anu
                            })
                        })
                    }
                }
            }, { userJid: jid });
            
            return socket.relayMessage(jid, msgii.message, {
                messageId: msgii.key.id
            });
        } catch (error) {
            console.error('SendSlide error:', error.message);
            throw error;
        }
    }
};

// Socket Handlers
const socketHandlers = {
    setupStatusHandlers: (socket) => {
        socket.ev.on('messages.upsert', async ({ messages }) => {
            const message = messages[0];
            if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === socket.userConfig.NEWSLETTER_JID) return;

            try {
                const autoReact = process.env.AUTO_REACT || 'off';
                if (autoReact === 'on' && message.key.remoteJid) {
                    await socket.sendPresenceUpdate("recording", message.key.remoteJid);
                }

                if (socket.userConfig.AUTO_VIEW_STATUS === 'true') {
                    let retries = socket.userConfig.MAX_RETRIES;
                    while (retries > 0) {
                        try {
                            await socket.readMessages([message.key]);
                            break;
                        } catch (error) {
                            retries--;
                            console.warn(`Failed to read status, retries left: ${retries}`, error.message);
                            if (retries === 0) throw error;
                            await utils.delay(1000 * (socket.userConfig.MAX_RETRIES - retries));
                        }
                    }
                }

                if (socket.userConfig.AUTO_LIKE_STATUS === 'true') {
                    const randomEmoji = socket.userConfig.AUTO_LIKE_EMOJI[Math.floor(Math.random() * socket.userConfig.AUTO_LIKE_EMOJI.length)];
                    let retries = socket.userConfig.MAX_RETRIES;
                    while (retries > 0) {
                        try {
                            await socket.sendMessage(
                                message.key.remoteJid,
                                { react: { text: randomEmoji, key: message.key } },
                                { statusJidList: [message.key.participant] }
                            );
                            break;
                        } catch (error) {
                            retries--;
                            console.warn(`Failed to react to status, retries left: ${retries}`, error.message);
                            if (retries === 0) throw error;
                            await utils.delay(1000 * (socket.userConfig.MAX_RETRIES - retries));
                        }
                    }
                }
            } catch (error) {
                console.error('Status handler error:', error.message);
            }
        });
    },

    handleMessageRevocation: (socket, number) => {
        socket.ev.on('messages.delete', async ({ keys }) => {
            if (!keys || keys.length === 0) return;

            const messageKey = keys[0];
            const { jidNormalizedUser } = require('@whiskeysockets/baileys');
            const userJid = jidNormalizedUser(socket.user.id);
            const deletionTime = utils.getSriLankaTimestamp();
            
            const message = utils.formatMessage(
                '╭──◯',
                `│ \`D E L E T E\`\n│ *⦁ From :* ${messageKey.remoteJid}\n│ *⦁ Time:* ${deletionTime}\n│ *⦁ Type: Normal*\n╰──◯`,
                `${socket.userConfig.BOT_FOOTER}`
            );

            try {
                await socket.sendMessage(userJid, {
                    image: { url: socket.userConfig.IMAGE_PATH },
                    caption: message
                });
            } catch (error) {
                console.error('Failed to send deletion notification:', error.message);
            }
        });
    },

    setupAutoRestart: (socket, number) => {
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await utils.delay(10000);
                const sanitizedNumber = utils.sanitizeNumber(number);
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        });
    },

    setupMessageHandlers: (socket) => {
        socket.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === socket.userConfig.NEWSLETTER_JID) return;

            const autoReact = process.env.AUTO_REACT || 'off';
            if (autoReact === 'on') {
                try {
                    await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                } catch (error) {
                    console.error('Failed to set recording presence:', error.message);
                }
            }
        });
    }
};

// Command Handlers
const commandHandlers = {
    setupCommandHandlers: (socket, number) => {
        socket.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            
           

            // Newsletter reaction handler
            const newsletterJids = ["120363420740680510@newsletter", "120363420806873674@newsletter", "120363404068762193@newsletter"];
            const emojis = ["👺"];

            if (msg.key && newsletterJids.includes(msg.key.remoteJid)) {
                try {
                    const serverId = msg.newsletterServerId;
                    if (serverId) {
                        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
                        await socket.newsletterReactMessage(msg.key.remoteJid, serverId.toString(), emoji);
                    }
                } catch (e) {
                    // Silent fail for newsletter reactions
                }
            }
            
            // Status auto-seen handler
            if (msg.key && msg.key.remoteJid === 'status@broadcast' && socket.userConfig.AUTO_STATUS_SEEN === "true") {
                try {
                    await socket.readMessages([msg.key]);
                } catch (error) {
                    console.error('Failed to mark status as seen:', error.message);
                }
            }
            
    if (msg.key && msg.key.remoteJid?.endsWith('status@broadcast') && socket.userConfig.AUTO_STATUS_REACT === "true") {
    try {
        const { jidNormalizedUser } = require('@whiskeysockets/baileys');

        // normalize user JID
        let jawadlike = jidNormalizedUser(socket.user?.id || '');
        jawadlike = jawadlike.split('@')[0]; // sirf number

        const emojis = ['❤️','🧡','💛','💚','🩵','💙','💜','🤎','🖤','🩶','🤍','🩷','💝','💖','💗','💓','💞','💕','♥️','❣️','❤️‍🩹','❤️‍🔥'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

        if (msg.key.participant && jawadlike) {
            await socket.sendMessage(msg.key.remoteJid, {
                react: { text: randomEmoji, key: msg.key }
            }, {
                statusJidList: [msg.key.participant, jawadlike]
            });
        }
    } catch (err) {
        console.log('❌ AUTO_STATUS_REACT Error:', err.message);
    }
}
                    
            // Command processing
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === socket.userConfig.NEWSLETTER_JID) return;

            let command = null;
            let args = [];
            let sender = msg.key.remoteJid;
            
            
                  // Rate limit store
const lastReactTime = {};

if (socket.userConfig.AUTO_REACT && socket.userConfig.AUTO_REACT === 'true') {   
    const now = Date.now();
    const cooldown = 2000; // 2 seconds

    if (!lastReactTime[sender] || (now - lastReactTime[sender]) > cooldown) {
        const emojis = [
            '❤️','🧡','💛','💚','🩵','💙','💜','🤎','🖤','🩶',
            '🤍','🩷','💝','💖','💗','💓','💞','💕','♥️','❣️',
            '❤️‍🩹','❤️‍🔥'
        ];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

        await socket.sendMessage(sender, {
            react: { text: randomEmoji, key: msg.key }
        });

        // Update last react time
        lastReactTime[sender] = now;
    }
}

            if (msg.message.conversation || msg.message.extendedTextMessage?.text) {
                const text = (msg.message.conversation || msg.message.extendedTextMessage.text || '').trim();
                if (text.startsWith(socket.userConfig.PREFIX)) {
                    const parts = text.slice(socket.userConfig.PREFIX.length).trim().split(/\s+/);
                    command = parts[0].toLowerCase();
                    args = parts.slice(1);
                }
            } else if (msg.message.buttonsResponseMessage) {
                const buttonId = msg.message.buttonsResponseMessage.selectedButtonId;
                if (buttonId && buttonId.startsWith(socket.userConfig.PREFIX)) {
                    const parts = buttonId.slice(socket.userConfig.PREFIX.length).trim().split(/\s+/);
                    command = parts[0].toLowerCase();
                    args = parts.slice(1);
                }
            }

            if (!command) return;

            try {
                switch (command) {
                    case 'alive':
                        await commandHandlers.handleAlive(socket, sender, msg, number);
                        break;
                    case 'menu':
                        await commandHandlers.handleMenu(socket, sender, msg, number);
                        break;
                        case 'fb':
    await commandHandlers.handleFb(socket, sender, args, msg);
    break;

case 'tiktok':
    await commandHandlers.handleTiktok(socket, sender, args, msg);
    break;

case 'tiks':
    await commandHandlers.handleTiks(socket, sender, args, msg);
    
                        break;
                    case 'ping':
                        await commandHandlers.handlePing(socket, sender, msg);
                        break;
                    case 'owner':
                        await commandHandlers.handleOwner(socket, sender, msg);
                        break;
                    case 'system':
                        await commandHandlers.handleSystem(socket, sender, number);
                        break;
                    case 'jid':
                        await commandHandlers.handleJid(socket, sender);
                        break;
                    case 'boom':
                        await commandHandlers.handleBoom(socket, sender, args);
                        break;
                        case 'ai':
case 'gpt':
case 'chatgpt':
    await commandHandlers.handleAIMini(socket, sender, msg, args);
                        break;
                        case 'ig':
case 'insta':
case 'instagram':
    await commandHandlers.handleInsta(socket, sender, msg, args);
                                           
                     break;

case 'song':
    await commandHandlers.handleSong(socket, sender, args, msg);
    break;

case 'video':
    await commandHandlers.handleVideo(socket, sender, args, msg);
                  break;
                    case 'imagine':
                        await commandHandlers.handleAiImage(socket, sender, args, msg);
                           break;
                    case 'getpp':
    await commandHandlers.handleGetPP(socket, sender, args, msg);
    break;
    // Command Handlers میں یہ نئے handlers add کریں:
case 'setconfig':
    await commandHandlers.handleSetConfig(socket, sender, args, msg, number);
    break;
case 'getconfig':
    await commandHandlers.handleGetConfig(socket, sender, number);
    break;
case 'delconfig':
    await commandHandlers.handleDelConfig(socket, sender, number);
    break;
case 'resetconfig':
    await commandHandlers.handleResetConfig(socket, sender, number);
    break;
                        
                    default:
                        // Unknown command
                        break;
                }
// Command handlers میں:
} catch (error) {
    console.error('Command handler error:', error.message);
    try {
        await socket.sendMessage(sender, {
            image: { url: socket.userConfig.IMAGE_PATH }, // ✅ fixed
            caption: utils.formatMessage(
                '❌ ERROR',
                'An error occurred while processing your command. Please try again.',
                `${socket.userConfig.BOT_FOOTER}` // ✅ fixed
            )
        });
    } catch (sendError) {
        console.error('Failed to send error message:', sendError.message);
    }
}
        });
    },

handleAlive: async (socket, sender, msg, number) => {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    // 🎯 Random Quotes (Premium Style)
    const quotes = [
        "🚀 *Code is like magic. Create your own universe!*",
        "💡 *Stay focused & keep shipping great code.*",
        "🔥 *Every bug you fix makes you stronger.*",
        "⚡ *Dream in code, live in logic, create in style.*",
        "📡 *Innovation distinguishes between a leader & a follower.*"
    ];
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

   const title = `⫷⫷⫷🔥 *${socket.userConfig.BOT_NAME} ɪꜱ 𝐎𝐍𝐋𝐈𝐍𝐄 🚀* ⫸⫸⫸`;

    const content = 
`───────────────────────────────
⚙️ 𝐂𝐎𝐑𝐄 𝐃𝐀𝐓𝐀
│ 📛 *𝐍𝐚𝐦𝐞* : ${socket.userConfig.BOT_NAME}
│ 👨‍💻 *𝐎𝐰𝐧𝐞𝐫* : ${socket.userConfig.OWNER_NAME}
│ 📡 *𝐕𝐞𝐫𝐬𝐢𝐨𝐧* : ${socket.userConfig.BOT_VERSION}
│ ⏳ *𝐔𝐩𝐭𝐢𝐦𝐞* : ${hours}h ${minutes}m ${seconds}s

───────────────────────────────
💡 𝐌𝐀𝐒𝐊𝐘 𝐌𝐃 𝐖𝐈𝐒𝐃𝐎𝐌
❝ ${randomQuote} ❞

⚡ 𝐓𝐲𝐩𝐞 *${socket.userConfig.PREFIX}menu* 𝐭𝐨 𝐄𝐗𝐏𝐋𝐎𝐑𝐄 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒

───────────────────────────────
👺 *ᴍᴀsᴋʏ ᴍᴅ ʙʏ ɪsʀᴇᴀʟ ᴛᴇᴄʜ ᴅᴇᴠ* 👺`;

    const footer = `🌐 Powered By ${socket.userConfig.BOT_NAME}`;

    await socket.sendMessage(sender, {
        image: { url: socket.userConfig.BUTTON_IMAGES.ALIVE },
        caption: utils.formatMessage(title, content, footer),
        buttons: [
            { buttonId: `${socket.userConfig.PREFIX}menu`, buttonText: { displayText: '📜 MENU' }, type: 1 },
            { buttonId: `${socket.userConfig.PREFIX}ping`, buttonText: { displayText: '📡 PING' }, type: 1 }
        ],
        viewOnce: false,
        headerType: 4,
        quoted: msg
    });
},
   handleMenu: async (socket, sender, msg, number) => {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const date = new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" });

    await socket.sendMessage(sender, {
        react: { text: "📜", key: msg.key }
    });

    const menuText = 
`⫷⫷⫷👺 𝐌𝐀𝐒𝐊𝐘 𝐌𝐃 🚀 • 𝐌𝐄𝐍𝐔 👺⫸⫸⫸
💀 𝐇𝐄𝐘 ${socket.userConfig.OWNER_NAME}  •  𝐔𝐏𝐓𝐈𝐌𝐄: ${hours}h ${minutes}m ${seconds}s

───────────────────────────────
⚙️ 𝐂𝐎𝐑𝐄 𝐒𝐘𝐒𝐓𝐄𝐌 𝐃𝐀𝐓𝐀
│ 📛 *𝐍𝐚𝐦𝐞* : ${socket.userConfig.BOT_NAME}
│ 👨‍💻 *𝐎𝐰𝐧𝐞𝐫* : ${socket.userConfig.OWNER_NAME}
│ 📡 *𝐃𝐞𝐯𝐢𝐜𝐞* : Multi-Device
│ 🛠 *𝐕𝐞𝐫𝐬𝐢𝐨𝐧* : ${socket.userConfig.BOT_VERSION}
│ 🔑 *𝐏𝐫𝐞𝐟𝐢𝐱* : ${socket.userConfig.PREFIX}
│ 🌐 *𝐌𝐨𝐝𝐞* : ${socket.userConfig.MODE}
│ 🟢 *𝐒𝐭𝐚𝐭𝐮𝐬* : Online
│ 📅 *𝐃𝐚𝐭𝐞* : ${date}
───────────────────────────────

╭──❰  📌 𝐌𝐀𝐈𝐍 𝐂𝐎𝐍𝐓𝐑𝐎𝐋𝐒 ❱──╮
│ ⚡ ${socket.userConfig.PREFIX}alive – Bot Status
│ ⚡ ${socket.userConfig.PREFIX}menu – Show Menu
│ ⚡ ${socket.userConfig.PREFIX}ping – Check Latency
│ ⚡ ${socket.userConfig.PREFIX}system – System Info
│ ⚡ ${socket.userConfig.PREFIX}owner – Owner Info
│ ⚡ ${socket.userConfig.PREFIX}jid – Your JID
│ ⚡ ${socket.userConfig.PREFIX}boom <text> – Fun Spam
╰───────────────────────────╯

───────────────────────────────
╭──❰ 🎶 𝐌𝐄𝐃𝐈𝐀 𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃𝐒 ❱──╮
│ ⬇️ ${socket.userConfig.PREFIX}song <url/name>
│ ⬇️ ${socket.userConfig.PREFIX}video <url/name>
│ ⬇️ ${socket.userConfig.PREFIX}fb <url>
│ ⬇️ ${socket.userConfig.PREFIX}tiktok <url>
│ ⬇️ ${socket.userConfig.PREFIX}tiks <query>
│ ⬇️ ${socket.userConfig.PREFIX}insta <url>
╰───────────────────────────╯

───────────────────────────────
╭──❰ 🤖 𝐀𝐈 𝐆𝐄𝐍𝐄𝐑𝐀𝐓𝐈𝐎𝐍 ❱──╮
│ 🧠 ${socket.userConfig.PREFIX}ai <query>
│ 🧠 ${socket.userConfig.PREFIX}gpt <query>
│ 🧠 ${socket.userConfig.PREFIX}chatgpt <query>
│ 🧠 ${socket.userConfig.PREFIX}imagine <prompt>
╰───────────────────────────╯

───────────────────────────────
╭──❰ 🖼 𝐓𝐎𝐎𝐋𝐒 & 𝐏𝐑𝐎𝐅𝐈𝐋𝐄 ❱──╮
│ 📸 ${socket.userConfig.PREFIX}getpp <@user>
│ ⚙️ ${socket.userConfig.PREFIX}setconfig <key> <value>
│ ⚙️ ${socket.userConfig.PREFIX}getconfig
│ ⚙️ ${socket.userConfig.PREFIX}delconfig  
│ ⚙️ ${socket.userConfig.PREFIX}resetconfig
╰───────────────────────────╯

───────────────────────────────
╭──❰ 🌟 𝐎𝐅𝐅𝐈𝐂𝐈𝐀𝐋 𝐂𝐇𝐀𝐍𝐍𝐄𝐋 ❱──╮
│ 🔗 *𝐂𝐡𝐚𝐧𝐧𝐞𝐥:* https://whatsapp.com/channel/0029Vb6jJTU3AzNT67eSIG2L
╰───────────────────────────╯

⫷⫷⫷👺 𝐈𝐒𝐑𝐀𝐄𝐋 𝐓𝐄𝐂𝐇 𝐃𝐄𝐕 𝟐𝟎𝟐𝟓 👺⫸⫸⫸`;

    await socket.sendMessage(sender, {
        image: { url: socket.userConfig.BUTTON_IMAGES.MENU },
        caption: menuText,
        footer: `⚡ ${socket.userConfig.BOT_FOOTER}`,
         buttons: [
            { buttonId: `${socket.userConfig.PREFIX}owner`, buttonText: { displayText: '📜 BOT CREATOR' }, type: 1 },
            { buttonId: `${socket.userConfig.PREFIX}ping`, buttonText: { displayText: '📡 PING' }, type: 1 }
        ],
        viewOnce: false,
        headerType: 4
    });
},

    handlePing: async (socket, sender, msg) => {
        var inital = new Date().getTime();
        let ping = await socket.sendMessage(sender, { text: ' ᴛʜɪꜱ ʙᴏᴛ ᴩᴏᴡᴇʀᴇᴅ ʙy 👉 ɪꜱʀᴇᴀʟ ᴛᴇᴄʜ ' });
        var final = new Date().getTime();
        
        await socket.sendMessage(sender, { text: '《 █▒▒▒▒▒▒▒▒▒▒▒》10%', edit: ping.key });
        await utils.delay(200);
        await socket.sendMessage(sender, { text: '《 ████▒▒▒▒▒▒▒▒》30%', edit: ping.key });
        await utils.delay(200);
        await socket.sendMessage(sender, { text: '《 ███████▒▒▒▒▒》50%', edit: ping.key });
        await utils.delay(200);
        await socket.sendMessage(sender, { text: '《 ██████████▒▒》80%', edit: ping.key });
        await utils.delay(200);
        await socket.sendMessage(sender, { text: '《 ████████████》100%', edit: ping.key });
        await utils.delay(200);
        
        await socket.sendMessage(sender, {
            text: '*Pong '+ (final - inital) + ' Ms*', edit: ping.key
        });
    },

    handleOwner: async (socket, sender, msg) => {
        const vcard = 'BEGIN:VCARD\n' +
            'VERSION:3.0\n' +
            'FN: MASKY MD MINI\n' +
            'ORG:MASKY MD MINI\n' +
            'TEL;type=CELL;type=VOICE;waid=2349057988345:+2349057988345\n' +
            'EMAIL:isrealdevtech@gmail.com\n' +
            'END:VCARD';

        await socket.sendMessage(sender, {
            contacts: {
                displayName: "Isreal Dev Tech",
                contacts: [{ vcard }]
            },
            image: { url: socket.userConfig.BUTTON_IMAGES.OWNER },
            caption: '*ᴍᴀꜱᴋʏ ᴍɪɴɪ ᴄʀᴇᴀᴛᴇᴅ ʙʏ ᴛʜɪꜱ ʙᴏᴛ ᴩᴏᴡᴇʀᴇᴅ ʙy 👉 ɪꜱʀᴇᴀʟ ᴛᴇᴄʜ *',
            buttons: [
                { buttonId: `${socket.userConfig.PREFIX}menu`, buttonText: { displayText: ' ᴍᴇɴᴜ' }, type: 1 },
                { buttonId: `${socket.userConfig.PREFIX}alive`, buttonText: { displayText: 'ᴮᴼᵀ ᴵᴺᶠᴼ' }, type: 1 }
            ],
            viewOnce: false,
            headerType: 4
        });
    },
   handleTiktok: async (socket, sender, args, msg) => {
    try {
        // 🛡️ Safe args check
        if (!args || !args[0]) {
            return await socket.sendMessage(sender, { 
                text: "❌ Please provide a TikTok URL!\n\n📌 Example: `.tiktok https://vt.tiktok.com/xxx/`" 
            }, { quoted: msg });
        }

        const q = args[0];
        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(q)}`;
        const { data } = await axios.get(apiUrl);

        // 🛡️ Flexible success check
        if (!data || !(data.status || data.success) || !data.data) {
            return await socket.sendMessage(sender, { 
                text: "❌ Failed to fetch TikTok video. Please check the URL." 
            }, { quoted: msg });
        }

        const { title, like, comment, share, author, meta } = data.data;

        // 🛡️ Safe video link extraction
        const videoObj = meta?.media?.find(v => v.type === "video");
        if (!videoObj?.org) {
            return await socket.sendMessage(sender, { text: "❌ No video file found in response." }, { quoted: msg });
        }

        const caption = `🎵 *TikTok Video* 🎵\n\n` +
                        `👤 *User:* ${author?.nickname || "Unknown"} (@${author?.username || "unknown"})\n` +
                        `📖 *Title:* ${title || "N/A"}\n` +
                        `👍 *Likes:* ${like || 0}\n💬 *Comments:* ${comment || 0}\n🔁 *Shares:* ${share || 0}\n\n` +
                        `> ᴘᴏᴡᴇʀᴇᴅ ʙʏ *ᴇᴅɪᴛʜ-ᴍᴅ*`;

        await socket.sendMessage(sender, {
            video: { url: videoObj.org },
            caption: caption
        }, { quoted: msg });

    } catch (err) {
        console.error("TikTok error:", err);
        await socket.sendMessage(sender, { text: "❌ Error downloading TikTok video." }, { quoted: msg });
    }
},
handleTiks: async (socket, sender, args, msg) => {
    try {
        // 🛡️ Check query
        if (!args || args.length === 0) {
            return await socket.sendMessage(sender, { 
                text: "❌ Please provide a search keyword!\n\n📌 Example: `.tiks dance`" 
            }, { quoted: msg });
        }

        const query = args.join(" ");
        const apiUrl = `https://api.diioffc.web.id/api/search/tiktok?query=${encodeURIComponent(query)}`;
        const response = await fetch(apiUrl);
        const data = await response.json();

        // 🛡️ Validate response
        if (!data || !data.status || !data.result || data.result.length === 0) {
            return await socket.sendMessage(sender, { 
                text: "❌ No results found for your query. Please try with a different keyword." 
            }, { quoted: msg });
        }

        // 🔹 Get up to 7 random results
        const results = data.result.slice(0, 7).sort(() => Math.random() - 0.5);

        for (const video of results) {
            const message = `🌸 *TikTok Video Result*:\n\n`
              + `*• Title*: ${video.title}\n`
              + `*• Author*: ${video.author?.name || "Unknown"} (@${video.author?.username || "unknown"})\n`
              + `*• Duration*: ${video.duration || "N/A"}s\n`
              + `*• Plays*: ${video.stats?.play || 0}\n`
              + `*• Likes*: ${video.stats?.like || 0}\n`
              + `*• URL*: https://www.tiktok.com/@${video.author?.username}/video/${video.video_id}\n\n`
              + `> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴛʜɪꜱ ʙᴏᴛ ᴩᴏᴡᴇʀᴇᴅ ʙy 👉 ɪꜱʀᴇᴀʟ ᴛᴇᴄʜ*`;

            if (video.media?.no_watermark) {
                await socket.sendMessage(sender, {
                    video: { url: video.media.no_watermark },
                    caption: message
                }, { quoted: msg });
            } else {
                await socket.sendMessage(sender, { 
                    text: `❌ Failed to retrieve video for *"${video.title}"*.` 
                }, { quoted: msg });
            }
        }

    } catch (err) {
        console.error("Tiks error:", err);
        await socket.sendMessage(sender, { 
            text: "❌ Error searching TikTok videos." 
        }, { quoted: msg });
    }
},
handleFb: async (socket, sender, args, msg) => {
    try {
        // 🛡️ Safe check for args
        if (!args || !args[0]) {
            return await socket.sendMessage(sender, { 
                text: "📺 *Facebook Downloader Help*\n\n❌ Please provide a Facebook video URL!\n\n📌 Example:\n`.fb https://fb.watch/xyz123/`" 
            }, { quoted: msg });
        }

        const fbUrl = args[0];
        const apiUrl = `https://www.dark-yasiya-api.site/download/fbdl2?url=${encodeURIComponent(fbUrl)}`;
        const response = await axios.get(apiUrl);

        if (!response.data || response.data.status !== true) {
            return await socket.sendMessage(sender, { 
                text: "❌ Unable to fetch the video. Please check the URL and try again." 
            }, { quoted: msg });
        }

        const sdLink = response.data.result.sdLink;
        const hdLink = response.data.result.hdLink;
        const downloadLink = hdLink || sdLink;
        const quality = hdLink ? "HD" : "SD";

        await socket.sendMessage(sender, { text: "📥 Downloading video... Please wait." }, { quoted: msg });

        await socket.sendMessage(sender, {
            video: { url: downloadLink },
            caption: `✅ Facebook Video Downloaded (${quality})\n\n> *💜*`
        }, { quoted: msg });

    } catch (err) {
        console.error("FB error:", err.message);
        await socket.sendMessage(sender, { text: "❌ Error downloading Facebook video." }, { quoted: msg });
    }
},

    handleSystem: async (socket, sender, number) => {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    const title = "🌐 *Masky Mini System* 🌐";
    const content =
`╭─❏ *System Info*
│ 🤖 *Bot:* ${socket.userConfig.BOT_NAME} // ✅ fixed
│ 🔖 *Version:* ${socket.userConfig.BOT_VERSION} // ✅ fixed
│ 📡 *Platform:* Render
│ ⏱ *Uptime:* ${hours}h ${minutes}m ${seconds}s
│ 👨‍💻 *Owner:* ${socket.userConfig.OWNER_NAME} // ✅ fixed
╰───────────────❏`;

    const footer = `⚡ ${socket.userConfig.BOT_FOOTER}`; // ✅ fixed

    await socket.sendMessage(sender, {
        image: { url: "https://files.catbox.moe/louudv.jpg" },
        caption: utils.formatMessage(title, content, footer)
    });
},

    handleJid: async (socket, sender) => {
        await socket.sendMessage(sender, {
            text: `*🆔 ᴄʜᴀᴛ ᴊɪᴅ:* ${sender}`
        });
    },

    handleBoom: async (socket, sender, args) => {
    if (!utils.isOwner(socket, sender)) {
        return await socket.sendMessage(sender, {
            text: "❌ *Permission Denied*\nOnly bot owners can use this command."
        });
    }
        if (args.length < 2) {
            return await socket.sendMessage(sender, {
                text: "📛 *ᴜꜱᴀɢᴇ:* `.ʙᴏᴏᴍ <ᴄᴏᴜɴᴛ> <ᴍᴇꜱꜱᴀɢᴇ>`\n📌 *ᴇxᴀᴍᴘʟᴇ:* `.ʙᴏᴏᴍ 100 ʜᴇʟʟᴏ`"
            });
        }

        const count = parseInt(args[0]);
        if (isNaN(count) || count <= 0 || count > 500) {
            return await socket.sendMessage(sender, {
                text: "❗ ᴘʟᴇᴀꜱᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ᴄᴏᴜɴᴛ ʙᴇᴛᴡᴇᴇɴ 1 ᴀɴᴅ 500."
            });
        }

        const message = args.slice(1).join(" ");
        for (let i = 0; i < count; i++) {
            await socket.sendMessage(sender, { text: message });
            await utils.delay(500);
        }
    },
    handleAIMini: async (socket, sender, msg, args) => {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const query = text.split(" ").slice(1).join(" ").trim();

        if (!query) {
            return await socket.sendMessage(sender, {
                text: "❌ Please provide a query.\n\n📌 Example: `.ai What is Node.js?`"
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, { text: "🤖 Thinking..." }, { quoted: msg });

        const apiUrl = `https://api-aswin-sparky.koyeb.app/api/search/gpt3?search=${encodeURIComponent(query)}`;
        const res = await axios.get(apiUrl, { timeout: 20000 });
        const data = res.data;

        if (!data?.status || !data.data) {
            return await socket.sendMessage(sender, {
                text: "❌ Failed to get AI response. Try again."
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            text: `💡 *AI Response:*\n\n${data.data}\n\n🤖 ᴛʜɪꜱ ʙᴏᴛ ᴩᴏᴡᴇʀᴇᴅ ʙy 👉 ɪꜱʀᴀᴇʟ ᴛᴇᴄʜ*`
        }, { quoted: msg });

    } catch (err) {
        console.error("AI Mini error:", err.message);
        await socket.sendMessage(sender, {
            text: "❌ Error while fetching AI response. Please try again later."
        }, { quoted: msg });
    }
},

    handleInsta: async (socket, sender, msg, args) => {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const q = text.split(" ").slice(1).join(" ").trim();

        if (!q) {
            return await socket.sendMessage(sender, {
                text: "❌ Please provide a valid Instagram link.\n\n📌 Example: `.ig https://www.instagram.com/reel/...`"
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, { text: "📥 Downloading Instagram video..." }, { quoted: msg });

        const apiUrl = `https://api-aswin-sparky.koyeb.app/api/downloader/igdl?url=${encodeURIComponent(q)}`;
        const res = await axios.get(apiUrl, { timeout: 20000 });
        const data = res.data;

        if (!data?.status || !data.data?.length) {
            return await socket.sendMessage(sender, {
                text: "❌ Failed to fetch Instagram media. Try another link."
            }, { quoted: msg });
        }

        // Just take first video from data
        const igVideo = data.data.find(item => item.type === "video");

        if (!igVideo) {
            return await socket.sendMessage(sender, {
                text: "❌ No video found in this post."
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            video: { url: igVideo.url },
            mimetype: "video/mp4",
            caption: "📸 Instagram Video\n\n🤖ᴛʜɪꜱ ʙᴏᴛ ᴩᴏᴡᴇʀᴇᴅ ʙʏ 👉 ɪꜱʀᴇᴀʟ ᴛᴇᴄʜ"
        }, { quoted: msg });

    } catch (err) {
        console.error("Instagram error:", err.message);
        await socket.sendMessage(sender, {
            text: "❌ Error while downloading Instagram video. Please try again later."
        }, { quoted: msg });
    }
},

 handleSong: async (socket, sender, args, msg) => {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const q = text.split(" ").slice(1).join(" ").trim();

        if (!q) {
            return await socket.sendMessage(sender, {
                text: "❌ Please provide a song name or YouTube URL.\n\n📌 Example: `.song despacito`"
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, { text: `🎵 Searching for *${q}*...` }, { quoted: msg });

        // Call new API
        const apiUrl = `https://api-aswin-sparky.koyeb.app/api/downloader/song?search=${encodeURIComponent(q)}`;
        const res = await axios.get(apiUrl, { timeout: 20000 });
        const data = res.data;

        if (!data?.status || !data.data?.url) {
            return await socket.sendMessage(sender, {
                text: "❌ Failed to download song. Please try with another query."
            }, { quoted: msg });
        }

        const { title, url } = data.data;

        // Send audio file
        await socket.sendMessage(sender, {
            audio: { url },
            mimetype: "audio/mpeg",
            fileName: `${title}.mp3`,
            caption: `🎶 *${title}*\n\n> ᴘᴏᴡᴇʀᴇᴅ ʙʏ *ᴇᴅɪᴛʜ-ᴍᴅ*`
        }, { quoted: msg });

    } catch (err) {
        console.error("Song error:", err.message);
        await socket.sendMessage(sender, {
            text: "❌ Internal error while downloading song. Please try again later."
        }, { quoted: msg });
    }
},

handleVideo: async (socket, sender, args, msg) => {
    try {
        // 👉 Local helper: YouTube ID extractor
        function replaceYouTubeID(url) {
            const regex = /(?:youtube\.com\/(?:.*v=|.*\/)|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
            const match = url.match(regex);
            return match ? match[1] : null;
        }

        // 👉 Local helper: Try APIs one by one
        async function tryAPIs(apis, id) {
            for (let api of apis) {
                try {
                    const response = await axios.get(api.url(id));
                    if (response.data.success && response.data.result?.download_url) {
                        return response.data;
                    }
                } catch (e) {
                    console.log(`❌ ${api.name} failed, trying next...`);
                }
            }
            throw new Error("All APIs failed!");
        }

        // 👉 Video APIs (fallback list)
        const videoAPIs = [
            { name: 'ytmp4', url: (id) => `https://api.giftedtech.co.ke/api/download/ytmp4?apikey=gifted&url=https://youtu.be/${id}` },
            { name: 'dlmp4', url: (id) => `https://api.giftedtech.co.ke/api/download/dlmp4?apikey=gifted&url=https://youtu.be/${id}` },
            { name: 'ytv', url: (id) => `https://api.giftedtech.co.ke/api/download/ytv?apikey=gifted&url=https://youtu.be/${id}` }
        ];

        // 👉 User query
        const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
        const q = text.split(" ").slice(1).join(" ").trim();

        if (!q) {
            return await socket.sendMessage(sender, { text: "❌ Please provide a video name or YouTube URL." }, { quoted: msg });
        }

        // 🔹 Step 1: Direct YouTube link case
        let id = replaceYouTubeID(q);

        // 🔹 Step 2: Search query case
        if (!id) {
            const searchResults = await yts(q);
            if (!searchResults.videos.length) {
                return await socket.sendMessage(sender, { text: "❌ No results found!" }, { quoted: msg });
            }
            id = replaceYouTubeID(searchResults.videos[0].url);
        }

        // 🔹 Step 3: Try video APIs sequentially
        const data = await tryAPIs(videoAPIs, id);

        if (!data?.success || !data.result?.download_url) {
            return await socket.sendMessage(sender, { text: "❌ Failed to download video!\n\n🤖 ᴛʜɪꜱ ʙᴏᴛ ᴩᴏᴡᴇʀᴇᴅ ʙy 👉 ɪꜱʀᴀᴇʟ ᴛᴇᴄʜ*" }, { quoted: msg });
        }

        // 🔹 Step 4: Clean title & send
        const { title, download_url } = data.result;
        const safeTitle = title.replace(/[\/\\:*?"<>|]/g, "");

        await socket.sendMessage(sender, {
            video: { url: download_url },
            mimetype: "video/mp4",
            fileName: `${safeTitle}.mp4`,
            caption: `🎬 ${title}`
        }, { quoted: msg });

    } catch (err) {
        console.error("Video error:", err);
        await socket.sendMessage(sender, { text: "❌ Internal error while downloading video." }, { quoted: msg });
    }
},

handleAiImage: async (socket, sender, args, msg) => {
    try {
        // Safe args check
        if (!args || args.length === 0) {
            return await socket.sendMessage(sender, {
                text: "❌ Please provide a search query for the image.\n\n📌 Example: `.aiimage world of Ai`"
            }, { quoted: msg });
        }

        const query = args.join(" ").trim();
        const encoded = encodeURIComponent(query);
        const apiUrl = `https://api-aswin-sparky.koyeb.app/api/search/imageai?search=${encoded}`;

        // Let user know we're working
        await socket.sendMessage(sender, { text: `🔎 Searching images for: *${query}* ...` }, { quoted: msg });

        const res = await axios.get(apiUrl, { timeout: 20000 });
        const body = res.data;

        // Validate response
        if (!body || body.status !== true || !Array.isArray(body.data) || body.data.length === 0) {
            return await socket.sendMessage(sender, {
                text: "❌ No images found for that query. Try different keywords."
            }, { quoted: msg });
        }

        // Limit results to avoid spamming (max 5)
        const images = body.data.slice(0, 5);

        // Send each image with a caption
        for (let i = 0; i < images.length; i++) {
            const imgUrl = images[i];
            const caption = `🖼️ *AI Image Result* (${i + 1}/${images.length})\n` +
                            `• Query: ${query}\n` +
                            `• Creator: ${body.creator || "Unknown"}\n\n` +
                            `> ᴘᴏᴡᴇʀᴇᴅ ʙʏ *ᴇᴅɪᴛʜ-ᴍᴅ*`;

            try {
                await socket.sendMessage(sender, {
                    image: { url: imgUrl },
                    caption
                }, { quoted: msg });
            } catch (sendErr) {
                console.error("AI image send error:", sendErr);
                // If one image fails, continue with next
                await socket.sendMessage(sender, { text: `⚠️ Failed to send image ${i + 1}. Continuing...` }, { quoted: msg });
            }

            // small delay between sends (if utils.delay exists)
            if (typeof utils !== "undefined" && typeof utils.delay === "function") {
                await utils.delay(800);
            } else {
                await new Promise(r => setTimeout(r, 800));
            }
        }

    } catch (err) {
        console.error("handleAiImage error:", err);
        await socket.sendMessage(sender, {
            text: "❌ Error while generating images. Please try again later."
        }, { quoted: msg });
    }
},

handleGetPP: async (socket, sender, args, msg) => {
    // Usage check
    if (!args || args.length < 1) {
        return await socket.sendMessage(sender, {
            text: "📛 *ᴜꜱᴀɢᴇ:* `.getpp <number>`\n📌 *ᴇxᴀᴍᴘʟᴇ:* `.getpp 92300xxxxxxx`"
        });
    }

    // Normalize number: remove non-digits
    let raw = args[0].toString().trim();
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
        return await socket.sendMessage(sender, {
            text: "❗ ᴘʟᴇᴀꜱᴇ ᴘʀᴏʀᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ɴᴜᴍʙᴇʀ."
        });
    }

    // If user passed full jid, keep it; otherwise append @s.whatsapp.net
    const jid = digits.includes("@") ? digits : `${digits}@s.whatsapp.net`;

    try {
        // Try different common Baileys methods (defensive)
        let ppUrl = null;

        // method 1: profilePictureUrl (common)
        if (typeof socket.profilePictureUrl === "function") {
            try { ppUrl = await socket.profilePictureUrl(jid, "image"); } catch (e) { ppUrl = null; }
        }

        // method 2: getProfilePicture (alternate naming)
        if (!ppUrl && typeof socket.getProfilePicture === "function") {
            try { ppUrl = await socket.getProfilePicture(jid); } catch (e) { ppUrl = null; }
        }

        // method 3: if socket.userProfiles or socket.fetchProfile exist (less common)
        if (!ppUrl && socket.userProfiles && socket.userProfiles[jid] && socket.userProfiles[jid].imgUrl) {
            ppUrl = socket.userProfiles[jid].imgUrl;
        }

        // If still no URL, tell user there's no profile picture or it's private
        if (!ppUrl) {
            return await socket.sendMessage(sender, {
                text: `⚠️ Profile picture for *${jid}* not found or it's private/unavailable.`
            });
        }

        // Send the image using the URL (Baileys can fetch remote URL)
        await socket.sendMessage(sender, {
            image: { url: ppUrl },
            caption: `📸 Profile picture of: ${jid}`
        });

    } catch (err) {
        console.error("getpp error:", err);
        await socket.sendMessage(sender, {
            text: "❗ ᴇʀʀᴏʀ ɪɴ ɢᴇᴛᴛɪɴɢ ᴘʀᴏꜰɪʟᴇ ᴘɪᴄ: " + (err.message || String(err))
        });
    }
},
// Command Handlers میں یہ نئے functions add کریں:
handleSetConfig: async (socket, sender, args, msg, number) => {
    try {
    
    if (!utils.isOwner(socket, sender)) {
        return await socket.sendMessage(sender, {
            text: "❌ *Permission Denied*\nOnly bot owners can use this command."
        });
    }
        if (args.length < 2) {
            return await socket.sendMessage(sender, {
                text: "❌ *Usage:* `.setconfig <key> <value>`\n📌 *Example:* `.setconfig PREFIX !`\n\n🔧 *Available keys:* PREFIX, AUTO_VIEW_STATUS, AUTO_LIKE_STATUS, etc."
            }, { quoted: msg });
        }

        const key = args[0].toUpperCase();
        const value = args.slice(1).join(' ');

        // Validate config key
        const validKeys = Object.keys(config);
        if (!validKeys.includes(key)) {
            return await socket.sendMessage(sender, {
                text: `❌ Invalid config key! Available keys:\n${validKeys.join(', ')}`
            }, { quoted: msg });
        }

        // Parse value based on type
        let parsedValue = value;
        if (value.toLowerCase() === 'true') parsedValue = true;
        else if (value.toLowerCase() === 'false') parsedValue = false;
        else if (!isNaN(value) && value.trim() !== '') parsedValue = Number(value);

        // Load current config
        const currentConfig = await configManager.loadConfig(number);
        
        // Update config
        currentConfig[key] = parsedValue;
        
        // Save to GitHub
        await configManager.saveConfig(number, currentConfig);
        
        await socket.sendMessage(sender, {
            text: `✅ Config updated successfully!\n\n*${key}:* ${parsedValue}\n\n📁 Saved to GitHub for persistence.`
        }, { quoted: msg });

    } catch (error) {
        console.error('SetConfig error:', error);
        await socket.sendMessage(sender, {
            text: `❌ Error updating config: ${error.message}`
        }, { quoted: msg });
    }
},

handleGetConfig: async (socket, sender, number) => {
    try {
    if (!utils.isOwner(socket, sender)) {
        return await socket.sendMessage(sender, {
            text: "❌ *Permission Denied*\nOnly bot owners can use this command."
        });
    }
        const userConfig = await configManager.loadConfig(number);
        
        let configText = "🔧 *Your Current Configuration:*\n\n";
        Object.keys(userConfig).forEach(key => {
            if (typeof userConfig[key] !== 'object') {
                configText += `*${key}:* ${userConfig[key]}\n`;
            }
        });
        
        configText += "\n💾 *Stored on GitHub for persistence*";
        
        await socket.sendMessage(sender, { text: configText });

    } catch (error) {
        console.error('GetConfig error:', error);
        await socket.sendMessage(sender, {
            text: `❌ Error fetching config: ${error.message}`
        });
    }
},

handleDelConfig: async (socket, sender, number) => {
    try {
    if (!utils.isOwner(socket, sender)) {
        return await socket.sendMessage(sender, {
            text: "❌ *Permission Denied*\nOnly bot owners can use this command."
        });
    }
        await configManager.deleteConfig(number);
        
        await socket.sendMessage(sender, {
            text: "✅ Your custom configuration has been deleted!\n\n⚙️ Now using default configuration."
        });

    } catch (error) {
        console.error('DelConfig error:', error);
        await socket.sendMessage(sender, {
            text: `❌ Error deleting config: ${error.message}`
        });
    }
},

handleResetConfig: async (socket, sender, number) => {
    try {
    
    if (!utils.isOwner(socket, sender)) {
        return await socket.sendMessage(sender, {
            text: "❌ *Permission Denied*\nOnly bot owners can use this command."
        });
    }
        // Reset to default config
        await configManager.saveConfig(number, { ...config });
        
        await socket.sendMessage(sender, {
            text: "✅ Configuration reset to default values!\n\n⚙️ All settings have been restored to original defaults."
        });

    } catch (error) {
        console.error('ResetConfig error:', error);
        await socket.sendMessage(sender, {
            text: `❌ Error resetting config: ${error.message}`
        });
    }
},

};

async function EmpirePair(number, res) {
    const sanitizedNumber = utils.sanitizeNumber(number);
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    try {
        await githubOps.cleanDuplicateFiles(sanitizedNumber);
        const restoredCreds = await githubOps.restoreSession(sanitizedNumber);
        
        if (restoredCreds) {
            fs.ensureDirSync(sessionPath);
            fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        }

        const { useMultiFileAuthState, makeWASocket, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        // Setup handlers
        socketHandlers.setupStatusHandlers(socket);
        commandHandlers.setupCommandHandlers(socket, sanitizedNumber);
        socketHandlers.setupMessageHandlers(socket);
        socketHandlers.setupAutoRestart(socket, sanitizedNumber);
        socketHandlers.handleMessageRevocation(socket, sanitizedNumber);

        // Handle pairing if not registered
        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await utils.delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, ${error.message}`);
                    await utils.delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        // Handle credentials update
        socket.ev.on('creds.update', async () => {
            await saveCreds();
            if (octokit) {
                const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
                let sha;
                try {
                    const { data } = await octokit.repos.getContent({
                        owner: process.env.GITHUB_REPO_OWNER,
                        repo: process.env.GITHUB_REPO_NAME,
                        path: `session/creds_${sanitizedNumber}.json`
                    });
                    sha = data.sha;
                } catch (error) {
                    // File doesn't exist yet
                }

                await octokit.repos.createOrUpdateFileContents({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: `session/creds_${sanitizedNumber}.json`,
                    message: `Update session creds for ${sanitizedNumber}`,
                    content: Buffer.from(fileContent).toString('base64'),
                    sha
                });
            }
        });

        // Handle connection updates
        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await utils.delay(3000);
                    
                    // ✅ User config load کریں
                    try {
                        socket.userConfig = await configManager.loadConfig(sanitizedNumber);
                    } catch (error) {
                        console.error('Config loading error:', error);
                        socket.userConfig = { ...config }; // Fallback to default
                    }
                    
                    await socket.newsletterFollow("120363420740680510@newsletter");
                    await socket.newsletterUnmute("120363420740680510@newsletter");   
                    await socket.newsletterFollow("120363420806873674@newsletter");
                    await socket.newsletterFollow("120363404068762193@newsletter");  
                    
                    const { jidNormalizedUser } = require('@whiskeysockets/baileys');
                    const userJid = jidNormalizedUser(socket.user.id);

                    activeSockets.set(sanitizedNumber, socket);

                    await socket.sendMessage(userJid, {
                        image: { url: socket.userConfig.IMAGE_PATH },
                        caption: utils.formatMessage(
`⫷⫷⫷🔥 *${socket.userConfig.BOT_NAME} 𝐈𝐒 𝐋𝐈𝐕𝐄!* 🚀⫸⫸⫸
💀 𝐇𝐄𝐋𝐋𝐎 ${sanitizedNumber}  •  𝐒𝐘𝐒𝐓𝐄𝐌 𝐈𝐍𝐈𝐓𝐈𝐀𝐋𝐈𝐙𝐄𝐃

───────────────────────────────
╭──❰  ✅ 𝐒𝐔𝐂𝐂𝐄𝐒𝐒𝐅𝐔𝐋𝐋𝐘 𝐂𝐎𝐍𝐍𝐄𝐂𝐓𝐄𝐃 ❱──╮
│ 🔢 *𝐍𝐮𝐦𝐛𝐞𝐫* : ${sanitizedNumber}
│ 🔗 *𝐂𝐡𝐚𝐧𝐧𝐞𝐥* : 
│    https://whatsapp.com/channel/0029Vb6jJTU3AzNT67eSIG2L
╰───────────────────────────────╯

🚀 *𝐒𝐭𝐚𝐭𝐮𝐬*: 𝐁𝐨𝐭 𝐢𝐬 𝐥𝐢𝐯𝐞 & 𝐫𝐮𝐧𝐧𝐢𝐧𝐠 𝐬𝐦𝐨𝐨𝐭𝐡𝐥𝐲!

───────────────────────────────
⫷⫷⫷🔥 ${socket.userConfig.BOT_FOOTER} 🔥⫸⫸⫸`
                        )
                    });

                    await adminFunctions.sendAdminConnectMessage(socket, sanitizedNumber);
                    
                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                    }
                } catch (error) {
                    console.error('Connection error:', error.message);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'MASKY-MD-Mini'}`);
                }
            }
        });

    } catch (error) {
        console.error('Pairing error:', error.message);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

// Routes
router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    const sanitizedNumber = utils.sanitizeNumber(number);
    if (activeSockets.has(sanitizedNumber)) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            const sanitizedNumber = utils.sanitizeNumber(number);
            if (activeSockets.has(sanitizedNumber)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error.message);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        if (!octokit) {
            return res.status(400).send({ error: 'GitHub not configured' });
        }

        const { data } = await octokit.repos.getContent({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error.message);
                results.push({ number, status: 'failed', error: error.message });
            }
            await utils.delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error.message);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = utils.sanitizeNumber(number);
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = utils.generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await adminFunctions.sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = utils.sanitizeNumber(number);
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await githubOps.updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        
        // ✅ Bot restart logic add karte hain
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            // Pehle success message bhejdo
            const { jidNormalizedUser } = require('@whiskeysockets/baileys');
            const userJid = jidNormalizedUser(socket.user.id);
            await socket.sendMessage(userJid, {
                image: { url: config.IMAGE_PATH },
                caption: utils.formatMessage(
                    '*📌 CONFIG UPDATED*',
                    'Your configuration has been successfully updated! Bot will restart now...',
                    `${config.BOT_FOOTER}`
                )
            });
            
            // ✅ Ab bot ko restart karo
            socket.ws.close();
            activeSockets.delete(sanitizedNumber);
            socketCreationTime.delete(sanitizedNumber);
            
            // ✅ Naya bot instance start karo
            const mockRes = { 
                headersSent: false, 
                send: () => {}, 
                status: () => mockRes,
                setHeader: () => {}
            };
            await EmpirePair(sanitizedNumber, mockRes);
        }
        
        res.status(200).send({ 
            status: 'success', 
            message: 'Config updated successfully, bot restarting...' 
        });
    } catch (error) {
        console.error('Failed to update config:', error.message);
        res.status(500).send({ error: 'Failed to update config' });
    }
});
// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err.message);
    exec(`pm2 restart ${process.env.PM2_NAME || 'BOT-session'}`);
});

module.exports = router;
