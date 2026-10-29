if (window.top === window) {
    createFive9Dock();
}

function createFive9Dock() {
    if (document.getElementById('five9-navusoft-widget')) {
        return;
    }

    const host = document.createElement('div');
    host.id = 'five9-navusoft-widget';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
        :host { all: initial; }
        [hidden] { display: none !important; }
        .launcher {
            position: fixed;
            left: 8px;
            bottom: 8px;
            width: 56px;
            height: 56px;
            z-index: 2147483646;
            border: 0;
            border-radius: 50%;
            background: #304ffe;
            color: #ffffff;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
            cursor: pointer;
            font: 700 20px/1 "Avenir Next", "Helvetica Neue", sans-serif;
        }
        .launcher:hover { background: #263fd4; }
        .launcher:focus-visible, .close:focus-visible {
            outline: 3px solid #fbbf24;
            outline-offset: 3px;
        }
        .panel {
            display: flex;
            flex-direction: column;
            position: fixed;
            left: 8px;
            bottom: 8px;
            width: min(460px, calc(100vw - 16px), calc(100dvh - 16px));
            height: min(460px, calc(100vw - 16px), calc(100dvh - 16px));
            box-sizing: border-box;
            z-index: 2147483647;
            background: transparent;
        }
        .header {
            display: flex;
            flex-shrink: 0;
            align-items: center;
            justify-content: flex-end;
            height: 44px;
            padding-right: 6px;
            border-radius: 8px 8px 0 0;
            background: transparent;
        }
        .surface {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            overflow: hidden;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            background: #ffffff;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
        }
        .close {
            display: grid;
            align-items: center;
            justify-items: end;
            box-sizing: border-box;
            width: 64px;
            height: 44px;
            padding: 0 10px 0 0;
            border: 0;
            background: transparent;
            color: #1d5674;
            opacity: 0;
            cursor: pointer;
        }
        .close:hover, .close:focus-visible { opacity: 1; }
        .close:hover { color: #003b5c; }
        .close::before {
            content: "";
            width: 7px;
            height: 7px;
            border-right: 2px solid currentColor;
            border-bottom: 2px solid currentColor;
            transform: translateY(-2px) rotate(45deg);
        }
        iframe {
            display: block;
            flex: 1;
            min-height: 0;
            width: 100%;
            border: 0;
            background: #ffffff;
        }
    `;

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Five9 Agent Desktop');

    const header = document.createElement('div');
    header.className = 'header';
    const surface = document.createElement('div');
    surface.className = 'surface';
    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Minimize Five9 dock');
    close.title = 'Minimize Five9';

    const iframe = document.createElement('iframe');
    iframe.src = 'https://app.five9.com/clients/integrations/adt.main.html?f9verticalthreshold=300px&f9hookapi=true';
    iframe.title = 'Five9 Agent Desktop';
    iframe.allow = 'microphone; autoplay';
    iframe.addEventListener('load', () => console.log('#### Docked Five9 Agent Desktop loaded'));

    const launcher = document.createElement('button');
    launcher.className = 'launcher';
    launcher.type = 'button';
    launcher.textContent = 'F9';
    launcher.title = 'Open Five9';
    launcher.setAttribute('aria-label', 'Open Five9');
    launcher.setAttribute('aria-expanded', 'false');

    const setOpen = (open) => {
        panel.hidden = !open;
        launcher.hidden = open;
        launcher.setAttribute('aria-expanded', String(open));
        console.log(`#### Docked Five9 widget ${open ? 'opened' : 'closed'}`);
        if (open) {
            close.focus();
        } else {
            launcher.focus();
        }
    };

    launcher.addEventListener('click', () => setOpen(true));
    close.addEventListener('click', () => setOpen(false));
    shadow.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !panel.hidden) {
            setOpen(false);
        }
    });

    const handledCalls = new Set();
    window.addEventListener('message', (event) => {
        const message = event.data;
        if (event.source === window && event.origin === location.origin && message?.source === 'five9-navusoft-api' &&
            ['ACCOUNT_VISITED', 'SAVE_CALL_NOTE_RESULT'].includes(message.type)) {
            iframe.contentWindow.postMessage({ ...message, source: 'five9-navusoft-extension' }, 'https://app.five9.com');
        } else if (event.source === iframe.contentWindow && event.origin === 'https://app.five9.com' &&
            message?.source === 'five9-navusoft-adapter') {
            if (message.type === 'BRIDGE_READY') {
                window.postMessage({ source: 'five9-navusoft-extension', type: 'REQUEST_ACCOUNT_VISITS' }, location.origin);
            } else if (message.type === 'CALL_STARTED') {
                setOpen(true);
            } else if (message.type === 'SAVE_CALL_NOTE') {
                window.postMessage({ ...message, source: 'five9-navusoft-extension' }, location.origin);
            }
        }
    });
    window.addEventListener('message', async (event) => {
        const message = event.data;
        if (event.origin !== 'https://app.five9.com' || event.source !== iframe.contentWindow ||
            message?.source !== 'five9-navusoft-adapter' ||
            !['INBOUND_CALL_STARTED', 'MANUAL_CALL_STARTED'].includes(message.type) ||
            typeof message.interactionId !== 'string' || !message.interactionId ||
            typeof message.number !== 'string' || handledCalls.has(message.interactionId)) {
            return;
        }
        handledCalls.add(message.interactionId);
        if (handledCalls.size > 256) {
            handledCalls.delete(handledCalls.values().next().value);
        }
        try {
            const contacts = await searchNavusoftContacts(message.number);
            console.log('#### Navusoft contact search completed', { count: contacts.length });
        } catch (error) {
            console.error('#### Navusoft contact search failed');
        }
    });

    header.append(close);
    surface.append(iframe);
    panel.append(header, surface);
    shadow.append(style, panel, launcher);
    document.documentElement.appendChild(host);
    console.log('#### Docked Five9 widget initialized for Navusoft');
}

async function searchNavusoftContacts(number) {
    const digits = String(number || '').replace(/\D/g, '');
    const phone = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (phone.length < 7 || phone.length > 15) {
        throw new Error('No valid caller phone number');
    }
    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const receive = (event) => {
            if (event.source !== window || event.origin !== location.origin ||
                event.data?.source !== 'five9-navusoft-api' || event.data.requestId !== requestId) {
                return;
            }
            clearTimeout(timeout);
            window.removeEventListener('message', receive);
            if (event.data.ok) {
                resolve(event.data.contacts);
            } else {
                reject(new Error(event.data.error || 'Navusoft contact search failed'));
            }
        };
        const timeout = setTimeout(() => {
            window.removeEventListener('message', receive);
            reject(new Error('Navusoft contact search timed out'));
        }, 20000);
        window.addEventListener('message', receive);
        window.postMessage({ source: 'five9-navusoft-extension', type: 'SEARCH_CONTACTS', requestId, phone }, location.origin);
    });
}