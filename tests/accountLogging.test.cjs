const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { test } = require('node:test');

const origin = 'https://bigssanitation.navusoft.net';
const five9Origin = 'https://app.five9.com';
const source = (filename) => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
const flush = async () => {
    await new Promise(setImmediate);
    await new Promise(setImmediate);
};

function createHarness(storage = new Map(), options = {}) {
    const listeners = new Set();
    const storeEvents = {};
    const detailEvents = {};
    const writes = [];
    const updates = [];
    const visits = [];
    const errors = [];
    const reloads = [];
    const logs = [];
    const transcriptionRequests = [];
    const noteResults = [];
    const cavWrites = [];
    const frames = [];
    const elements = [];
    const contactSearches = [];
    const catalogRequests = [];
    const cavReads = [];
    let account = { id: '123', name: 'Account One' };
    let selectedView;
    let sdkReceive;
    let sdkEvents;
    let hooks;
    let applicationEvents;
    let selectedAccountId = '123';
    const variables = options.cavList || [
        { id: '81', group: 'Navusoft', name: 'account_id' },
        { id: '82', group: 'Navusoft', name: 'note_id' }
    ];
    const interactionVariables = options.interactionCavList || variables;
    const top = {
        addEventListener(type, callback) { listeners.add(callback); },
        removeEventListener(type, callback) { listeners.delete(callback); },
        postMessage(data) {
            if (data.type === 'SAVE_CALL_NOTE_RESULT') noteResults.push(data);
            if (data.type === 'SEARCH_CONTACTS') {
                contactSearches.push(data);
                queueMicrotask(() => top.postMessage({
                    source: 'five9-navusoft-api', requestId: data.requestId, ok: true,
                    contacts: [{ name: 'Test Contact', siteName: 'Test Site' }]
                }));
            }
            queueMicrotask(() => listeners.forEach((callback) => callback({ source: top, origin, data })));
        }
    };
    top.top = top;
    const parent = {
        postMessage(data) {
            queueMicrotask(() => listeners.forEach((callback) => callback({ source: sdk, origin: five9Origin, data })));
        }
    };
    const sdk = {
        parent,
        addEventListener(type, callback) { sdkReceive = callback; },
        postMessage(data) {
            queueMicrotask(() => sdkReceive({ source: parent, origin, data }));
        },
        Five9: { CrmSdk: {
            HookStatusCode: { Proceed: 'Proceed', Error: 'Error', Confirmation: 'Confirmation' },
            hookApi: () => ({ registerApi(callbacks) { hooks = callbacks; } }),
            applicationApi: () => ({ subscribe(callbacks) { applicationEvents = callbacks; } }),
            interactionApi: () => ({
            subscribe(callbacks) { sdkEvents = callbacks; },
            objectVisited({ crmObject }) { visits.push(crmObject); },
            isMasterPage: async () => options.master !== false,
            async getSelectedRelatedToObject() {
                if (options.selectionError) throw options.selectionError;
                if (Object.hasOwn(options, 'selectedObject')) return options.selectedObject;
                return selectedAccountId ? { id: `navusoft-account:${selectedAccountId}` } : undefined;
            },
            async getDispositions() { return options.dispositions || [{ id: '17', name: 'Completed' }]; },
            async getMetadata() { return { tenantId: options.metadataDomainId || 12 }; },
            async executeRestApi(params) {
                catalogRequests.push(params);
                if (options.catalogGate) await options.catalogGate;
                if (options.catalogFails) throw new Error('Catalog request failed');
                return options.catalogResponse || { status: 200, response: options.domainCavList || variables };
            },
            async getCav(params) {
                cavReads.push(params);
                if (options.cavReadFails) throw new Error('CAV readback failed');
                return interactionVariables;
            },
            async setCav(params) {
                cavWrites.push(params);
                if (options.cavGate) await options.cavGate;
                if (options.cavFails) throw new Error('CAV update failed');
                if (!options.ignoreCavWrite) {
                    for (const updated of params.cavList) {
                        let variable = interactionVariables.find((variable) => variable.id === updated.id);
                        if (!variable) {
                            variable = { id: updated.id };
                            interactionVariables.push(variable);
                        }
                        variable.value = updated.value;
                    }
                }
            },
            async executeCloudRestApi(params) {
                transcriptionRequests.push(params);
                if (options.transcriptFails) {
                    throw { errorCode: 'NotAvailable', errorMessage: 'Transcript not ready' };
                }
                return options.transcriptResult || { status: 200, response: { summary: 'Test AI summary' } };
            }
        }) } }
    };
    class Element {
        constructor(tag) {
            elements.push(this);
            this.tag = tag;
            this.children = [];
            this.events = {};
            this.style = {};
            if (tag === 'iframe') {
                this.contentWindow = sdk;
                frames.push(this);
            }
        }
        append(...children) { this.children.push(...children); }
        appendChild(child) { this.append(child); }
        attachShadow() { return new Element('shadow'); }
        setAttribute() {}
        addEventListener(type, callback) { this.events[type] = callback; }
        focus() {}
    }
    const root = new Element('html');
    const document = {
        documentElement: root,
        createElement: (tag) => new Element(tag),
        getElementById: (id) => root.children.find((child) => child.id === id)
    };
    const noteStore = {
        lastOptions: options.notesLoaded ? { params: {} } : undefined,
        reload() {
            reloads.push('notes');
            if (!this.lastOptions || options.noteRefreshFails) {
                throw new Error('Notes store cannot reload');
            }
        }
    };
    const activityStore = {
        lastOptions: { params: {} },
        reload() { reloads.push('activity'); }
    };
    const detail = {
        on(type, callback) { detailEvents[type] = callback; },
        down(selector) {
            if (selector === 'pendingactivitygrid') return { getStore: () => activityStore };
        }
    };
    selectedView = detail;
    const store = {
        getAt: () => ({ get: (key) => ({
            'account-id': account.id,
            'account-name': account.name,
            'account-access': options.denied ? 0 : 1
        })[key] }),
        on(type, callback) { storeEvents[type] = callback; }
    };
    top.Ext = {
        data: { StoreManager: { lookup: (id) => ({ customerSiteStore: store, 'note.NoteBySite': noteStore })[id] } },
        getCmp: () => detail,
        ComponentQuery: { query: () => [{ getLayout: () => ({ getActiveItem: () => selectedView }) }] },
        create: () => ({
            proxy: { headers: {} },
            getId() { return this.id === undefined ? (options.noteId === undefined ? 987 : options.noteId) : this.id; },
            setId(id) { this.id = id; },
            commit() {},
            set(data, value) {
                if (typeof data === 'string') this.data[data] = value;
                else this.data = data;
            },
            save({ callback }) {
                if (this.saved) updates.push({ ...this.data });
                else writes.push({ ...this.data });
                this.saved = true;
                callback(this, {
                    wasSuccessful: () => !options.saveFails,
                    response: { responseText: options.saveResponse || '' }
                });
            }
        })
    };
    top.Portal = {
        model: {
            SharedData: { sessionId: 'test-only-session', usrId: 7 },
            StaticReferenceData: { getNoteTypesStore: () => ({ getRange: () => options.noNoteType ? [] : [{
                get: (key) => ({ type: 1, name: 'Service Note ', id: 17 })[key]
            }] }) }
        },
        util: { Constants: { CARD_CUSTOMER_DETAIL: 'customer' }, Formatter: { generateUUID: () => 'test-only-uuid' } }
    };
    const console = { log: (...args) => logs.push(args), error: (...args) => errors.push(args.join(' ')) };
    const common = { crypto: webcrypto, setTimeout, clearTimeout, console };
    const topContext = vm.createContext({ ...common, window: top, self: top, document, location: { origin },
        localStorage: { getItem: () => null, setItem() {} },
        sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) }
    });
    const sdkContext = vm.createContext({ ...common, window: sdk });
    vm.runInContext(source('five9Bridge.js'), sdkContext);
    vm.runInContext(source('content.js'), topContext);
    vm.runInContext(source('accountLogging.js'), topContext);
    return {
        writes, updates, visits, errors, storage, reloads, logs, transcriptionRequests, noteResults, cavWrites,
        iframeUrl: frames[0].src,
        elements, contactSearches, catalogRequests, cavReads,
        initializeSession() { applicationEvents.sessionInitialized(); },
        inbound(interactionId) {
            parent.postMessage({ source: 'five9-navusoft-adapter', type: 'INBOUND_CALL_STARTED',
                interactionId, number: '17249725640' });
        },
        beforeSave(interactionId, relatedId = '123', callState = 'WRAP_UP', domainId = '12') {
            selectedAccountId = relatedId;
            return hooks.beforeDisposition({
                interactionType: 'Call',
                dispositionId: 17,
                interactionData: { interactionId, callId: 'five9-call', callType: 'INBOUND', callState, ani: '7249725640', domainId },
            });
        },
        end(callData = { domainId: '12', callId: '34' }) { sdkEvents.callEnded({ callData }); },
        openAccount(id, name) {
            account = { id, name };
            storeEvents.load(store, [], true);
        },
        finish(interactionId, relatedId = '123', disposition = 'Completed') {
            sdkEvents.callFinished({
                callData: { interactionId, callId: 'five9-call', callType: 'INBOUND', ani: '7249725640' },
                callLogData: {
                    what: relatedId ? { id: `navusoft-account:${relatedId}` } : undefined,
                    dispositionName: disposition, comment: 'Agent summary'
                }
            });
        },
        replayVisits() { top.postMessage({ source: 'five9-navusoft-extension', type: 'REQUEST_ACCOUNT_VISITS' }); }
    };
}

