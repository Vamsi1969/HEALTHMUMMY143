// ============================================================
// Health Mummy — AI-Powered Health Assistant
// Uses OpenRouter API (configurable via .env)
// Falls back to rule-based responses if no API key is set
// ============================================================

// --- Configuration ---
const CONFIG = window.__OPENROUTER_CONFIG__ || {};
const API_KEY = CONFIG.apiKey || '';
const MODEL = CONFIG.model || 'google/gemma-4-31b-it:free';
const HAS_AI = !!API_KEY;

// --- Conversation State ---
let conversationHistory = [];
const MAX_HISTORY = 20; // Keep last 20 messages for context

// System prompt that sets the AI's role as a health assistant
const SYSTEM_PROMPT = {
  role: "system",
  content: `You are Health Mummy, a compassionate, knowledgeable health assistant. Your role:
- Provide helpful, accurate health information and advice
- Always include a disclaimer: "⚠️ I'm an AI assistant — always consult a healthcare professional for medical advice."
- Be warm, empathetic, and encouraging
- Keep responses concise but thorough (2-4 paragraphs)
- For emergencies (chest pain, stroke, severe bleeding, etc.), ALWAYS advise calling 911 immediately
- Suggest when to see a doctor if symptoms are serious
- You can reference general wellness tips, diet, exercise, and mental health
- If asked something outside health scope, politely redirect to health topics`
};

// --- Fallback Rule-Based Responses (used when no API key) ---
const RESPONSES = {
    "hello": "Hello! I am your Health Mummy assistant. How are you feeling today?",
    "hi": "Hi there! I'm here to help with your health. What's on your mind?",
    "hey": "Hey! Welcome to Health Mummy. Tell me what's bothering you or ask any health question.",
    "help": "<strong>I can help with:</strong> Fever, Cold, Flu, Diabetes, Blood Pressure, Headache, Back Pain, Asthma, Heart, Skin, Eyes, Dental, Pregnancy, Mental Health, First Aid, Cancer awareness, Kidney, Liver, Arthritis, Cholesterol, and 100+ more. Just type your symptom!",
    "thank": "You're welcome! Stay healthy and take care. I'm always here if you need health advice. 💚",
    "headache": "<strong>Headache:</strong> Stay hydrated, rest your eyes, and stay in a quiet environment. Try paracetamol. If headaches are frequent or severe, consult a doctor to rule out migraines or other causes.",
    "fever": "<strong>Fever:</strong> Your body is fighting infection. Rest, drink fluids, take paracetamol or ibuprofen. Sponge with lukewarm water. If fever exceeds 103°F or lasts >3 days, see a doctor immediately.",
    "cough": "<strong>Cough:</strong> Stay hydrated, try honey in warm water (adults). Steam inhalation helps. Dry cough = suppressant; wet cough = expectorant. If >3 weeks or produces blood, see a doctor.",
    "chest pain": "<strong>⚠️ Chest Pain:</strong> Could be heart attack. If sudden, crushing, radiates to arm/jaw with sweating/nausea, <strong>CALL 911.</strong> Chew an aspirin while waiting.",
    "heart attack": "<strong>⚠️ Heart Attack:</strong> Chest pressure, arm/jaw/back pain, shortness of breath, cold sweat. <strong>CALL 911 NOW.</strong> Chew an aspirin. Do CPR if unresponsive.",
    "stroke": "<strong>⚠️ Stroke — Act FAST:</strong> <strong>F</strong>ace drooping, <strong>A</strong>rm weakness, <strong>S</strong>peech difficulty, <strong>T</strong>ime to call 911. Every minute counts. Note when symptoms started.",
    "default": "I'm your Health Mummy assistant covering <strong>150+ health conditions</strong> — fever, diabetes, BP, cold, flu, asthma, heart, skin, eyes, dental, pregnancy, mental health, first aid, cancer awareness, and much more. Just type your symptom! For serious concerns, please consult a healthcare professional."
};

// --- Browser Text-to-Speech (SpeechSynthesis) ---
// Uses the browser's built-in TTS — free, unlimited, no API key needed
const TTS_ENABLED = true;

function speakText(text) {
    // Strip HTML tags for cleaner speech
    const cleanText = text.replace(/<[^>]*>/g, '').trim();
    if (!cleanText) return Promise.resolve(false);
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'en-US';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        
        // Try to find a natural voice
        const trySelectVoice = () => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length === 0) {
                // Voices not loaded yet — wait for them
                window.speechSynthesis.onvoiceschanged = () => {
                    window.speechSynthesis.onvoiceschanged = null;
                    trySelectVoice();
                };
                return;
            }
            const preferredVoice = voices.find(v =>
                v.name.includes('Samantha') ||
                v.name.includes('Google UK Female') ||
                v.name.includes('Microsoft Zira') ||
                v.name.includes('Female')
            );
            if (preferredVoice) utterance.voice = preferredVoice;
            window.speechSynthesis.speak(utterance);
        };
        trySelectVoice();
        
        utterance.onend = () => resolve(true);
        utterance.onerror = (e) => {
            console.warn('SpeechSynthesis error:', e);
            resolve(false);
        };
        
        // If no voices needed selection, just speak
        if (!utterance.voice) {
            window.speechSynthesis.speak(utterance);
        }
    });
}

// --- Voice Input (SpeechRecognition) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

function startVoiceInput() {
    if (!SpeechRecognition) {
        alert('Voice input is not supported in this browser. Please use Chrome or Edge.');
        return;
    }
    
    if (isListening) {
        // Manual stop — clear input so auto-send doesn't fire with partial text
        userInput.value = '';
        stopVoiceInput();
        return;
    }
    
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    
    const micBtn = document.getElementById('mic-btn');
    
    recognition.onstart = () => {
        isListening = true;
        micBtn.classList.add('listening');
        micBtn.innerHTML = '🎤';
        micBtn.title = 'Listening... Click to stop';
        userInput.placeholder = 'Listening...';
    };
    
    recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
        }
        userInput.value = transcript;
        // Auto-grow the transcript as user speaks
        userInput.scrollLeft = userInput.scrollWidth;
    };
    
    recognition.onend = () => {
        isListening = false;
        micBtn.classList.remove('listening');
        micBtn.innerHTML = '🎤';
        micBtn.title = 'Click to speak';
        userInput.placeholder = 'Type your symptoms...';
        
        // Auto-send if there's text
        if (userInput.value.trim()) {
            handleSend();
        }
    };
    
    recognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        isListening = false;
        micBtn.classList.remove('listening');
        micBtn.innerHTML = '🎤';
        micBtn.title = 'Click to speak';
        userInput.placeholder = 'Type your symptoms...';
        
        if (event.error === 'not-allowed') {
            alert('Microphone access denied. Please allow microphone permissions in your browser settings.');
        }
    };
    
    recognition.start();
}

function stopVoiceInput() {
    if (recognition) {
        recognition.stop();
    }
}

// --- Chat Elements ---
const chatBox = document.getElementById('chat-box');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

// --- Fallback Response Function ---
function getFallbackResponse(message) {
    const lowerMessage = message.toLowerCase();
    for (const key in RESPONSES) {
        if (key !== "default" && lowerMessage.includes(key)) {
            return RESPONSES[key];
        }
    }
    return RESPONSES["default"];
}

// --- OpenRouter AI Call ---
async function callOpenRouter(messages) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.origin,
            "X-OpenRouter-Title": "Health Mummy"
        },
        body: JSON.stringify({
            model: MODEL,
            messages: messages,
            temperature: 0.7,
            max_tokens: 1024
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// --- Send Message to AI ---
async function sendToAI(userMessage) {
    // Add user message to history
    conversationHistory.push({ role: "user", content: userMessage });

    // Trim history if too long
    if (conversationHistory.length > MAX_HISTORY) {
        conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    }

    // Build full message array with system prompt
    const messages = [SYSTEM_PROMPT, ...conversationHistory];

    try {
        const aiResponse = await callOpenRouter(messages);
        
        // Add AI response to history
        conversationHistory.push({ role: "assistant", content: aiResponse });
        
        return aiResponse;
    } catch (error) {
        console.error("OpenRouter API error:", error);
        
        // On error, fall back to rule-based response
        const fallback = getFallbackResponse(userMessage);
        const disclaimer = "<br><br><em style='color: #ffaa00; font-size: 0.85rem;'>⚠️ AI service unavailable — showing offline response. Check your API key and try again.</em>";
        return fallback + disclaimer;
    }
}

// --- Chat UI Functions ---
function addMessage(message, isUser = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    msgDiv.classList.add(isUser ? 'user-message' : 'bot-message');
    
    const msgContent = document.createElement('div');
    msgContent.className = 'msg-content';
    msgContent.innerHTML = message;
    msgDiv.appendChild(msgContent);
    
    // Add speak button for bot messages
    if (!isUser && TTS_ENABLED) {
        const speakBtn = document.createElement('button');
        speakBtn.className = 'speak-btn';
        speakBtn.innerHTML = '🔊';
        speakBtn.title = 'Listen to this response';
        speakBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            speakBtn.disabled = true;
            speakBtn.innerHTML = '🔊 <span class="speaking-dots">...</span>';
            const success = await speakText(message);
            speakBtn.disabled = false;
            speakBtn.innerHTML = success ? '🔊✅' : '🔊❌';
            setTimeout(() => { speakBtn.innerHTML = '🔊'; }, 2000);
        });
        msgDiv.appendChild(speakBtn);
    }
    
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function showTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.classList.add('typing-indicator');
    indicator.id = 'typing';
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('div');
        dot.classList.add('dot');
        indicator.appendChild(dot);
    }
    chatBox.appendChild(indicator);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function hideTypingIndicator() {
    const indicator = document.getElementById('typing');
    if (indicator) indicator.remove();
}

async function handleSend() {
    const text = userInput.value.trim();
    if (!text) return;

    // Add user message to chat
    addMessage(text, true);
    userInput.value = '';

    // Show typing indicator
    showTypingIndicator();

    try {
        if (HAS_AI) {
            // Use AI-powered response
            const response = await sendToAI(text);
            hideTypingIndicator();
            addMessage(response, false);
        } else {
            // Use rule-based fallback with a small delay
            setTimeout(() => {
                hideTypingIndicator();
                const response = getFallbackResponse(text);
                const notice = HAS_AI ? "" :
                    "<br><br><em style='color: #888; font-size: 0.8rem;'>💡 Set up your API key for AI-powered responses: run <strong>node build.js</strong> after adding your key to .env</em>";
                addMessage(response + notice, false);
            }, 800);
        }
    } catch (error) {
        hideTypingIndicator();
        console.error("Error handling message:", error);
        addMessage("I'm sorry, I encountered an error. Please try again or set up your API key.", false);
    }
}

