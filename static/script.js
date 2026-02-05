// BU Chatbot - Frontend JavaScript with Clerk Authentication

// State
let currentSessionId = null;
let allChats = [];
let clerkInstance = null;
let isInitializing = true;

// DOM Elements (will be initialized after DOM load)
let sidebar, sidebarToggle, newChatBtn;
let searchChatsBtn, searchModal, searchInput, closeSearchBtn, searchResults;
let chatHistory, chatContainer, welcomeMessage, messagesContainer;
let messageInput, sendBtn;
let headerTitle, aboutModal, closeAboutBtn; 
let authContainer, appContainer, userButtonContainer;
let isUserButtonMounted = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    initializeDOMElements();
    await initializeClerk();
});

function initializeDOMElements() {
    // Auth elements
    authContainer = document.getElementById('authContainer');
    appContainer = document.getElementById('appContainer');
    userButtonContainer = document.getElementById('userButtonContainer');

    // App elements
    sidebar = document.getElementById('sidebar');
    sidebarToggle = document.getElementById('sidebarToggle');
    newChatBtn = document.getElementById('newChatBtn');
    searchChatsBtn = document.getElementById('searchChatsBtn');
    searchModal = document.getElementById('searchModal');
    headerTitle = document.getElementById('headerTitle');
    aboutModal = document.getElementById('aboutModal');
    closeAboutBtn = document.getElementById('closeAboutBtn');
    searchInput = document.getElementById('searchInput');
    closeSearchBtn = document.getElementById('closeSearchBtn');
    searchResults = document.getElementById('searchResults');
    chatHistory = document.getElementById('chatHistory');
    chatContainer = document.getElementById('chatContainer');
    welcomeMessage = document.getElementById('welcomeMessage');
    messagesContainer = document.getElementById('messages');
    messageInput = document.getElementById('messageInput');
    sendBtn = document.getElementById('sendBtn');
}

async function initializeClerk() {
    try {
        await waitForClerk();

        const scriptTag = document.querySelector('script[data-clerk-publishable-key]');
        const publishableKey = scriptTag ? scriptTag.getAttribute('data-clerk-publishable-key') : null;

        if (!publishableKey) {
            throw new Error("Clerk publishable key not found in HTML");
        }

        if (typeof window.Clerk === 'function') {
            clerkInstance = new window.Clerk(publishableKey);
            await clerkInstance.load();
        } else {
            clerkInstance = window.Clerk;
            await window.Clerk.load();
        }
        
        clerkInstance.addListener(({ user }) => {
            if (user && !isInitializing) {
                showApp();
            } else if (!user && !isInitializing) {
                showAuth();
            }
        });

        if (clerkInstance.user) {
            await showApp();
        } else {
            showAuth();
        }

        isInitializing = false;
    } catch (error) {
        console.error('Failed to initialize Clerk:', error);
        showAuth();
        isInitializing = false;
    }
}

function showAuth() {
    authContainer.classList.remove('hidden');
    appContainer.classList.add('hidden');

    const signInEl = document.getElementById('signIn');

    if (signInEl.childNodes.length === 0) {
        clerkInstance.mountSignIn(signInEl, {
            forceRedirectUrl: '/', 
        });
    }
}

async function showApp() {
    authContainer.classList.add('hidden');
    appContainer.classList.remove('hidden');

    // Mount user button in sidebar - this will persist
    if (userButtonContainer && !isUserButtonMounted) {
        userButtonContainer.innerHTML = '';
        clerkInstance.mountUserButton(userButtonContainer, {
            afterSignOutUrl: window.location.href,
            showName: true, 
            appearance: {
                elements: {
                    userButtonTrigger: {
                        width: '100%',
                        justifyContent: 'flex-start'
                    }
                }
            }
        });
        isUserButtonMounted = true; 
    }

    // Initialize app (only once)
    if (!window._eventListenersSetup) {
        setupEventListeners();
        window._eventListenersSetup = true;
    }

    // Wait a moment for session to be fully ready
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('[Auth] Session ready, loading chats...');
    await loadChatHistory();
}