test('fetches and logs transcription values before disposition once per call', async () => {
    const result = { status: 200, response: { summary: 'Test AI summary', token: 'test-secret' } };
    const harness = createHarness(new Map(), { transcriptResult: result });
    harness.end();
    harness.end();
    await flush();
    assert.equal(harness.transcriptionRequests.length, 1);
    const request = harness.transcriptionRequests[0];
    assert.equal(request.path, '/transcript/v1/transcripts/domains/12/calls/34/transcriptions');
    assert.equal(request.method, 'GET');
    assert.equal(Object.keys(request.payload).length, 0);
    assert.equal(harness.writes.length, 0);
    const entry = harness.logs.find((args) => args[0].includes('pre-disposition transcription response'));
    assert.equal(entry[1].status, 200);
    assert.equal(entry[1].response.summary, 'Test AI summary');
    assert.equal(entry[1].response.token, '[REDACTED]');
    result.response.summary = 'Changed later';
    assert.equal(entry[1].response.summary, 'Test AI summary');
});

test('transcription lookup skips missing IDs and nonmaster frames', async () => {
    const harness = createHarness();
    harness.end({ domainId: '12' });
    harness.end({ callId: '34' });
    await flush();
    assert.equal(harness.transcriptionRequests.length, 0);
    const nonmaster = createHarness(new Map(), { master: false });
    nonmaster.end();
    await flush();
    assert.equal(nonmaster.transcriptionRequests.length, 0);
});