// --- Event Listeners ---
sendBtn.addEventListener('click', handleSend);
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
});

// --- Voice Input Event Listener ---
const micBtn = document.getElementById('mic-btn');
if (micBtn) {
    micBtn.addEventListener('click', startVoiceInput);
}

// Show AI status & voice features indicator in chat header
(function showAIStatus() {
    const headerTitle = document.querySelector('.header-title p');
    if (headerTitle) {
        const aiStatus = HAS_AI
            ? `<span style="color: #4CAF50;">●</span> AI Online`
            : `<span style="color: #ffaa00;">●</span> Offline Mode`;
        const supportsVoice = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
        const voiceStatus = supportsVoice
            ? `<span style="color: #8B5CF6;"> 🎤 Voice</span>`
            : '';
        headerTitle.innerHTML = `Your personal well-being guide — ${aiStatus}${voiceStatus}`;
    }
})();

// ============================================================
// Navigation & UI (unchanged)
// ============================================================
const backBtn = document.getElementById('back-btn');
const viewSections = document.querySelectorAll('.view-section');

function showSection(sectionId) {
    viewSections.forEach(sec => sec.style.display = 'none');
    document.getElementById(sectionId).style.display = 'flex';
    
    if (sectionId === 'dashboard-section') {
        backBtn.style.display = 'none';
    } else {
        backBtn.style.display = 'flex';
    }
}

backBtn.addEventListener('click', () => {
    showSection('dashboard-section');
});

document.getElementById('card-chat').addEventListener('click', () => showSection('chat-section'));
document.getElementById('card-bmi').addEventListener('click', () => showSection('bmi-section'));
document.getElementById('card-emergency').addEventListener('click', () => showSection('emergency-section'));

document.getElementById('card-hospital').addEventListener('click', () => {
    window.open('https://www.google.com/maps/search/hospitals+near+me/', '_blank');
});

document.getElementById('card-blood').addEventListener('click', () => {
    window.open('https://www.google.com/maps/search/blood+banks+near+me/', '_blank');
});

document.getElementById('card-breathe').addEventListener('click', () => showSection('breathe-section'));

document.getElementById('card-water').addEventListener('click', () => showSection('water-section'));
document.getElementById('card-symptoms').addEventListener('click', () => showSection('symptom-section'));
document.getElementById('card-medicine').addEventListener('click', () => showSection('medicine-section'));
document.getElementById('card-logins')?.addEventListener('click', () => {
    showSection('login-history-section');
    setTimeout(loadLoginHistory, 50);
});

document.getElementById('card-analytics')?.addEventListener('click', () => {
    showSection('analytics-section');
    setTimeout(runAnalytics, 100);
});

// ============================================================
// Calm Zone — Breathing Exercise
// ============================================================
const breatheCircle = document.getElementById('breathe-circle');
const breatheInstruction = document.getElementById('breathe-instruction');
const breatheTimer = document.getElementById('breathe-timer');
const breatheStartBtn = document.getElementById('breathe-start-btn');
let breatheInterval = null;
let breatheRunning = false;

function runBreatheCycle() {
    let countdown;

    // Phase 1: Inhale (4 seconds)
    breatheCircle.className = 'breathe-circle grow';
    breatheInstruction.textContent = 'Inhale...';
    countdown = 4;
    breatheTimer.textContent = countdown;
    const inhaleTimer = setInterval(() => {
        countdown--;
        if (countdown > 0) breatheTimer.textContent = countdown;
        else { breatheTimer.textContent = ''; clearInterval(inhaleTimer); }
    }, 1000);

    // Phase 2: Hold (4 seconds)
    setTimeout(() => {
        if (!breatheRunning) return;
        breatheCircle.className = 'breathe-circle hold';
        breatheInstruction.textContent = 'Hold...';
        countdown = 4;
        breatheTimer.textContent = countdown;
        const holdTimer = setInterval(() => {
            countdown--;
            if (countdown > 0) breatheTimer.textContent = countdown;
            else { breatheTimer.textContent = ''; clearInterval(holdTimer); }
        }, 1000);
    }, 4000);

    // Phase 3: Exhale (4 seconds)
    setTimeout(() => {
        if (!breatheRunning) return;
        breatheCircle.className = 'breathe-circle shrink';
        breatheInstruction.textContent = 'Exhale...';
        countdown = 4;
        breatheTimer.textContent = countdown;
        const exhaleTimer = setInterval(() => {
            countdown--;
            if (countdown > 0) breatheTimer.textContent = countdown;
            else { breatheTimer.textContent = ''; clearInterval(exhaleTimer); }
        }, 1000);
    }, 8000);
}

breatheStartBtn.addEventListener('click', () => {
    if (breatheRunning) {
        breatheRunning = false;
        clearInterval(breatheInterval);
        breatheCircle.className = 'breathe-circle';
        breatheInstruction.textContent = 'Tap Start to Begin';
        breatheTimer.textContent = '';
        breatheStartBtn.textContent = 'Start';
    } else {
        breatheRunning = true;
        breatheStartBtn.textContent = 'Stop';
        runBreatheCycle();
        breatheInterval = setInterval(() => {
            if (breatheRunning) runBreatheCycle();
        }, 12000);
    }
});

// ============================================================
// BMI Calculator
// ============================================================
const bmiWeight = document.getElementById('bmi-weight');
const bmiHeight = document.getElementById('bmi-height');
const calcBmiBtn = document.getElementById('calc-bmi-btn');
const bmiResult = document.getElementById('bmi-result');

calcBmiBtn.addEventListener('click', () => {
    const w = parseFloat(bmiWeight.value);
    const h = parseFloat(bmiHeight.value) / 100; // convert cm to meters
    
    if (!w || !h || w <= 0 || h <= 0) {
        bmiResult.innerHTML = "<span style='color: #ff4444;'>Please enter valid numbers.</span>";
        bmiResult.style.display = 'block';
        return;
    }
    
    const bmi = (w / (h * h)).toFixed(1);
    let category = '';
    let color = '';
    
    if (bmi < 18.5) {
        category = 'Underweight';
        color = '#ffaa00';
    } else if (bmi < 25) {
        category = 'Normal weight';
        color = '#00C851';
    } else if (bmi < 30) {
        category = 'Overweight';
        color = '#ffaa00';
    } else {
        category = 'Obese';
        color = '#ff4444';
    }
    
    bmiResult.innerHTML = `Your BMI is <strong>${bmi}</strong><br><span style="color: ${color};">${category}</span>`;
    bmiResult.style.display = 'block';
});

// ============================================================
// Google Sign-In
// ============================================================
const loginModal = document.getElementById('login-modal');
const mainApp = document.getElementById('main-app');

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

window.handleCredentialResponse = function(response) {
    const responsePayload = parseJwt(response.credential);
    const userName = responsePayload ? responsePayload.given_name || responsePayload.name : "User";
    const userEmail = responsePayload?.email || '';
    const userPicture = responsePayload?.picture || '';
    
    // Capture device/browser info (sync — instant)
    const deviceInfo = getDeviceInfo();
    
    // Generate a session ID for duration tracking
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const loginTime = new Date().toISOString();
    
    // Build login data (without IP — saved immediately)
    const loginData = {
        name: userName,
        email: userEmail,
        picture: userPicture,
        session_id: sessionId,
        login_time: loginTime,
        ...deviceInfo
    };
    
    // Save to localStorage immediately (with device info)
    saveLoginLocal(loginData);
    
    // Fire-and-forget: get IP geolocation, then save to Supabase once with full data
    getIPGeolocation().then(geo => {
        const fullData = { ...loginData, ...geo };
        saveLoginToSupabase(fullData);
        
        // Update the last localStorage entry with IP data
        try {
            const logins = JSON.parse(localStorage.getItem('healthmummy_logins') || '[]');
            if (logins.length > 0) {
                const last = logins[logins.length - 1];
                if (last.session_id === sessionId) {
                    Object.assign(last, geo);
                    localStorage.setItem('healthmummy_logins', JSON.stringify(logins));
                }
            }
        } catch (e) { /* ignore */ }
    });
    
    // Start session timer in the header
    startSessionTimer(loginTime);
    
    loginModal.style.opacity = '0';
    
    setTimeout(() => {
        loginModal.style.display = 'none';
        mainApp.style.display = 'flex';
        showSection('dashboard-section');
        
        setTimeout(() => {
            showTypingIndicator();
            setTimeout(() => {
                hideTypingIndicator();
                const aiStatus = HAS_AI ? " I'm powered by AI and can help with <strong>any</strong> health concern — just tell me your symptoms!" : "";
                addMessage(`<strong>Welcome ${userName}!</strong> I am your Health Mummy assistant.${aiStatus}`, false);
            }, 1000);
        }, 500);
    }, 500);
};

// ============================================================
// ☀️ Health Tips of the Day
// ============================================================
const HEALTH_TIPS = [
    "Drink at least 8 glasses of water daily to stay hydrated and maintain healthy skin.",
    "Aim for 7-9 hours of sleep each night — your body repairs itself during sleep.",
    "Walk 10,000 steps a day to improve cardiovascular health and boost mood.",
    "Include colorful vegetables in every meal for a wide range of nutrients.",
    "Practice deep breathing for 2 minutes when stressed — inhale 4s, hold 4s, exhale 4s.",
    "Limit screen time 30 minutes before bed for better sleep quality.",
    "Eat protein with every meal to maintain muscle mass and feel full longer.",
    "Wash your hands frequently — it's the #1 way to prevent infection.",
    "Take a 5-minute stretch break every hour if you sit for long periods.",
    "Vitamin D from 10-15 minutes of morning sunlight boosts immunity and mood.",
    "Include fiber-rich foods like oats, beans, and apples for digestive health.",
    "Reduce salt intake to maintain healthy blood pressure levels.",
    "Practice gratitude — writing 3 things you're grateful for improves mental health.",
    "Limit added sugar to less than 25g per day for optimal health.",
    "Stay socially connected — strong relationships are linked to longer life.",
    "Use proper posture: keep your back straight and shoulders relaxed while sitting.",
    "Eat fatty fish like salmon twice a week for omega-3 fatty acids.",
    "Replace sugary drinks with water or herbal tea to cut empty calories.",
    "Take the stairs instead of the elevator for extra daily activity.",
    "Laugh often — it reduces stress hormones and boosts immune function.",
    "Get regular health check-ups even when you feel fine — prevention is key.",
    "Include probiotics (yogurt, kefir) for gut health and better digestion.",
    "Limit alcohol consumption — moderate means up to 1 drink per day for women, 2 for men.",
    "Use sunscreen with SPF 30+ even on cloudy days to protect your skin.",
    "Practice mindfulness or meditation for 5-10 minutes daily to reduce anxiety.",
    "Eat breakfast within 2 hours of waking to kickstart your metabolism.",
    "Keep a consistent sleep schedule — same bedtime and wake time daily.",
    "Include iron-rich foods like spinach, lentils, and lean red meat in your diet.",
    "Stay hydrated before, during, and after exercise for better performance.",
    "Take regular breaks from screens using the 20-20-20 rule: look 20 feet away for 20 seconds every 20 minutes."
];

