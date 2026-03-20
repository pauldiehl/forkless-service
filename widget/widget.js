/**
 * Forkless Widget — Multi-Tenant Three-Layer UI Injector
 *
 * Self-contained DOM injector with direct DOM rendering (no iframe).
 * Ports the shell.html UX: FAB, 55vh bottom bar, full screen, auth gate.
 *
 * Embed on any page:
 *   <script src="https://api.agentintake.io/widget.js?tenant=paul-brand"></script>
 *
 * Or with data attributes:
 *   <script src="https://api.agentintake.io/widget.js"
 *     data-api="https://api.agentintake.io"
 *     data-tenant="paul-brand"
 *     data-theme="dark">
 *   </script>
 */

(function() {
  'use strict';

  const WIDGET_VERSION = '2.0.0';

  const defaults = {
    apiUrl: '',
    chatUrl: '',
    tenantId: '',
    theme: 'dark',
    agentMode: 'collapsed',
    boardEnabled: false,
    boardMode: 'minimized',
    wsUrl: '',
    greeting: 'Hey! How can I help you today?',
  };

  let config = { ...defaults };
  let agentLayer = null;
  let fabButton = null;
  let boardOverlay = null;
  let boardBadge = null;
  let ws = null;
  let token = null;
  let conversationId = null;
  let inputExpanded = false;
  let authEmail = '';

  // ─── SVG Icons ──────────────────────────────────────────────────

  const ICON_CHAT = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  const ICON_CHAT_SM = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  const ICON_CHAT_XS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  const ICON_COLLAPSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const ICON_MINIMAL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="12" width="18" height="9" rx="2"/><line x1="3" y1="6" x2="21" y2="6"/></svg>';
  const ICON_FULL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
  const ICON_SEND = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  const ICON_EXPAND_UP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
  const ICON_EXPAND_DOWN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  // ─── Initialization ──────────────────────────────────────────

  function init(opts = {}) {
    const script = document.currentScript || document.querySelector('script[src*="widget.js"]');
    if (script) {
      const url = new URL(script.src, window.location.origin);
      const tenantParam = url.searchParams.get('tenant');
      if (tenantParam) opts.tenantId = opts.tenantId || tenantParam;
      if (script.dataset.api) opts.apiUrl = opts.apiUrl || script.dataset.api;
      if (script.dataset.tenant) opts.tenantId = opts.tenantId || script.dataset.tenant;
      if (script.dataset.theme) opts.theme = opts.theme || script.dataset.theme;
      if (script.dataset.board === 'true') opts.boardEnabled = true;
      if (script.dataset.ws) opts.wsUrl = opts.wsUrl || script.dataset.ws;
      if (script.dataset.chatUrl) opts.chatUrl = opts.chatUrl || script.dataset.chatUrl;
      // Tenant color overrides
      if (script.dataset.bg) opts.bgColor = script.dataset.bg;
      if (script.dataset.text) opts.textColor = script.dataset.text;
      if (script.dataset.accent) opts.accentColor = script.dataset.accent;
      if (!opts.apiUrl && script.src) {
        const scriptUrl = new URL(script.src);
        opts.apiUrl = `${scriptUrl.protocol}//${scriptUrl.host}`;
      }
    }

    config = { ...defaults, ...opts };

    // Default chatUrl to chat.agentintake.io when apiUrl is agentintake.io
    if (!config.chatUrl && config.apiUrl && config.apiUrl.includes('agentintake.io')) {
      config.chatUrl = 'https://chat.agentintake.io';
    }

    // Restore session
    token = localStorage.getItem(`forkless_token_${config.tenantId}`);
    conversationId = localStorage.getItem(`forkless_conv_${config.tenantId}`);
    const savedMode = localStorage.getItem(`forkless_mode_${config.tenantId}`);
    if (savedMode && ['collapsed', 'minimal', 'full'].includes(savedMode)) {
      config.agentMode = savedMode;
    }

    // Check token expiry
    if (token && isTokenExpired(token)) {
      token = null;
      localStorage.removeItem(`forkless_token_${config.tenantId}`);
    }

    injectStyles();
    applyColorOverrides();
    createFAB();
    createAgentLayer();
    if (config.boardEnabled) createBoardOverlay();
    applyMode(config.agentMode);

    if (token) {
      connectWebSocket();
      if (config.boardEnabled) fetchBoard();
    }
  }

  function isTokenExpired(t) {
    try {
      const parts = t.split('.');
      if (parts.length !== 3) return true;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.exp && payload.exp < Math.floor(Date.now() / 1000);
    } catch { return true; }
  }

  // ─── Styles ──────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('forkless-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'forkless-widget-styles';
    style.textContent = `
      :root {
        --fk-bg-primary: #101014;
        --fk-bg-secondary: #18181b;
        --fk-bg-tertiary: #27272a;
        --fk-surface: #2a2a2e;
        --fk-surface-hover: #3a3a3f;
        --fk-border: #3f3f46;
        --fk-text-primary: #fafafa;
        --fk-text-secondary: #a1a1aa;
        --fk-text-muted: #71717a;
        --fk-accent: #e8735a;
        --fk-accent-dim: rgba(232, 115, 90, 0.15);
        --fk-accent-glow: rgba(232, 115, 90, 0.3);
        --fk-agent-bg: #131316;
        --fk-user-msg: #2e2b5e;
        --fk-agent-msg: #27272a;
        --fk-success: #34d399;
        --fk-gradient-from: #e8735a;
        --fk-gradient-to: #d4543a;
        --fk-radius: 12px;
        --fk-radius-sm: 8px;
      }

      /* === FAB === */
      #forkless-fab {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 10002;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        border: none;
        background: linear-gradient(135deg, var(--fk-gradient-from), var(--fk-gradient-to));
        color: white;
        font-size: 24px;
        cursor: pointer;
        box-shadow: 0 4px 24px var(--fk-accent-glow);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        animation: fk-fab-pulse 3s ease-in-out infinite;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      }

      #forkless-fab:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 32px var(--fk-accent-glow);
      }

      #forkless-fab:active { transform: scale(0.95); }

      #forkless-fab.fk-hidden {
        transform: scale(0) translateY(20px);
        opacity: 0;
        pointer-events: none;
      }

      @keyframes fk-fab-pulse {
        0%, 100% { box-shadow: 0 4px 24px var(--fk-accent-glow); }
        50% { box-shadow: 0 4px 32px var(--fk-accent-glow); }
      }

      /* === AGENT LAYER === */
      #forkless-agent {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 10001;
        display: flex;
        flex-direction: column;
        background: var(--fk-agent-bg);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        color: var(--fk-text-primary);
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        -webkit-font-smoothing: antialiased;
      }

      #forkless-agent.fk-collapsed {
        transform: translateY(100%);
        pointer-events: none;
      }

      #forkless-agent.fk-minimal {
        height: 55vh;
        border-top: 1px solid var(--fk-border);
        box-shadow: 0 -4px 20px rgba(0,0,0,0.4);
      }

      #forkless-agent.fk-full {
        height: 100vh;
      }

      /* === HEADER === */
      #forkless-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: var(--fk-bg-secondary);
        border-bottom: 1px solid var(--fk-border);
        flex-shrink: 0;
      }

      #forkless-header-left {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      #forkless-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--fk-gradient-from), var(--fk-gradient-to));
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: white;
      }

      #forkless-agent-name {
        font-weight: 600;
        font-size: 15px;
      }

      #forkless-agent-status {
        font-size: 12px;
        color: var(--fk-success);
      }

      #forkless-header-controls {
        display: flex;
        gap: 4px;
      }

      .fk-mode-btn {
        background: none;
        border: 1px solid var(--fk-border);
        color: var(--fk-text-secondary);
        width: 32px;
        height: 32px;
        border-radius: var(--fk-radius-sm);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .fk-mode-btn:hover {
        background: var(--fk-surface-hover);
        color: var(--fk-accent);
        border-color: var(--fk-accent);
      }

      .fk-mode-btn.fk-active {
        background: var(--fk-accent-dim);
        color: var(--fk-accent);
        border-color: var(--fk-accent);
      }

      /* === FAQ CAROUSEL === */
      #forkless-faq-bar {
        display: flex;
        flex-direction: column;
        padding: 6px 16px 8px;
        background: var(--fk-bg-secondary);
        border-bottom: 1px solid var(--fk-border);
        flex-shrink: 0;
        overflow: hidden;
      }

      #forkless-faq-bar.fk-hidden { display: none; }

      #forkless-faq-label {
        font-size: 11px;
        color: var(--fk-text-muted);
        margin-bottom: 5px;
        white-space: nowrap;
      }

      #forkless-faq-track-wrapper {
        overflow: hidden;
        position: relative;
        height: 26px;
      }

      #forkless-faq-track {
        display: flex;
        gap: 8px;
        position: absolute;
        white-space: nowrap;
        will-change: transform;
        animation: fk-ticker linear infinite;
      }

      .fk-faq-pill {
        display: inline-flex;
        align-items: center;
        padding: 3px 12px;
        font-size: 12px;
        color: var(--fk-text-primary);
        background: var(--fk-surface);
        border: 1px solid var(--fk-border);
        border-radius: 13px;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.15s ease;
        flex-shrink: 0;
      }

      .fk-faq-pill:hover {
        background: var(--fk-accent-dim);
        border-color: var(--fk-accent);
        color: var(--fk-accent);
      }

      @keyframes fk-ticker {
        0% { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }

      /* === CONVERSATION LOG === */
      #forkless-log {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: var(--fk-agent-bg);
        scroll-behavior: smooth;
      }

      #forkless-log::-webkit-scrollbar { width: 6px; }
      #forkless-log::-webkit-scrollbar-track { background: transparent; }
      #forkless-log::-webkit-scrollbar-thumb { background: var(--fk-border); border-radius: 3px; }

      #forkless-log.fk-hidden-for-expand {
        flex: 0 !important;
        min-height: 0 !important;
        max-height: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }

      .fk-message {
        display: flex;
        gap: 10px;
        max-width: 85%;
        animation: fk-msg-in 0.3s ease;
      }

      @keyframes fk-msg-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .fk-message.fk-agent { align-self: flex-start; }
      .fk-message.fk-user { align-self: flex-end; flex-direction: row-reverse; }

      .fk-msg-avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        color: white;
      }

      .fk-message.fk-agent .fk-msg-avatar {
        background: linear-gradient(135deg, var(--fk-gradient-from), var(--fk-gradient-to));
      }

      .fk-message.fk-user .fk-msg-avatar {
        background: var(--fk-surface);
        color: var(--fk-text-secondary);
      }

      .fk-msg-bubble {
        padding: 10px 14px;
        border-radius: var(--fk-radius);
        font-size: 14px;
        line-height: 1.5;
        word-wrap: break-word;
        white-space: pre-wrap;
      }

      .fk-message.fk-agent .fk-msg-bubble {
        background: var(--fk-agent-msg);
        border-bottom-left-radius: 4px;
      }

      .fk-message.fk-user .fk-msg-bubble {
        background: var(--fk-user-msg);
        border-bottom-right-radius: 4px;
      }

      .fk-msg-bubble a {
        color: var(--fk-accent);
        text-decoration: underline;
        word-break: break-all;
      }

      .fk-msg-bubble a:hover { opacity: 0.8; }

      .fk-system-msg {
        text-align: center;
        font-size: 12px;
        color: var(--fk-text-muted);
        padding: 4px 0;
      }

      /* Typing indicator */
      #forkless-typing {
        display: none;
        gap: 4px;
        padding: 12px 16px;
        align-self: flex-start;
      }

      #forkless-typing.fk-active { display: flex; }

      #forkless-typing span {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--fk-text-muted);
        animation: fk-typing-bounce 1.4s ease-in-out infinite;
      }

      #forkless-typing span:nth-child(2) { animation-delay: 0.2s; }
      #forkless-typing span:nth-child(3) { animation-delay: 0.4s; }

      @keyframes fk-typing-bounce {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
        30% { transform: translateY(-6px); opacity: 1; }
      }

      /* Welcome message */
      #forkless-welcome {
        text-align: center;
        padding: 40px 20px;
        color: var(--fk-text-secondary);
      }

      #forkless-welcome h2 {
        font-size: 18px;
        font-weight: 600;
        color: var(--fk-text-primary);
        margin-bottom: 8px;
      }

      #forkless-welcome p {
        font-size: 14px;
        line-height: 1.5;
      }

      /* === INPUT AREA === */
      #forkless-input-area {
        padding: 12px 16px;
        background: var(--fk-bg-secondary);
        border-top: 1px solid var(--fk-border);
        flex-shrink: 0;
        transition: flex 0.3s ease;
      }

      #forkless-input-area.fk-expanded {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      #forkless-input-row {
        display: flex;
        gap: 8px;
        align-items: flex-end;
      }

      #forkless-input-area.fk-expanded #forkless-input-row {
        flex: 1;
        align-items: stretch;
        min-height: 0;
      }

      #forkless-input {
        flex: 1;
        background: var(--fk-surface);
        border: 1px solid var(--fk-border);
        border-radius: var(--fk-radius);
        padding: 10px 14px;
        color: var(--fk-text-primary);
        font-size: 14px;
        font-family: inherit;
        resize: none;
        outline: none;
        min-height: 42px;
        max-height: 147px;
        line-height: 1.5;
        transition: border-color 0.2s ease, max-height 0.3s ease;
      }

      #forkless-input-area.fk-expanded #forkless-input {
        max-height: none !important;
        height: 100% !important;
        min-height: 0 !important;
      }

      #forkless-input:focus { border-color: var(--fk-accent); }
      #forkless-input::placeholder { color: var(--fk-text-muted); }

      #forkless-btn-column {
        display: flex;
        flex-direction: column;
        align-self: stretch;
        justify-content: space-between;
        flex-shrink: 0;
      }

      #forkless-expand-btn {
        width: 42px;
        height: 32px;
        border-radius: var(--fk-radius-sm);
        border: 1px solid var(--fk-border);
        background: var(--fk-surface);
        color: var(--fk-text-secondary);
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.2s ease;
      }

      #forkless-expand-btn.fk-visible { display: flex; }

      #forkless-expand-btn:hover {
        background: var(--fk-surface-hover);
        color: var(--fk-accent);
        border-color: var(--fk-accent);
      }

      #forkless-send-btn {
        width: 42px;
        height: 42px;
        border-radius: var(--fk-radius);
        border: none;
        background: linear-gradient(135deg, var(--fk-gradient-from), var(--fk-gradient-to));
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        flex-shrink: 0;
      }

      #forkless-send-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 2px 12px var(--fk-accent-glow);
      }

      #forkless-send-btn:active { transform: scale(0.95); }
      #forkless-send-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

      /* Usage indicator */
      #forkless-usage {
        text-align: center;
        font-size: 11px;
        color: var(--fk-text-muted);
        padding: 4px 0 0;
      }

      /* === AUTH OVERLAY === */
      #forkless-auth {
        position: absolute;
        inset: 0;
        background: var(--fk-agent-bg);
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }

      #forkless-auth.fk-hidden { display: none; }

      #forkless-auth h3 {
        font-size: 18px;
        font-weight: 600;
        margin-bottom: 8px;
        color: var(--fk-text-primary);
      }

      #forkless-auth p {
        font-size: 14px;
        color: var(--fk-text-secondary);
        margin-bottom: 20px;
        text-align: center;
      }

      .fk-auth-input {
        width: 100%;
        max-width: 280px;
        padding: 10px 14px;
        border: 1px solid var(--fk-border);
        border-radius: var(--fk-radius-sm);
        background: var(--fk-surface);
        color: var(--fk-text-primary);
        font-size: 14px;
        text-align: center;
        margin-bottom: 12px;
        font-family: inherit;
        outline: none;
      }

      .fk-auth-input:focus { border-color: var(--fk-accent); }

      .fk-auth-btn {
        background: linear-gradient(135deg, var(--fk-gradient-from), var(--fk-gradient-to));
        color: white;
        border: none;
        border-radius: var(--fk-radius-sm);
        padding: 10px 24px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        font-family: inherit;
        transition: all 0.2s ease;
      }

      .fk-auth-btn:hover { transform: scale(1.02); box-shadow: 0 2px 12px var(--fk-accent-glow); }
      .fk-auth-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

      #forkless-auth-error {
        color: #f44;
        font-size: 12px;
        margin-top: 8px;
        min-height: 16px;
      }

      /* === BOARD OVERLAY === */
      #forkless-board {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 9999;
        pointer-events: none;
        transition: opacity 0.3s ease;
      }

      #forkless-board.fk-minimized { opacity: 0; pointer-events: none; }

      #forkless-board .fk-board-columns {
        display: flex;
        gap: 8px;
        padding: 12px;
        height: calc(100% - 80px);
        pointer-events: auto;
      }

      #forkless-board .fk-board-column {
        flex: 1;
        background: rgba(13, 13, 26, 0.85);
        border-radius: 8px;
        border: 1px solid rgba(42, 42, 62, 0.6);
        padding: 10px;
        overflow-y: auto;
        min-width: 0;
      }

      #forkless-board .fk-board-column h3 {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #888;
        margin: 0 0 8px 0;
        padding-bottom: 6px;
        border-bottom: 1px solid #2a2a3e;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      .fk-board-card {
        background: #1a1a2e;
        border-radius: 6px;
        padding: 8px 10px;
        margin-bottom: 6px;
        font-size: 12px;
        color: #e0e0e0;
        cursor: pointer;
        border-left: 3px solid transparent;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      .fk-board-card.bg-default   { border-left-color: #555; }
      .fk-board-card.bg-urgent    { border-left-color: #f44; background: #2a1a1a; }
      .fk-board-card.bg-active    { border-left-color: #4af; }
      .fk-board-card.bg-done      { border-left-color: #4a4; background: #1a2a1a; }
      .fk-board-card.bg-info      { border-left-color: #aa4af0; }
      .fk-board-card.bg-journey   { border-left-color: #fa4; background: #2a2a1a; }

      .fk-board-card .fk-card-title { font-weight: 600; margin-bottom: 2px; }
      .fk-board-card .fk-card-desc { font-size: 11px; color: #999; line-height: 1.3; }

      /* Board badge */
      #forkless-board-badge {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 10003;
        background: rgba(13, 13, 26, 0.9);
        border: 1px solid #2a2a3e;
        border-radius: 16px;
        padding: 4px 12px;
        font-size: 11px;
        color: #888;
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      /* === RESPONSIVE === */
      @media (max-width: 640px) {
        #forkless-agent.fk-minimal { height: 60vh; }
        .fk-message { max-width: 92%; }
        #forkless-fab { bottom: 16px; right: 16px; width: 54px; height: 54px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Color Overrides ──────────────────────────────────────────

  function applyColorOverrides() {
    const root = document.documentElement;
    if (config.bgColor) {
      root.style.setProperty('--fk-bg-primary', config.bgColor);
      root.style.setProperty('--fk-bg-secondary', config.bgColor);
      root.style.setProperty('--fk-agent-bg', config.bgColor);
    }
    if (config.textColor) {
      root.style.setProperty('--fk-text-primary', config.textColor);
    }
    if (config.accentColor) {
      root.style.setProperty('--fk-accent', config.accentColor);
      root.style.setProperty('--fk-gradient-from', config.accentColor);
      root.style.setProperty('--fk-gradient-to', config.accentColor);
    }
  }

  // ─── FAB ──────────────────────────────────────────────────────

  function createFAB() {
    fabButton = document.createElement('button');
    fabButton.id = 'forkless-fab';
    fabButton.setAttribute('aria-label', 'Open agent');
    fabButton.innerHTML = '<span style="font-size:24px;line-height:1">&#9889;</span>';
    fabButton.addEventListener('click', () => setAgentMode('minimal'));
    document.body.appendChild(fabButton);
  }

  // ─── Agent Layer ──────────────────────────────────────────────

  function createAgentLayer() {
    agentLayer = document.createElement('div');
    agentLayer.id = 'forkless-agent';

    agentLayer.innerHTML = `
      <div id="forkless-header">
        <div id="forkless-header-left">
          <div id="forkless-avatar">${ICON_CHAT_SM}</div>
          <div>
            <div id="forkless-agent-name">Agent</div>
            <div id="forkless-agent-status">Online</div>
          </div>
        </div>
        <div id="forkless-header-controls">
          <button class="fk-mode-btn" id="fk-btn-collapse" title="Collapse">${ICON_COLLAPSE}</button>
          <button class="fk-mode-btn" id="fk-btn-minimal" title="Minimal">${ICON_MINIMAL}</button>
          <button class="fk-mode-btn" id="fk-btn-full" title="Full screen">${ICON_FULL}</button>
        </div>
      </div>
      <div id="forkless-faq-bar" class="fk-hidden">
        <div id="forkless-faq-label">Ask me anything... or just click a FAQ</div>
        <div id="forkless-faq-track-wrapper">
          <div id="forkless-faq-track"></div>
        </div>
      </div>
      <div id="forkless-log">
        <div id="forkless-welcome">
          <h2>Welcome</h2>
          <p>Start a conversation to get going.</p>
        </div>
      </div>
      <div id="forkless-typing"><span></span><span></span><span></span></div>
      <div id="forkless-input-area">
        <div id="forkless-input-row">
          <textarea id="forkless-input" placeholder="Type a message..." rows="1"></textarea>
          <div id="forkless-btn-column">
            <button id="forkless-expand-btn" title="Expand input">${ICON_EXPAND_UP}</button>
            <button id="forkless-send-btn" title="Send">${ICON_SEND}</button>
          </div>
        </div>
        <div id="forkless-usage"></div>
      </div>
      <div id="forkless-auth">
        <h3 id="fk-auth-title">Sign in to continue</h3>
        <p>Enter your email to receive a verification code.</p>
        <input class="fk-auth-input" id="fk-auth-email" type="email" placeholder="your@email.com">
        <input class="fk-auth-input" id="fk-auth-otp" type="text" placeholder="6-digit code" style="display:none">
        <button class="fk-auth-btn" id="fk-auth-submit">Send Code</button>
        <div id="forkless-auth-error"></div>
      </div>
    `;

    document.body.appendChild(agentLayer);

    // Mode buttons
    agentLayer.querySelector('#fk-btn-collapse').addEventListener('click', () => setAgentMode('collapsed'));
    agentLayer.querySelector('#fk-btn-minimal').addEventListener('click', () => setAgentMode('minimal'));
    agentLayer.querySelector('#fk-btn-full').addEventListener('click', () => setAgentMode('full'));

    // Input handling
    const input = agentLayer.querySelector('#forkless-input');
    const sendBtn = agentLayer.querySelector('#forkless-send-btn');
    const expandBtn = agentLayer.querySelector('#forkless-expand-btn');

    sendBtn.addEventListener('click', () => sendMessage());
    expandBtn.addEventListener('click', () => toggleExpandInput());

    input.addEventListener('input', () => {
      if (!inputExpanded) {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 147) + 'px';
      }
      checkExpandButton();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auth handling
    const authSubmit = agentLayer.querySelector('#fk-auth-submit');
    const authEmailInput = agentLayer.querySelector('#fk-auth-email');
    const authOtpInput = agentLayer.querySelector('#fk-auth-otp');

    authSubmit.addEventListener('click', () => handleAuth());
    authEmailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAuth();
    });
    authOtpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAuth();
    });

    // FAQ carousel — fetch and populate
    loadFaqCarousel();

    // Show/hide auth overlay based on token state
    updateAuthVisibility();
  }

  async function loadFaqCarousel() {
    if (!config.tenantId || !config.apiUrl) return;
    try {
      const res = await fetch(`${config.apiUrl}/faqs/${config.tenantId}`);
      if (!res.ok) return;
      const data = await res.json();
      // Update agent name from tenant data
      const tenantName = data.data?.tenant_name;
      if (tenantName) {
        const nameEl = agentLayer.querySelector('#forkless-agent-name');
        if (nameEl) nameEl.textContent = tenantName + ' Agent';
      }

      const faqs = data.data?.faqs || [];
      if (faqs.length === 0) return;

      const bar = agentLayer.querySelector('#forkless-faq-bar');
      const track = agentLayer.querySelector('#forkless-faq-track');
      bar.classList.remove('fk-hidden');

      // Build pills — duplicate the set so the ticker loops seamlessly
      const buildPills = () => faqs.map(f => {
        const pill = document.createElement('button');
        pill.className = 'fk-faq-pill';
        pill.textContent = f.question;
        pill.addEventListener('click', () => {
          const input = agentLayer.querySelector('#forkless-input');
          input.value = f.question;
          sendMessage();
        });
        return pill;
      });

      // Two copies for seamless loop
      buildPills().forEach(p => track.appendChild(p));
      buildPills().forEach(p => track.appendChild(p));

      // Set animation duration based on content width (after render)
      requestAnimationFrame(() => {
        const trackWidth = track.scrollWidth / 2;
        const speed = 40; // px per second
        const duration = trackWidth / speed;
        track.style.animationDuration = `${duration}s`;
      });

      // Pause on hover
      track.addEventListener('mouseenter', () => track.style.animationPlayState = 'paused');
      track.addEventListener('mouseleave', () => track.style.animationPlayState = 'running');
    } catch {
      // Silently fail — FAQ carousel is optional
    }
  }

  function updateAuthVisibility() {
    const authOverlay = agentLayer.querySelector('#forkless-auth');
    if (token) {
      authOverlay.classList.add('fk-hidden');
    } else {
      authOverlay.classList.remove('fk-hidden');
    }
  }

  // ─── Auth Flow ────────────────────────────────────────────────

  let authStep = 'email';

  async function handleAuth() {
    const authError = agentLayer.querySelector('#forkless-auth-error');
    const authSubmit = agentLayer.querySelector('#fk-auth-submit');
    const emailInput = agentLayer.querySelector('#fk-auth-email');
    const otpInput = agentLayer.querySelector('#fk-auth-otp');
    const authTitle = agentLayer.querySelector('#fk-auth-title');

    authError.textContent = '';
    authSubmit.disabled = true;

    if (authStep === 'email') {
      const email = emailInput.value.trim();
      if (!email) { authSubmit.disabled = false; return; }
      authEmail = email;

      try {
        const res = await fetch(`${config.apiUrl}/auth/send-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, tenant_id: config.tenantId }),
        });
        const data = await res.json();
        if (data.data?.sent) {
          authStep = 'otp';
          emailInput.style.display = 'none';
          otpInput.style.display = 'block';
          otpInput.focus();
          authSubmit.textContent = 'Verify';
          authTitle.textContent = 'Enter your code';
          agentLayer.querySelector('#forkless-auth p').textContent = `We sent a 6-digit code to ${email}`;
        } else {
          authError.textContent = data.error || 'Failed to send code';
        }
      } catch {
        authError.textContent = 'Connection error';
      }
    } else if (authStep === 'otp') {
      const otp = otpInput.value.trim();
      if (!otp) { authSubmit.disabled = false; return; }

      try {
        const res = await fetch(`${config.apiUrl}/auth/verify-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: authEmail, otp, tenant_id: config.tenantId }),
        });
        const data = await res.json();
        if (data.data?.authenticated) {
          token = data.data.token;
          localStorage.setItem(`forkless_token_${config.tenantId}`, token);
          updateAuthVisibility();
          addSystemMessage('Signed in successfully');

          // Show greeting after auth
          if (config.greeting) {
            setTimeout(() => addMessage('agent', config.greeting), 400);
          }

          connectWebSocket();
          if (config.boardEnabled) fetchBoard();
        } else {
          authError.textContent = data.error || 'Invalid code';
        }
      } catch {
        authError.textContent = 'Connection error';
      }
    }

    authSubmit.disabled = false;
  }

  // ─── Mode Controls ────────────────────────────────────────────

  function setAgentMode(mode) {
    config.agentMode = mode;
    applyMode(mode);
    localStorage.setItem(`forkless_mode_${config.tenantId}`, mode);
  }

  function applyMode(mode) {
    agentLayer.className = `fk-${mode}`;

    // FAB visibility
    if (mode === 'collapsed') {
      fabButton.classList.remove('fk-hidden');
    } else {
      fabButton.classList.add('fk-hidden');
    }

    // Active button highlighting
    agentLayer.querySelectorAll('.fk-mode-btn').forEach(b => b.classList.remove('fk-active'));
    const activeBtn = agentLayer.querySelector(`#fk-btn-${mode}`);
    if (activeBtn) activeBtn.classList.add('fk-active');

    // Reset input expansion on collapse
    if (mode === 'collapsed') {
      collapseInput();
    }

    // Focus input when opening
    if (mode !== 'collapsed') {
      setTimeout(() => {
        const input = agentLayer.querySelector('#forkless-input');
        if (input && token) input.focus();
      }, 400);
    }
  }

  // ─── Expand/Collapse Input ────────────────────────────────────

  function checkExpandButton() {
    if (inputExpanded) return;
    const input = agentLayer.querySelector('#forkless-input');
    const expandBtn = agentLayer.querySelector('#forkless-expand-btn');
    if (input.scrollHeight > 147) {
      expandBtn.classList.add('fk-visible');
    } else {
      expandBtn.classList.remove('fk-visible');
    }
  }

  function toggleExpandInput() {
    if (inputExpanded) {
      collapseInput();
    } else {
      expandInput();
    }
  }

  function expandInput() {
    inputExpanded = true;
    const input = agentLayer.querySelector('#forkless-input');
    input.style.removeProperty('height');
    agentLayer.querySelector('#forkless-input-area').classList.add('fk-expanded');
    agentLayer.querySelector('#forkless-log').classList.add('fk-hidden-for-expand');
    agentLayer.querySelector('#forkless-expand-btn').innerHTML = ICON_EXPAND_DOWN;
    input.focus();
  }

  function collapseInput() {
    inputExpanded = false;
    const input = agentLayer.querySelector('#forkless-input');
    agentLayer.querySelector('#forkless-input-area').classList.remove('fk-expanded');
    agentLayer.querySelector('#forkless-log').classList.remove('fk-hidden-for-expand');
    agentLayer.querySelector('#forkless-expand-btn').innerHTML = ICON_EXPAND_UP;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 147) + 'px';
    setTimeout(checkExpandButton, 50);
  }

  function resetInput() {
    const input = agentLayer.querySelector('#forkless-input');
    const expandBtn = agentLayer.querySelector('#forkless-expand-btn');
    input.value = '';
    input.style.height = 'auto';
    inputExpanded = false;
    agentLayer.querySelector('#forkless-input-area').classList.remove('fk-expanded');
    agentLayer.querySelector('#forkless-expand-btn').innerHTML = ICON_EXPAND_UP;
    expandBtn.classList.remove('fk-visible');
  }

  // ─── Messaging ────────────────────────────────────────────────

  function addMessage(role, text) {
    const log = agentLayer.querySelector('#forkless-log');
    const welcome = log.querySelector('#forkless-welcome');
    if (welcome) welcome.remove();

    const msgDiv = document.createElement('div');
    msgDiv.className = `fk-message fk-${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'fk-msg-avatar';
    if (role === 'agent') {
      avatar.innerHTML = ICON_CHAT_XS;
    } else {
      avatar.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    }

    const bubble = document.createElement('div');
    bubble.className = 'fk-msg-bubble';
    bubble.innerHTML = linkifyText(text);

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
    log.appendChild(msgDiv);
    log.scrollTop = log.scrollHeight;
  }

  function addSystemMessage(text) {
    const log = agentLayer.querySelector('#forkless-log');
    const msg = document.createElement('div');
    msg.className = 'fk-system-msg';
    msg.textContent = text;
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
  }

  function showTyping() {
    agentLayer.querySelector('#forkless-typing').classList.add('fk-active');
    const log = agentLayer.querySelector('#forkless-log');
    log.scrollTop = log.scrollHeight;
  }

  function hideTyping() {
    agentLayer.querySelector('#forkless-typing').classList.remove('fk-active');
  }

  async function sendMessage() {
    const input = agentLayer.querySelector('#forkless-input');
    const text = input.value.trim();
    if (!text) return;

    addMessage('user', text);
    resetInput();
    showTyping();

    const sendBtn = agentLayer.querySelector('#forkless-send-btn');
    sendBtn.disabled = true;

    try {
      const chatUrl = config.chatUrl || config.apiUrl;
      const res = await fetch(`${chatUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          tenant_id: config.tenantId,
          conversation_id: conversationId,
        }),
      });

      hideTyping();

      if (res.status === 401) {
        // Token expired or invalid — re-auth
        token = null;
        localStorage.removeItem(`forkless_token_${config.tenantId}`);
        authStep = 'email';
        const emailInput = agentLayer.querySelector('#fk-auth-email');
        const otpInput = agentLayer.querySelector('#fk-auth-otp');
        emailInput.style.display = 'block';
        otpInput.style.display = 'none';
        agentLayer.querySelector('#fk-auth-submit').textContent = 'Send Code';
        agentLayer.querySelector('#fk-auth-title').textContent = 'Session expired';
        agentLayer.querySelector('#forkless-auth p').textContent = 'Please sign in again.';
        updateAuthVisibility();
        sendBtn.disabled = false;
        return;
      }

      if (res.status === 429) {
        addSystemMessage('Daily message limit reached. Try again tomorrow.');
        sendBtn.disabled = false;
        return;
      }

      if (res.status === 500) {
        addSystemMessage('Our AI service is temporarily unavailable. Please try again in a moment.');
        sendBtn.disabled = false;
        return;
      }

      if (res.status === 503 || res.status === 504) {
        addSystemMessage('That took too long to process. Try a shorter or more specific question.');
        sendBtn.disabled = false;
        return;
      }

      if (!res.ok) {
        addSystemMessage('Something went wrong. Please try again.');
        sendBtn.disabled = false;
        return;
      }

      const data = await res.json();
      if (data.data) {
        addMessage('agent', data.data.reply);
        conversationId = data.data.conversation_id || conversationId;
        localStorage.setItem(`forkless_conv_${config.tenantId}`, conversationId);

        // Handle actions
        if (data.data.actions) handleActions(data.data.actions);
        if (config.boardEnabled && data.data.boardUpdate) renderBoard(data.data.boardUpdate);

        // Update usage display
        if (data.data.usage) {
          const usageEl = agentLayer.querySelector('#forkless-usage');
          usageEl.textContent = `${data.data.usage.remaining} messages remaining today`;
        }
      } else if (data.error) {
        addSystemMessage(data.error);
      }
    } catch {
      hideTyping();
      addSystemMessage('Connection error. Please check your internet and try again.');
    }

    sendBtn.disabled = false;
  }

  function handleActions(actions) {
    for (const action of actions) {
      switch (action.action) {
        case 'show_board':
          setBoardMode(action.mode || 'full_board');
          if (action.columns) renderBoard(action.columns);
          break;
        case 'focus_card':
          setBoardMode('full_board');
          break;
        case 'set_display_mode':
          if (action.board_mode) setBoardMode(action.board_mode);
          if (action.agent_mode) setAgentMode(action.agent_mode);
          break;
      }
    }
  }

  // ─── Board Overlay ────────────────────────────────────────────

  function createBoardOverlay() {
    boardOverlay = document.createElement('div');
    boardOverlay.id = 'forkless-board';
    boardOverlay.className = config.boardMode === 'minimized' ? 'fk-minimized' : '';
    boardOverlay.innerHTML = '<div class="fk-board-columns"></div>';
    document.body.appendChild(boardOverlay);

    boardBadge = document.createElement('div');
    boardBadge.id = 'forkless-board-badge';
    boardBadge.textContent = 'Board';
    boardBadge.style.display = config.boardMode === 'minimized' ? 'block' : 'none';
    boardBadge.addEventListener('click', () => setBoardMode('full_board'));
    document.body.appendChild(boardBadge);
  }

  function renderBoard(columns) {
    const container = boardOverlay.querySelector('.fk-board-columns');
    const stages = ['intake', 'qualified', 'grooming', 'building', 'validate', 'done'];

    container.innerHTML = stages.map(stage => `
      <div class="fk-board-column">
        <h3>${stage} (${(columns[stage] || []).length})</h3>
        ${(columns[stage] || []).map(card => `
          <div class="fk-board-card bg-${card.background || 'default'}" data-card-id="${card.id}">
            <div class="fk-card-title">${escapeHtml(card.title)}</div>
            ${card.description ? `<div class="fk-card-desc">${escapeHtml(truncate(card.description, 60))}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  function setBoardMode(mode) {
    config.boardMode = mode;
    if (mode === 'minimized') {
      boardOverlay.classList.add('fk-minimized');
      if (boardBadge) boardBadge.style.display = 'block';
    } else {
      boardOverlay.classList.remove('fk-minimized');
      if (boardBadge) boardBadge.style.display = 'none';
    }
  }

  // ─── WebSocket ────────────────────────────────────────────────

  let wsRetries = 0;
  const WS_MAX_RETRIES = 3;

  function connectWebSocket() {
    // Only connect if explicit wsUrl is provided (data-ws attribute)
    if (!config.wsUrl) return;
    if (ws && ws.readyState <= 1) return;
    if (wsRetries >= WS_MAX_RETRIES) return;

    const params = new URLSearchParams();
    if (token) params.set('token', token);
    if (config.tenantId) params.set('tenant_id', config.tenantId);

    try {
      ws = new WebSocket(`${config.wsUrl}?${params}`);
      ws.onopen = () => {
        wsRetries = 0; // Reset on successful connect
        if (config.boardEnabled) ws.send(JSON.stringify({ action: 'subscribe', channel: 'board' }));
        ws.send(JSON.stringify({ action: 'subscribe', channel: 'agent' }));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.channel === 'board') fetchBoard();
          if (data.channel === 'agent' && data.text) {
            addMessage('agent', data.text);
          }
        } catch {}
      };
      ws.onclose = () => {
        wsRetries++;
        if (wsRetries < WS_MAX_RETRIES) {
          setTimeout(connectWebSocket, 5000 * wsRetries);
        }
      };
    } catch {}
  }

  // ─── API Calls ────────────────────────────────────────────────

  async function fetchBoard() {
    if (!config.apiUrl || !config.tenantId) return;
    try {
      const res = await fetch(`${config.apiUrl}/board?tenant_id=${config.tenantId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.data?.columns) renderBoard(data.data.columns);
    } catch {}
  }

  // ─── Utilities ────────────────────────────────────────────────

  function linkifyText(text) {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>'
    );
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function truncate(str, max) {
    if (!str || str.length <= max) return str;
    return str.slice(0, max) + '...';
  }

  // ─── Public API ───────────────────────────────────────────────

  window.Forkless = {
    init,
    setAgentMode,
    setBoardMode,
    renderBoard,
    fetchBoard,
    setToken: (t) => {
      token = t;
      localStorage.setItem(`forkless_token_${config.tenantId}`, t);
      updateAuthVisibility();
    },
    version: WIDGET_VERSION,
  };

  // Auto-init
  const currentScript = document.currentScript;
  if (currentScript && (currentScript.dataset.api || currentScript.src.includes('tenant='))) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => init());
    } else {
      init();
    }
  }
})();