test('transcription errors do not block disposition or the account note', async () => {
    const harness = createHarness(new Map(), { transcriptFails: true });
    harness.end();
    await flush();
    assert.ok(harness.errors.some((message) => message.includes('pre-disposition transcription lookup failed')));
    harness.finish('transcript-failed');
    await flush();
    assert.equal(harness.writes.length, 1);
    const notReady = createHarness(new Map(), { transcriptResult: { status: 404, response: 'Not ready' } });
    notReady.end();
    await flush();
    const entry = notReady.logs.find((args) => args[0].includes('pre-disposition transcription response'));
    assert.equal(entry[1].status, 404);
    assert.equal(entry[1].response, 'Not ready');
});

test('registers account visits and saves to selected Related To, not the current account', async () => {
    const harness = createHarness();
    await flush();
    harness.openAccount('456', 'Account Two');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flush();
    assert.ok(harness.visits.some((account) => account.id === 'navusoft-account:123' && account.isWhat && !account.isWho));
    assert.ok(harness.visits.some((account) => account.id === 'navusoft-account:456'));
    harness.finish('selected-account');
    await flush();
    assert.equal(harness.writes.length, 1);
    assert.equal(harness.writes[0].accountId, 123);
    assert.equal(harness.writes[0].siteId, undefined);
    assert.equal(harness.writes[0].typeId, 17);
    assert.match(harness.writes[0].note, /Disposition: Completed/);
    assert.match(harness.writes[0].note, /Agent summary/);
    assert.deepEqual(harness.reloads, []);
});