function getDailyTip() {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    // Simple hash of date string for consistent daily tip
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
        hash |= 0;
    }
    const index = Math.abs(hash) % HEALTH_TIPS.length;
    return HEALTH_TIPS[index];
}

function showHealthTip() {
    const tipEl = document.getElementById('health-tip-text');
    if (tipEl) {
        tipEl.textContent = getDailyTip();
    }
}

// Handle next tip button
const tipNextBtn = document.getElementById('tip-next-btn');
if (tipNextBtn) {
    tipNextBtn.addEventListener('click', () => {
        const tipEl = document.getElementById('health-tip-text');
        if (tipEl) {
            // Show a random tip on click (different from daily)
            let idx;
            do {
                idx = Math.floor(Math.random() * HEALTH_TIPS.length);
            } while (HEALTH_TIPS.length > 1 && HEALTH_TIPS[idx] === tipEl.textContent);
            tipEl.textContent = HEALTH_TIPS[idx];
            // Spin animation
            tipNextBtn.style.transform = 'rotate(180deg)';
            setTimeout(() => { tipNextBtn.style.transform = 'rotate(0deg)'; }, 300);
        }
    });
}

// Also show tip when returning to dashboard
const dashboardSection = document.getElementById('dashboard-section');
if (dashboardSection) {
    const observer = new MutationObserver(() => {
        if (dashboardSection.style.display !== 'none') {
            showHealthTip();
        }
    });
    observer.observe(dashboardSection, { attributes: true, attributeFilter: ['style'] });
}

// ============================================================
// 💧 Water Intake Tracker
// ============================================================
const WATER_GOAL = 8;
const WATER_STORAGE_KEY = 'healthmummy_water';

function getWaterData() {
    const today = new Date().toISOString().split('T')[0];
    const stored = localStorage.getItem(WATER_STORAGE_KEY);
    if (stored) {
        try {
            const data = JSON.parse(stored);
            if (data.date === today) return data.count;
        } catch (e) { /* ignore */ }
    }
    return 0;
}

function saveWaterData(count) {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(WATER_STORAGE_KEY, JSON.stringify({ date: today, count: count }));
}

function updateWaterUI() {
    const count = getWaterData();
    const percent = Math.min(100, Math.round((count / WATER_GOAL) * 100));
    const circumference = 326.73; // 2 * PI * 52
    const offset = circumference - (percent / 100) * circumference;
    
    const countEl = document.getElementById('water-count');
    const percentEl = document.getElementById('water-percent');
    const ringFill = document.getElementById('water-ring-fill');
    const motivationEl = document.getElementById('water-motivation');
    
    if (countEl) countEl.textContent = count;
    if (percentEl) percentEl.textContent = percent + '%';
    if (ringFill) ringFill.style.strokeDashoffset = offset;
    
    if (motivationEl) {
        if (count === 0) motivationEl.textContent = '🥤 Start drinking water! Your body needs it.';
        else if (count < 4) motivationEl.textContent = '👍 Good start! Keep going, you\'re ' + (WATER_GOAL - count) + ' glasses away.';
        else if (count < 8) motivationEl.textContent = '💪 Almost there! Just ' + (WATER_GOAL - count) + ' more glass' + (WATER_GOAL - count > 1 ? 'es' : '') + '!';
        else if (count >= 8) motivationEl.textContent = '🎉 Awesome! You hit your water goal! Your body thanks you!';
    }
}

function addWater(glasses) {
    let count = getWaterData();
    count = Math.min(count + glasses, 20); // Cap at 20
    saveWaterData(count);
    updateWaterUI();
}

function resetWater() {
    saveWaterData(0);
    updateWaterUI();
}

// Water event listeners
document.getElementById('water-add-1')?.addEventListener('click', () => addWater(1));
document.getElementById('water-add-2')?.addEventListener('click', () => addWater(2));
document.getElementById('water-reset')?.addEventListener('click', resetWater);

// Update water when section is shown
document.getElementById('card-water')?.addEventListener('click', () => {
    setTimeout(updateWaterUI, 50);
});

// ============================================================
// 📋 Symptom Journal
// ============================================================
const SYMPTOM_STORAGE_KEY = 'healthmummy_symptoms';

function getSymptoms() {
    try {
        return JSON.parse(localStorage.getItem(SYMPTOM_STORAGE_KEY)) || [];
    } catch (e) {
        return [];
    }
}

function saveSymptoms(entries) {
    localStorage.setItem(SYMPTOM_STORAGE_KEY, JSON.stringify(entries));
}

