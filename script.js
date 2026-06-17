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
// Initialize all features on page load
// ============================================================
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