test('refreshes activity without reloading an unopened Notes store', async () => {
    const harness = createHarness();
    await flush();
    harness.finish('refresh-activity');
    await flush();
    assert.equal(harness.writes.length, 1);
    assert.deepEqual(harness.reloads, ['activity']);
    assert.ok(!harness.errors.some((message) => message.includes('refresh')));
});

test('refreshes initialized Notes and activity stores independently', async () => {
    const harness = createHarness(new Map(), { notesLoaded: true });
    await flush();
    harness.finish('refresh-both');
    await flush();
    assert.deepEqual(harness.reloads, ['notes', 'activity']);
    const failed = createHarness(new Map(), { notesLoaded: true, noteRefreshFails: true });
    await flush();
    failed.finish('refresh-failure');
    await flush();
    assert.equal(failed.writes.length, 1);
    assert.deepEqual(failed.reloads, ['notes', 'activity']);
    assert.ok(failed.errors.some((message) => message.includes('could not refresh')));
    assert.ok(!failed.errors.some((message) => message.includes('call note failed:')));
});

test('does not save without disposition, Related To, a visited account, or master ownership', async () => {
    const harness = createHarness();
    await flush();
    harness.finish('no-disposition', '123', '');
    harness.finish('no-account', null);
    harness.finish('unvisited', '999');
    await flush();
    assert.equal(harness.writes.length, 0);
    const nonmaster = createHarness(new Map(), { master: false });
    await flush();
    nonmaster.finish('nonmaster');
    await flush();
    assert.equal(nonmaster.writes.length, 0);
});

test('suppresses duplicate call completion, including after a page reload', async () => {
    const storage = new Map();
    const first = createHarness(storage);
    await flush();
    first.finish('duplicate');
    first.finish('duplicate');
    await flush();
    assert.equal(first.writes.length, 1);
    const reloaded = createHarness(storage);
    await flush();
    reloaded.finish('duplicate');
    await flush();
    assert.equal(reloaded.writes.length, 0);
    assert.equal(first.noteResults[0].noteId, '987');
    assert.equal(first.noteResults[0].accountId, '123');
    assert.equal(reloaded.noteResults[0].noteId, '987');
    assert.equal(reloaded.noteResults[0].duplicate, true);
});

test('failed saves are reported and not retried automatically', async () => {
    const storage = new Map();
    const first = createHarness(storage, { saveFails: true });
    await flush();
    first.finish('failed');
    await flush();
    assert.equal(first.writes.length, 1);
    assert.ok(first.errors.some((message) => message.includes('could not confirm')));
    const reloaded = createHarness(storage);
    await flush();
    reloaded.finish('failed');
    await flush();
    assert.equal(reloaded.writes.length, 0);
    assert.ok(reloaded.errors.some((message) => message.includes('already attempted')));
});

test('replays visits when Five9 is ready and refuses an unavailable note type', async () => {
    const harness = createHarness(new Map(), { noNoteType: true });
    await flush();
    const previousCount = harness.visits.length;
    harness.replayVisits();
    await flush();
    assert.ok(harness.visits.length > previousCount);
    harness.finish('missing-note-type');
    await flush();
    assert.equal(harness.writes.length, 0);
    assert.ok(harness.errors.some((message) => message.includes('Service Note')));
});

test('beforeDisposition writes the saved note and selected account IDs before allowing disposition', async () => {
    const harness = createHarness();
    await flush();
    harness.openAccount('456', 'Account Two');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flush();
    const result = await harness.beforeSave('cav-success');
    assert.equal(result.status.statusCode, 'Proceed');
    assert.equal(harness.writes.length, 1);
    assert.equal(harness.writes[0].accountId, 123);
    assert.equal(harness.cavWrites.length, 1);
    assert.equal(harness.cavWrites[0].interactionId, 'cav-success');
    assert.deepEqual(JSON.parse(JSON.stringify(harness.cavWrites[0].cavList)), [
        { id: '81', value: '123' }, { id: '82', value: '987' }
    ]);
    harness.finish('cav-success');
    await flush();
    assert.equal(harness.writes.length, 1);
    assert.equal(harness.cavWrites.length, 1);
    assert.equal(harness.updates.length, 1);
    assert.match(harness.updates[0].note, /Agent summary/);
});