function renderSymptomHistory() {
    const historyEl = document.getElementById('symptom-history');
    if (!historyEl) return;
    
    const entries = getSymptoms();
    
    if (entries.length === 0) {
        historyEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No entries yet. Start logging your symptoms!</p>';
        return;
    }
    
    // Show most recent first
    const sorted = [...entries].reverse();
    historyEl.innerHTML = sorted.map(e => {
        const severityLabel = ['', 'Mild', 'Moderate', 'Moderate', 'Severe', 'Very Severe'];
        const severityColor = ['', '#4CAF50', '#8bc34a', '#ffaa00', '#ff7043', '#ff4444'];
        return `
            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <span style="font-size: 0.85rem; color: var(--text-muted);">${e.date}</span>
                    <span style="font-size: 0.8rem; color: ${severityColor[e.severity] || '#888'}; font-weight: 600;">${severityLabel[e.severity] || 'Unknown'}</span>
                </div>
                <div style="font-weight: 600; font-size: 0.95rem;">${e.symptoms}</div>
                ${e.notes ? `<div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">${e.notes}</div>` : ''}
            </div>
        `;
    }).join('');
}

function saveSymptomEntry() {
    const dateInput = document.getElementById('symptom-date');
    const severityInput = document.getElementById('symptom-severity');
    const symptomInput = document.getElementById('symptom-input');
    const notesInput = document.getElementById('symptom-notes');
    
    if (!dateInput || !symptomInput) return;
    
    const date = dateInput.value || new Date().toISOString().split('T')[0];
    const severity = parseInt(severityInput?.value || '3');
    const symptoms = symptomInput.value.trim();
    const notes = notesInput?.value.trim() || '';
    
    if (!symptoms) {
        alert('Please enter at least one symptom.');
        return;
    }
    
    const entries = getSymptoms();
    entries.push({ date, severity, symptoms, notes });
    saveSymptoms(entries);
    
    // Clear form
    symptomInput.value = '';
    if (notesInput) notesInput.value = '';
    
    renderSymptomHistory();
    
    // Show brief success feedback
    const btn = document.getElementById('symptom-save-btn');
    if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '✅ Saved!';
        btn.style.background = '#4CAF50';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 1500);
    }
}

// Set today's date as default
const symptomDateInput = document.getElementById('symptom-date');
if (symptomDateInput) {
    symptomDateInput.value = new Date().toISOString().split('T')[0];
}

// Severity slider sync
const severitySlider = document.getElementById('symptom-severity');
const severityLabel = document.getElementById('symptom-severity-label');
if (severitySlider && severityLabel) {
    severitySlider.addEventListener('input', () => {
        const labels = ['', 'Mild', 'Moderate', 'Moderate', 'Severe', 'Very Severe'];
        const val = parseInt(severitySlider.value);
        severityLabel.textContent = labels[val] || val;
    });
}

// Symptom journal event listeners
document.getElementById('symptom-save-btn')?.addEventListener('click', saveSymptomEntry);

// Render history when section is shown
document.getElementById('card-symptoms')?.addEventListener('click', () => {
    setTimeout(renderSymptomHistory, 50);
});

// ============================================================
// 💊 Medicine Reminder
// ============================================================
const MED_STORAGE_KEY = 'healthmummy_medicines';

function getMedicines() {
    try {
        return JSON.parse(localStorage.getItem(MED_STORAGE_KEY)) || [];
    } catch (e) {
        return [];
    }
}

function saveMedicines(meds) {
    localStorage.setItem(MED_STORAGE_KEY, JSON.stringify(meds));
}

function renderMedicines() {
    const medList = document.getElementById('med-list');
    if (!medList) return;
    
    const meds = getMedicines();
    
    if (meds.length === 0) {
        medList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No medications added yet.</p>';
        return;
    }
    
    medList.innerHTML = meds.map((med, idx) => {
        const takenToday = med.lastTaken && med.lastTaken === new Date().toISOString().split('T')[0];
        const isOverdue = !takenToday && isTimePassed(med.time);
        
        let statusColor = '#888';
        let statusText = '⏰ ' + med.time;
        if (takenToday) {
            statusColor = '#4CAF50';
            statusText = '✅ Taken - ' + med.time;
        } else if (isOverdue) {
            statusColor = '#ff4444';
            statusText = '⚠️ Overdue - ' + med.time;
        }
        
        return `
            <div style="background: ${takenToday ? 'rgba(76,175,80,0.08)' : 'rgba(255,255,255,0.05)'}; border: 1px solid ${takenToday ? 'rgba(76,175,80,0.2)' : 'rgba(255,255,255,0.08)'}; border-radius: 10px; padding: 12px; display: flex; justify-content: space-between; align-items: center;">
                <div style="flex: 1;">
                    <div style="font-weight: 600; font-size: 0.95rem;">${med.name}</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">${med.dosage || ''}</div>
                    <div style="font-size: 0.8rem; color: ${statusColor}; font-weight: 500;">${statusText}</div>
                </div>
                <div style="display: flex; gap: 5px; align-items: center;">
                    <button class="med-toggle-btn" data-index="${idx}" style="background: ${takenToday ? 'rgba(76,175,80,0.2)' : 'rgba(255,255,255,0.1)'}; border: 1px solid ${takenToday ? '#4CAF50' : '#555'}; color: ${takenToday ? '#4CAF50' : '#aaa'}; border-radius: 50%; width: 36px; height: 36px; cursor: pointer; font-size: 1rem; transition: all 0.2s;">
                        ${takenToday ? '✓' : '○'}
                    </button>
                    <button class="med-delete-btn" data-index="${idx}" style="background: transparent; border: none; color: #ff4444; cursor: pointer; font-size: 1.1rem; padding: 5px; opacity: 0.6; transition: opacity 0.2s;" title="Remove">✕</button>
                </div>
            </div>
        `;
    }).join('');
    
    // Attach event listeners to medicine buttons
    document.querySelectorAll('.med-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index);
            toggleMedication(idx);
        });
    });
    
    document.querySelectorAll('.med-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index);
            deleteMedication(idx);
        });
    });
}

function isTimePassed(timeStr) {
    if (!timeStr) return false;
    const [hours, minutes] = timeStr.split(':').map(Number);
    const now = new Date();
    const medTime = new Date();
    medTime.setHours(hours, minutes, 0, 0);
    return now > medTime;
}

function toggleMedication(index) {
    const meds = getMedicines();
    if (!meds[index]) return;
    
    const today = new Date().toISOString().split('T')[0];
    if (meds[index].lastTaken === today) {
        meds[index].lastTaken = ''; // Unmark
    } else {
        meds[index].lastTaken = today;
    }
    saveMedicines(meds);
    renderMedicines();
}

function deleteMedication(index) {
    if (!confirm('Remove this medication?')) return;
    const meds = getMedicines();
    meds.splice(index, 1);
    saveMedicines(meds);
    renderMedicines();
}

function addMedication() {
    const nameInput = document.getElementById('med-name');
    const dosageInput = document.getElementById('med-dosage');
    const timeInput = document.getElementById('med-time');
    const notifyInput = document.getElementById('med-notify');
    
    if (!nameInput || !timeInput) return;
    
    const name = nameInput.value.trim();
    const dosage = dosageInput?.value.trim() || '';
    const time = timeInput.value;
    const notify = notifyInput?.checked || false;
    
    if (!name) {
        alert('Please enter a medicine name.');
        return;
    }
    
    if (!time) {
        alert('Please select a time.');
        return;
    }
    
    // Request notification permission if needed
    if (notify && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    
    const meds = getMedicines();
    meds.push({
        name,
        dosage,
        time,
        notify,
        lastTaken: '',
        id: Date.now(),
        createdAt: new Date().toISOString()
    });
    saveMedicines(meds);
    
    // Clear form
    nameInput.value = '';
    if (dosageInput) dosageInput.value = '';
    
    renderMedicines();
    
    // Success feedback
    const btn = document.getElementById('med-add-btn');
    if (btn) {
        btn.textContent = '✅ Added!';
        setTimeout(() => { btn.textContent = '➕ Add Medicine'; }, 1500);
    }
    
    // Schedule notification
    if (notify && Notification.permission === 'granted') {
        scheduleMedNotification(name, dosage, time);
    }
}

function scheduleMedNotification(name, dosage, time) {
    // Set a timeout for the notification
    const [hours, minutes] = time.split(':').map(Number);
    const now = new Date();
    const scheduled = new Date();
    scheduled.setHours(hours, minutes, 0, 0);
    
    let delay = scheduled - now;
    if (delay < 0) {
        // Already passed today, schedule for tomorrow
        delay += 24 * 60 * 60 * 1000;
    }
    
    setTimeout(() => {
        if (Notification.permission === 'granted') {
            new Notification('💊 Medicine Reminder', {
                body: `Time to take ${name}${dosage ? ' (' + dosage + ')' : ''}`,
                icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>💊</text></svg>'
            });
        }
    }, delay);
}

// Check and schedule notifications for saved medicines on page load
function scheduleAllNotifications() {
    if (Notification.permission !== 'granted') return;
    const meds = getMedicines();
    meds.forEach(med => {
        if (med.notify) {
            scheduleMedNotification(med.name, med.dosage, med.time);
        }
    });
}

// Medicine event listeners
document.getElementById('med-add-btn')?.addEventListener('click', addMedication);

// Render medicines when section is shown
document.getElementById('card-medicine')?.addEventListener('click', () => {
    setTimeout(renderMedicines, 50);
});

// Schedule notifications on startup
if (Notification.permission === 'granted') {
    scheduleAllNotifications();
}

// ============================================================
// 📱 Enhanced Device & Location Tracking
// ============================================================

function getDeviceInfo() {
    const ua = navigator.userAgent;
    const screenRes = `${window.screen.width}x${window.screen.height}`;

    // Detect platform
    let platform = 'desktop';
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) {
        platform = /iPad|Tablet/i.test(ua) ? 'tablet' : 'mobile';
    }

    // Detect browser
    let browser = 'Unknown';
    if (ua.includes('Chrome') && !ua.includes('Edg') && !ua.includes('OPR')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Edg')) browser = 'Edge';
    else if (ua.includes('OPR') || ua.includes('Opera')) browser = 'Opera';

    // Get browser version
    let browserFull = browser;
    try {
        const escapedName = browser.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const browserMatch = ua.match(new RegExp(`${escapedName}\\/(\\d+\\.\\d+)`));
        if (browserMatch) browserFull = `${browser} ${browserMatch[1]}`;
    } catch (e) { /* ignore regex issues */ }

    // Detect OS
    let os = 'Unknown';
    if (/Windows NT 10/i.test(ua)) os = 'Windows 10';
    else if (/Windows NT 11/i.test(ua)) os = 'Windows 11';
    else if (/Windows NT 6\.3/i.test(ua)) os = 'Windows 8.1';
    else if (/Windows NT 6\.1/i.test(ua)) os = 'Windows 7';
    else if (/Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
    else if (/Linux/i.test(ua) && !/Android/i.test(ua)) os = 'Linux';
    else if (/CrOS/i.test(ua)) os = 'ChromeOS';

    return {
        platform,
        browser: browserFull,
        os,
        screen_resolution: screenRes,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown',
        language: navigator.language || navigator.userLanguage || 'Unknown',
        referrer: document.referrer || '(direct)'
    };
}

async function getIPGeolocation() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch('https://ip-api.com/json/', {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.status === 'success') {
            return {
                ip: data.query || '',
                city: data.city || '',
                region: data.regionName || '',
                country: data.country || '',
                isp: data.isp || ''
            };
        }
    } catch (e) {
        console.warn('IP geolocation unavailable:', e.message);
    }
    return { ip: '', city: '', region: '', country: '', isp: '' };
}

// ============================================================
// ⏱️ Session Duration Tracker
// ============================================================

let sessionTimerInterval = null;

function startSessionTimer(loginTimeISO) {
    const timerEl = document.getElementById('session-timer');
    const durationEl = document.getElementById('session-duration');
    if (!timerEl || !durationEl) return;
    
    const loginTime = new Date(loginTimeISO).getTime();
    if (isNaN(loginTime)) return;
    
    timerEl.style.display = 'block';
    
    // Persist session time for page refreshes
    try {
        localStorage.setItem('healthmummy_session_start', loginTimeISO);
    } catch (e) { /* ignore */ }
    
    function updateDuration() {
        const elapsed = Math.floor((Date.now() - loginTime) / 60000); // minutes
        if (elapsed < 1) {
            durationEl.textContent = '<1m';
        } else if (elapsed < 60) {
            durationEl.textContent = elapsed + 'm';
        } else {
            const hours = Math.floor(elapsed / 60);
            const mins = elapsed % 60;
            durationEl.textContent = hours + 'h ' + mins + 'm';
        }
    }
    
    updateDuration();
    sessionTimerInterval = setInterval(updateDuration, 30000); // update every 30s
}

function stopSessionTimer() {
    if (sessionTimerInterval) {
        clearInterval(sessionTimerInterval);
        sessionTimerInterval = null;
    }
    const timerEl = document.getElementById('session-timer');
    if (timerEl) timerEl.style.display = 'none';
    try {
        localStorage.removeItem('healthmummy_session_start');
    } catch (e) { /* ignore */ }
}

// Restore session timer on page load if session exists
(function restoreSessionTimer() {
    try {
        const savedLoginTime = localStorage.getItem('healthmummy_session_start');
        if (savedLoginTime) {
            const elapsed = Date.now() - new Date(savedLoginTime).getTime();
            // Only restore if less than 24 hours old
            if (elapsed < 24 * 60 * 60 * 1000 && elapsed > 0) {
                startSessionTimer(savedLoginTime);
            } else {
                localStorage.removeItem('healthmummy_session_start');
            }
        }
    } catch (e) { /* ignore */ }
})();
const SUPABASE_URL = 'https://tswndevadeowsbivxrec.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_HBYXO_d41bbHEWxfzCRdjw_xEm13y1t';

async function saveLoginToSupabase(userData) {
    try {
        const payload = {
            name: userData.name || 'Unknown',
            email: userData.email || '',
            picture: userData.picture || '',
            login_time: userData.login_time || new Date().toISOString(),
            user_agent: navigator.userAgent.substring(0, 300),
            // Enhanced device fields
            device_type: userData.platform || '',
            browser: userData.browser || '',
            os: userData.os || '',
            timezone: userData.timezone || '',
            language: userData.language || '',
            screen_resolution: userData.screen_resolution || '',
            referrer: userData.referrer || '',
            ip_address: userData.ip || '',
            city: userData.city || '',
            region: userData.region || '',
            country: userData.country || '',
            isp: userData.isp || '',
            session_id: userData.session_id || ''
        };
        
        const response = await fetch(`${SUPABASE_URL}/rest/v1/logins`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            console.warn('Supabase login save warning:', response.status);
        }
        return true;
    } catch (error) {
        console.warn('Supabase save error:', error.message);
        return false;
    }
}

function saveLoginLocal(userData) {
    try {
        const logins = JSON.parse(localStorage.getItem('healthmummy_logins') || '[]');
        logins.push({
            name: userData.name || 'Unknown',
            email: userData.email || '',
            picture: userData.picture || '',
            login_time: userData.login_time || new Date().toISOString(),
            session_id: userData.session_id || '',
            platform: userData.platform || '',
            browser: userData.browser || '',
            os: userData.os || '',
            screen_resolution: userData.screen_resolution || '',
            timezone: userData.timezone || '',
            language: userData.language || '',
            referrer: userData.referrer || '',
            ip: userData.ip || '',
            city: userData.city || '',
            region: userData.region || '',
            country: userData.country || '',
            isp: userData.isp || ''
        });
        localStorage.setItem('healthmummy_logins', JSON.stringify(logins));
    } catch (e) { /* ignore */ }
}

function renderLoginCard(l, isLocal = false) {
    const time = new Date(l.login_time);
    const timeStr = time.toLocaleDateString() + ' ' + time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const initial = (l.name || '?')[0].toUpperCase();
    
    // Build details section
    const details = [];
    if (l.browser) details.push(`<span style="color: #8BC34A;">🌐</span> ${l.browser}`);
    if (l.os) details.push(`<span style="color: #42A5F5;">💻</span> ${l.os}`);
    if (l.platform) details.push(`<span style="color: #AB47BC;">📱</span> ${l.platform}`);
    if (l.screen_resolution) details.push(`<span style="color: #FFA726;">🖥️</span> ${l.screen_resolution}`);
    if (l.timezone) details.push(`<span style="color: #78909C;">🕐</span> ${l.timezone}`);
    if (l.language) details.push(`<span style="color: #26A69A;">🌍</span> ${l.language}`);
    if (l.referrer && l.referrer !== '(direct)') details.push(`<span style="color: #90A4AE;">🔗</span> ${l.referrer}`);
    
    // Location info
    const locationParts = [];
    if (l.city) locationParts.push(l.city);
    if (l.region) locationParts.push(l.region);
    if (l.country) locationParts.push(l.country);
    const locationStr = locationParts.length > 0 ? locationParts.join(', ') : '';
    if (locationStr) details.unshift(`<span style="color: #EF5350;">📍</span> ${locationStr}`);
    if (l.ip) details.unshift(`<span style="color: #66BB6A;">🔢</span> IP: ${l.ip}`);
    if (l.isp) details.push(`<span style="color: #A1887F;">📡</span> ${l.isp}`);
    
    const detailsHtml = details.length > 0
        ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 0.75rem; display: flex; flex-wrap: wrap; gap: 6px;">
            ${details.map(d => `<span style="background: rgba(255,255,255,0.04); padding: 3px 8px; border-radius: 6px;">${d}</span>`).join('')}
           </div>`
        : '<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 0.75rem; color: var(--text-muted);">No device info captured</div>';
    
    const sourceBadge = isLocal
        ? '<span style="font-size: 0.65rem; color: #ffaa00; border: 1px solid rgba(255,170,0,0.3); padding: 2px 8px; border-radius: 10px;">local</span>'
        : '<span style="font-size: 0.65rem; color: #4CAF50; border: 1px solid rgba(76,175,80,0.3); padding: 2px 8px; border-radius: 10px;">cloud</span>';
    
    return `
        <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px;">
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #4CAF50, #2E7D32); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.1rem; flex-shrink: 0;">${initial}</div>
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="font-weight: 600; font-size: 0.95rem;">${l.name || 'Unknown'}</span>
                        ${sourceBadge}
                    </div>
                    ${l.email ? `<div style="font-size: 0.8rem; color: var(--text-muted);">${l.email}</div>` : ''}
                    <div style="font-size: 0.75rem; color: #888; margin-top: 2px;">⏱️ ${timeStr}</div>
                </div>
                <div style="display: flex; gap: 6px; align-items: center;">
                    <span style="font-size: 0.7rem; color: #4CAF50; font-weight: 500; padding: 3px 10px; background: rgba(76,175,80,0.1); border-radius: 20px;">✓</span>
                </div>
            </div>
            ${detailsHtml}
        </div>
    `;
}

async function loadLoginHistory() {
    const listEl = document.getElementById('login-history-list');
    if (!listEl) return;
    
    listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">🔄 Loading...</p>';
    
    let rendered = false;
    
    // Try Supabase first
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/logins?order=login_time.desc&limit=50`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });
        
        if (!response.ok) throw new Error('Supabase unavailable');
        
        const logins = await response.json();
        
        if (logins.length === 0) {
            listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No logins recorded yet. Sign in to track!</p>';
            rendered = true;
        } else {
            listEl.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px; display: flex; justify-content: space-between;"><span>📊 ' + logins.length + ' recent logins</span><span style="color: #4CAF50;">● cloud</span></div>' +
                logins.map(l => renderLoginCard(l)).join('');
            rendered = true;
        }
    } catch (error) {
        console.warn('Login history fallback to local:', error.message);
    }
    
    // If Supabase failed or is empty, merge with local data
    if (!rendered) {
        const localLogins = JSON.parse(localStorage.getItem('healthmummy_logins') || '[]');
        
        if (localLogins.length === 0) {
            listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No login history. Sign in to start tracking!<br><span style="font-size: 0.75rem;">Login tracking captures: device type, browser, OS, screen size, timezone, language, IP location, and more.</span></p>';
            return;
        }
        
        listEl.innerHTML = '<div style="font-size: 0.8rem; color: #ffaa00; margin-bottom: 8px; display: flex; justify-content: space-between;"><span>📊 ' + localLogins.length + ' logins</span><span style="color: #ffaa00;">● local</span></div>' +
            localLogins.reverse().map(l => renderLoginCard(l, true)).join('');
    }
}

// Refresh button handler
document.getElementById('refresh-logins-btn')?.addEventListener('click', loadLoginHistory);

// ============================================================
// 📊 Login Analytics — Charts & Statistics
// ============================================================

// Chart.js dark theme defaults
const CHART_COLORS = [
    '#4CAF50', '#2196F3', '#FFC107', '#FF5722', '#9C27B0',
    '#00BCD4', '#FF4081', '#8BC34A', '#FF9800', '#607D8B',
    '#E91E63', '#3F51B5', '#009688', '#CDDC39', '#795548'
];

let chartInstances = {};
let selectedRange = 'all'; // '7d', '30d', or 'all'

function getLoginData() {
    // Login data is always saved to localStorage on sign-in (see handleCredentialResponse)
    // Supabase is an async remote backup — localStorage is the primary analytics source
    try {
        return JSON.parse(localStorage.getItem('healthmummy_logins') || '[]');
    } catch (e) {
        return [];
    }
}

function filterLoginsByRange(logins, range) {
    if (range === 'all' || !logins || logins.length === 0) return logins;
    
    const cutoff = new Date();
    if (range === '7d') cutoff.setDate(cutoff.getDate() - 7);
    else if (range === '30d') cutoff.setDate(cutoff.getDate() - 30);
    
    return logins.filter(l => {
        if (!l.login_time) return true;
        const loginDate = new Date(l.login_time);
        return loginDate >= cutoff;
    });
}

function computeAnalytics(logins) {
    if (!logins || logins.length === 0) {
        return { total: 0, uniqueUsers: 0, activeDays: 0, platformCount: 0 };
    }

    // --- Summary stats ---
    const uniqueEmails = new Set(logins.map(l => l.email).filter(Boolean));
    const uniqueDays = new Set(logins.map(l => l.login_time ? l.login_time.split('T')[0] : null).filter(Boolean));
    const platforms = new Set(logins.map(l => l.platform || 'desktop').filter(Boolean));

    // --- Logins per day (adapts to selected range) ---
    const dailyMap = {};
    const today = new Date();
    let dailyRangeDays = 14; // default
    if (selectedRange === '7d') dailyRangeDays = 7;
    else if (selectedRange === '30d') dailyRangeDays = 30;
    else if (selectedRange === 'all') {
        // Use max span from data (capped at 90 for readability)
        const dates = logins.map(l => l.login_time ? new Date(l.login_time) : null).filter(Boolean);
        if (dates.length > 0) {
            const minDate = new Date(Math.min(...dates));
            const maxDate = new Date(Math.max(...dates));
            dailyRangeDays = Math.min(90, Math.max(14, Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24))));
        }
    }
    for (let i = dailyRangeDays - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        dailyMap[key] = 0;
    }
    logins.forEach(l => {
        if (l.login_time) {
            const day = l.login_time.split('T')[0];
            if (dailyMap[day] !== undefined) dailyMap[day]++;
        }
    });
    const dailyLabels = Object.keys(dailyMap).map(d => {
        const dt = new Date(d);
        return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    });
    const dailyValues = Object.values(dailyMap);

    // --- Browser distribution ---
    const browserMap = {};
    logins.forEach(l => {
        if (l.browser) {
            const b = l.browser.split(' ')[0]; // Just the name, not version
            browserMap[b] = (browserMap[b] || 0) + 1;
        }
    });

    // --- OS distribution ---
    const osMap = {};
    logins.forEach(l => {
        if (l.os && l.os !== 'Unknown') {
            osMap[l.os] = (osMap[l.os] || 0) + 1;
        }
    });
    // If no OS data, show a single "Unknown" entry
    if (Object.keys(osMap).length === 0 && logins.length > 0) {
        osMap['Unknown'] = logins.length;
    }

    // --- Platform breakdown ---
    const platformMap = { desktop: 0, mobile: 0, tablet: 0 };
    logins.forEach(l => {
        const p = (l.platform || 'desktop').toLowerCase();
        if (platformMap[p] !== undefined) platformMap[p]++;
        else platformMap['desktop']++;
    });

    // --- Hourly activity ---
    const hourly = Array(24).fill(0);
    logins.forEach(l => {
        if (l.login_time) {
            const hour = new Date(l.login_time).getHours();
            if (hour >= 0 && hour < 24) hourly[hour]++;
        }
    });
    const hourlyLabels = hourly.map((_, i) => {
        if (i === 0) return '12a';
        if (i < 12) return i + 'a';
        if (i === 12) return '12p';
        return (i - 12) + 'p';
    });

    // --- Top locations ---
    const locationMap = {};
    logins.forEach(l => {
        const parts = [];
        if (l.city) parts.push(l.city);
        if (l.country) parts.push(l.country);
        const loc = parts.join(', ');
        if (loc) {
            locationMap[loc] = (locationMap[loc] || 0) + 1;
        }
    });

    // --- User Growth (cumulative unique users over time, by day) ---
    const firstLoginByEmail = {}; // email → earliest login_time
    logins.forEach(l => {
        if (l.email && l.login_time) {
            if (!firstLoginByEmail[l.email] || l.login_time < firstLoginByEmail[l.email]) {
                firstLoginByEmail[l.email] = l.login_time;
            }
        }
    });
    // Build time series: earliest → latest (by day), cumulative sum
    const growthEvents = Object.entries(firstLoginByEmail)
        .map(([email, time]) => time.split('T')[0])
        .sort();
    const growthDateMap = {};
    growthEvents.forEach(date => {
        growthDateMap[date] = (growthDateMap[date] || 0) + 1;
    });
    // Build full date range from earliest first-login to today
    let growthLabels = [];
    let growthValues = [];
    const growthDates = Object.keys(growthDateMap).sort();
    if (growthDates.length > 0) {
        const startDate = new Date(growthDates[0]);
        const endDate = new Date();
        let cumulative = 0;
        const current = new Date(startDate);
        while (current <= endDate) {
            const key = current.toISOString().split('T')[0];
            const dtLabel = current.toLocaleDateString([], { month: 'short', day: 'numeric' });
            growthLabels.push(dtLabel);
            cumulative += growthDateMap[key] || 0;
            growthValues.push(cumulative);
            current.setDate(current.getDate() + 1);
        }
    }

    return {
        total: logins.length,
        uniqueUsers: uniqueEmails.size,
        activeDays: uniqueDays.size,
        platformCount: platforms.size,
        dailyLabels,
        dailyValues,
        browserMap,
        osMap,
        platformMap,
        hourly,
        hourlyLabels,
        locationMap,
        growthLabels,
        growthValues
    };
}

function renderSummaryCards(stats) {
    const setStat = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.querySelector('.stat-value').textContent = val;
    };
    setStat('stat-total', stats.total);
    setStat('stat-users', stats.uniqueUsers);
    setStat('stat-days', stats.activeDays);
    setStat('stat-platforms', stats.platformCount);
}

function destroyCharts() {
    Object.values(chartInstances).forEach(c => {
        if (c) { try { c.destroy(); } catch (e) { /* ignore */ } }
    });
    chartInstances = {};
}

function createChart(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    try {
        const ctx = canvas.getContext('2d');
        const chart = new Chart(ctx, config);
        chartInstances[id] = chart;
        return chart;
    } catch (e) {
        console.warn('Chart render error for ' + id + ':', e.message);
        return null;
    }
}

function getChartTextColor() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? '#555' : '#ccc';
}
function getChartTickColor() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? '#777' : '#999';
}
function getChartGridColor() {
    return document.documentElement.getAttribute('data-theme') === 'light'
        ? 'rgba(0,0,0,0.06)'
        : 'rgba(255,255,255,0.04)';
}

function chartTextOpts() {
    const textColor = getChartTextColor();
    const tickColor = getChartTickColor();
    const gridColor = getChartGridColor();
    return {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
            legend: {
                labels: { color: textColor, font: { size: 11 }, padding: 12 }
            }
        },
        scales: {
            x: {
                ticks: { color: tickColor, font: { size: 10 } },
                grid: { color: gridColor }
            },
            y: {
                beginAtZero: true,
                ticks: { color: tickColor, font: { size: 10 }, stepSize: 1 },
                grid: { color: gridColor }
            }
        }
    };
}

function renderDailyChart(labels, values) {
    createChart('chart-daily', {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Logins',
                data: values,
                backgroundColor: values.map(v =>
                    v > 0 ? 'rgba(76, 175, 80, 0.7)' : 'rgba(255,255,255,0.05)'
                ),
                borderColor: values.map(v =>
                    v > 0 ? '#4CAF50' : 'transparent'
                ),
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            ...chartTextOpts(),
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderDoughnutChart(id, label, dataMap) {
    const entries = Object.entries(dataMap).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(e => e[0]);
    const values = entries.map(e => e[1]);
    const colors = labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

    if (labels.length === 0) {
        // Use the empty-state div instead of destroying the canvas
        const canvas = document.getElementById(id);
        if (canvas) {
            const card = canvas.closest('.chart-card');
            if (card) {
                const wrapper = card.querySelector('.chart-wrapper');
                const empty = card.querySelector('.chart-empty');
                if (wrapper) wrapper.style.display = 'none';
                if (empty) empty.style.display = 'flex';
            }
        }
        return;
    }

    createChart(id, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderColor: 'rgba(30,30,30,0.8)',
                borderWidth: 2
            }]
        },
        options: {
            ...chartTextOpts(),
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: getChartTextColor(),
                        font: { size: 10 },
                        padding: 10,
                        boxWidth: 12
                    }
                }
            }
        }
    });
}

function renderPlatformChart(platformMap) {
    const labels = [];
    const values = [];
    const colors = { desktop: '#4CAF50', mobile: '#2196F3', tablet: '#9C27B0' };
    const icons = { desktop: '💻', mobile: '📱', tablet: '📟' };

    ['desktop', 'mobile', 'tablet'].forEach(p => {
        if (platformMap[p] > 0) {
            labels.push(`${icons[p]} ${p}`);
            values.push(platformMap[p]);
        }
    });

    if (values.length === 0) {
        // Use the empty-state div instead of destroying the canvas
        const canvas = document.getElementById('chart-platform');
        if (canvas) {
            const card = canvas.closest('.chart-card');
            if (card) {
                const wrapper = card.querySelector('.chart-wrapper');
                const empty = card.querySelector('.chart-empty');
                if (wrapper) wrapper.style.display = 'none';
                if (empty) empty.style.display = 'flex';
            }
        }
        return;
    }

    createChart('chart-platform', {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: labels.map(l => colors[l.split(' ')[1]] || '#888'),
                borderColor: 'rgba(30,30,30,0.8)',
                borderWidth: 2
            }]
        },
        options: {
            ...chartTextOpts(),
            cutout: '55%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: getChartTextColor(), font: { size: 11 }, padding: 12, boxWidth: 12 }
                }
            }
        }
    });
}

function renderHourlyChart(hourly, labels) {
    const peak = Math.max(...hourly, 1);
    createChart('chart-hourly', {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Logins',
                data: hourly,
                backgroundColor: hourly.map(v =>
                    v > 0 ? `rgba(33, 150, 243, ${0.3 + (v / peak) * 0.5})` : 'rgba(255,255,255,0.03)'
                ),
                borderColor: hourly.map(v =>
                    v > 0 ? 'rgba(33, 150, 243, 0.8)' : 'transparent'
                ),
                borderWidth: 1,
                borderRadius: 3
            }]
        },
        options: {
            ...chartTextOpts(),
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderUserGrowthChart(labels, values) {
    if (!labels || labels.length === 0 || !values || values.length === 0) {
        const canvas = document.getElementById('chart-growth');
        if (canvas) {
            const card = canvas.closest('.chart-card');
            if (card) {
                const wrapper = card.querySelector('.chart-wrapper');
                const empty = card.querySelector('.chart-empty');
                if (wrapper) wrapper.style.display = 'none';
                if (empty) empty.style.display = 'flex';
            }
        }
        return;
    }

    const gridColor = getChartGridColor();
    const textColor = getChartTextColor();
    const tickColor = getChartTickColor();
    createChart('chart-growth', {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Total Users',
                data: values,
                fill: true,
                backgroundColor: 'rgba(76, 175, 80, 0.15)',
                borderColor: '#4CAF50',
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#4CAF50',
                pointBorderColor: '#fff',
                pointBorderWidth: 1,
                pointHoverRadius: 5,
                tension: 0.3
            }]
        },
        options: {
            ...chartTextOpts(),
            scales: {
                x: {
                    ticks: { color: tickColor, font: { size: 9 }, maxTicksLimit: 8 },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: tickColor,
                        font: { size: 10 },
                        stepSize: Math.max(1, Math.floor(Math.max(...values, 1) / 5))
                    },
                    grid: { color: gridColor }
                }
            },
            plugins: {
                legend: {
                    labels: { color: textColor, font: { size: 10 }, boxWidth: 12, padding: 8 }
                },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            return 'Users: ' + ctx.parsed.y;
                        }
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
}

function renderLocationList(locationMap) {
    const container = document.getElementById('location-list');
    if (!container) return;

    const entries = Object.entries(locationMap).sort((a, b) => b[1] - a[1]).slice(0, 10);

    if (entries.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No location data yet — sign in to see where users are from!</p>';
        return;
    }

    container.innerHTML = entries.map(([loc, count]) =>
        `<div class="location-item">
            <span>📍 ${loc}</span>
            <span class="location-count">${count}</span>
        </div>`
    ).join('');
}

function setChartEmptyState(hasData) {
    document.querySelectorAll('.chart-card').forEach(c => {
        const wrapper = c.querySelector('.chart-wrapper');
        const empty = c.querySelector('.chart-empty');
        if (wrapper && empty) {
            wrapper.style.display = hasData ? '' : 'none';
            empty.style.display = hasData ? 'none' : '';
        }
    });
}

function runAnalytics() {
    const allLogins = getLoginData();

    // Destroy old charts before anything
    destroyCharts();

    // Update active filter button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === selectedRange);
    });

    // Filter by selected date range
    const logins = filterLoginsByRange(allLogins, selectedRange);

    if (logins.length === 0) {
        renderSummaryCards({ total: 0, uniqueUsers: 0, activeDays: 0, platformCount: 0 });
        setChartEmptyState(false);
        // Reset location list
        const locContainer = document.getElementById('location-list');
        if (locContainer) locContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center;">' +
            (allLogins.length > 0 ? 'No logins in this date range. Try a different filter.' : 'No login data yet. Sign in to see analytics!') +
            '</p>';
        return;
    }

    const stats = computeAnalytics(logins);

    // Show charts, hide empty states
    setChartEmptyState(true);

    // Render everything
    renderSummaryCards(stats);
    renderDailyChart(stats.dailyLabels, stats.dailyValues);
    renderDoughnutChart('chart-browser', 'Browser', stats.browserMap);
    renderDoughnutChart('chart-os', 'OS', stats.osMap);
    renderPlatformChart(stats.platformMap);
    renderHourlyChart(stats.hourly, stats.hourlyLabels);
    renderUserGrowthChart(stats.growthLabels, stats.growthValues);
    renderLocationList(stats.locationMap);
}

// Filter button event listeners
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const range = btn.dataset.range;
        if (range === selectedRange) return;
        selectedRange = range;
        runAnalytics();
    });
});

// Refresh handler
document.getElementById('refresh-analytics-btn')?.addEventListener('click', runAnalytics);

// ============================================================
// 📤 Export Analytics Data (CSV & JSON)
// ============================================================

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function getExportLabel() {
    const labels = { '7d': '7days', '30d': '30days', 'all': 'alltime' };
    return labels[selectedRange] || 'alltime';
}

function formatCSVValue(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    // Escape quotes and wrap in quotes if contains comma, quote, or newline
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function exportLoginCSV() {
    const logins = getLoginData();
    const filtered = filterLoginsByRange(logins, selectedRange);

    if (filtered.length === 0) {
        alert('No login data to export in the current range.');
        return;
    }

    // Columns: all tracked fields
    const columns = [
        'Name', 'Email', 'Login Time', 'Session ID',
        'Platform', 'Browser', 'OS', 'Screen Resolution',
        'Timezone', 'Language', 'Referrer',
        'IP Address', 'City', 'Region', 'Country', 'ISP'
    ];

    const rows = filtered.map(l => [
        l.name || '',
        l.email || '',
        l.login_time || '',
        l.session_id || '',
        l.platform || '',
        l.browser || '',
        l.os || '',
        l.screen_resolution || '',
        l.timezone || '',
        l.language || '',
        l.referrer || '',
        l.ip || '',
        l.city || '',
        l.region || '',
        l.country || '',
        l.isp || ''
    ].map(formatCSVValue));

    const header = columns.join(',');
    const body = rows.map(r => r.join(',')).join('\n');
    const csv = header + '\n' + body;

    const label = getExportLabel();
    const date = new Date().toISOString().split('T')[0];
    downloadFile(csv, `healthmummy_logins_${label}_${date}.csv`, 'text/csv;charset=utf-8;');
}

function exportAnalyticsJSON() {
    const logins = getLoginData();
    const filtered = filterLoginsByRange(logins, selectedRange);

    if (filtered.length === 0) {
        alert('No login data to export in the current range.');
        return;
    }

    // Build a structured export object
    const exportData = {
        exported_at: new Date().toISOString(),
        date_range: selectedRange === 'all' ? 'all_time' : selectedRange,
        total_logins: filtered.length,
        unique_users: new Set(filtered.map(l => l.email).filter(Boolean)).size,
        logins: filtered.map(l => ({
            name: l.name || '',
            email: l.email || '',
            login_time: l.login_time || '',
            session_id: l.session_id || '',
            device: {
                platform: l.platform || '',
                browser: l.browser || '',
                os: l.os || '',
                screen_resolution: l.screen_resolution || ''
            },
            locale: {
                timezone: l.timezone || '',
                language: l.language || '',
                referrer: l.referrer || ''
            },
            location: {
                ip: l.ip || '',
                city: l.city || '',
                region: l.region || '',
                country: l.country || '',
                isp: l.isp || ''
            }
        }))
    };

    const json = JSON.stringify(exportData, null, 2);
    const label = getExportLabel();
    const date = new Date().toISOString().split('T')[0];
    downloadFile(json, `healthmummy_analytics_${label}_${date}.json`, 'application/json;charset=utf-8;');
}

// Export button event listeners
document.getElementById('export-csv-btn')?.addEventListener('click', exportLoginCSV);
document.getElementById('export-json-btn')?.addEventListener('click', exportAnalyticsJSON);

// ============================================================
// 🌗 Dark/Light Theme Toggle
// ============================================================

const THEME_STORAGE_KEY = 'healthmummy_theme';

function getSavedTheme() {
    try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) { /* ignore */ }
    // Check system preference as fallback
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    
    // Toggle icon visibility
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    if (sunIcon && moonIcon) {
        if (theme === 'light') {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'block';
        } else {
            sunIcon.style.display = 'block';
            moonIcon.style.display = 'none';
        }
    }
    
    // Save preference
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (e) { /* ignore */ }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
}

// Theme toggle button
const themeToggle = document.getElementById('theme-toggle');
if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
}

// Apply saved theme on load
applyTheme(getSavedTheme());

// ============================================================
// Initialize all features on page load
// ============================================================
// === Validation Helpers ===
function sanitize(s){return (s||'').replace(/<[^>]*>/g,'').trim()}
function isValidEmail(e){return /^[\w.\-]+@[a-zA-Z\d\-]+\.[a-zA-Z]{2,}$/.test(e)}
function getPwdErrors(p){var e=[];if(p.length<8)e.push('8+ chars');if(!/[A-Z]/.test(p))e.push('uppercase');if(!/[0-9]/.test(p))e.push('number');if(!/[!@#$%^&*(),.?:{}|<>]/.test(p))e.push('special char');return e}
function isValidPhone(p){return p===''||/^[\d\-\+\s()]{7,20}$/.test(p)}
function showFieldError(id,msg){var el=document.getElementById(id);if(el){el.textContent=msg;el.style.display=msg?'block':'none';var inpId=id.replace('-error','');var inp=document.getElementById(inpId);if(inp&&(inp.tagName==='INPUT'||inp.tagName==='SELECT'||inp.tagName==='TEXTAREA')){if(msg)inp.classList.add('error');else inp.classList.remove('error')}}}
function clearAllErrors(){document.querySelectorAll('.field-error').forEach(function(el){el.textContent='';el.style.display='none'});document.querySelectorAll('input.error').forEach(function(el){el.classList.remove('error')});document.querySelectorAll('input.valid').forEach(function(el){el.classList.remove('valid')})}

// === User Auth ===
var currentUser=null;
function loadCurrentUser(){try{var s=localStorage.getItem('healthmummy_current_user');if(s)currentUser=JSON.parse(s)}catch(e){}}
function saveCurrentUser(u){currentUser=u;localStorage.setItem('healthmummy_current_user',JSON.stringify(u))}
function getAllUsers(){try{return JSON.parse(localStorage.getItem('healthmummy_users')||'[]')}catch(e){return[]}}
function saveAllUsers(u){localStorage.setItem('healthmummy_users',JSON.stringify(u))}
function isLoggedIn(){return currentUser!==null}
function showToast(m){var t=document.querySelector('.toast-notification');if(t)t.remove();t=document.createElement('div');t.className='toast-notification';t.textContent=m;document.body.appendChild(t);setTimeout(function(){t.style.opacity='0';setTimeout(function(){t.remove()},300)},3000)}
function openAuthModal(t){var m=document.getElementById('pwd-strength-meter');if(m)m.style.display='none';var o=document.getElementById('auth-modal-overlay');if(!o)return;o.style.display='flex';document.getElementById('login-form').style.display=t==='register'?'none':'block';document.getElementById('register-form').style.display=t==='register'?'block':'none';o.setAttribute('aria-labelledby',t==='register'?'reg-modal-title':'auth-modal-title')}
function closeAuthModal(){var o=document.getElementById('auth-modal-overlay');if(o)o.style.display='none'}

// === Registration with validation ===
function handleRegister(){clearAllErrors();var n=sanitize(document.getElementById('reg-name')?.value||'');var e=sanitize(document.getElementById('reg-email')?.value||'');var p=document.getElementById('reg-password')?.value||'';var c=document.getElementById('reg-confirm')?.value||'';var hasErr=false;if(!n){showFieldError('reg-name-error','Name is required');hasErr=true}if(!e){showFieldError('reg-email-error','Email is required');hasErr=true}else if(!isValidEmail(e)){showFieldError('reg-email-error','Invalid email format');hasErr=true}if(!p){showFieldError('reg-password-error','Password is required');hasErr=true}else{var pwdErrs=getPwdErrors(p);if(pwdErrs.length){showFieldError('reg-password-error','Need: '+pwdErrs.join(', '));hasErr=true}}if(!c){showFieldError('reg-confirm-error','Confirm your password');hasErr=true}else if(p!==c){showFieldError('reg-confirm-error','Passwords do not match');hasErr=true}if(hasErr)return;var u=getAllUsers();if(u.find(function(x){return x.email===e})){showFieldError('reg-email-error','Email already registered');return}var nu={id:'u_'+Date.now(),name:n,email:e,password:p,phone:'',dob:'',createdAt:new Date().toISOString()};u.push(nu);saveAllUsers(u);saveCurrentUser({id:nu.id,name:n,email:e,phone:'',dob:'',createdAt:nu.createdAt});closeAuthModal();showToast('Welcome '+n+'!');updateProfileDisplay();document.getElementById('hero-section').style.display='none';document.getElementById('main-app').style.display='flex';showSection('dashboard-section')}

function handleLogin(){clearAllErrors();var e=sanitize(document.getElementById('login-email')?.value||'');var p=document.getElementById('login-password')?.value||'';var hasErr=false;if(!e){showFieldError('login-email-error','Email is required');hasErr=true}else if(!isValidEmail(e)){showFieldError('login-email-error','Invalid email format');hasErr=true}if(!p){showFieldError('login-password-error','Password is required');hasErr=true}if(hasErr)return;var u=getAllUsers();var user=u.find(function(x){return x.email===e&&x.password===p});if(!user){showFieldError('login-email-error','Invalid email or password');showFieldError('login-password-error','Invalid email or password');return}saveCurrentUser({id:user.id,name:user.name,email:user.email,phone:user.phone||'',dob:user.dob||'',createdAt:user.createdAt});closeAuthModal();showToast('Welcome '+user.name);updateProfileDisplay();document.getElementById('hero-section').style.display='none';document.getElementById('main-app').style.display='flex';showSection('dashboard-section')}
function handleLogout(){localStorage.removeItem('healthmummy_current_user');currentUser=null;showToast('Signed out');updateProfileDisplay();showSection('dashboard-section')}
function updateProfileDisplay(){var ne=document.getElementById('profile-display-name');var ee=document.getElementById('profile-display-email');var te=document.getElementById('profile-account-type');if(isLoggedIn()){if(ne)ne.textContent=currentUser.name;if(ee)ee.textContent=currentUser.email;if(te)te.textContent='Registered User'}else{if(ne)ne.textContent='Guest';if(ee)ee.textContent='Not signed in';if(te)te.textContent='Guest'}}
function loadProfile(){if(!isLoggedIn()){['profile-name','profile-email','profile-phone','profile-dob'].forEach(function(id){var el=document.getElementById(id);if(el)el.value=''});updateProfileDisplay();return}document.getElementById('profile-name').value=currentUser.name||'';document.getElementById('profile-email').value=currentUser.email||'';document.getElementById('profile-phone').value=currentUser.phone||'';document.getElementById('profile-dob').value=currentUser.dob||'';updateProfileDisplay()}

function saveProfile(){if(!isLoggedIn()){showToast('Sign in first');return}clearAllErrors();var n=sanitize(document.getElementById('profile-name').value||'');var e=sanitize(document.getElementById('profile-email').value||'');var p=sanitize(document.getElementById('profile-phone').value||'');var d=document.getElementById('profile-dob').value;var hasErr=false;if(!n){showFieldError('profile-name-error','Name is required');hasErr=true}if(!e){showFieldError('profile-email-error','Email is required');hasErr=true}else if(!isValidEmail(e)){showFieldError('profile-email-error','Invalid email format');hasErr=true}if(p&&!isValidPhone(p)){showFieldError('profile-phone-error','Invalid phone format');hasErr=true}if(hasErr)return;var u=getAllUsers();var idx=u.findIndex(function(x){return x.id===currentUser.id});if(idx!==-1){u[idx].name=n;u[idx].email=e;u[idx].phone=p;u[idx].dob=d;saveAllUsers(u);currentUser.name=n;currentUser.email=e;currentUser.phone=p;currentUser.dob=d;saveCurrentUser(currentUser);updateProfileDisplay();showToast('Profile updated!')}else{showToast('Error saving profile')}}
function getAppts(){try{return JSON.parse(localStorage.getItem('healthmummy_appointments')||'[]')}catch(e){return[]}}
function saveAppts(a){localStorage.setItem('healthmummy_appointments',JSON.stringify(a))}
var apptFilter='all';
function renderAppointments(){var c=document.getElementById('appointment-list');if(!c)return;var appts=getAppts();var now=new Date();if(apptFilter==='upcoming'){appts=appts.filter(function(a){return new Date(a.date+'T'+a.time)>now})}else if(apptFilter==='past'){appts=appts.filter(function(a){return new Date(a.date+'T'+a.time)<=now})}var html='';appts.forEach(function(a){var d=new Date(a.date+'T'+a.time);var uc=d>now;var sc='upcoming';var st='Upcoming';if(a.status==='cancelled'){sc='cancelled';st='Cancelled'}else if(!uc){sc='past';st='Past'}var ds=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});var ts=d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});html+='<div class="appointment-card"><div class="appt-info"><h4>'+a.doctor+'</h4><p>'+ds+' at '+ts+'</p>';if(a.notes){html+='<p style="margin-top:6px;font-style:italic;">'+a.notes+'</p>'}html+='</div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;"><span class="appt-status '+sc+'">'+st+'</span>';if(uc){html+='<button onclick="delAppt(\''+a.id+'\')" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;">Cancel</button>'}html+='</div></div>'});c.innerHTML=html||'<p style="text-align:center;color:var(--text-secondary);padding:40px 0;">No appointments found</p>'}
function delAppt(id){saveAppts(getAppts().filter(function(a){return a.id!==id}));renderAppointments();showToast('Appointment cancelled')}

// === New Appointment with date validation ===
function handleNewAppt(){var doc=document.getElementById('appt-doctor')?.value;var date=document.getElementById('appt-date')?.value;var time=document.getElementById('appt-time')?.value;var notes=document.getElementById('appt-notes')?.value.trim();var hasErr=false;if(!doc){showToast('Please select a doctor');hasErr=true}if(!date){showToast('Please pick a date');hasErr=true}else{var today=new Date();today.setHours(0,0,0,0);var apptDate=new Date(date+'T23:59:59');if(apptDate<today){showToast('Date must be today or later');hasErr=true}}if(!time){showToast('Please pick a time');hasErr=true}if(hasErr)return;var appt={id:'a_'+Date.now(),doctor:doc,date:date,time:time,notes:notes||'',status:'upcoming',createdBy:currentUser?currentUser.email:'guest',createdAt:new Date().toISOString()};var appts=getAppts();appts.push(appt);saveAppts(appts);['appt-doctor','appt-date','appt-time','appt-notes'].forEach(function(id){var el=document.getElementById(id);if(el)el.value=''});document.getElementById('add-appointment-form').style.display='none';renderAppointments();showToast('Appointment scheduled!')}


// === Field validators for blur ===
function validateField(fieldId,errorId,validateFn){var el=document.getElementById(fieldId);if(!el)return;el.addEventListener('blur',function(){var val=el.value.trim();var err=validateFn(val);if(err){showFieldError(errorId,err);el.classList.remove('valid');el.classList.add('error')}else{showFieldError(errorId,'');var e=document.getElementById(errorId);if(e)e.style.display='block';el.classList.remove('error');if(val){el.classList.add('valid')}else{el.classList.remove('valid')}}});el.addEventListener('input',function(){showFieldError(errorId,'');el.classList.remove('valid');el.classList.remove('error')})}


// === Blur validation rules ===

// === Password strength meter ===
function updatePwdMeter(){
  var pwd=document.getElementById('reg-password')?.value||'';
  var meter=document.getElementById('pwd-strength-meter');
  if(!meter)return;
  if(pwd.length===0){meter.style.display='none';return}
  meter.style.display='block';
  
  // Check requirements
  var hasMin=pwd.length>=8;
  var hasUpper=/[A-Z]/.test(pwd);
  var hasNumber=/[0-9]/.test(pwd);
  var hasSpecial=/[!@#$%^&*(),.?:{}|<>]/.test(pwd);
  
  // Update requirement list
  var reqs=[
    {id:'pwd-req-length',met:hasMin,icon:hasMin?'✓':'○'},
    {id:'pwd-req-upper',met:hasUpper,icon:hasUpper?'✓':'○'},
    {id:'pwd-req-number',met:hasNumber,icon:hasNumber?'✓':'○'},
    {id:'pwd-req-special',met:hasSpecial,icon:hasSpecial?'✓':'○'}
  ];
  reqs.forEach(function(r){
    var el=document.getElementById(r.id);
    if(!el)return;
    el.className=r.met?'met':'unmet';
    var icon=el.querySelector('.pwd-req-icon');
    if(icon){icon.textContent=r.icon;icon.className='pwd-req-icon '+(r.met?'met':'unmet')}
  });
  
  // Calculate strength
  var score=0;
  if(hasMin)score++;
  if(hasUpper)score++;
  if(hasNumber)score++;
  if(hasSpecial)score++;
  
  // Update segments
  var segments=['pwd-seg-0','pwd-seg-1','pwd-seg-2','pwd-seg-3'];
  var classes=['','active-weak','active-fair','active-good','active-strong'];
  var label=document.getElementById('pwd-meter-label');
  var strengthLabels=['Weak','Weak','Fair','Good','Strong'];
  
  segments.forEach(function(id,i){
    var seg=document.getElementById(id);
    if(!seg)return;
    seg.className='pwd-meter-segment';
    if(i<score)seg.classList.add(classes[score]);
  });
  
  if(label)label.textContent='Strength: '+strengthLabels[score];
  if(label)label.style.color=score<=1?'#e74c3c':score===2?'#f39c12':score===3?'#3498db':'#2ecc71';
}

function setupBlurValidation(){validateField('login-email','login-email-error',function(v){if(!v)return 'Email is required';if(!isValidEmail(v))return 'Invalid email format';return null});validateField('login-password','login-password-error',function(v){if(!v)return 'Password is required';return null});validateField('reg-name','reg-name-error',function(v){if(!v)return 'Name is required';return null});validateField('reg-email','reg-email-error',function(v){if(!v)return 'Email is required';if(!isValidEmail(v))return 'Invalid email format';return null});validateField('reg-password','reg-password-error',function(v){if(!v)return 'Password is required';var pwdErrs=getPwdErrors(v);if(pwdErrs.length)return 'Need: '+pwdErrs.join(', ');return null});validateField('reg-confirm','reg-confirm-error',function(v){if(!v)return 'Confirm your password';var p=document.getElementById('reg-password')?.value||'';if(v!==p)return 'Passwords do not match';return null});validateField('profile-name','profile-name-error',function(v){if(!v)return 'Name is required';return null});validateField('profile-email','profile-email-error',function(v){if(!v)return 'Email is required';if(!isValidEmail(v))return 'Invalid email format';return null});validateField('profile-phone','profile-phone-error',function(v){if(v&&!isValidPhone(v))return 'Invalid phone format';return null});validateField('appt-doctor','appt-doctor-error',function(v){if(!v)return 'Select a doctor';return null});validateField('appt-date','appt-date-error',function(v){if(!v)return 'Pick a date';var today=new Date();today.setHours(0,0,0,0);var apptDate=new Date(v+'T23:59:59');if(apptDate<today)return 'Must be today or later';return null});validateField('appt-time','appt-time-error',function(v){if(!v)return 'Pick a time';return null})}


// === Card click handlers ===
document.getElementById('card-appointments')?.addEventListener('click', function(){showSection('appointment-section');setTimeout(renderAppointments,100)});
document.getElementById('card-profile')?.addEventListener('click', function(){showSection('profile-section');setTimeout(loadProfile,100)});


document.getElementById('hero-cta-nav-btn')?.addEventListener('click',function(){openAuthModal('register')});
document.getElementById('hero-cta-main-btn')?.addEventListener('click',function(){openAuthModal('register')});

// === Keyboard handlers for feature cards ===
document.getElementById('card-chat')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-hospital')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-blood')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-injury-camera')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-bmi')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-emergency')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-breathe')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-water')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-symptoms')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-medicine')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-logins')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-analytics')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-appointments')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});
document.getElementById('card-profile')?.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '||e.key==='Spacebar'){e.preventDefault();e.target.click()}});

// === Password visibility toggle ===
function togglePasswordVisibility(fieldId,btn){var f=document.getElementById(fieldId);if(!f)return;if(f.type==='password'){f.type='text';btn.classList.add('showing');btn.setAttribute('aria-label','Hide password');btn.querySelector('svg').innerHTML='<path d=\"M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24\"/><line x1=\"1\" y1=\"1\" x2=\"23\" y2=\"23\"/></path>';}else{f.type='password';btn.classList.remove('showing');btn.setAttribute('aria-label','Show password');btn.querySelector('svg').innerHTML='<path d=\"M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/></path>';}}
// === Event listeners ===
document.getElementById('auth-close-btn')?.addEventListener('click',closeAuthModal);
document.getElementById('auth-modal-overlay')?.addEventListener('click',function(e){if(e.target===e.currentTarget)closeAuthModal()});
document.getElementById('show-register-link')?.addEventListener('click',function(e){e.preventDefault();openAuthModal('register')});
document.getElementById('show-login-link')?.addEventListener('click',function(e){e.preventDefault();openAuthModal('login')});
document.getElementById('register-submit-btn')?.addEventListener('click',handleRegister);
document.getElementById('login-submit-btn')?.addEventListener('click',handleLogin);
document.getElementById('profile-logout-btn')?.addEventListener('click',handleLogout);
document.getElementById('save-profile-btn')?.addEventListener('click',saveProfile);
document.getElementById('save-appointment-btn')?.addEventListener('click',handleNewAppt);
loadCurrentUser();
setupBlurValidation();
document.querySelector('[id=\"reg-password\"] + .pwd-toggle-btn')?.addEventListener('click',function(){togglePasswordVisibility('reg-password',this)});
document.getElementById('reg-password')?.addEventListener('input',updatePwdMeter);
document.getElementById('reg-password')?.addEventListener('input',function(){showFieldError('reg-confirm-error','')});

(function initFeatures() {
    // Water: set initial state
    updateWaterUI();
    
    // Symptoms: set date if not set
    if (symptomDateInput && !symptomDateInput.value) {
        symptomDateInput.value = new Date().toISOString().split('T')[0];
    }
    
    // Medicines: render if section exists
    renderMedicines();
    
    // Health tip
    showHealthTip();
})();
