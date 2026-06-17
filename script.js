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
    msgDiv.innerHTML = message;
    
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

// Show AI status indicator in chat header
(function showAIStatus() {
    const headerTitle = document.querySelector('.header-title p');
    if (headerTitle) {
        const status = HAS_AI
            ? `<span style="color: #4CAF50;">●</span> AI Online`
            : `<span style="color: #ffaa00;">●</span> Offline Mode`;
        headerTitle.innerHTML = `Your personal well-being guide — ${status}`;
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