test('never updates CAVs after call finish or from a nonmaster frame', async () => {
    const harness = createHarness();
    await flush();
    await harness.beforeSave('already-finished', '123', 'FINISHED');
    assert.equal(harness.writes.length, 0);
    harness.finish('already-finished');
    await flush();
    assert.equal(harness.writes.length, 1);
    assert.equal(harness.cavWrites.length, 0);
    assert.ok(harness.errors.some((message) => message.includes('saving note only')));
    const nonmaster = createHarness(new Map(), { master: false });
    await flush();
    await nonmaster.beforeSave('nonmaster-hook');
    assert.equal(nonmaster.writes.length, 0);
    assert.equal(nonmaster.cavWrites.length, 0);
});

test('missing domain CAV definitions allow disposition and preserve the saved note', async () => {
    const harness = createHarness(new Map(), { cavList: [
        { id: '81', group: 'Navusoft', name: 'account_id' },
        { id: '99', group: 'Other', name: 'note_id' }
    ] });
    await flush();
    const result = await harness.beforeSave('missing-cav');
    assert.equal(result.status.statusCode, 'Proceed');
    assert.equal(harness.writes.length, 1);
    assert.equal(harness.cavWrites.length, 0);
    assert.ok(harness.errors.some((message) => message.includes('Navusoft.note_id')));
});

test('resolves qualified Navusoft CAV names as well as separate group and name fields', async () => {
    for (const cavList of [
        [
            { id: '81', name: 'Navusoft.account_id' },
            { id: '82', name: 'Navusoft.note_id' }
        ],
        [
            { id: '81', group: 'Navusoft ', name: ' account_id ' },
            { id: '82', group: 'Navusoft', name: 'Navusoft.note_id' },
            { id: '99', group: 'Other', name: 'account_id' }
        ]
    ]) {
        const harness = createHarness(new Map(), { cavList });
        await flush();
        assert.equal((await harness.beforeSave('cav-name-formats')).status.statusCode, 'Proceed');
        assert.deepEqual(JSON.parse(JSON.stringify(harness.cavWrites[0].cavList)), [
            { id: '81', value: '123' }, { id: '82', value: '987' }
        ]);
    }
});

test('resolves unpopulated CAVs from the full domain catalog and caches it across calls', async () => {
    const harness = createHarness(new Map(), { interactionCavList: [] });
    await flush();
    assert.equal((await harness.beforeSave('domain-catalog-first')).status.statusCode, 'Proceed');
    assert.equal((await harness.beforeSave('domain-catalog-second')).status.statusCode, 'Proceed');
    assert.equal(harness.catalogRequests.length, 1);
    assert.equal(harness.catalogRequests[0].path, '/appsvcs/rs/svc/orgs/12/call_variables');
    assert.equal(harness.catalogRequests[0].method, 'GET');
    assert.equal(harness.catalogRequests[0].payload, null);
    assert.equal(harness.cavReads.length, 2);
    assert.equal(harness.cavWrites.length, 2);
    assert.equal(harness.cavWrites[0].cavList[0].value, '123');
    assert.equal(harness.cavWrites[0].cavList[1].value, '987');
});

test('catalog cache is domain-scoped and cleared when a Five9 session initializes', async () => {
    const harness = createHarness();
    await flush();
    await harness.beforeSave('domain-one');
    await harness.beforeSave('domain-two', '123', 'WRAP_UP', '34');
    assert.equal(harness.catalogRequests.length, 2);
    assert.equal(harness.catalogRequests[1].path, '/appsvcs/rs/svc/orgs/34/call_variables');
    harness.initializeSession();
    await harness.beforeSave('domain-one-new-session');
    assert.equal(harness.catalogRequests.length, 3);
    assert.equal(harness.catalogRequests[2].path, '/appsvcs/rs/svc/orgs/12/call_variables');
});

test('concurrent calls share an in-flight catalog request', async () => {
    let release;
    const catalogGate = new Promise((resolve) => { release = resolve; });
    const harness = createHarness(new Map(), { catalogGate });
    await flush();
    const first = harness.beforeSave('concurrent-catalog-first');
    const second = harness.beforeSave('concurrent-catalog-second');
    await flush();
    assert.equal(harness.catalogRequests.length, 1);
    assert.equal(harness.writes.length, 2);
    release();
    assert.equal((await first).status.statusCode, 'Proceed');
    assert.equal((await second).status.statusCode, 'Proceed');
});