// Get auth token for API requests
async function getAuthToken() {
    if (!clerkInstance) {
        console.log('[Auth] Clerk not initialized');
        return null;
    }
    if (!clerkInstance.session) {
        console.log('[Auth] No session available');
        return null;
    }
    try {
        const token = await clerkInstance.session.getToken();
        console.log('[Auth] Token obtained:', token ? 'yes' : 'no');
        return token;
    } catch (error) {
        console.error('[Auth] Token error:', error);
        return null;
    }
}

// Authenticated fetch wrapper
async function authFetch(url, options = {}) {
    const token = await getAuthToken();

    if (!token) {
        throw new Error('No auth token available');
    }

    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };

    return fetch(url, { ...options, headers });
}

// Event Listeners
function setupEventListeners() {
    // Sidebar toggle
    const toggleSidebar = () => {
        sidebar.classList.toggle('collapsed');
    };
    if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebar);
    const sidebarCloseToggle = document.getElementById('sidebarCloseToggle');
    if (sidebarCloseToggle) sidebarCloseToggle.addEventListener('click', toggleSidebar);
    
    // New chat button
    newChatBtn.addEventListener('click', startNewChat);

    // Search
    searchChatsBtn.addEventListener('click', openSearch);
    closeSearchBtn.addEventListener('click', closeSearch);
    searchInput.addEventListener('input', filterChats);

    // Send message
    sendBtn.addEventListener('click', sendMessage);

    // Handle Enter to send, Shift+Enter for new line
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
        // Shift+Enter allows default behavior (new line in textarea)
    });

    // Input validation and auto-resize
    messageInput.addEventListener('input', () => {
        sendBtn.disabled = !messageInput.value.trim();
        autoResizeTextarea();
    });

    // Initialize send button state
    sendBtn.disabled = true;

    // 1. Open modal when clicking the "BU Chatbot" title
    if (headerTitle) {
        headerTitle.addEventListener('click', () => {
            aboutModal.classList.remove('hidden'); 
            setTimeout(() => {
                aboutModal.classList.add('active');
            }, 10);
        });
    }

    // 2. Close modal when clicking the "X" button
    if (closeAboutBtn) {
        closeAboutBtn.addEventListener('click', () => {
            aboutModal.classList.remove('active');
            setTimeout(() => {
                aboutModal.classList.add('hidden'); 
            }, 300);
        });
    }

    // 3. Close modal when clicking outside the content
    if (aboutModal) {
        aboutModal.addEventListener('click', (e) => {
            if (e.target === aboutModal) {
                aboutModal.classList.remove('active');
                setTimeout(() => {
                    aboutModal.classList.add('hidden');
                }, 300);
            }
        });
    }
}

// Auto-resize textarea based on content
function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    const maxHeight = 150; // Max height in pixels
    messageInput.style.height = Math.min(messageInput.scrollHeight, maxHeight) + 'px';
}

// Chat History Functions
async function loadChatHistory() {
    try {
        const response = await authFetch('/api/chats');
        if (!response.ok) {
            if (response.status === 401) {
                // Token may have expired, try to refresh
                console.warn('Auth token expired or invalid');
                // Don't reload - let Clerk handle the session
                return;
            }
            throw new Error('Failed to load chats');
        }
        const data = await response.json();
        allChats = data.chats || [];
        renderChatHistory();
    } catch (error) {
        console.error('Failed to load chat history:', error);
        // Don't reload on error - just log it
    }
}

function renderChatHistory() {
    chatHistory.innerHTML = '';

    if (allChats.length === 0) {
        return;
    }

    allChats.forEach(chat => {
        const item = document.createElement('div');
        item.className = `chat-history-item${chat.id === currentSessionId ? ' active' : ''}`;
        item.innerHTML = `
            <span class="title">${escapeHtml(chat.title)}</span>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteChat('${chat.id}')" title="Delete chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18"></path>
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                </svg>
            </button>
        `;
        item.addEventListener('click', () => loadChat(chat.id));
        chatHistory.appendChild(item);
    });
}

async function loadChat(sessionId) {
    try {
        const response = await authFetch(`/api/chats/${sessionId}`);
        if (!response.ok) throw new Error('Chat not found');

        const chat = await response.json();
        currentSessionId = sessionId;

        // Clear and populate messages
        messagesContainer.innerHTML = '';
        welcomeMessage.classList.add('hidden');

        chat.messages.forEach(msg => {
            addMessageToUI(msg.content, msg.role);
        });

        renderChatHistory();
        scrollToBottom();
    } catch (error) {
        console.error('Failed to load chat:', error);
    }
}

async function deleteChat(sessionId) {
    try {
        await authFetch(`/api/chats/${sessionId}`, { method: 'DELETE' });

        if (currentSessionId === sessionId) {
            startNewChat();
        }

        await loadChatHistory();
    } catch (error) {
        console.error('Failed to delete chat:', error);
    }
}

// New Chat
async function startNewChat() {
    try {
        await authFetch('/api/new-chat', { method: 'POST' });
        currentSessionId = null;
        messagesContainer.innerHTML = '';
        welcomeMessage.classList.remove('hidden');
        messageInput.value = '';
        sendBtn.disabled = true;
        renderChatHistory();
    } catch (error) {
        console.error('Failed to start new chat:', error);
    }
}

// Search Functions
function openSearch() {
    searchModal.classList.add('active');
    searchInput.focus();
    filterChats();
}

function closeSearch() {
    searchModal.classList.remove('active');
    searchInput.value = '';
}

function filterChats() {
    const query = searchInput.value.toLowerCase().trim();
    searchResults.innerHTML = '';

    const filtered = query
        ? allChats.filter(chat => chat.title.toLowerCase().includes(query))
        : allChats;

    if (filtered.length === 0) {
        searchResults.innerHTML = '<div class="search-results-empty">No chats found</div>';
        return;
    }

    filtered.forEach(chat => {
        const item = document.createElement('div');
        item.className = 'chat-history-item';
        item.innerHTML = `<span class="title">${escapeHtml(chat.title)}</span>`;
        item.addEventListener('click', () => {
            closeSearch();
            loadChat(chat.id);
        });
        searchResults.appendChild(item);
    });
}

// Message Functions
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    // Hide welcome message
    welcomeMessage.classList.add('hidden');

    // Add user message to UI
    addMessageToUI(message, 'user');
    messageInput.value = '';
    sendBtn.disabled = true;

    // Show loading indicator
    const loadingId = showLoading();

    try {
        const response = await authFetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                session_id: currentSessionId
            })
        });

        if (!response.ok) {
            throw new Error('Failed to get response');
        }

        const data = await response.json();
        currentSessionId = data.session_id;

        // Remove loading and add AI response
        removeLoading(loadingId);
        addMessageToUI(data.response, 'assistant');

        // Refresh chat history
        await loadChatHistory();
    } catch (error) {
        console.error('Failed to send message:', error);
        removeLoading(loadingId);
        addMessageToUI('Sorry, something went wrong. Please try again.', 'assistant');
    }

    scrollToBottom();
}

function addMessageToUI(content, role) {
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;

    // Use Clerk user info for avatar if available
    let avatar = role === 'user' ? 'U' : 'AI';
    if (role === 'user' && clerkInstance && clerkInstance.user) {
        const firstName = clerkInstance.user.firstName || '';
        avatar = firstName.charAt(0).toUpperCase() || 'U';
    }

    const formattedContent = role === 'assistant' ? formatMarkdown(content) : escapeHtml(content);

    messageEl.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-content">
            <div class="message-bubble">${formattedContent}</div>
        </div>
    `;

    messagesContainer.appendChild(messageEl);
    scrollToBottom();
}

function showLoading() {
    const id = 'loading-' + Date.now();
    const loadingEl = document.createElement('div');
    loadingEl.id = id;
    loadingEl.className = 'message assistant';
    loadingEl.innerHTML = `
        <div class="message-avatar">AI</div>
        <div class="message-content">
            <div class="loading-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    messagesContainer.appendChild(loadingEl);
    scrollToBottom();
    return id;
}

function removeLoading(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// Utility Functions
function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatMarkdown(text) {
    // Basic markdown formatting
    let html = escapeHtml(text);

    // Code blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
}

function waitForClerk() {
    return new Promise((resolve, reject) => {
        if (window.Clerk) {
            resolve();
            return;
        }

        const maxAttempts = 50;
        let attempts = 0;

        const interval = setInterval(() => {
            attempts++;
            if (window.Clerk) {
                clearInterval(interval);
                resolve();
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                reject(new Error('Clerk failed to load'));
            }
        }, 100);
    });
}