test('catalog failures allow disposition, preserve notes, and are not cached', async () => {
    for (const options of [
        { catalogFails: true },
        { catalogResponse: { status: 403, response: [] } },
        { catalogResponse: { status: 200, response: {} } },
        { catalogResponse: { status: 200, response: 'not-json' } }
    ]) {
        const harness = createHarness(new Map(), options);
        await flush();
        assert.equal((await harness.beforeSave('catalog-failure')).status.statusCode, 'Proceed');
        assert.equal((await harness.beforeSave('catalog-failure')).status.statusCode, 'Proceed');
        assert.equal(harness.catalogRequests.length, 2);
        assert.equal(harness.writes.length, 1);
        assert.equal(harness.cavWrites.length, 0);
        assert.ok(harness.errors.some((message) => message.includes('CAV synchronization failed; allowing disposition')));
    }
});

test('catalog lookup supports metadata domain IDs and JSON response bodies', async () => {
    const harness = createHarness(new Map(), {
        metadataDomainId: 56,
        interactionCavList: [],
        catalogResponse: { status: 200, response: JSON.stringify([
            { id: '81', group: 'Navusoft', name: 'account_id' },
            { id: '82', group: 'Navusoft', name: 'note_id' }
        ]) }
    });
    await flush();
    assert.equal((await harness.beforeSave('metadata-domain', '123', 'WRAP_UP', null)).status.statusCode, 'Proceed');
    assert.equal(harness.catalogRequests[0].path, '/appsvcs/rs/svc/orgs/56/call_variables');
    const missingAccount = createHarness();
    await flush();
    assert.equal((await missingAccount.beforeSave('no-account-catalog', null)).status.statusCode, 'Confirmation');
    assert.equal(missingAccount.catalogRequests.length, 0);
    assert.equal(missingAccount.cavReads.length, 0);
});

test('ambiguous or conflicting CAV definitions allow disposition without logging values', async () => {
    for (const cavList of [
        [
            { id: '81', group: 'Navusoft', name: 'account_id', value: 'private-test-value' },
            { id: '83', name: 'Navusoft.account_id' },
            { id: '82', group: 'Navusoft', name: 'note_id' }
        ],
        [
            { id: '81', group: 'Other', name: 'Navusoft.account_id', value: 'private-test-value' },
            { id: '82', group: 'Navusoft', name: 'note_id' }
        ]
    ]) {
        const harness = createHarness(new Map(), { cavList });
        await flush();
        const result = await harness.beforeSave('cav-definition-conflict');
        assert.equal(result.status.statusCode, 'Proceed');
        assert.ok(harness.errors.some((message) => message.includes('did not expose a unique Navusoft.account_id')));
        assert.equal(harness.cavWrites.length, 0);
        assert.ok(harness.errors.some((message) => message.includes('CAV definitions (values omitted)')));
        assert.ok(harness.errors.every((message) => !message.includes('private-test-value')));
    }
});

test('CAV failures can be retried without saving another note, including after reload', async () => {
    const storage = new Map();
    const failed = createHarness(storage, { cavFails: true });
    await flush();
    assert.equal((await failed.beforeSave('cav-retry')).status.statusCode, 'Proceed');
    assert.equal((await failed.beforeSave('cav-retry')).status.statusCode, 'Proceed');
    assert.equal(failed.writes.length, 1);
    assert.equal(failed.cavWrites.length, 2);
    assert.ok(failed.errors.some((message) => message.includes('CAV update failed')));
    const reloaded = createHarness(storage);
    await flush();
    await reloaded.beforeSave('cav-retry');
    assert.equal(reloaded.writes.length, 0);
    assert.equal(reloaded.cavWrites[0].cavList[1].value, '987');
});

test('failed saves and missing note IDs never populate success CAVs', async () => {
    for (const options of [{ saveFails: true }, { noteId: null }]) {
        const harness = createHarness(new Map(), options);
        await flush();
        assert.equal((await harness.beforeSave('no-note-id')).status.statusCode, options.saveFails ? 'Error' : 'Proceed');
        harness.finish('no-note-id');
        await flush();
        assert.equal(harness.writes.length, 1);
        assert.equal(harness.cavWrites.length, 0);
        assert.ok(harness.errors.some((message) => message.includes('synchronization failed')));
    }
});

test('uses the bare numeric save response when Navusoft leaves a generated record ID', async () => {
    const storage = new Map();
    const harness = createHarness(storage, { noteId: 'ext-record-7', saveResponse: '654321' });
    await flush();
    assert.equal((await harness.beforeSave('numeric-note-response')).status.statusCode, 'Proceed');
    assert.equal(harness.noteResults[0].noteId, '654321');
    assert.equal(harness.cavWrites[0].cavList[1].value, '654321');
    harness.finish('numeric-note-response');
    await flush();
    assert.equal(harness.writes.length, 1);
    assert.equal(harness.updates.length, 1);
    const reloaded = createHarness(storage);
    await flush();
    assert.equal((await reloaded.beforeSave('numeric-note-response')).status.statusCode, 'Proceed');
    assert.equal(reloaded.writes.length, 0);
    assert.equal(reloaded.cavWrites[0].cavList[1].value, '654321');
});

test('invalid numeric save responses never populate note CAVs or trigger duplicate writes', async () => {
    for (const saveResponse of ['0', '-1', 'true', 'null', '9007199254740992', 'not-json']) {
        const harness = createHarness(new Map(), { noteId: 'ext-record-7', saveResponse });
        await flush();
        assert.equal((await harness.beforeSave('invalid-note-response')).status.statusCode, 'Proceed');
        assert.equal((await harness.beforeSave('invalid-note-response')).status.statusCode, 'Proceed');
        assert.equal(harness.cavWrites.length, 0);
        assert.equal(harness.writes.length, 1);
    }
});

test('changing Related To after saving cannot relabel the note with another account', async () => {
    const storage = new Map();
    const harness = createHarness(storage);
    await flush();
    await harness.beforeSave('different-account');
    harness.openAccount('456', 'Account Two');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flush();
    await harness.beforeSave('different-account', '456');
    assert.equal(harness.writes.length, 1);
    assert.equal(harness.cavWrites.length, 1);
    assert.ok(harness.errors.some((message) => message.includes('different account')));
    const reloaded = createHarness(storage);
    await flush();
    reloaded.openAccount('456', 'Account Two');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flush();
    await reloaded.beforeSave('different-account', '456');
    assert.equal(reloaded.writes.length, 0);
    assert.equal(reloaded.cavWrites.length, 0);
});

test('disposition stays pending until the CAV write completes and both values are read back', async () => {
    let release;
    const cavGate = new Promise((resolve) => { release = resolve; });
    const harness = createHarness(new Map(), { cavGate });
    await flush();
    let completed = false;
    const disposing = harness.beforeSave('delayed-cav').then((result) => {
        completed = true;
        return result;
    });
    await flush();
    assert.equal(harness.writes.length, 1);
    assert.equal(harness.cavWrites.length, 1);
    assert.equal(completed, false);
    release();
    assert.equal((await disposing).status.statusCode, 'Proceed');
});

test('disposition proceeds with a logged error when Five9 returns different CAV values', async () => {
    const harness = createHarness(new Map(), { ignoreCavWrite: true });
    await flush();
    const result = await harness.beforeSave('unconfirmed-cav');
    assert.equal(result.status.statusCode, 'Proceed');
    assert.ok(harness.errors.some((message) => message.includes('did not confirm')));
});

test('CAV write and readback failures allow disposition without a dialog and preserve final comments', async () => {
    for (const options of [{ cavFails: true }, { cavReadFails: true }]) {
        const harness = createHarness(new Map(), options);
        await flush();
        const result = await harness.beforeSave('nonblocking-cav-failure');
        assert.equal(result.status.statusCode, 'Proceed');
        assert.equal(result.status.message, undefined);
        assert.ok(harness.errors.some((message) => message.includes('CAV synchronization failed; allowing disposition')));
        assert.ok(harness.errors.every((message) => !message.includes('disposition blocked')));
        harness.finish('nonblocking-cav-failure');
        await flush();
        assert.equal(harness.writes.length, 1);
        assert.equal(harness.updates.length, 1);
        assert.match(harness.updates[0].note, /Agent summary/);
    }
});

test('unrecognized accounts request confirmation while invalid dispositions remain blocked', async () => {
    for (const relatedId of ['999']) {
        const harness = createHarness();
        await flush();
        assert.equal((await harness.beforeSave('missing-related', relatedId)).status.statusCode, 'Confirmation');
        assert.equal(harness.writes.length, 0);
        assert.equal(harness.cavWrites.length, 0);
    }
    const harness = createHarness(new Map(), { dispositions: [] });
    await flush();
    assert.equal((await harness.beforeSave('missing-disposition')).status.statusCode, 'Error');
    assert.equal(harness.writes.length, 0);
});

test('missing account returns an SDK confirmation and can finish without a note', async () => {
    const harness = createHarness();
    await flush();
    const result = await harness.beforeSave('confirm-no-account', null);
    assert.equal(result.status.statusCode, 'Confirmation');
    assert.equal(result.status.messageHeader, 'No Account Selected');
    assert.match(result.status.message, /No note will be saved because you have not selected an account/);
    assert.equal(result.params.interactionData.interactionId, 'confirm-no-account');
    assert.equal(result.params.dispositionId, 17);
    harness.finish('confirm-no-account', null);
    await flush();
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.cavWrites.length, 0);
    assert.equal(harness.errors.length, 0);
});

test('empty and placeholder SDK selection objects request confirmation without any writes', async () => {
    for (const selectedObject of [undefined, null, {}, { id: '0' }, { id: 'None' }, { id: 'unrecognized' }]) {
        const harness = createHarness(new Map(), { selectedObject });
        await flush();
        const result = await harness.beforeSave('placeholder-selection');
        assert.equal(result.status.statusCode, 'Confirmation');
        assert.equal(result.params.interactionData.interactionId, 'placeholder-selection');
        assert.equal(harness.writes.length, 0);
        assert.equal(harness.cavWrites.length, 0);
        assert.equal(harness.errors.length, 0);
    }
});

test('NoData selection errors request confirmation but other SDK errors remain blocking', async () => {
    const noData = createHarness(new Map(), { selectionError: { errorCode: 'NoData' } });
    await flush();
    assert.equal((await noData.beforeSave('no-related-data')).status.statusCode, 'Confirmation');
    assert.equal(noData.writes.length, 0);
    assert.equal(noData.cavWrites.length, 0);
    const failed = createHarness(new Map(), { selectionError: {
        errorCode: 'InteractionNotFound', errorMessage: 'Call is unavailable'
    } });
    await flush();
    const result = await failed.beforeSave('selection-error');
    assert.equal(result.status.statusCode, 'Error');
    assert.match(result.status.message, /Call is unavailable/);
    assert.equal(failed.writes.length, 0);
    assert.equal(failed.cavWrites.length, 0);
});

test('declining the no-account confirmation permits selecting an account and retrying', async () => {
    const harness = createHarness();
    await flush();
    assert.equal((await harness.beforeSave('select-after-warning', null)).status.statusCode, 'Confirmation');
    assert.equal(harness.writes.length, 0);
    assert.equal((await harness.beforeSave('select-after-warning', '123')).status.statusCode, 'Proceed');
    assert.equal(harness.writes.length, 1);
    assert.equal(harness.cavWrites.length, 1);
});

test('the iframe URL enables Hook API and retains the dock threshold', async () => {
    const harness = createHarness();
    await flush();
    const url = new URL(harness.iframeUrl);
    assert.equal(url.searchParams.get('f9hookapi'), 'true');
    assert.equal(url.searchParams.get('f9verticalthreshold'), '300px');
    assert.ok(harness.iframeUrl.endsWith('&f9hookapi=true'));
});

test('inbound contact searches do not create a banner above the iframe', async () => {
    const harness = createHarness();
    await flush();
    const elementCount = harness.elements.length;
    harness.inbound('no-banner');
    harness.inbound('no-banner');
    await flush();
    assert.equal(harness.contactSearches.length, 1);
    assert.equal(harness.contactSearches[0].phone, '7249725640');
    assert.equal(harness.elements.length, elementCount);
    assert.ok(!harness.elements.some((element) => element.className === 'lookup'));
    const surface = harness.elements.find((element) => element.className === 'surface');
    assert.deepEqual(surface.children.map((element) => element.tag), ['iframe']);
    assert.ok(harness.logs.some((args) => args[0].includes('contact search completed')));
});